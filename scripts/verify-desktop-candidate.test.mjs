import assert from "node:assert/strict";
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

const STAGE_PATH = fileURLToPath(
  new URL("./stage-desktop-candidate.mjs", import.meta.url),
);
const VERIFY_PATH = fileURLToPath(
  new URL("./verify-desktop-candidate.mjs", import.meta.url),
);
const sourceCommit = "a".repeat(40);

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "desktop-candidate-verify-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  write(
    root,
    "apps/desktop/src-tauri/tauri.conf.json",
    JSON.stringify({ version: "0.1.0-beta.1" }),
  );
  write(
    root,
    "apps/desktop/src-tauri/target/release/bundle/msi/JoeSSH.msi",
    "windows-installer",
  );
  const staged = run(STAGE_PATH, root, [
    "--platform",
    "windows",
    "--source-commit",
    sourceCommit,
  ]);
  assert.equal(staged.status, 0, staged.stderr);
  return root;
}

function write(root, path, value) {
  const fullPath = join(root, ...path.split("/"));
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, value);
}

function run(script, root, args = []) {
  return spawnSync(process.execPath, [script, "--root", root, ...args], {
    encoding: "utf8",
  });
}

function verify(root, extraArgs = []) {
  return run(VERIFY_PATH, root, [
    "--platform",
    "windows",
    "--source-commit",
    sourceCommit,
    ...extraArgs,
  ]);
}

function candidatePath(root, name) {
  return join(
    root,
    "reports",
    "candidates",
    "desktop",
    "windows-unsigned",
    name,
  );
}

test("verifies a staged candidate and binds it to the checked-out commit", (t) => {
  const root = fixture(t);
  const result = verify(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Verified 1 unsigned windows Desktop candidate artifact/,
  );
  assert.match(result.stdout, /ineligible for public release/);
});

test("verifies an extracted candidate outside the source repository", (t) => {
  const root = fixture(t);
  const extractedCandidate = join(
    root,
    "reports",
    "candidates",
    "desktop",
    "windows-unsigned",
  );
  const consumerRoot = join(root, "unrelated-consumer-directory");
  const result = run(VERIFY_PATH, consumerRoot, [
    "--standalone",
    "--candidate-dir",
    extractedCandidate,
    "--platform",
    "windows",
    "--source-commit",
    sourceCommit,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Verified 1 unsigned windows Desktop candidate artifact/,
  );
});

test("rejects tampered artifacts and release-eligible metadata", (t) => {
  const root = fixture(t);
  writeFileSync(candidatePath(root, "JoeSSH.msi"), "tampered-installer");
  const metadataPath = candidatePath(root, "candidate-metadata.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  metadata.releaseEligible = true;
  metadata.generatedAt = "1";
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  const result = verify(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /hash mismatch for JoeSSH\.msi/);
  assert.match(result.stderr, /releaseEligible must be false/);
  assert.match(result.stderr, /generatedAt must be an ISO timestamp/);
});

test("rejects unlisted files, version drift, and source commit drift", (t) => {
  const root = fixture(t);
  writeFileSync(candidatePath(root, "unexpected.exe"), "unexpected");
  write(root, "package.json", JSON.stringify({ version: "0.1.0-beta.2" }));

  const result = verify(root, ["--source-commit", "b".repeat(40)]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version mismatch/);
  assert.match(result.stderr, /sourceCommit must match/);
  assert.match(
    result.stderr,
    /candidate metadata does not list file unexpected\.exe/,
  );
  assert.match(
    result.stderr,
    /SHA256SUMS\.txt does not list candidate file unexpected\.exe/,
  );
});

test("fails closed when the candidate directory escapes the repository root", (t) => {
  const root = fixture(t);
  const result = verify(root, ["--candidate-dir", "../outside"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must stay inside the repository root/);
});
