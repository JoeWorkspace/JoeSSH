import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(
  new URL("./stage-desktop-candidate.mjs", import.meta.url),
);

function fixture(t, tauriVersion = "0.1.0-beta.1") {
  const root = mkdtempSync(join(tmpdir(), "desktop-candidate-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  write(
    root,
    "apps/desktop/src-tauri/tauri.conf.json",
    JSON.stringify({ version: tauriVersion }),
  );
  return root;
}

function write(root, path, value) {
  const fullPath = join(root, ...path.split("/"));
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, value);
}

function run(root, platform, extraArgs = [], env = {}) {
  return spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--root", root, "--platform", platform, ...extraArgs],
    {
      encoding: "utf8",
      env: { ...process.env, ...env },
    },
  );
}

test("stages only the requested platform with checksums and non-release metadata", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/target/release/bundle/msi/JoeSSH.msi",
    "windows-installer",
  );
  write(
    root,
    "apps/desktop/src-tauri/target/release/bundle/deb/JoeSSH.deb",
    "linux-installer",
  );

  const result = run(root, "windows", ["--source-commit", "A".repeat(40)]);
  assert.equal(result.status, 0, result.stderr);
  const output = join(root, "reports/candidates/desktop/windows-unsigned");
  const metadata = JSON.parse(
    readFileSync(join(output, "candidate-metadata.json"), "utf8"),
  );
  assert.equal(metadata.product, "JoeSSH Community");
  assert.equal(metadata.releaseEligible, false);
  assert.equal(metadata.signingStatus, "unverified");
  assert.equal(metadata.sourceCommit, "a".repeat(40));
  assert.deepEqual(
    metadata.artifacts.map((artifact) => artifact.name),
    ["JoeSSH.msi"],
  );
  assert.equal(
    metadata.artifacts[0].sha256,
    createHash("sha256").update("windows-installer").digest("hex"),
  );
  const checksums = readFileSync(join(output, "SHA256SUMS.txt"), "utf8");
  assert.match(checksums, /JoeSSH\.msi/);
  assert.match(checksums, /candidate-metadata\.json/);
  assert.doesNotMatch(checksums, /JoeSSH\.deb/);
});

test("fails when package and Tauri versions differ", (t) => {
  const root = fixture(t, "0.1.0");
  write(
    root,
    "apps/desktop/src-tauri/target/release/bundle/dmg/JoeSSH.dmg",
    "macos-installer",
  );
  const result = run(root, "macos");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version mismatch/);
});

test("fails closed for missing platform artifacts and output paths outside the root", (t) => {
  const root = fixture(t);
  const missing = run(root, "linux");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /No linux Desktop bundle artifacts/);

  write(
    root,
    "apps/desktop/src-tauri/target/release/bundle/deb/JoeSSH.deb",
    "linux-installer",
  );
  const escaped = run(root, "linux", ["--output-dir", "../outside"]);
  assert.notEqual(escaped.status, 0);
  assert.match(escaped.stderr, /must stay inside the repository root/);

  const escapedBundle = run(root, "linux", ["--bundle-dir", "../outside"]);
  assert.notEqual(escapedBundle.status, 0);
  assert.match(escapedBundle.stderr, /must stay inside the repository root/);

  const overlapping = run(root, "linux", [
    "--output-dir",
    "apps/desktop/src-tauri/target/release/bundle/candidate-output",
  ]);
  assert.notEqual(overlapping.status, 0);
  assert.match(overlapping.stderr, /cannot overlap/);

  const invalidCommit = run(root, "linux", ["--source-commit", "not-a-sha"]);
  assert.notEqual(invalidCommit.status, 0);
  assert.match(invalidCommit.stderr, /40-character Git commit SHA/);
});
