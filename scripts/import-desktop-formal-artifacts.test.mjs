import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const IMPORTER_PATH = fileURLToPath(new URL("./import-desktop-formal-artifacts.mjs", import.meta.url));

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "desktop-formal-artifact-import-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
  });
  writeFile(root, "package.json", `${JSON.stringify({ version: "0.1.0-beta.1" })}\n`);
  return root;
}

function writeFile(root, relativePath, content, encoding = "utf8") {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, encoding);
}

function readReleaseFile(root, relativePath) {
  return readFileSync(join(root, ...relativePath.split("/")), "utf8");
}

function createSignedArtifactInput(t) {
  const inputDir = mkdtempSync(join(tmpdir(), "desktop-formal-signed-input-"));
  t.after(() => {
    rmSync(inputDir, { force: true, recursive: true });
  });
  writeFile(inputDir, "JoeSSH_0.1.0-beta.1_x64-setup.exe", "windows");
  writeFile(inputDir, "JoeSSH_0.1.0-beta.1_aarch64.dmg", "macos");
  writeFile(inputDir, "JoeSSH_0.1.0-beta.1_amd64.AppImage", "linux");
  writeFile(inputDir, "windows-signature-verification.txt", "signtool verify JoeSSH_0.1.0-beta.1_x64-setup.exe passed");
  writeFile(inputDir, "macos-signature-verification.txt", "codesign --verify JoeSSH_0.1.0-beta.1_aarch64.dmg passed");
  writeFile(inputDir, "macos-notarization-verification.txt", "spctl --assess JoeSSH_0.1.0-beta.1_aarch64.dmg accepted");
  return inputDir;
}

function runImporter(root, inputDir, extraArgs = [], env = {}) {
  return spawnSync(
    process.execPath,
    [IMPORTER_PATH, "--root", root, "--input-dir", inputDir, ...extraArgs],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    },
  );
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

test("imports signed Desktop formal artifacts and verifies local source evidence", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t);

  const result = runImporter(root, inputDir, [], createFakeGitCommands(root));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "JoeSSH_0.1.0-beta.1_x64-setup.exe")), true);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "JoeSSH_0.1.0-beta.1_aarch64.dmg")), true);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "JoeSSH_0.1.0-beta.1_amd64.AppImage")), true);
  assert.match(readReleaseFile(root, "reports/release/desktop/SHA256SUMS.txt"), /JoeSSH_0\.1\.0-beta\.1_x64-setup\.exe/);
  assert.match(
    readReleaseFile(root, "reports/release/desktop/release-evidence-SHA256SUMS.txt"),
    /reports\/release\/desktop\/release-evidence-source\.json/,
  );

  const evidence = JSON.parse(readReleaseFile(root, "reports/release/desktop/release-evidence.json"));
  assert.deepEqual(
    evidence.artifacts.map((artifact) => artifact.platform).sort(),
    ["linux", "macos", "windows"],
  );
  const source = JSON.parse(readReleaseFile(root, "reports/release/desktop/release-evidence-source.json"));
  assert.equal(source.sourceAuthority, "local");
  assert.equal(source.releaseTagCommit, "abc123");
  assert.equal(source.source.gitFsckStrict, true);
  assert.equal(source.runner.type, "local-release-machine");
  assert.match(result.stdout, /Desktop release evidence verified for 3 artifact\(s\)/);
});

test("imports self-hosted Desktop formal artifacts with self-hosted source authority", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t);

  const result = runImporter(
    root,
    inputDir,
    ["--source-authority", "self-hosted"],
    createFakeGitCommands(root),
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const source = JSON.parse(readReleaseFile(root, "reports/release/desktop/release-evidence-source.json"));
  assert.equal(source.sourceAuthority, "self-hosted");
  assert.equal(source.runner.type, "self-hosted-release-machine");
});

test("preflights signed Desktop formal artifacts without importing them", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t);

  const result = runImporter(root, inputDir, ["--preflight-only"], createFakeGitCommands(root));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Desktop release package preflight passed for 3 artifact\(s\)/);
  assert.match(result.stdout, /Desktop formal artifact input preflight passed for 3 artifact\(s\)/);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "release-evidence.json")), false);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "SHA256SUMS.txt")), false);
});

test("rejects macOS artifacts without notarization proof", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t);
  rmSync(join(inputDir, "macos-notarization-verification.txt"));

  const result = runImporter(root, inputDir, [], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /macOS notarization verification proof file is required/);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "release-evidence.json")), false);
});

test("preflight rejects signature proof that is not bound to the artifact identity", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t);
  writeFile(inputDir, "windows-signature-verification.txt", "signtool verify passed");

  const result = runImporter(root, inputDir, ["--preflight-only"], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Windows signature verification proof must mention the artifact file name or SHA256/);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "release-evidence.json")), false);
});

test("rejects stale Desktop formal artifacts before packaging", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t);
  writeFile(inputDir, "JoeSSH_0.1.0-beta.0_amd64.deb", "old linux");

  const result = runImporter(root, inputDir, [], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /do not include 0\.1\.0-beta\.1/);
  assert.match(result.stderr, /0\.1\.0-beta\.0/);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "release-evidence.json")), false);
});

test("accepts explicit UTF-16LE proof files", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t);
  writeFileSync(
    join(inputDir, "windows-signature-verification.txt"),
    Buffer.from("\uFEFFsigntool verify JoeSSH_0.1.0-beta.1_x64-setup.exe passed", "utf16le"),
  );

  const result = runImporter(root, inputDir, [], createFakeGitCommands(root));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const evidence = JSON.parse(readReleaseFile(root, "reports/release/desktop/release-evidence.json"));
  assert.match(evidence.artifacts.find((artifact) => artifact.platform === "windows").signatureVerification, /signtool/);
});

test("rejects input directories inside the release workspace before packaging", (t) => {
  const root = createFixture(t);
  writeFile(root, "signed/JoeSSH_0.1.0-beta.1_x64-setup.exe", "windows");
  writeFile(root, "signed/JoeSSH_0.1.0-beta.1_aarch64.dmg", "macos");
  writeFile(root, "signed/JoeSSH_0.1.0-beta.1_amd64.AppImage", "linux");
  writeFile(root, "signed/windows-signature-verification.txt", "signtool verify JoeSSH_0.1.0-beta.1_x64-setup.exe passed");
  writeFile(root, "signed/macos-signature-verification.txt", "codesign --verify JoeSSH_0.1.0-beta.1_aarch64.dmg passed");
  writeFile(root, "signed/macos-notarization-verification.txt", "spctl --assess JoeSSH_0.1.0-beta.1_aarch64.dmg accepted");

  const result = runImporter(root, join(root, "signed"), [], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--input-dir must be outside the release workspace/);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "release-evidence.json")), false);
});
