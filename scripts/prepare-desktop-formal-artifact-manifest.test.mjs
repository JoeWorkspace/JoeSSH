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

const MANIFEST_PATH = fileURLToPath(
  new URL("./prepare-desktop-formal-artifact-manifest.mjs", import.meta.url),
);

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "desktop-formal-artifact-manifest-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
  });
  writeFile(root, "package.json", `${JSON.stringify({ version: "0.1.0-beta.1" })}\n`);
  writeCurrentRequest(root);
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

function writeCurrentRequest(root, options = {}) {
  const request = {
    artifactContract: {},
    kind: "joessh-desktop-formal-artifact-request",
    product: "JoeSSH",
    releaseTag: "v0.1.0-beta.1",
    requestId: options.requestId ?? "desktop-formal-test",
    requestVersion: 1,
    requiredPlatforms: options.requiredPlatforms ?? ["windows", "macos", "linux"],
    source: {
      gitCommit: options.gitCommit ?? "abc123",
      gitFsckStrict: true,
      releaseTagCommit: options.releaseTagCommit ?? "abc123",
      repository: options.repository ?? "https://github.com/joessh/joessh.git",
    },
    sourceAuthority: options.sourceAuthority ?? "local",
    version: "0.1.0-beta.1",
  };
  const requestText = `${JSON.stringify(request, null, 2)}\n`;
  writeFile(root, "reports/handoff/desktop/formal-artifact-request.json", requestText);
  writeFile(
    root,
    "reports/handoff/desktop/formal-artifact-request-SHA256SUMS.txt",
    `${sha256(requestText)}  reports/handoff/desktop/formal-artifact-request.json\n`,
  );
}

function createSignedArtifactInput(t, options = {}) {
  const inputDir = mkdtempSync(join(tmpdir(), "desktop-formal-signed-input-"));
  t.after(() => {
    rmSync(inputDir, { force: true, recursive: true });
  });

  const artifacts = [
    ["JoeSSH_0.1.0-beta.1_x64-setup.exe", "windows"],
    ["JoeSSH_0.1.0-beta.1_aarch64.dmg", "macos"],
    ...(options.includeLinux === false
      ? []
      : [["JoeSSH_0.1.0-beta.1_amd64.AppImage", "linux"]]),
  ];
  for (const [fileName, content] of artifacts) {
    writeFile(inputDir, fileName, content);
  }
  if (options.includeStaleArtifact) {
    writeFile(inputDir, "JoeSSH_0.1.0-beta.0_amd64.deb", "old linux");
  }
  return inputDir;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runManifest(root, inputDir, extraArgs = [], env = {}) {
  return spawnSync(
    process.execPath,
    [MANIFEST_PATH, "--root", root, "--input-dir", inputDir, ...extraArgs],
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

test("writes a request-bound Desktop formal artifact manifest", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t);

  const result = runManifest(root, inputDir, [], createFakeGitCommands(root));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Wrote Desktop formal artifact manifest for 3 artifact\(s\)/);
  assert.equal(existsSync(join(inputDir, "desktop-formal-artifact-manifest.json")), true);

  const manifest = JSON.parse(readFile(inputDir, "desktop-formal-artifact-manifest.json"));
  assert.equal(manifest.kind, "joessh-desktop-formal-artifact-manifest");
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.requestId, "desktop-formal-test");
  assert.equal(manifest.version, "0.1.0-beta.1");
  assert.equal(manifest.releaseTag, "v0.1.0-beta.1");
  assert.equal(manifest.sourceAuthority, "local");
  assert.equal(manifest.source.gitCommit, "abc123");
  assert.equal(manifest.source.releaseTagCommit, "abc123");
  assert.equal(manifest.source.gitFsckStrict, true);
  assert.deepEqual(
    manifest.artifacts.map((artifact) => artifact.fileName).sort(),
    [
      "JoeSSH_0.1.0-beta.1_aarch64.dmg",
      "JoeSSH_0.1.0-beta.1_amd64.AppImage",
      "JoeSSH_0.1.0-beta.1_x64-setup.exe",
    ],
  );
  assert.deepEqual(
    manifest.artifacts.map((artifact) => artifact.platform).sort(),
    ["linux", "macos", "windows"],
  );
  assert.equal(
    manifest.artifacts.find((artifact) => artifact.fileName.endsWith(".AppImage")).packageType,
    "AppImage",
  );
  assert.equal(
    manifest.artifacts.find((artifact) => artifact.fileName.endsWith(".exe")).sha256,
    sha256("windows"),
  );
  assert.equal(
    manifest.artifacts.find((artifact) => artifact.fileName.endsWith(".dmg")).sizeBytes,
    Buffer.byteLength("macos"),
  );
});

test("rejects manifest generation without the current request checksum", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t);
  rmSync(join(root, "reports", "handoff", "desktop", "formal-artifact-request-SHA256SUMS.txt"));

  const result = runManifest(root, inputDir, [], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /request checksum manifest is required/);
  assert.equal(existsSync(join(inputDir, "desktop-formal-artifact-manifest.json")), false);
});

test("rejects a request built from a different commit", (t) => {
  const root = createFixture(t);
  writeCurrentRequest(root, { gitCommit: "def456" });
  const inputDir = createSignedArtifactInput(t);

  const result = runManifest(root, inputDir, [], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /request\.source\.gitCommit must match current HEAD/);
  assert.equal(existsSync(join(inputDir, "desktop-formal-artifact-manifest.json")), false);
});

test("rejects stale Desktop formal artifact filenames", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t, { includeStaleArtifact: true });

  const result = runManifest(root, inputDir, [], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /do not include 0\.1\.0-beta\.1/);
  assert.match(result.stderr, /0\.1\.0-beta\.0/);
  assert.equal(existsSync(join(inputDir, "desktop-formal-artifact-manifest.json")), false);
});

test("rejects missing required Desktop platforms", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t, { includeLinux: false });

  const result = runManifest(root, inputDir, [], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required platform\(s\): linux/);
  assert.equal(existsSync(join(inputDir, "desktop-formal-artifact-manifest.json")), false);
});

test("rejects output paths outside the signed artifact input directory", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t);

  const result = runManifest(
    root,
    inputDir,
    ["--output", join(root, "desktop-formal-artifact-manifest.json")],
    createFakeGitCommands(root),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--output must stay inside --input-dir/);
  assert.equal(existsSync(join(inputDir, "desktop-formal-artifact-manifest.json")), false);
});

test("rejects an existing manifest unless force is explicit", (t) => {
  const root = createFixture(t);
  const inputDir = createSignedArtifactInput(t);
  writeFile(inputDir, "desktop-formal-artifact-manifest.json", "{}\n");

  const result = runManifest(root, inputDir, [], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exists/);
});
