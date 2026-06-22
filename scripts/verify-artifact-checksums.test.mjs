import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CHECKER_PATH = fileURLToPath(new URL("./verify-artifact-checksums.mjs", import.meta.url));

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "artifact-checksums-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  mkdirSync(join(root, "reports", "release"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "joessh.zip"), "release artifact", "utf8");

  return root;
}

function writeManifest(root, content) {
  const manifestPath = join(root, "reports", "release", "SHA256SUMS.txt");
  writeFileSync(manifestPath, content, "utf8");
  return "reports/release/SHA256SUMS.txt";
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runChecker(root, manifest = "reports/release/SHA256SUMS.txt") {
  return spawnSync(process.execPath, [CHECKER_PATH, "--root", root, manifest], {
    encoding: "utf8",
  });
}

function runAllReleaseChecker(root) {
  return spawnSync(process.execPath, [CHECKER_PATH, "--root", root, "--all-release"], {
    encoding: "utf8",
  });
}

test("verifies a generated SHA256 manifest", (t) => {
  const root = createFixture(t);
  writeManifest(root, `${sha256("release artifact")}  dist/joessh.zip\n`);

  const result = runChecker(root);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Verified 1 SHA256 checksum/);
});

test("rejects stale artifact hashes", (t) => {
  const root = createFixture(t);
  writeManifest(root, `${sha256("old artifact")}  dist/joessh.zip\n`);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /hash mismatch/);
});

test("rejects missing artifacts", (t) => {
  const root = createFixture(t);
  writeManifest(root, `${sha256("missing")}  dist/missing.zip\n`);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /references missing artifact/);
});

test("rejects manifest paths that escape the release root", (t) => {
  const root = createFixture(t);
  writeManifest(root, `${sha256("release artifact")}  ../outside.zip\n`);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /escapes the release root/);
});

test("rejects malformed manifest lines", (t) => {
  const root = createFixture(t);
  writeManifest(root, "not-a-checksum dist/joessh.zip\n");

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not '<sha256> {2}<relative-path>'/);
});

test("verifies every release checksum manifest recursively", (t) => {
  const root = createFixture(t);
  writeManifest(root, `${sha256("release artifact")}  dist/joessh.zip\n`);
  writeFile(root, "reports/release/desktop/release-evidence.json", "{}\n");
  writeFile(
    root,
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    `${sha256("{}\n")}  reports/release/desktop/release-evidence.json\n`,
  );

  const result = runAllReleaseChecker(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Verified 2 SHA256 checksum\(s\) from 2 manifest\(s\)/);
});

test("recursive release checksum verification rejects stale nested manifests", (t) => {
  const root = createFixture(t);
  writeManifest(root, `${sha256("release artifact")}  dist/joessh.zip\n`);
  writeFile(root, "reports/release/sync/backup-restore-smoke.json", '{"ok":true}\n');
  writeFile(
    root,
    "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt",
    `${sha256("old evidence")}  reports/release/sync/backup-restore-smoke.json\n`,
  );

  const result = runAllReleaseChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /hash mismatch for reports\/release\/sync\/backup-restore-smoke\.json/);
});
