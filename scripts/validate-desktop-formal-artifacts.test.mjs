import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(new URL("./validate-desktop-formal-artifacts.mjs", import.meta.url));

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "desktop-formal-artifact-validate-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
  });
  writeFile(root, "package.json", `${JSON.stringify({ version: "0.1.0-beta.1" })}\n`);
  writeCurrentRequest(root);
  return root;
}

function writeCurrentRequest(root) {
  const request = JSON.stringify(
    {
      artifactContract: {},
      kind: "joessh-desktop-formal-artifact-request",
      product: "JoeSSH",
      releaseTag: "v0.1.0-beta.1",
      requestId: "desktop-formal-test",
      requestVersion: 1,
      requiredPlatforms: ["windows", "macos", "linux"],
      source: {
        gitCommit: "abc123",
        gitFsckStrict: true,
        releaseTagCommit: "abc123",
        repository: "https://github.com/joessh/joessh.git",
      },
      sourceAuthority: "local",
      version: "0.1.0-beta.1",
    },
    null,
    2,
  );
  writeFile(root, "reports/handoff/desktop/formal-artifact-request.json", `${request}\n`);
  writeFile(
    root,
    "reports/handoff/desktop/formal-artifact-request-SHA256SUMS.txt",
    `${sha256(`${request}\n`)}  reports/handoff/desktop/formal-artifact-request.json\n`,
  );
}

function createInput(t, options = {}) {
  const inputDir = mkdtempSync(join(tmpdir(), "desktop-formal-artifact-input-"));
  t.after(() => {
    rmSync(inputDir, { force: true, recursive: true });
  });
  const artifacts = [
    ["JoeSSH_0.1.0-beta.1_x64-setup.exe", "windows", "windows"],
    ["JoeSSH_0.1.0-beta.1_aarch64.dmg", "macos", "macos"],
    ...(options.includeLinux === false ? [] : [["JoeSSH_0.1.0-beta.1_amd64.AppImage", "linux", "linux"]]),
  ];
  for (const [fileName, content] of artifacts) {
    writeFile(inputDir, fileName, content);
  }
  writeFile(
    inputDir,
    "windows-signature-verification.txt",
    `signtool verify /pa JoeSSH_0.1.0-beta.1_x64-setup.exe ${sha256("windows")} passed`,
  );
  writeFile(
    inputDir,
    "macos-signature-verification.txt",
    `codesign --verify JoeSSH_0.1.0-beta.1_aarch64.dmg ${sha256("macos")} passed`,
  );
  writeFile(
    inputDir,
    "macos-notarization-verification.txt",
    `spctl --assess JoeSSH_0.1.0-beta.1_aarch64.dmg ${sha256("macos")} accepted`,
  );
  return inputDir;
}

function createFakeGitCommands(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    dirtyStatus: "",
    fsckFails: false,
    head: "abc123",
    repository: "https://github.com/joessh/joessh.git",
    tagCommit: "abc123",
    ...options,
  };
  const fakeGitPath = join(binDir, "git.js");
  writeFileSync(
    fakeGitPath,
    `
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join(" ");
if (key === "rev-parse --is-inside-work-tree") {
  console.log("true");
  process.exit(0);
}
if (key === "status --porcelain=v1 --untracked-files=all -- . :(exclude)reports/release") {
  if (state.dirtyStatus) {
    console.log(state.dirtyStatus);
  }
  process.exit(0);
}
if (key === "status --porcelain=v1 --untracked-files=all -- . :(exclude)reports/release :(exclude)reports/handoff") {
  if (state.dirtyStatus) {
    console.log(state.dirtyStatus);
  }
  process.exit(0);
}
if (key === "rev-parse HEAD") {
  console.log(state.head);
  process.exit(0);
}
if (key === "rev-parse --verify v0.1.0-beta.1^{}") {
  console.log(state.tagCommit);
  process.exit(0);
}
if (key === "remote get-url origin") {
  console.log(state.repository);
  process.exit(0);
}
if (key === "fsck --strict") {
  if (state.fsckFails) {
    console.error("fsck failed");
    process.exit(1);
  }
  process.exit(0);
}
console.error("unexpected git args: " + key);
process.exit(2);
`,
    "utf8",
  );

  return {
    ATLASTERM_RELEASE_GIT_ARGS: JSON.stringify([fakeGitPath]),
    ATLASTERM_RELEASE_GIT_COMMAND: process.execPath,
  };
}

function runValidate(root, inputDir, extraArgs = [], env = {}) {
  return spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--root", root, "--input-dir", inputDir, ...extraArgs],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    },
  );
}

function readReport(root) {
  return JSON.parse(readFileSync(join(root, "reports", "handoff", "desktop", "formal-artifact-input-report.json"), "utf8"));
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("generates a manifest and validates signed Desktop formal artifacts without importing", (t) => {
  const root = createFixture(t);
  const inputDir = createInput(t);

  const result = runValidate(root, inputDir, [], createFakeGitCommands(root));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Wrote Desktop formal artifact manifest for 3 artifact\(s\)/);
  assert.match(result.stdout, /Desktop formal artifact validation passed/);
  assert.equal(existsSync(join(inputDir, "desktop-formal-artifact-manifest.json")), true);
  assert.equal(readReport(root).decision, "go");
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "release-evidence.json")), false);
});

test("fails after writing intake evidence when the signed input is incomplete", (t) => {
  const root = createFixture(t);
  const inputDir = createInput(t, { includeLinux: false });

  const result = runValidate(root, inputDir, [], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /validation is no-go/);
  const report = readReport(root);
  assert.equal(report.decision, "no-go");
  assert.equal(
    report.blockers.some((blocker) => blocker.id === "desktop-formal-artifact-platforms"),
    true,
  );
});

test("reuses an existing returned manifest unless forced", (t) => {
  const root = createFixture(t);
  const inputDir = createInput(t);

  const first = runValidate(root, inputDir, [], createFakeGitCommands(root));
  assert.equal(first.status, 0, first.stdout + first.stderr);

  const second = runValidate(root, inputDir, [], createFakeGitCommands(root));
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.match(second.stdout, /Using existing/);

  const forced = runValidate(root, inputDir, ["--force-manifest"], createFakeGitCommands(root));
  assert.equal(forced.status, 0, forced.stdout + forced.stderr);
  assert.match(forced.stdout, /Wrote Desktop formal artifact manifest for 3 artifact\(s\)/);
});
