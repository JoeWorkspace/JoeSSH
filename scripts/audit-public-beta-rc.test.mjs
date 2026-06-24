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
  writeWebRollback(root);
  writeArtifactWithManifest(root, "reports/release/sync/joessh-sync-0.1.0-beta.1-win32-x64.exe", "sync", "reports/release/sync/SHA256SUMS.txt");
  writeArtifactWithManifest(root, "reports/release/npm-web-sbom.cdx.json", "web-sbom", "reports/release/SBOM-SHA256SUMS.txt");
  appendManifest(root, "reports/release/SBOM-SHA256SUMS.txt", "reports/release/npm-desktop-sbom.cdx.json", "desktop-sbom");
  appendManifest(root, "reports/release/SBOM-SHA256SUMS.txt", "reports/release/cargo-metadata.json", "cargo");
  appendManifest(root, "reports/release/SBOM-SHA256SUMS.txt", "reports/release/tauri-cargo-metadata.json", "tauri");
  writeArtifactWithManifest(
    root,
    "reports/release/release-provenance.json",
    "provenance",
    "reports/release/release-provenance-SHA256SUMS.txt",
  );
  writeArtifactWithManifest(
    root,
    "reports/release/local-release-authority.json",
    "local authority",
    "reports/release/local-release-authority-SHA256SUMS.txt",
  );
  writeArtifactWithManifest(
    root,
    "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe",
    "desktop",
    "reports/release/desktop/SHA256SUMS.txt",
  );
  writeArtifactWithManifest(root, "reports/release/desktop/release-evidence.json", "{}", "reports/release/desktop/release-evidence-SHA256SUMS.txt");
  writeDogfood(root, { passed: true });

  const state = {
    ciConclusion: "success",
    desktopSecretsOk: true,
    gitClean: true,
    head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    localAuthorityOk: true,
    publishPreflightOk: true,
    publicBetaDogfoodOk: true,
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

test("uses local publish preflight without requiring GitHub signing secrets", (t) => {
  const { fakePath, root, statePath } = createFixture(t, {
    desktopSecretsOk: false,
    publishPreflightOk: true,
  });
  const result = runAudit(root, fakePath, statePath, ["--release-authority", "local", "--skip-github"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /GO \(0 blockers\)/);
  const report = JSON.parse(readFileSync(join(root, "reports/release/public-beta-rc-audit.json"), "utf8"));
  assert.equal(report.releaseAuthority, "local");
  assert.equal(report.decision, "go");
  assert.equal(report.blockers.length, 0);
  assert.equal(report.checks.find((check) => check.id === "publish-preflight")?.label, "Local release publish preflight");
  assert.equal(report.checks.find((check) => check.id === "local-release-authority")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "local-release-authority-verify")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "desktop-signing-secrets")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "github-ci")?.status, "pass");
});

test("uses web-sync-only profile without requiring Desktop signing evidence", (t) => {
  const { fakePath, root, statePath } = createFixture(t, {
    desktopSecretsOk: false,
    removeDesktopEvidence: true,
  });
  writeDesktopExclusion(root);

  const result = runAudit(root, fakePath, statePath, [
    "--release-authority",
    "local",
    "--release-profile",
    "web-sync-only",
    "--skip-github",
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /GO \(0 blockers\)/);
  const report = JSON.parse(readFileSync(join(root, "reports/release/public-beta-rc-audit.json"), "utf8"));
  assert.equal(report.releaseProfile, "web-sync-only");
  assert.equal(report.decision, "go");
  assert.equal(report.blockers.length, 0);
  assert.equal(report.checks.find((check) => check.id === "release-desktop-exclusion")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "desktop-signing-secrets")?.status, "pass");
  assert(!report.checks.some((check) => check.id === "release-desktop"));
});

test("web-sync-only profile rejects staged Desktop release artifacts", (t) => {
  const { fakePath, root, statePath } = createFixture(t, {
    removeDesktopEvidence: true,
  });
  writeDesktopExclusion(root);
  writeArtifactWithManifest(
    root,
    "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe",
    "desktop",
    "reports/release/desktop/SHA256SUMS.txt",
  );

  const result = runAudit(root, fakePath, statePath, [
    "--release-authority",
    "local",
    "--release-profile",
    "web-sync-only",
    "--skip-github",
  ]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(root, "reports/release/public-beta-rc-audit.json"), "utf8"));
  const blocker = report.blockers.find((entry) => entry.id === "release-desktop-stale-artifacts");
  assert(blocker);
  assert.match(blocker.detail, /must not stage public Desktop artifacts/);
});

