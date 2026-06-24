import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(new URL("./verify-desktop-unsigned-staging.mjs", import.meta.url));

function createFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "joessh-unsigned-staging-verify-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const version = options.version ?? "0.1.0-beta.10";
  const artifactPath =
    options.artifactPath ??
    `apps/desktop/src-tauri/target/release/bundle/nsis/JoeSSH_${version}_x64-setup.exe`;
  const artifactContent = options.artifactContent ?? "unsigned installer";
  writeFile(root, "package.json", JSON.stringify({ version }));
  writeFile(root, artifactPath, artifactContent);

  const report = {
    schemaVersion: 1,
    generatedAt: "2026-06-25T00:00:00.000Z",
    version,
    decision: "internal-staging-only",
    publicReleaseEvidence: false,
    boundary:
      "Unsigned Desktop staging reports are for internal dogfood and handoff only. They must not be copied into reports/release or used as signed Desktop formal release evidence.",
    git: {
      head: options.reportHead ?? "abc123",
      statusShort: [],
      tagsAtHead: [`v${version}`],
    },
    bundleDir: "apps/desktop/src-tauri/target/release/bundle",
    artifacts: [
      {
        path: artifactPath,
        fileName: artifactPath.split("/").pop(),
        platform: "windows",
        packageType: null,
        sizeBytes: artifactContent.length,
        sha256: sha256(artifactContent),
        versionMatchesPackage: true,
        authenticode: {
          status: "NotSigned",
          statusMessage: "No signature",
        },
      },
    ],
    ...options.reportOverrides,
  };
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  writeFile(root, "reports/handoff/desktop/unsigned-staging-report.json", reportText);
  writeFile(
    root,
    "reports/handoff/desktop/unsigned-staging-report-SHA256SUMS.txt",
    `${sha256(reportText)}  reports/handoff/desktop/unsigned-staging-report.json\n`,
  );
  return root;
}

function runVerifier(root, env = createFakeGitCommands(root), extraArgs = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, "--root", root, ...extraArgs], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function createFakeGitCommands(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    head: "abc123",
    tagCommit: "abc123",
    tagsAtHead: "v0.1.0-beta.10",
    fsckFails: false,
    ...options,
  };
  const fakeGitPath = join(binDir, "git.js");
  writeFileSync(
    fakeGitPath,
    `
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join(" ");
if (key === "rev-parse HEAD") {
  console.log(state.head);
  process.exit(0);
}
if (key === "rev-parse --verify v0.1.0-beta.10^{}") {
  console.log(state.tagCommit);
  process.exit(0);
}
if (key === "fsck --strict") {
  if (state.fsckFails) {
    console.error("fsck failed");
    process.exit(1);
  }
  process.exit(0);
}
if (key === "tag --points-at HEAD") {
  console.log(state.tagsAtHead);
  process.exit(0);
}
console.error("unexpected git args: " + key);
process.exit(2);
`,
    "utf8",
  );
  return {
    ATLASTERM_RELEASE_GIT_ARGS: JSON.stringify([fakeGitPath]),
    ATLASTERM_RELEASE_GIT_COMMAND: process.execPath,
  };
}

test("verifies checksum-covered unsigned Desktop staging evidence", (t) => {
  const root = createFixture(t);
  const result = runVerifier(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Unsigned Desktop staging evidence verified for v0\.1\.0-beta\.10/);
});

test("rejects a stale report checksum", (t) => {
  const root = createFixture(t);
  writeFile(root, "reports/handoff/desktop/unsigned-staging-report.json", "{}\n");

  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /checksum manifest hash mismatch/);
});

test("rejects artifact hash mismatches", (t) => {
  const root = createFixture(t);
  writeFile(
    root,
    "apps/desktop/src-tauri/target/release/bundle/nsis/JoeSSH_0.1.0-beta.10_x64-setup.exe",
    "mutated unsigned installer",
  );

  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /artifacts\[0\]\.sizeBytes must match/);
  assert.match(result.stderr, /artifacts\[0\]\.sha256 does not match/);
});

test("rejects unsigned staging evidence under reports/release", (t) => {
  const root = createFixture(t);

  const result = runVerifier(root, createFakeGitCommands(root), [
    "--report",
    "reports/release/desktop/unsigned-staging-report.json",
    "--checksum",
    "reports/release/desktop/unsigned-staging-report-SHA256SUMS.txt",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must stay outside reports\/release/);
});

test("rejects public Desktop artifacts staged under reports/release", (t) => {
  const root = createFixture(t);
  writeFile(root, "reports/release/desktop/JoeSSH_0.1.0-beta.10_x64-setup.exe", "public installer");

  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not stage public Desktop artifacts/);
});

test("rejects Desktop installers and unsigned staging evidence anywhere under reports/release", (t) => {
  const root = createFixture(t);
  writeFile(root, "reports/release/web/JoeSSH_0.1.0-beta.10_x64-setup.exe", "misplaced unsigned installer");
  writeFile(root, "reports/release/sync/unsigned-staging-report.json", '{"publicReleaseEvidence":false}\n');
  writeFile(
    root,
    "reports/release/sync/unsigned-staging-report-SHA256SUMS.txt",
    `${sha256('{"publicReleaseEvidence":false}\n')}  reports/release/sync/unsigned-staging-report.json\n`,
  );

  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not stage public Desktop artifacts or unsigned staging evidence in reports\/release/);
  assert.match(result.stderr, /reports\/release\/web\/JoeSSH_0\.1\.0-beta\.10_x64-setup\.exe/);
  assert.match(result.stderr, /reports\/release\/sync\/unsigned-staging-report\.json/);
  assert.match(result.stderr, /reports\/release\/sync\/unsigned-staging-report-SHA256SUMS\.txt/);
});

test("allows packaged Sync Windows executables under reports/release/sync", (t) => {
  const root = createFixture(t);
  writeFile(root, "reports/release/sync/joessh-sync-0.1.0-beta.10-win32-x64.exe", "sync release binary");

  const result = runVerifier(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("rejects reports that are not bound to the current release tag", (t) => {
  const root = createFixture(t, {
    reportOverrides: {
      git: {
        head: "abc123",
        statusShort: [],
        tagsAtHead: ["v0.1.0-beta.9"],
      },
    },
  });

  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /git\.tagsAtHead must include v0\.1\.0-beta\.10/);
});

test("can skip current Git checks while preserving content checks", (t) => {
  const root = createFixture(t);
  const result = runVerifier(root, {}, ["--skip-current-git-check"]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
});

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
