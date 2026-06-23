import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const VERIFIER_PATH = fileURLToPath(new URL("./verify-sync-release-evidence.mjs", import.meta.url));
const releaseBinaryName = `joessh-sync-0.1.0-beta.1-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;

function createFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "sync-release-evidence-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
  });

  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  writeFile(root, `reports/release/sync/${releaseBinaryName}`, "sync release binary");
  writeManifest(root, "reports/release/sync/SHA256SUMS.txt", [
    ["sync release binary", `reports/release/sync/${releaseBinaryName}`],
  ]);

  const evidence = {
    artifact: "sync-backup-restore-smoke",
    assertions: [
      "seeded two devices and one sync change",
      "copied an operator ledger backup",
      "corrupted the primary JSON ledger",
      "restored the operator backup as the service .bak ledger",
      "verified startup recovery from backup metrics",
      "verified admin snapshot, pull, and post-recovery write path",
    ],
    binary: `reports/release/sync/${releaseBinaryName}`,
    binaryKind: "packaged-release",
    binaryManifest: "reports/release/sync/SHA256SUMS.txt",
    binarySha256: sha256("sync release binary"),
    devices: ["device-a", "device-b"],
    evidenceVersion: 1,
    platform: process.platform,
    operatorBackupSha256: sha256("operator backup"),
    recovery: {
      rpo: "all mutations durably persisted before the operator backup copy",
      rtoMs: 123,
      scenario: "primary ledger corrupted; operator backup restored as ledger.bak before service restart",
    },
    restoredChanges: ["change-a", "change-b"],
    timestamp: "2026-06-22T00:00:00.000Z",
    version: "0.1.0-beta.1",
    ...options.evidence,
  };
  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  writeFile(root, "reports/release/sync/backup-restore-smoke.json", evidenceText);
  if (options.evidenceChecksum !== false) {
    writeManifest(root, "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt", [
      [options.badEvidenceChecksum ? "stale evidence" : evidenceText, "reports/release/sync/backup-restore-smoke.json"],
    ]);
  }

  return root;
}

function runVerifier(root) {
  return spawnSync(process.execPath, [VERIFIER_PATH, "--root", root], {
    encoding: "utf8",
  });
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function writeManifest(root, relativePath, entries) {
  writeFile(
    root,
    relativePath,
    entries.map(([content, artifactPath]) => `${sha256(content)}  ${artifactPath}`).join("\n") + "\n",
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("verifies packaged Sync backup/restore evidence", (t) => {
  const result = runVerifier(createFixture(t));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Verified Sync release evidence reports\/release\/sync\/backup-restore-smoke\.json/);
});

test("rejects backup/restore evidence from a non-packaged binary", (t) => {
  const result = runVerifier(
    createFixture(t, {
      evidence: {
        binary: "target/debug/atlasterm-sync",
        binaryKind: "debug",
        binaryManifest: null,
      },
    }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /binaryKind packaged-release/);
  assert.match(result.stderr, /binary must point at a staged reports\/release\/sync\/joessh-sync artifact/);
});

test("rejects backup/restore evidence with a stale binary sha256", (t) => {
  const result = runVerifier(
    createFixture(t, {
      evidence: {
        binarySha256: sha256("stale binary"),
      },
    }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /binarySha256 does not match the staged binary/);
});

test("rejects backup/restore evidence without checksum coverage", (t) => {
  const result = runVerifier(createFixture(t, { evidenceChecksum: false }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing evidence checksum manifest/);
});

test("rejects backup/restore evidence with a stale checksum manifest", (t) => {
  const result = runVerifier(createFixture(t, { badEvidenceChecksum: true }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /evidence checksum manifest hash mismatch/);
});

test("rejects backup/restore evidence without recovery semantics", (t) => {
  const result = runVerifier(
    createFixture(t, {
      evidence: {
        assertions: ["seeded two devices and one sync change"],
        devices: ["device-a"],
        recovery: {
          rtoMs: 0,
          scenario: "primary ledger corrupted",
        },
        restoredChanges: ["change-a"],
      },
    }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /assertions missing/);
  assert.match(result.stderr, /devices must include at least two device ids/);
  assert.match(result.stderr, /restoredChanges must include at least two restored change ids/);
  assert.match(result.stderr, /recovery.rpo must describe/);
  assert.match(result.stderr, /recovery.scenario must mention the operator backup rollback path/);
  assert.match(result.stderr, /recovery.rtoMs must be a positive number/);
});

test("rejects backup/restore evidence from a different release version", (t) => {
  const result = runVerifier(
    createFixture(t, {
      evidence: {
        version: "0.1.0-beta.0",
      },
    }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /version must be 0\.1\.0-beta\.1/);
});
