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
import { inflateRawSync } from "node:zlib";
import test from "node:test";

const KIT_PATH = fileURLToPath(new URL("./prepare-desktop-formal-artifact-kit.mjs", import.meta.url));

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "desktop-formal-artifact-kit-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
  });
  writeFile(root, "package.json", `${JSON.stringify({ version: "0.1.0-beta.1" })}\n`);
  writeCurrentRequest(root);
  writeFile(root, "reports/handoff/desktop/formal-evidence-unblock-report.json", '{"decision":"no-go"}\n');
  writeFile(root, "reports/handoff/desktop/unsigned-staging-report.json", '{"publicReleaseEvidence":false}\n');
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
    artifactContract: {
      platforms: {
        linux: { acceptedExtensions: [".AppImage", ".deb", ".rpm"], requiredProofFiles: [] },
        macos: {
          acceptedExtensions: [".dmg", ".pkg", ".app.tar.gz"],
          requiredProofFiles: ["macos-signature-verification.txt", "macos-notarization-verification.txt"],
        },
        windows: { acceptedExtensions: [".exe", ".msi", ".msix"], requiredProofFiles: ["windows-signature-verification.txt"] },
      },
      proofTextRules: { mustMentionAll: ["artifact file name", "artifact SHA256"] },
    },
    commands: {
      import: "npm run release:desktop:formal-artifacts:import -- --input-dir <signed-artifact-dir> --source-authority local",
      intake: "npm run release:desktop:formal-artifacts:intake -- --input-dir <signed-artifact-dir> --source-authority local",
      manifest: "npm run release:desktop:formal-artifacts:manifest -- --input-dir <signed-artifact-dir> --source-authority local",
      preflight: "npm run release:desktop:formal-artifacts:preflight -- --input-dir <signed-artifact-dir> --source-authority local",
      verify: "npm run release:desktop:verify-evidence -- --require-source --require-current-git-source",
    },
    inputDirectory: {
      fileNameMustInclude: "0.1.0-beta.1",
      mustBeOutsideReleaseWorkspace: true,
      proofFilesMustBePlainText: true,
    },
    kind: "joessh-desktop-formal-artifact-request",
    product: "JoeSSH",
    releaseTag: "v0.1.0-beta.1",
    requestId: options.requestId ?? "desktop-formal-test",
    requestVersion: 1,
    requiredPlatforms: options.requiredPlatforms ?? ["windows", "macos", "linux"],
    returnedManifest: {
      fileName: "desktop-formal-artifact-manifest.json",
      required: true,
      requiredFields: ["requestId", "source.gitCommit", "source.releaseTagCommit", "artifacts[].sha256"],
    },
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

function runKit(root, extraArgs = [], env = {}) {
  return spawnSync(process.execPath, [KIT_PATH, "--root", root, ...extraArgs], {
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

function readZipEntries(path) {
  const archive = readFileSync(path);
  const endOfCentralDirectoryOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(endOfCentralDirectoryOffset, -1);

  const entryCount = archive.readUInt16LE(endOfCentralDirectoryOffset + 10);
  let offset = archive.readUInt32LE(endOfCentralDirectoryOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    assert.equal(archive.readUInt32LE(localHeaderOffset), 0x04034b50);
    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, compressionMethod === 8 ? inflateRawSync(compressed).toString("utf8") : compressed.toString("utf8"));

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("writes a checksum-covered Desktop formal artifact handoff kit", (t) => {
  const root = createFixture(t);

  const result = runKit(root, [], createFakeGitCommands(root));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const archivePath = join(root, "reports", "handoff", "desktop", "desktop-formal-artifact-handoff-kit-0.1.0-beta.1.zip");
  assert.equal(existsSync(archivePath), true);
  const entries = readZipEntries(archivePath);
  assert.match(entries.get("README.md"), /This kit is bound to v0\.1\.0-beta\.1 at abc123/);
  assert.match(entries.get("README.md"), /desktop-formal-artifact-manifest\.json/);
  assert.match(entries.get("commands/windows-powershell.ps1"), /release:desktop:formal-artifacts:manifest/);
  assert.match(entries.get("commands/unix.sh"), /release:desktop:formal-artifacts:import/);
  assert.equal(
    entries.get("formal-artifact-request.json"),
    readFile(root, "reports/handoff/desktop/formal-artifact-request.json"),
  );
  assert.equal(
    entries.get("formal-artifact-request-SHA256SUMS.txt"),
    readFile(root, "reports/handoff/desktop/formal-artifact-request-SHA256SUMS.txt"),
  );
  assert.equal(entries.get("context/formal-evidence-unblock-report.json"), '{"decision":"no-go"}\n');
  assert.equal(entries.get("context/unsigned-staging-report.json"), '{"publicReleaseEvidence":false}\n');

  const kit = JSON.parse(entries.get("formal-artifact-handoff-kit.json"));
  assert.equal(kit.kind, "joessh-desktop-formal-artifact-handoff-kit");
  assert.equal(kit.requestId, "desktop-formal-test");
  assert.equal(kit.source.gitCommit, "abc123");
  assert.equal(kit.source.releaseTagCommit, "abc123");
  assert.deepEqual(kit.requiredPlatforms, ["windows", "macos", "linux"]);
  assert.match(kit.commands.preflight, /release:desktop:formal-artifacts:preflight/);
  assert.equal(
    kit.includedFiles.find((entry) => entry.path.endsWith("formal-artifact-request.json")).sha256,
    sha256File(join(root, "reports", "handoff", "desktop", "formal-artifact-request.json")),
  );

  assert.equal(
    readFile(root, "reports/handoff/desktop/desktop-formal-artifact-handoff-kit-0.1.0-beta.1-SHA256SUMS.txt"),
    `${sha256File(archivePath)}  reports/handoff/desktop/desktop-formal-artifact-handoff-kit-0.1.0-beta.1.zip\n`,
  );
});

test("rejects kit generation without the current request checksum", (t) => {
  const root = createFixture(t);
  rmSync(join(root, "reports", "handoff", "desktop", "formal-artifact-request-SHA256SUMS.txt"));

  const result = runKit(root, [], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /request checksum manifest is required/);
  assert.equal(
    existsSync(join(root, "reports", "handoff", "desktop", "desktop-formal-artifact-handoff-kit-0.1.0-beta.1.zip")),
    false,
  );
});

test("rejects a handoff request from a different commit", (t) => {
  const root = createFixture(t);
  writeCurrentRequest(root, { gitCommit: "def456" });

  const result = runKit(root, [], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /request\.source\.gitCommit must match current HEAD/);
});

test("rejects output paths outside the release root", (t) => {
  const root = createFixture(t);

  const result = runKit(root, ["--output", join(root, "..", "kit.zip")], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /output paths must stay inside the release root/);
});
