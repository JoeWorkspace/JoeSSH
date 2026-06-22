import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const PACKAGER_PATH = fileURLToPath(new URL("./package-sync-release.mjs", import.meta.url));
const binaryExtension = process.platform === "win32" ? ".exe" : "";
const sourceBinaryName = `atlasterm-sync${binaryExtension}`;
const releaseBinaryName = `joessh-sync-0.1.0-beta.1-${process.platform}-${process.arch}${binaryExtension}`;

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "sync-release-package-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  return root;
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function readReleaseFile(root, relativePath) {
  return readFileSync(join(root, ...relativePath.split("/")), "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runPackager(root) {
  return spawnSync(process.execPath, [PACKAGER_PATH, "--root", root, "--skip-build"], {
    encoding: "utf8",
  });
}

test("packages the Sync release binary with checksums and removes stale binaries", (t) => {
  const root = createFixture(t);
  writeFile(root, `target/release/${sourceBinaryName}`, "sync release binary");
  writeFile(root, "reports/release/sync/joessh-sync-0.0.0-beta.0-linux-x64", "stale linux binary");
  writeFile(root, "reports/release/sync/joessh-sync-image-digest.txt", "container evidence");
  writeFile(root, "reports/release/sync/backup-restore-smoke.json", '{"ok":true}\n');

  const result = runPackager(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(root, "reports", "release", "sync", releaseBinaryName)), true);
  assert.equal(existsSync(join(root, "reports", "release", "sync", "joessh-sync-0.0.0-beta.0-linux-x64")), false);
  assert.equal(existsSync(join(root, "reports", "release", "sync", "joessh-sync-image-digest.txt")), true);
  assert.equal(existsSync(join(root, "reports", "release", "sync", "backup-restore-smoke.json")), true);
  assert.equal(readReleaseFile(root, `reports/release/sync/${releaseBinaryName}`), "sync release binary");
  assert.equal(
    readReleaseFile(root, "reports/release/sync/SHA256SUMS.txt"),
    `${sha256("sync release binary")}  reports/release/sync/${releaseBinaryName}\n`,
  );
});

test("rejects packaging when the release binary has not been built", (t) => {
  const root = createFixture(t);

  const result = runPackager(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected sync release binary/);
  assert.match(result.stderr, new RegExp(`target[/\\\\]release[/\\\\]${sourceBinaryName.replace(".", "\\.")}`));
});
