import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const KIT_PATH = fileURLToPath(new URL("./prepare-desktop-formal-artifact-kit.mjs", import.meta.url));
const VERIFY_PATH = fileURLToPath(new URL("./verify-desktop-formal-artifact-kit.mjs", import.meta.url));

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "desktop-formal-artifact-kit-verify-"));
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
      kit: "npm run release:desktop:formal-artifacts:kit -- --source-authority local",
      kitVerify: "npm run release:desktop:formal-artifacts:kit:verify -- --source-authority local",
      manifest: "npm run release:desktop:formal-artifacts:manifest -- --input-dir <signed-artifact-dir> --source-authority local",
      preflight: "npm run release:desktop:formal-artifacts:preflight -- --input-dir <signed-artifact-dir> --source-authority local",
      verify: "npm run release:desktop:verify-evidence -- --require-source --require-current-git-source --require-source-authority local",
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
    requiredPlatforms: ["windows", "macos", "linux"],
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

function runKit(root, env = {}) {
  return spawnSync(process.execPath, [KIT_PATH, "--root", root], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function runVerifier(root, extraArgs = [], env = {}) {
  return spawnSync(process.execPath, [VERIFY_PATH, "--root", root, ...extraArgs], {
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

function kitChecksumPath(root) {
  return join(
    root,
    "reports",
    "handoff",
    "desktop",
    "desktop-formal-artifact-handoff-kit-0.1.0-beta.1-SHA256SUMS.txt",
  );
}

function kitZipPath(root) {
  return join(root, "reports", "handoff", "desktop", "desktop-formal-artifact-handoff-kit-0.1.0-beta.1.zip");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function generateKit(root, env = createFakeGitCommands(root)) {
  const result = runKit(root, env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(kitZipPath(root)), true);
  assert.equal(existsSync(kitChecksumPath(root)), true);
  return env;
}

test("verifies a checksum-covered Desktop formal artifact handoff kit", (t) => {
  const root = createFixture(t);
  const env = generateKit(root);

  const result = runVerifier(root, [], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Desktop formal artifact handoff kit verified for v0\.1\.0-beta\.1/);
});

test("rejects a handoff kit checksum mismatch", (t) => {
  const root = createFixture(t);
  const env = generateKit(root);
  writeFileSync(
    kitChecksumPath(root),
    `0000000000000000000000000000000000000000000000000000000000000000  reports/handoff/desktop/desktop-formal-artifact-handoff-kit-0.1.0-beta.1.zip\n`,
    "utf8",
  );

  const result = runVerifier(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /checksum does not match/);
});

test("rejects a missing handoff kit checksum manifest", (t) => {
  const root = createFixture(t);
  const env = generateKit(root);
  rmSync(kitChecksumPath(root));

  const result = runVerifier(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /checksum manifest is missing/);
});

test("rejects a handoff kit that no longer matches the current request", (t) => {
  const root = createFixture(t);
  const env = generateKit(root);
  writeCurrentRequest(root, { requestId: "desktop-formal-new-request" });

  const result = runVerifier(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Embedded formal-artifact-request\.json does not match the current request/);
  assert.match(result.stderr, /handoff kit requestId must match the current request/);
});

test("rejects a handoff kit with stale embedded optional context", (t) => {
  const root = createFixture(t);
  const env = generateKit(root);
  writeFile(root, "reports/handoff/desktop/unsigned-staging-report.json", '{"publicReleaseEvidence":false,"updated":true}\n');

  const result = runVerifier(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /context\/unsigned-staging-report\.json does not match the current reports\/handoff\/desktop\/unsigned-staging-report\.json/);
});

test("rejects a handoff kit when current HEAD no longer matches the request", (t) => {
  const root = createFixture(t);
  generateKit(root);
  const env = createFakeGitCommands(root, { head: "def456", tagCommit: "def456" });

  const result = runVerifier(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /request\.source\.gitCommit must match current HEAD/);
});

test("rejects handoff kit paths outside the release root", (t) => {
  const root = createFixture(t);
  const result = runVerifier(root, ["--kit", join(root, "..", "kit.zip")], createFakeGitCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /paths must stay inside the release root/);
});
