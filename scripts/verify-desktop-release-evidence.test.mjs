import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CHECKER_PATH = fileURLToPath(new URL("./verify-desktop-release-evidence.mjs", import.meta.url));
const FIXTURE_ARTIFACTS = [
  ["reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe", "windows installer"],
  ["reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg", "macos dmg"],
  ["reports/release/desktop/JoeSSH_0.1.0-beta.1_amd64.AppImage", "linux appimage"],
];

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "desktop-release-evidence-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  for (const [path, content] of FIXTURE_ARTIFACTS) {
    writeFile(root, path, content);
  }
  writeManifest(root, FIXTURE_ARTIFACTS);
  writeEvidence(root, completeEvidence());

  return root;
}

function completeEvidence() {
  return [
    {
      path: FIXTURE_ARTIFACTS[0][0],
      platform: "windows",
      sha256: sha256(FIXTURE_ARTIFACTS[0][1]),
      signed: true,
      signatureVerification: `signtool verify /pa ${FIXTURE_ARTIFACTS[0][0]} ${sha256(FIXTURE_ARTIFACTS[0][1])} passed`,
    },
    {
      path: FIXTURE_ARTIFACTS[1][0],
      platform: "macos",
      sha256: sha256(FIXTURE_ARTIFACTS[1][1]),
      signed: true,
      notarized: true,
      signatureVerification: `codesign --verify ${FIXTURE_ARTIFACTS[1][0]} ${sha256(FIXTURE_ARTIFACTS[1][1])} passed`,
      notarizationVerification: `spctl --assess ${FIXTURE_ARTIFACTS[1][0]} ${sha256(FIXTURE_ARTIFACTS[1][1])} passed`,
    },
    {
      path: FIXTURE_ARTIFACTS[2][0],
      platform: "linux",
      sha256: sha256(FIXTURE_ARTIFACTS[2][1]),
      packageType: "AppImage",
    },
  ];
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function writeManifest(root, artifacts) {
  writeFile(
    root,
    "reports/release/desktop/SHA256SUMS.txt",
    artifacts.map(([path, content]) => `${sha256(content)}  ${path}`).join("\n") + "\n",
  );
}

function writeEvidence(root, artifacts) {
  const evidence = JSON.stringify({ artifacts }, null, 2);
  writeFile(root, "reports/release/desktop/release-evidence.json", evidence);
  writeFile(
    root,
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    `${sha256(evidence)}  reports/release/desktop/release-evidence.json\n`,
  );
}

function writeEvidenceSource(root, overrides = {}) {
  const source = JSON.stringify(
    {
      artifactName: "desktop-release-evidence",
      formalEvidenceJob: {
        conclusion: "success",
        databaseId: 123456780,
        name: "Package Formal Desktop Evidence",
        status: "completed",
      },
      importedAt: "2026-06-21T00:00:00.000Z",
      releaseRef: "v0.1.0-beta.1",
      releaseTagCommit: "abc123",
      repository: "JoeWorkspace/JoeSSH",
      sourceVersion: 1,
      workflowRun: {
        conclusion: "success",
        headSha: "abc123",
        id: "123456789",
        status: "completed",
        url: "https://github.example/actions/runs/123456789",
        workflowDatabaseId: 987654321,
        workflowName: "Desktop Release Artifacts",
      },
      ...overrides,
    },
    null,
    2,
  );
  writeFile(root, "reports/release/desktop/release-evidence-source.json", source);
  const existingManifest = readFileSync(join(root, "reports", "release", "desktop", "release-evidence-SHA256SUMS.txt"), "utf8");
  writeFile(
    root,
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    `${existingManifest.trimEnd()}\n${sha256(source)}  reports/release/desktop/release-evidence-source.json\n`,
  );
}

function localEvidenceSourceOverride() {
  return {
    formalEvidenceJob: {
      artifactRoot: "reports/release/desktop",
      command: "npm run release:desktop:package",
      conclusion: "success",
      name: "Package Formal Desktop Evidence",
      status: "completed",
    },
    formalArtifactManifest: {
      artifacts: [
        {
          fileName: "JoeSSH_0.1.0-beta.1_x64-setup.exe",
          packageType: null,
          platform: "windows",
          sha256: sha256(FIXTURE_ARTIFACTS[0][1]),
          sizeBytes: FIXTURE_ARTIFACTS[0][1].length,
        },
        {
          fileName: "JoeSSH_0.1.0-beta.1_aarch64.dmg",
          packageType: null,
          platform: "macos",
          sha256: sha256(FIXTURE_ARTIFACTS[1][1]),
          sizeBytes: FIXTURE_ARTIFACTS[1][1].length,
        },
        {
          fileName: "JoeSSH_0.1.0-beta.1_amd64.AppImage",
          packageType: "AppImage",
          platform: "linux",
          sha256: sha256(FIXTURE_ARTIFACTS[2][1]),
          sizeBytes: FIXTURE_ARTIFACTS[2][1].length,
        },
      ],
      kind: "joessh-desktop-formal-artifact-manifest",
      path: "C:/signed/desktop-formal-artifact-manifest.json",
      requestId: "desktop-formal-test",
      sha256: sha256("desktop-formal-artifact-manifest"),
      source: {
        gitCommit: "abc123",
        gitFsckStrict: true,
        releaseTagCommit: "abc123",
        repository: "https://git.example/JoeWorkspace/JoeSSH.git",
      },
      version: 1,
    },
    repository: "https://git.example/JoeWorkspace/JoeSSH.git",
    runner: {
      os: "windows",
      type: "self-hosted-release-machine",
    },
    source: {
      cleanTreeExcluding: "reports/release",
      gitCommit: "abc123",
      gitFsckStrict: true,
      releaseTagCommit: "abc123",
    },
    sourceAuthority: "local",
    workflowRun: undefined,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runChecker(root, args = [], env = {}) {
  return spawnSync(process.execPath, [CHECKER_PATH, "--root", root, ...args], {
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
    head: "abc123",
    tag: "abc123",
    ...options,
  };
  const fakeGitPath = join(binDir, "git.js");
  writeFileSync(
    fakeGitPath,
    `
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join(" ");
if (key === "rev-parse HEAD") {
  console.log(state.head);
  process.exit(0);
}
if (key === "rev-parse --verify v0.1.0-beta.1^{}") {
  console.log(state.tag);
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

test("accepts complete desktop release evidence", (t) => {
  const result = runChecker(createFixture(t));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Desktop release evidence verified for 3 artifact/);
});

test("accepts formal desktop evidence with a workflow source sidecar", (t) => {
  const root = createFixture(t);
  writeEvidenceSource(root);

  const result = runChecker(root, ["--require-source"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Desktop release evidence verified for 3 artifact/);
});

test("accepts formal desktop evidence with a local source sidecar", (t) => {
  const root = createFixture(t);
  writeEvidenceSource(root, localEvidenceSourceOverride());

  const result = runChecker(root, ["--require-source", "--require-source-authority", "local"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Desktop release evidence verified for 3 artifact/);
});

test("rejects local publication source sidecars without a formal artifact manifest", (t) => {
  const root = createFixture(t);
  const source = localEvidenceSourceOverride();
  delete source.formalArtifactManifest;
  writeEvidenceSource(root, source);

  const result = runChecker(root, ["--require-source", "--require-source-authority", "local"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /formalArtifactManifest must be an object/);
});

test("requires a specific desktop evidence source authority when requested", (t) => {
  const root = createFixture(t);
  writeEvidenceSource(root);

  const result = runChecker(root, ["--require-source-authority", "local"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceAuthority must be local/);
});

test("accepts GitHub source authority without requiring proof text to repeat artifact sha256", (t) => {
  const root = createFixture(t);
  const evidence = completeEvidence();
  evidence[0].signatureVerification = `signtool verify /pa ${FIXTURE_ARTIFACTS[0][0]} passed`;
  evidence[1].signatureVerification = `codesign --verify ${FIXTURE_ARTIFACTS[1][0]} passed`;
  evidence[1].notarizationVerification = `spctl --assess ${FIXTURE_ARTIFACTS[1][0]} accepted`;
  writeEvidence(root, evidence);
  writeEvidenceSource(root);

  const result = runChecker(root, ["--require-source-authority", "github"]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("local source authority requires proof text to repeat artifact sha256", (t) => {
  const root = createFixture(t);
  const evidence = completeEvidence();
  evidence[0].signatureVerification = `signtool verify /pa ${FIXTURE_ARTIFACTS[0][0]} passed`;
  writeEvidence(root, evidence);
  writeEvidenceSource(root, localEvidenceSourceOverride());

  const result = runChecker(root, ["--require-source-authority", "local"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /signatureVerification must mention both the artifact file name and artifact sha256/);
});

test("accepts formal desktop evidence when source sidecar matches current Git", (t) => {
  const root = createFixture(t);
  writeEvidenceSource(root, localEvidenceSourceOverride());

  const result = runChecker(root, ["--require-source", "--require-current-git-source"], createFakeGitCommands(root));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Desktop release evidence verified for 3 artifact/);
});

test("rejects formal desktop evidence without a workflow source sidecar", (t) => {
  const result = runChecker(createFixture(t), ["--require-source"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing desktop evidence source sidecar/);
});

test("rejects formal desktop evidence source sidecars from a different release ref", (t) => {
  const root = createFixture(t);
  writeEvidenceSource(root, { releaseRef: "v0.1.0-beta.2" });

  const result = runChecker(root, ["--require-source"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /releaseRef must be v0\.1\.0-beta\.1/);
});

test("rejects local desktop evidence source sidecars from a different commit", (t) => {
  const root = createFixture(t);
  const localSource = localEvidenceSourceOverride();
  writeEvidenceSource(root, {
    ...localSource,
    source: {
      ...localSource.source,
      gitCommit: "def456",
    },
  });

  const result = runChecker(root, ["--require-source"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /source\.gitCommit must match releaseTagCommit/);
});

test("rejects source sidecars that do not match the current release tag commit", (t) => {
  const root = createFixture(t);
  writeEvidenceSource(root, localEvidenceSourceOverride());

  const result = runChecker(
    root,
    ["--require-source", "--require-current-git-source"],
    createFakeGitCommands(root, { head: "def456", tag: "def456" }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /releaseTagCommit must match current HEAD/);
  assert.match(result.stderr, /releaseTagCommit must match v0\.1\.0-beta\.1/);
});

test("rejects unsigned Windows artifacts", (t) => {
  const root = createFixture(t);
  const evidence = completeEvidence();
  evidence[0].signed = false;
  delete evidence[0].signatureVerification;
  writeEvidence(root, evidence);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /signed must be true/);
  assert.match(result.stderr, /signatureVerification must be a non-empty string/);
});

test("rejects macOS artifacts without notarization evidence", (t) => {
  const root = createFixture(t);
  const evidence = completeEvidence();
  evidence[1].notarized = false;
  delete evidence[1].notarizationVerification;
  writeEvidence(root, evidence);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /notarized must be true/);
  assert.match(result.stderr, /notarizationVerification must be a non-empty string/);
});

test("rejects missing platform coverage and unchecked artifacts", (t) => {
  const root = createFixture(t);
  writeEvidence(root, [completeEvidence()[0]]);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing release evidence/);
  assert.match(result.stderr, /at least one macos artifact/);
  assert.match(result.stderr, /at least one linux artifact/);
});

test("rejects release evidence without artifact sha256 bindings", (t) => {
  const root = createFixture(t);
  const evidence = completeEvidence();
  delete evidence[2].sha256;
  writeEvidence(root, evidence);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /sha256 is required/);
});

test("rejects release evidence with stale artifact sha256 bindings", (t) => {
  const root = createFixture(t);
  const evidence = completeEvidence();
  evidence[2].sha256 = sha256("different linux artifact");
  writeEvidence(root, evidence);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /sha256 must match/);
});

test("rejects checksum manifests that do not match actual desktop artifacts", (t) => {
  const root = createFixture(t);
  writeFile(root, FIXTURE_ARTIFACTS[2][0], "mutated linux appimage");

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /hash mismatch/);
});

test("rejects missing desktop release evidence checksum manifests", (t) => {
  const root = createFixture(t);
  rmSync(join(root, "reports", "release", "desktop", "release-evidence-SHA256SUMS.txt"));

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing desktop evidence checksum manifest/);
});

test("rejects stale desktop release evidence checksum manifests", (t) => {
  const root = createFixture(t);
  writeFile(
    root,
    "reports/release/desktop/release-evidence.json",
    `${JSON.stringify({ artifacts: completeEvidence() }, null, 2)}\n`,
  );

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /desktop evidence checksum manifest hash mismatch/);
});

test("rejects signing evidence that is not bound to the artifact path or hash", (t) => {
  const root = createFixture(t);
  const evidence = completeEvidence();
  evidence[0].signatureVerification = "signtool verify passed";
  writeEvidence(root, evidence);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /signatureVerification must mention the artifact path, artifact file name, or artifact sha256/);
});

test("rejects signing evidence that reports failed verification", (t) => {
  const root = createFixture(t);
  const evidence = completeEvidence();
  evidence[0].signatureVerification = `signtool verify /pa ${FIXTURE_ARTIFACTS[0][0]} failed`;
  writeEvidence(root, evidence);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /signatureVerification must not report a failed verification/);
});

test("rejects signing evidence that lacks a successful verification result", (t) => {
  const root = createFixture(t);
  const evidence = completeEvidence();
  evidence[1].notarizationVerification = `spctl --assess ${FIXTURE_ARTIFACTS[1][0]}`;
  writeEvidence(root, evidence);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /notarizationVerification must show a successful verification/);
});
