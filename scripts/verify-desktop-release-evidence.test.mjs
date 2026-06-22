import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
      signatureVerification: `signtool verify /pa ${FIXTURE_ARTIFACTS[0][0]} passed`,
    },
    {
      path: FIXTURE_ARTIFACTS[1][0],
      platform: "macos",
      sha256: sha256(FIXTURE_ARTIFACTS[1][1]),
      signed: true,
      notarized: true,
      signatureVerification: `codesign --verify ${FIXTURE_ARTIFACTS[1][0]} passed`,
      notarizationVerification: `spctl --assess ${FIXTURE_ARTIFACTS[1][0]} passed`,
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runChecker(root) {
  return spawnSync(process.execPath, [CHECKER_PATH, "--root", root], {
    encoding: "utf8",
  });
}

test("accepts complete desktop release evidence", (t) => {
  const result = runChecker(createFixture(t));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Desktop release evidence verified for 3 artifact/);
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
