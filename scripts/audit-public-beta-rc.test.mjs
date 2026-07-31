import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(
  new URL("./audit-public-beta-rc.mjs", import.meta.url),
);

function createFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "rc-audit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFile(
    root,
    "package.json",
    JSON.stringify({
      scripts: {
        "release:desktop:secret-template":
          "node scripts/configure-desktop-release-secrets.mjs --write-template",
      },
      version: "0.1.0-beta.1",
    }),
  );
  writeFile(
    root,
    "scripts/configure-desktop-release-secrets.mjs",
    [
      "FORMAL_SIGNING_DISABLED",
      "--write-template",
      "reports/handoff/desktop/external-signer-input-template.env",
    ].join("\n"),
  );
  writeFile(
    root,
    "scripts/desktop-release-evidence-preflight.mjs",
    [
      "FORMAL_SIGNING_DISABLED",
      "approved externally managed isolated signer",
    ].join("\n"),
  );
  writeArtifactWithManifest(
    root,
    "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip",
    "web",
    "reports/release/web/SHA256SUMS.txt",
  );
  writeArtifactWithManifest(
    root,
    "reports/release/sync/joessh-sync-0.1.0-beta.1-win32-x64.exe",
    "sync",
    "reports/release/sync/SHA256SUMS.txt",
  );
  writeArtifactWithManifest(
    root,
    "reports/release/npm-web-sbom.cdx.json",
    "web-sbom",
    "reports/release/SBOM-SHA256SUMS.txt",
  );
  appendManifest(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    "reports/release/npm-desktop-sbom.cdx.json",
    "desktop-sbom",
  );
  appendManifest(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    "reports/release/cargo-workspace-sbom.cdx.json",
    "cargo-workspace-sbom",
  );
  appendManifest(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    "reports/release/tauri-cargo-sbom.cdx.json",
    "tauri-cargo-sbom",
  );
  writeArtifactWithManifest(
    root,
    "reports/release/third-party-licenses/manifest.json",
    '{"fixture":"third-party-license-inventory"}\n',
    "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
  );
  appendManifest(
    root,
    "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
    "reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt",
    "JoeSSH third-party notices fixture.\n",
  );
  writeArtifactWithManifest(
    root,
    "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe",
    "desktop",
    "reports/release/desktop/SHA256SUMS.txt",
  );
  writeArtifactWithManifest(
    root,
    "reports/release/desktop/release-evidence.json",
    "{}",
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
  );
  const state = {
    ciConclusion: "success",
    gitClean: true,
    head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    publishPreflightOk: true,
    tag: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...options,
  };
  writeDogfood(root, {
    gitCommit:
      options.dogfoodGitCommit ?? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    gitDirty: options.dogfoodGitDirty ?? false,
    passed: options.dogfoodPassed ?? true,
    version: options.dogfoodVersion ?? "0.1.0-beta.1",
    wrappedGate: options.dogfoodWrappedGate ?? "qa:release:public",
    wrappedStatus: options.dogfoodWrappedStatus ?? 0,
  });
  if (options.removeDesktopEvidence) {
    rmSync(join(root, "reports", "release", "desktop"), {
      recursive: true,
      force: true,
    });
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
    [
      SCRIPT_PATH,
      "--root",
      root,
      "--repo",
      "JoeWorkspace/JoeSSH",
      "--no-fail",
      ...extraArgs,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ATLASTERM_RC_AUDIT_GH_ARGS: JSON.stringify([fakePath, statePath, "gh"]),
        ATLASTERM_RC_AUDIT_GH_COMMAND: process.execPath,
        ATLASTERM_RC_AUDIT_GIT_ARGS: JSON.stringify([
          fakePath,
          statePath,
          "git",
        ]),
        ATLASTERM_RC_AUDIT_GIT_COMMAND: process.execPath,
        ATLASTERM_RC_AUDIT_NPM_ARGS: JSON.stringify([
          fakePath,
          statePath,
          "npm",
        ]),
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
  const report = JSON.parse(
    readFileSync(
      join(root, "reports/release/public-beta-rc-audit.json"),
      "utf8",
    ),
  );
  assert.equal(report.decision, "go");
  assert.equal(report.blockers.length, 0);
});

test("rejects stale, dirty, weak, or failed Desktop dogfood evidence", async (t) => {
  const cases = [
    ["stale version", { dogfoodVersion: "0.1.0-beta.0" }, /evidence version/],
    [
      "different commit",
      { dogfoodGitCommit: "b".repeat(40) },
      /evidence commit/,
    ],
    ["dirty source", { dogfoodGitDirty: true }, /clean source worktree/],
    [
      "weaker wrapped gate",
      { dogfoodWrappedGate: "qa:beta:windows:source" },
      /qa:release:public/,
    ],
    ["failed wrapped gate", { dogfoodWrappedStatus: 1 }, /qa:release:public/],
  ];

  for (const [name, options, diagnostic] of cases) {
    await t.test(name, (subtest) => {
      const { fakePath, root, statePath } = createFixture(subtest, options);
      const result = runAudit(root, fakePath, statePath, ["--skip-github"]);
      assert.equal(result.status, 0);
      const report = JSON.parse(
        readFileSync(
          join(root, "reports/release/public-beta-rc-audit.json"),
          "utf8",
        ),
      );
      const blocker = report.blockers.find(
        (entry) => entry.id === "desktop-dogfood",
      );
      assert(blocker);
      assert.match(blocker.detail, diagnostic);
    });
  }
});

