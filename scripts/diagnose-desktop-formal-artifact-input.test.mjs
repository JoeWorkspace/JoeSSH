import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(new URL("./diagnose-desktop-formal-artifact-input.mjs", import.meta.url));

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "desktop-formal-artifact-intake-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
  });
  writeFile(root, "package.json", `${JSON.stringify({ version: "0.1.0-beta.1" })}\n`);
  return root;
}

function createInput(t) {
  const inputDir = mkdtempSync(join(tmpdir(), "desktop-formal-artifact-input-"));
  t.after(() => {
    rmSync(inputDir, { force: true, recursive: true });
  });
  const artifacts = [
    ["JoeSSH_0.1.0-beta.1_x64-setup.exe", "windows", "windows", null],
    ["JoeSSH_0.1.0-beta.1_aarch64.dmg", "macos", "macos", null],
    ["JoeSSH_0.1.0-beta.1_amd64.AppImage", "linux", "linux", "AppImage"],
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
  writeFile(
    inputDir,
    "desktop-formal-artifact-manifest.json",
    `${JSON.stringify(
      {
        artifacts: artifacts.map(([fileName, content, platform, packageType]) => ({
          fileName,
          packageType,
          platform,
          sha256: sha256(content),
          sizeBytes: Buffer.byteLength(content),
        })),
        kind: "joessh-desktop-formal-artifact-manifest",
        manifestVersion: 1,
        product: "JoeSSH",
        releaseTag: "v0.1.0-beta.1",
        requestId: "desktop-formal-test",
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
    )}\n`,
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
if (key === "rev-parse HEAD") {
  console.log(state.head);
  process.exit(0);
}
if (key === "rev-parse --verify v0.1.0-beta.1^{}") {
  console.log(state.tagCommit);
  process.exit(0);
}
if (key === "remote get-url origin") {
  console.log("https://github.com/joessh/joessh.git");
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

function runDiagnostics(root, args = [], env = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH, "--root", root, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
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

test("writes a no-go intake report when input is missing", (t) => {
  const root = createFixture(t);

  const result = runDiagnostics(root, ["--no-fail"]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = readReport(root);
  assert.equal(report.decision, "no-go");
  assert.equal(report.blockers.some((blocker) => blocker.id === "desktop-formal-input"), true);
  assert.match(
    readFileSync(join(root, "reports", "handoff", "desktop", "formal-artifact-input-report-SHA256SUMS.txt"), "utf8"),
    /reports\/handoff\/desktop\/formal-artifact-input-report\.json/,
  );
});

test("accepts a complete input directory and runs the formal preflight without importing", (t) => {
  const root = createFixture(t);
  const inputDir = createInput(t);

  const result = runDiagnostics(root, ["--input-dir", inputDir], createFakeGitCommands(root));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = readReport(root);
  assert.equal(report.decision, "go");
  assert.equal(report.artifacts.length, 3);
  assert.equal(report.preflight.status, "pass");
  assert.equal(report.manifest.status, "pass");
  assert.equal(report.proofFiles.windowsSignature.status, "pass");
  assert.equal(report.artifacts.find((artifact) => artifact.platform === "windows").sha256, sha256("windows"));
  assert.throws(() => readFileSync(join(root, "reports", "release", "desktop", "release-evidence.json")));
});

test("reports missing platform artifacts before preflight", (t) => {
  const root = createFixture(t);
  const inputDir = mkdtempSync(join(tmpdir(), "desktop-formal-artifact-input-partial-"));
  t.after(() => rmSync(inputDir, { force: true, recursive: true }));
  writeFile(inputDir, "JoeSSH_0.1.0-beta.1_x64-setup.exe", "windows");
  writeFile(inputDir, "windows-signature-verification.txt", "signtool verify /pa JoeSSH_0.1.0-beta.1_x64-setup.exe passed");

  const result = runDiagnostics(root, ["--input-dir", inputDir, "--no-fail"], createFakeGitCommands(root));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = readReport(root);
  assert.equal(report.decision, "no-go");
  assert.equal(report.preflight.attempted, false);
  assert.match(
    report.blockers.find((blocker) => blocker.id === "desktop-formal-artifact-platforms").detail,
    /macos, linux/,
  );
});

test("reports missing returned formal artifact manifest before preflight", (t) => {
  const root = createFixture(t);
  const inputDir = createInput(t);
  rmSync(join(inputDir, "desktop-formal-artifact-manifest.json"));

  const result = runDiagnostics(root, ["--input-dir", inputDir, "--no-fail"], createFakeGitCommands(root));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = readReport(root);
  assert.equal(report.decision, "no-go");
  assert.equal(report.preflight.attempted, false);
  assert.match(
    report.blockers.find((blocker) => blocker.id === "desktop-formal-artifact-manifest").detail,
    /desktop-formal-artifact-manifest\.json is required/,
  );
});

test("reports failed signing proof semantics", (t) => {
  const root = createFixture(t);
  const inputDir = createInput(t);
  writeFile(inputDir, "windows-signature-verification.txt", "signtool verify /pa JoeSSH_0.1.0-beta.1_x64-setup.exe failed");

  const result = runDiagnostics(root, ["--input-dir", inputDir, "--no-fail"], createFakeGitCommands(root));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = readReport(root);
  assert.equal(report.decision, "no-go");
  assert.equal(report.proofFiles.windowsSignature.status, "fail");
  assert.match(
    report.blockers.find((blocker) => blocker.id === "windows-signature-verification").detail,
    /must not report a failed verification/,
  );
});
