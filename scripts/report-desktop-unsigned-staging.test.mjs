import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const node = process.execPath;
const script = "scripts/report-desktop-unsigned-staging.mjs";

test("writes an internal-only unsigned Desktop staging report", () => {
  const root = fixtureRoot();
  const bundleDir = join(root, "apps", "desktop", "src-tauri", "target", "release", "bundle", "nsis");
  mkdirSync(bundleDir, { recursive: true });
  const artifactPath = join(bundleDir, "JoeSSH_0.1.0-beta.9_x64-setup.exe");
  writeFileSync(artifactPath, "unsigned installer");

  const gitCommand = fakeCommand(root, "fake-git.mjs", `
const args = process.argv.slice(2);
const command = args.join(" ");
if (command === "rev-parse HEAD") console.log("abc123");
else if (command === "tag --points-at HEAD") console.log("v0.1.0-beta.9");
else process.exit(0);
`);
  const powershellCommand = fakeCommand(root, "fake-powershell.mjs", `
console.log(JSON.stringify({ Status: "NotSigned", StatusMessage: "No signature" }));
`);

  const result = run([
    "--root",
    root,
    "--bundle-dir",
    "apps/desktop/src-tauri/target/release/bundle",
  ], { gitCommand, powershellCommand });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reports\/handoff\/desktop\/unsigned-staging-report\.json/);

  const report = JSON.parse(readFileSync(join(root, "reports", "handoff", "desktop", "unsigned-staging-report.json"), "utf8"));
  assert.equal(report.version, "0.1.0-beta.9");
  assert.equal(report.publicReleaseEvidence, false);
  assert.equal(report.decision, "internal-staging-only");
  assert.equal(report.git.head, "abc123");
  assert.deepEqual(report.git.tagsAtHead, ["v0.1.0-beta.9"]);
  assert.equal(report.artifacts.length, 1);
  assert.equal(report.artifacts[0].path, "apps/desktop/src-tauri/target/release/bundle/nsis/JoeSSH_0.1.0-beta.9_x64-setup.exe");
  assert.equal(report.artifacts[0].authenticode.status, "NotSigned");
  assert.equal(report.artifacts[0].sha256, sha256("unsigned installer"));
});

test("rejects outputs under reports/release", () => {
  const root = fixtureRoot();
  const bundleDir = join(root, "apps", "desktop", "src-tauri", "target", "release", "bundle", "nsis");
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(join(bundleDir, "JoeSSH_0.1.0-beta.9_x64-setup.exe"), "unsigned installer");

  const result = run([
    "--root",
    root,
    "--output",
    "reports/release/desktop/unsigned-staging-report.json",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside reports\/release/);
});

test("rejects missing staging artifacts", () => {
  const root = fixtureRoot();
  const result = run(["--root", root]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No Desktop staging artifacts found/);
});

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "joessh-unsigned-staging-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.1.0-beta.9" }));
  return root;
}

function fakeCommand(root, name, body) {
  const path = join(root, name);
  writeFileSync(path, body);
  return path;
}

function run(args, options = {}) {
  const env = { ...process.env };
  if (options.gitCommand) {
    env.ATLASTERM_RELEASE_GIT_COMMAND = node;
    env.ATLASTERM_RELEASE_GIT_ARGS = JSON.stringify([options.gitCommand]);
  }
  if (options.powershellCommand) {
    env.ATLASTERM_RELEASE_POWERSHELL_COMMAND = node;
    env.ATLASTERM_RELEASE_POWERSHELL_ARGS = JSON.stringify([options.powershellCommand]);
  }
  return spawnSync(node, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
