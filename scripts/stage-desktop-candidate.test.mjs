import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

test("replaces verified candidates at default and custom owned output paths", (t) => {
  const root = fixture(t);
  const bundle = "apps/desktop/src-tauri/target/release/bundle/msi/JoeSSH.msi";
  for (const output of [
    "reports/candidates/desktop/windows-unsigned",
    "reports/candidates/desktop/custom/windows-preview",
  ]) {
    write(root, bundle, "first-installer");
    const args = ["--output-dir", output];
    assert.equal(run(root, "windows", args).status, 0);
    write(root, bundle, "updated-installer");
    const result = run(root, "windows", args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, output, "JoeSSH.msi"), "utf8"), "updated-installer");
  }
});

test("protects unrelated directories and the candidate parent from custom output paths", (t) => {
  const root = fixture(t);
  write(root, "apps/desktop/src-tauri/target/release/bundle/msi/JoeSSH.msi", "installer");
  for (const output of ["docs", ".git", "reports/other-output", "reports/candidates/desktop"]) {
    write(root, `${output}/sentinel.txt`, "preserve-me");
    const result = run(root, "windows", ["--output-dir", output]);
    assert.notEqual(result.status, 0, output);
    assert.match(result.stderr, /must be a child of reports\/candidates\/desktop/);
    assert.equal(readFileSync(join(root, output, "sentinel.txt"), "utf8"), "preserve-me");
    assert.equal(existsSync(join(root, output, "candidate-metadata.json")), false);
  }
});

test("preserves existing files that are not part of a verified candidate", (t) => {
  const root = fixture(t);
  const output = "reports/candidates/desktop/windows-unsigned";
  write(root, "apps/desktop/src-tauri/target/release/bundle/msi/JoeSSH.msi", "installer");
  assert.equal(run(root, "windows").status, 0);
  const originalMetadata = readFileSync(join(root, output, "candidate-metadata.json"), "utf8");
  write(root, `${output}/sentinel.txt`, "preserve-me");
  const result = run(root, "windows");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a verified candidate/);
  assert.equal(readFileSync(join(root, output, "sentinel.txt"), "utf8"), "preserve-me");
  assert.equal(readFileSync(join(root, output, "candidate-metadata.json"), "utf8"), originalMetadata);

  const unrelatedOutput = "reports/candidates/desktop/unrelated";
  write(root, `${unrelatedOutput}/sentinel.txt`, "unrelated");
  const unrelated = run(root, "windows", ["--output-dir", unrelatedOutput]);
  assert.notEqual(unrelated.status, 0);
  assert.match(unrelated.stderr, /not a verified candidate/);
  assert.equal(readFileSync(join(root, unrelatedOutput, "sentinel.txt"), "utf8"), "unrelated");
});

test("rejects output junctions and symbolic link ancestors without changing their targets", (t) => {
  for (const linkPath of ["reports/candidates", "reports/candidates/desktop/windows-unsigned"]) {
    const root = fixture(t);
    const outside = mkdtempSync(join(tmpdir(), "candidate-outside-"));
    t.after(() => rmSync(outside, { force: true, recursive: true }));
    write(root, "apps/desktop/src-tauri/target/release/bundle/msi/JoeSSH.msi", "installer");
    write(outside, "sentinel.txt", "outside-root");
    write(outside, "desktop/windows-unsigned/sentinel.txt", "outside-nested");
    const link = join(root, linkPath);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");

    const result = run(root, "windows");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symbolic links or junctions|must stay inside the repository root after resolving paths/);
    assert.equal(readFileSync(join(outside, "sentinel.txt"), "utf8"), "outside-root");
    assert.equal(readFileSync(join(outside, "desktop/windows-unsigned/sentinel.txt"), "utf8"), "outside-nested");
    assert.equal(existsSync(join(outside, "candidate-metadata.json")), false);
    assert.equal(existsSync(join(outside, "desktop/windows-unsigned/candidate-metadata.json")), false);
  }
});

test("rejects an internal junction redirecting candidate output into protected files", (t) => {
  const root = fixture(t);
  write(root, "apps/desktop/src-tauri/target/release/bundle/msi/JoeSSH.msi", "installer");
  write(root, "docs/windows-unsigned/sentinel.txt", "protected-docs");
  mkdirSync(join(root, "reports/candidates"), { recursive: true });
  symlinkSync(join(root, "docs"), join(root, "reports/candidates/desktop"), process.platform === "win32" ? "junction" : "dir");

  const result = run(root, "windows");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic links or junctions/);
  assert.equal(readFileSync(join(root, "docs/windows-unsigned/sentinel.txt"), "utf8"), "protected-docs");
});

test("rejects a bundle junction before changing an existing candidate", (t) => {
  const root = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), "candidate-bundle-outside-"));
  t.after(() => rmSync(outside, { force: true, recursive: true }));
  write(outside, "JoeSSH.msi", "outside-installer");
  const bundle = join(root, "apps/desktop/src-tauri/target/release/bundle");
  mkdirSync(dirname(bundle), { recursive: true });
  symlinkSync(outside, bundle, process.platform === "win32" ? "junction" : "dir");
  const sentinel = "reports/candidates/desktop/windows-unsigned/sentinel.txt";
  write(root, sentinel, "existing-output");

  const result = run(root, "windows");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic links or junctions/);
  assert.equal(readFileSync(join(root, sentinel), "utf8"), "existing-output");
});

test("rejects duplicate input names before replacing a verified candidate", (t) => {
  const root = fixture(t);
  write(root, "apps/desktop/src-tauri/target/release/bundle/msi/JoeSSH.msi", "installer");
  assert.equal(run(root, "windows").status, 0);
  const outputArtifact = join(root, "reports/candidates/desktop/windows-unsigned/JoeSSH.msi");
  write(root, "apps/desktop/src-tauri/target/release/bundle/other/JoeSSH.msi", "duplicate-installer");

  const result = run(root, "windows");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate file name/);
  assert.equal(readFileSync(outputArtifact, "utf8"), "installer");
});