test("records No-Go blockers without hiding GitHub billing annotations", (t) => {
  const { fakePath, root, statePath } = createFixture(t, {
    ciConclusion: "failure",
    desktopSecretsOk: false,
    dogfoodPassed: false,
    publishPreflightOk: false,
    publicBetaDogfoodOk: false,
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
  assert(report.blockers.some((blocker) => blocker.id === "public-beta-dogfood"));
  assert(report.blockers.some((blocker) => blocker.id === "desktop-signing-secrets"));
  assert(report.blockers.some((blocker) => blocker.id === "github-ci"));
});

test("rejects stale Public Beta operator dogfood evidence", (t) => {
  const { fakePath, root, statePath } = createFixture(t, {
    publicBetaDogfoodOk: false,
  });

  const result = runAudit(root, fakePath, statePath, ["--skip-github"]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(root, "reports/release/public-beta-rc-audit.json"), "utf8"));
  const blocker = report.blockers.find((entry) => entry.id === "public-beta-dogfood");
  assert(blocker);
  assert.match(blocker.detail, /version must be 0\.1\.0-beta\.1/);
});

test("rejects missing release provenance before publish preflight can hide it", (t) => {
  const { fakePath, root, statePath } = createFixture(t);
  rmSync(join(root, "reports", "release", "release-provenance-SHA256SUMS.txt"));

  const result = runAudit(root, fakePath, statePath, ["--skip-github"]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(root, "reports/release/public-beta-rc-audit.json"), "utf8"));
  const blocker = report.blockers.find((entry) => entry.id === "release-provenance");
  assert(blocker);
  assert.match(blocker.detail, /release-provenance-SHA256SUMS\.txt is missing/);
});

test("rejects missing Web Admin rollback evidence", (t) => {
  const { fakePath, root, statePath } = createFixture(t);
  rmSync(join(root, "reports", "release", "web", "rollback-smoke-SHA256SUMS.txt"));

  const result = runAudit(root, fakePath, statePath, ["--skip-github"]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(root, "reports/release/public-beta-rc-audit.json"), "utf8"));
  const blocker = report.blockers.find((entry) => entry.id === "web-admin-rollback-checksum");
  assert(blocker);
  assert.match(blocker.detail, /rollback-smoke-SHA256SUMS\.txt is missing/);
});

test("rejects stale Web Admin rollback evidence", (t) => {
  const { fakePath, root, statePath } = createFixture(t);
  writeWebRollback(root, {
    version: "0.1.0-beta.0",
  });

  const result = runAudit(root, fakePath, statePath, ["--skip-github"]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(root, "reports/release/public-beta-rc-audit.json"), "utf8"));
  const blocker = report.blockers.find((entry) => entry.id === "web-admin-rollback");
  assert(blocker);
  assert.match(blocker.detail, /version must be 0\.1\.0-beta\.1/);
});

test("rejects stale local release authority before publish preflight can hide it", (t) => {
  const { fakePath, root, statePath } = createFixture(t, {
    localAuthorityOk: false,
  });

  const result = runAudit(root, fakePath, statePath, ["--release-authority", "local", "--skip-github"]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(root, "reports/release/public-beta-rc-audit.json"), "utf8"));
  const blocker = report.blockers.find((entry) => entry.id === "local-release-authority-verify");
  assert(blocker);
  assert.match(blocker.detail, /Local release authority verification failed/);
});

test("rejects checksum manifest entries outside the release root", (t) => {
  const { fakePath, root, statePath } = createFixture(t);
  writeFile(root, "reports/release/web/SHA256SUMS.txt", `${"a".repeat(64)}  ../outside.zip\n`);
  const result = runAudit(root, fakePath, statePath, ["--skip-github"]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(root, "reports/release/public-beta-rc-audit.json"), "utf8"));
  const blocker = report.blockers.find((entry) => entry.id === "release-web");
  assert(blocker);
  assert.match(blocker.detail, /escapes the release root/);
});

