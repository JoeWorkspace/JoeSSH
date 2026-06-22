import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(new URL("./audit-public-beta-rc.mjs", import.meta.url));

function createFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "rc-audit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  writeArtifactWithManifest(root, "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip", "web", "reports/release/web/SHA256SUMS.txt");
  writeArtifactWithManifest(root, "reports/release/sync/joessh-sync-0.1.0-beta.1-win32-x64.exe", "sync", "reports/release/sync/SHA256SUMS.txt");
  writeArtifactWithManifest(root, "reports/release/npm-web-sbom.cdx.json", "web-sbom", "reports/release/SBOM-SHA256SUMS.txt");
  appendManifest(root, "reports/release/SBOM-SHA256SUMS.txt", "reports/release/npm-desktop-sbom.cdx.json", "desktop-sbom");
  appendManifest(root, "reports/release/SBOM-SHA256SUMS.txt", "reports/release/cargo-metadata.json", "cargo");
  appendManifest(root, "reports/release/SBOM-SHA256SUMS.txt", "reports/release/tauri-cargo-metadata.json", "tauri");
  writeArtifactWithManifest(root, "reports/release/desktop/JoeSSH.exe", "desktop", "reports/release/desktop/SHA256SUMS.txt");
  writeArtifactWithManifest(root, "reports/release/desktop/release-evidence.json", "{}", "reports/release/desktop/release-evidence-SHA256SUMS.txt");
  writeDogfood(root, { passed: true });

  const state = {
    ciConclusion: "success",
    desktopSecretsOk: true,
    gitClean: true,
    head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    publishPreflightOk: true,
    tag: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...options,
  };
  if (options.removeDesktopEvidence) {
    rmSync(join(root, "reports", "release", "desktop"), { recursive: true, force: true });
  }
  if (options.dogfoodPassed === false) {
    writeDogfood(root, { passed: false });
  }

  const statePath = join(root, "state.json");
  writeFileSync(statePath, JSON.stringify(state), "utf8");
  const fakePath = join(root, "fake-command.mjs");
  writeFileSync(fakePath, fakeCommandSource(), "utf8");

  return { fakePath, root, statePath };
}

function runAudit(root, fakePath, statePath, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--root", root, "--repo", "JoeWorkspace/JoeSSH", "--no-fail", ...extraArgs],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ATLASTERM_RC_AUDIT_GH_ARGS: JSON.stringify([fakePath, statePath, "gh"]),
        ATLASTERM_RC_AUDIT_GH_COMMAND: process.execPath,
        ATLASTERM_RC_AUDIT_GIT_ARGS: JSON.stringify([fakePath, statePath, "git"]),
        ATLASTERM_RC_AUDIT_GIT_COMMAND: process.execPath,
        ATLASTERM_RC_AUDIT_NPM_ARGS: JSON.stringify([fakePath, statePath, "npm"]),
        ATLASTERM_RC_AUDIT_NPM_COMMAND: process.execPath,
      },
    },
  );
}

test("writes a Go audit report when release evidence and gates pass", (t) => {
  const { fakePath, root, statePath } = createFixture(t);
  const result = runAudit(root, fakePath, statePath);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /GO \(0 blockers\)/);
  const report = JSON.parse(readFileSync(join(root, "reports/release/public-beta-rc-audit.json"), "utf8"));
  assert.equal(report.decision, "go");
  assert.equal(report.blockers.length, 0);
});

