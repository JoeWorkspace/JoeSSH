import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const REQUEST_PATH = fileURLToPath(new URL("./prepare-desktop-formal-artifact-request.mjs", import.meta.url));

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "desktop-formal-artifact-request-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
  });
  writeFile(root, "package.json", `${JSON.stringify({ version: "0.1.0-beta.1" })}\n`);
  return root;
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function readFile(root, relativePath) {
  return readFileSync(join(root, ...relativePath.split("/")), "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runRequest(root, extraArgs = [], env = {}) {
  return spawnSync(process.execPath, [REQUEST_PATH, "--root", root, ...extraArgs], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function createFakeGitCommands(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    dirtyStatus: "",
    fsckFails: false,
    head: "abc123",
    repository: "https://example.invalid/JoeWorkspace/JoeSSH.git",
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

test("writes checksum-covered Desktop formal artifact request from a clean release tag", (t) => {
  const root = createFixture(t);

  const result = runRequest(root, [], createFakeGitCommands(root));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(
    existsSync(join(root, "reports", "handoff", "desktop", "formal-artifact-request.json")),
    true,
  );
  assert.equal(
    existsSync(join(root, "reports", "handoff", "desktop", "formal-artifact-request-SHA256SUMS.txt")),
    true,
  );

  const requestText = readFile(root, "reports/handoff/desktop/formal-artifact-request.json");
  const request = JSON.parse(requestText);
  assert.equal(request.kind, "joessh-desktop-formal-artifact-request");
  assert.match(request.requestId, /^desktop-formal-0\.1\.0-beta\.1-[a-f0-9]{16}$/);
  assert.equal(request.version, "0.1.0-beta.1");
  assert.equal(request.releaseTag, "v0.1.0-beta.1");
  assert.equal(request.source.gitCommit, "abc123");
  assert.deepEqual(request.requiredPlatforms, ["windows", "macos", "linux"]);
  assert.deepEqual(request.source.cleanTreeExcluding, ["reports/release", "reports/handoff"]);
  assert.deepEqual(request.artifactContract.platforms.windows.requiredProofFiles, [
    "windows-signature-verification.txt",
  ]);
  assert.deepEqual(request.artifactContract.proofTextRules.mustMentionAll, [
    "artifact file name",
    "artifact SHA256",
  ]);
  assert.equal(request.returnedManifest.fileName, "desktop-formal-artifact-manifest.json");
  assert.equal(request.returnedManifest.required, true);
  assert.match(request.returnedManifest.requiredFields.join("\n"), /artifacts\[\]\.sha256/);
  assert.deepEqual(request.artifactContract.platforms.macos.requiredProofFiles, [
    "macos-signature-verification.txt",
    "macos-notarization-verification.txt",
  ]);
  assert.deepEqual(request.artifactContract.platforms.linux.acceptedExtensions, [
    ".AppImage",
    ".deb",
    ".rpm",
  ]);
  assert.equal(request.inputDirectory.mustBeOutsideReleaseWorkspace, true);
  assert.match(request.commands.kit, /release:desktop:formal-artifacts:kit/);
  assert.match(request.commands.kitVerify, /release:desktop:formal-artifacts:kit:verify/);
  assert.match(request.commands.manifest, /release:desktop:formal-artifacts:manifest/);
  assert.match(request.commands.intake, /release:desktop:formal-artifacts:intake/);
  assert.match(request.commands.import, /--source-authority local/);
  assert.match(request.clearsRcBlockers.join("\n"), /release-evidence-SHA256SUMS\.txt/);

  assert.equal(
    readFile(root, "reports/handoff/desktop/formal-artifact-request-SHA256SUMS.txt"),
    `${sha256(requestText)}  reports/handoff/desktop/formal-artifact-request.json\n`,
  );
});

test("rejects dirty source before writing a Desktop formal artifact request", (t) => {
  const root = createFixture(t);

  const result = runRequest(root, [], createFakeGitCommands(root, { dirtyStatus: " M package.json" }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be clean/);
  assert.equal(existsSync(join(root, "reports", "handoff", "desktop", "formal-artifact-request.json")), false);
});

test("rejects a release tag that does not point at HEAD", (t) => {
  const root = createFixture(t);

  const result = runRequest(root, [], createFakeGitCommands(root, { tagCommit: "def456" }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release tag v0\.1\.0-beta\.1 must point at HEAD/);
});

test("rejects unsupported required Desktop platforms", (t) => {
  const root = createFixture(t);

  const result = runRequest(root, ["--require-platforms", "windows,freebsd"], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported platform/);
});