test("flags staged Desktop artifacts that do not match the package version", (t) => {
  const { fakePath, root, statePath } = createFixture(t);
  writeFile(root, "reports/release/desktop/JoeSSH_0.1.0-beta.0_x64-setup.exe", "old desktop");

  const result = runAudit(root, fakePath, statePath);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(root, "reports/release/public-beta-rc-audit.json"), "utf8"));
  const blocker = report.blockers.find((entry) => entry.id === "release-desktop-stale-artifacts");
  assert(blocker);
  assert.match(blocker.detail, /0\.1\.0-beta\.1/);
  assert.match(blocker.detail, /0\.1\.0-beta\.0/);
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

function writeWebRollback(root, overrides = {}) {
  const evidence = {
    artifact: "web-admin-rollback-smoke",
    assertions: [
      "verified current Web Admin release package",
      "verified previous Web Admin rollback package",
      "verified rollback package keeps deployment headers and manifest",
      "verified rollback package is a different release bundle",
    ],
    current: {
      artifact: "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip",
      sha256: sha256Content("web"),
      version: "0.1.0-beta.1",
    },
    evidenceVersion: 1,
    previous: {
      artifact: "reports/release/web/joessh-web-admin-0.1.0-beta.0.zip",
      sha256: sha256Content("previous web"),
      version: "0.1.0-beta.0",
    },
    version: "0.1.0-beta.1",
    ...overrides,
  };
  const evidenceText = JSON.stringify(evidence);
  writeFile(root, "reports/release/web/rollback-smoke.json", evidenceText);
  writeFile(
    root,
    "reports/release/web/rollback-smoke-SHA256SUMS.txt",
    `${sha256Content(evidenceText)}  reports/release/web/rollback-smoke.json\n`,
  );
}

function writeArtifactWithManifest(root, artifactPath, content, manifestPath) {
  writeFile(root, artifactPath, content);
  writeFile(root, manifestPath, `${sha256Content(content)}  ${artifactPath}\n`);
}

function writeDesktopExclusion(root) {
  const evidence = JSON.stringify({
    artifact: "desktop-public-exclusion",
    assertions: [
      "no public Desktop downloads are included in this release profile",
      "reports/release/desktop contains no Desktop release artifacts",
      "signed Desktop formal evidence remains required if Desktop downloads are published",
    ],
    desktopReleaseDir: "reports/release/desktop",
    evidenceVersion: 1,
    generatedAt: "2026-06-21T00:00:00.000Z",
    product: "JoeSSH",
    publicDesktopDownloads: false,
    releaseProfile: "web-sync-only",
    releaseTag: "v0.1.0-beta.1",
    version: "0.1.0-beta.1",
  });
  writeFile(root, "reports/release/desktop-exclusion.json", evidence);
  writeFile(
    root,
    "reports/release/desktop-exclusion-SHA256SUMS.txt",
    `${sha256Content(evidence)}  reports/release/desktop-exclusion.json\n`,
  );
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
  if (is("run", "release:publish-preflight:web-sync-only")) {
    if (state.publishPreflightOk) process.exit(0);
    console.error("Desktop public exclusion verification failed.");
    process.exit(1);
  }
  if (is("run", "release:publish-preflight:local")) {
    if (state.publishPreflightOk) process.exit(0);
    console.error("Local release authority verification failed.");
    process.exit(1);
  }
  if (is("run", "release:publish-preflight:local:web-sync-only")) {
    if (state.publishPreflightOk) process.exit(0);
    console.error("Desktop public exclusion verification failed.");
    process.exit(1);
  }
  if (is("run", "release:desktop:configure-secrets", "--", "--verify-only")) {
    if (state.desktopSecretsOk) process.exit(0);
    console.error("Missing GitHub Actions secret(s) required for formal Desktop evidence");
    process.exit(1);
  }
  if (is("run", "release:local-authority:verify")) {
    if (state.localAuthorityOk) process.exit(0);
    console.error("Local release authority verification failed: source.gitCommit does not match current HEAD");
    process.exit(1);
  }
  if (is("run", "qa:public-beta-dogfood")) {
    if (state.publicBetaDogfoodOk) process.exit(0);
    console.error("FAIL version must be 0.1.0-beta.1");
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