test("records No-Go blockers without hiding GitHub billing annotations", (t) => {
  const { fakePath, root, statePath } = createFixture(t, {
    ciConclusion: "failure",
    desktopSecretsOk: false,
    dogfoodPassed: false,
    publishPreflightOk: false,
    removeDesktopEvidence: true,
    tag: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  const result = runAudit(root, fakePath, statePath);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /NO-GO/);
  const report = JSON.parse(readFileSync(join(root, "reports/release/public-beta-rc-audit.json"), "utf8"));
  assert.equal(report.decision, "no-go");
  assert.match(JSON.stringify(report), /spending limit needs to be increased/);
  assert(report.blockers.some((blocker) => blocker.id === "release-tag"));
  assert(report.blockers.some((blocker) => blocker.id === "desktop-signing-secrets"));
  assert(report.blockers.some((blocker) => blocker.id === "github-ci"));
});

function writeDogfood(root, { passed }) {
  const evidence = {
    auth: "private-key",
    checks: [
      "host-key probe",
      "pinned host-key authentication",
      "exec marker",
      "SFTP list/download/upload/overwrite",
      "PTY marker",
      "local forwarding start/traffic/shutdown",
    ],
    fixture: "local-openssh",
    finishedAt: "2026-06-22T00:00:00.000Z",
    status: passed ? "passed" : "failed",
  };
  const path = "reports/smoke/desktop/real-ssh-smoke.json";
  writeFile(root, path, JSON.stringify(evidence));
  writeFile(root, "reports/smoke/desktop/real-ssh-smoke-SHA256SUMS.txt", `${sha256Content(JSON.stringify(evidence))}  ${path}\n`);
}

function writeArtifactWithManifest(root, artifactPath, content, manifestPath) {
  writeFile(root, artifactPath, content);
  writeFile(root, manifestPath, `${sha256Content(content)}  ${artifactPath}\n`);
}

function appendManifest(root, manifestPath, artifactPath, content) {
  writeFile(root, artifactPath, content);
  const path = join(root, ...manifestPath.split("/"));
  writeFileSync(path, `${readFileSync(path, "utf8")}${sha256Content(content)}  ${artifactPath}\n`);
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function sha256Content(content) {
  return createHash("sha256").update(content).digest("hex");
}

function fakeCommandSource() {
  return `
import { readFileSync } from "node:fs";
const state = JSON.parse(readFileSync(process.argv[2], "utf8"));
const tool = process.argv[3];
const args = process.argv.slice(4);
const is = (...expected) => args.length === expected.length && args.every((value, index) => value === expected[index]);
if (tool === "git") {
  if (is("rev-parse", "HEAD")) console.log(state.head);
  else if (is("rev-parse", "--verify", "v0.1.0-beta.1^{commit}")) console.log(state.tag);
  else if (args[0] === "status") {
    if (!state.gitClean) console.log(" M package.json");
  } else if (is("remote", "get-url", "origin")) console.log("https://github.com/JoeWorkspace/JoeSSH.git");
  else { console.error("unexpected git args " + args.join(" ")); process.exit(2); }
  process.exit(0);
}
if (tool === "npm") {
  if (is("run", "release:publish-preflight")) {
    if (state.publishPreflightOk) process.exit(0);
    console.error("Release tag v0.1.0-beta.1 must point at HEAD for publish preflight.");
    process.exit(1);
  }
  if (is("run", "release:desktop:configure-secrets", "--", "--verify-only")) {
    if (state.desktopSecretsOk) process.exit(0);
    console.error("Missing GitHub Actions secret(s) required for formal Desktop evidence");
    process.exit(1);
  }
  console.error("unexpected npm args " + args.join(" "));
  process.exit(2);
}
if (tool === "gh") {
  if (is("auth", "status")) process.exit(0);
  if (args[0] === "run" && args[1] === "list") {
    console.log(JSON.stringify([{ databaseId: 100, headSha: state.head, status: "completed", conclusion: state.ciConclusion, workflowName: "CI", url: "https://example.test/run/100" }]));
    process.exit(0);
  }
  if (is("run", "view", "100", "--repo", "JoeWorkspace/JoeSSH", "--json", "jobs")) {
    console.log(JSON.stringify({ jobs: [{ databaseId: 200, name: "Lint", conclusion: "failure", status: "completed" }] }));
    process.exit(0);
  }
  if (is("api", "repos/JoeWorkspace/JoeSSH/check-runs/200/annotations")) {
    console.log(JSON.stringify([{ path: ".github", message: "The job was not started because recent account payments have failed or your spending limit needs to be increased." }]));
    process.exit(0);
  }
  console.error("unexpected gh args " + args.join(" "));
  process.exit(2);
}
console.error("unexpected tool " + tool);
process.exit(2);
`;
}