test("records No-Go blockers without hiding GitHub billing annotations", (t) => {
  const { fakePath, root, statePath } = createFixture(t, {
    ciConclusion: "failure",
    dogfoodPassed: false,
    publishPreflightOk: false,
    removeDesktopEvidence: true,
    tag: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  const result = runAudit(root, fakePath, statePath);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /NO-GO/);
  const report = JSON.parse(
    readFileSync(
      join(root, "reports/release/public-beta-rc-audit.json"),
      "utf8",
    ),
  );
  assert.equal(report.decision, "no-go");
  assert.match(JSON.stringify(report), /spending limit needs to be increased/);
  assert(report.blockers.some((blocker) => blocker.id === "release-tag"));
  assert(
    report.checks.some(
      (check) =>
        check.id === "desktop-formal-signing-disabled" &&
        check.status === "pass",
    ),
  );
  assert(report.blockers.some((blocker) => blocker.id === "github-ci"));
});

test("blocks when a repository signing mutation path is reintroduced", (t) => {
  const { fakePath, root, statePath } = createFixture(t);
  writeFile(
    root,
    "scripts/configure-desktop-release-secrets.mjs",
    [
      "FORMAL_SIGNING_DISABLED",
      "--write-template",
      "reports/handoff/desktop/external-signer-input-template.env",
      "spawnSync",
      '"secret", "set"',
      "desktop-release-signing",
    ].join("\n"),
  );

  const result = runAudit(root, fakePath, statePath, ["--skip-github"]);
  assert.equal(result.status, 0);
  const report = JSON.parse(
    readFileSync(
      join(root, "reports/release/public-beta-rc-audit.json"),
      "utf8",
    ),
  );
  const blocker = report.blockers.find(
    (entry) => entry.id === "desktop-formal-signing-disabled",
  );
  assert(blocker);
  assert.match(blocker.detail, /template-only boundary/);
});

test("rejects checksum manifest entries outside the release root", (t) => {
  const { fakePath, root, statePath } = createFixture(t);
  writeFile(
    root,
    "reports/release/web/SHA256SUMS.txt",
    `${"a".repeat(64)}  ../outside.zip\n`,
  );
  const result = runAudit(root, fakePath, statePath, ["--skip-github"]);

  assert.equal(result.status, 0);
  const report = JSON.parse(
    readFileSync(
      join(root, "reports/release/public-beta-rc-audit.json"),
      "utf8",
    ),
  );
  const blocker = report.blockers.find((entry) => entry.id === "release-web");
  assert(blocker);
  assert.match(blocker.detail, /escapes the release root/);
});

test("rejects an SBOM manifest that omits the public Cargo SBOMs", (t) => {
  const { fakePath, root, statePath } = createFixture(t);
  writeFile(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    `${sha256Content("web-sbom")}  reports/release/npm-web-sbom.cdx.json\n${sha256Content("desktop-sbom")}  reports/release/npm-desktop-sbom.cdx.json\n`,
  );

  const result = runAudit(root, fakePath, statePath, ["--skip-github"]);

  assert.equal(result.status, 0);
  const report = JSON.parse(
    readFileSync(
      join(root, "reports/release/public-beta-rc-audit.json"),
      "utf8",
    ),
  );
  const blocker = report.blockers.find((entry) => entry.id === "release-sbom");
  assert(blocker);
  assert.match(blocker.detail, /must exactly cover/);
  assert.match(blocker.detail, /cargo-workspace-sbom\.cdx\.json/);
});

test("flags staged Desktop artifacts that do not match the package version", (t) => {
  const { fakePath, root, statePath } = createFixture(t);
  writeFile(
    root,
    "reports/release/desktop/JoeSSH_0.1.0-beta.0_x64-setup.exe",
    "old desktop",
  );

  const result = runAudit(root, fakePath, statePath);

  assert.equal(result.status, 0);
  const report = JSON.parse(
    readFileSync(
      join(root, "reports/release/public-beta-rc-audit.json"),
      "utf8",
    ),
  );
  const blocker = report.blockers.find(
    (entry) => entry.id === "release-desktop-stale-artifacts",
  );
  assert(blocker);
  assert.match(blocker.detail, /0\.1\.0-beta\.1/);
  assert.match(blocker.detail, /0\.1\.0-beta\.0/);
});

function writeDogfood(
  root,
  { gitCommit, gitDirty, passed, version, wrappedGate, wrappedStatus },
) {
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
    gitCommit,
    gitDirty,
    status: passed ? "passed" : "failed",
    version,
    wrappedCommand: {
      gate: wrappedGate,
      provided: true,
      status: wrappedStatus,
    },
  };
  const path = "reports/smoke/desktop/real-ssh-smoke.json";
  writeFile(root, path, JSON.stringify(evidence));
  writeFile(
    root,
    "reports/smoke/desktop/real-ssh-smoke-SHA256SUMS.txt",
    `${sha256Content(JSON.stringify(evidence))}  ${path}\n`,
  );
}

function writeArtifactWithManifest(root, artifactPath, content, manifestPath) {
  writeFile(root, artifactPath, content);
  writeFile(root, manifestPath, `${sha256Content(content)}  ${artifactPath}\n`);
}

function appendManifest(root, manifestPath, artifactPath, content) {
  writeFile(root, artifactPath, content);
  const path = join(root, ...manifestPath.split("/"));
  writeFileSync(
    path,
    `${readFileSync(path, "utf8")}${sha256Content(content)}  ${artifactPath}\n`,
  );
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
