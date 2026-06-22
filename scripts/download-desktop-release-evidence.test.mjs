import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(new URL("./download-desktop-release-evidence.mjs", import.meta.url));
const RUN_ID = "123456789";
const HEAD_SHA = "abc123";
const REPO = "JoeWorkspace/JoeSSH";

function createFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "desktop-release-evidence-download-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  return {
    env: createFakeCommands(root, options),
    root,
  };
}

function createFakeCommands(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    artifactExpired: false,
    artifactMissing: false,
    duplicateBasename: false,
    failedJobAnnotationMessage: null,
    failedJobId: 987654321,
    formalEvidenceConclusion: "success",
    formalEvidenceJobId: 123456780,
    formalEvidenceStatus: "completed",
    headSha: HEAD_SHA,
    runConclusion: "success",
    runStatus: "completed",
    ...options,
  };

  const fakeGhPath = join(binDir, "gh.js");
  writeFileSync(
    fakeGhPath,
    `
const { createHash } = require("node:crypto");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join("\\0");
const runId = ${JSON.stringify(RUN_ID)};
const repo = ${JSON.stringify(REPO)};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeDownloadedEvidence(dir) {
  mkdirSync(join(dir, "nested"), { recursive: true });
  const artifacts = [
    ["desktop installer", "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe"],
    ["macos dmg", "reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg"],
    ["linux appimage", "reports/release/desktop/JoeSSH_0.1.0-beta.1_amd64.AppImage"],
  ];
  const manifest = artifacts.map(([content, path]) => sha256(content) + "  " + path).join("\\n") + "\\n";
  const evidence = JSON.stringify({
    artifacts: [
      {
        path: artifacts[0][1],
        platform: "windows",
        sha256: sha256(artifacts[0][0]),
        signed: true,
        signatureVerification: "signtool verify " + artifacts[0][1] + " passed",
      },
      {
        path: artifacts[1][1],
        platform: "macos",
        sha256: sha256(artifacts[1][0]),
        signed: true,
        notarized: true,
        signatureVerification: "codesign verify " + artifacts[1][1] + " passed",
        notarizationVerification: "spctl assess " + artifacts[1][1] + " passed",
      },
      {
        path: artifacts[2][1],
        platform: "linux",
        sha256: sha256(artifacts[2][0]),
        packageType: "AppImage",
      },
    ],
  }, null, 2);
  writeFileSync(join(dir, "SHA256SUMS.txt"), manifest);
  writeFileSync(join(dir, "release-evidence.json"), evidence);
  writeFileSync(join(dir, "release-evidence-SHA256SUMS.txt"), sha256(evidence) + "  reports/release/desktop/release-evidence.json\\n");
  for (const [content, path] of artifacts) {
    writeFileSync(join(dir, "nested", path.split("/").pop()), content);
  }
  if (state.duplicateBasename) {
    mkdirSync(join(dir, "dupe"), { recursive: true });
    writeFileSync(join(dir, "dupe", "SHA256SUMS.txt"), "duplicate");
  }
}

if (key === "--version") {
  console.log("gh version 2.70.0");
  process.exit(0);
}
if (key === "auth\\0status") {
  console.log("Logged in");
  process.exit(0);
}
if (key === "run\\0view\\0" + runId + "\\0--repo\\0" + repo + "\\0--json\\0status,conclusion,headSha,jobs,url,databaseId,workflowDatabaseId,workflowName") {
  const jobs = state.runConclusion === "success"
    ? [{
      conclusion: state.formalEvidenceConclusion,
      databaseId: state.formalEvidenceJobId,
      name: "Package Formal Desktop Evidence",
      status: state.formalEvidenceStatus,
    }]
    : [{
      conclusion: "failure",
      databaseId: state.failedJobId,
      name: "Build Desktop linux",
      status: "completed",
    }];
  console.log(JSON.stringify({
    conclusion: state.runConclusion,
    databaseId: Number(runId),
    headSha: state.headSha,
    jobs,
    status: state.runStatus,
    url: "https://github.example/actions/runs/" + runId,
    workflowDatabaseId: 24680,
    workflowName: "Desktop Release Artifacts",
  }));
  process.exit(0);
}
if (key === "api\\0repos/" + repo + "/check-runs/" + state.failedJobId + "/annotations") {
  console.log(JSON.stringify(state.failedJobAnnotationMessage ? [{
    path: ".github",
    message: state.failedJobAnnotationMessage,
  }] : []));
  process.exit(0);
}
if (key === "api\\0repos/" + repo + "/check-runs/" + state.formalEvidenceJobId + "/annotations") {
  console.log(JSON.stringify(state.failedJobAnnotationMessage ? [{
    path: ".github/workflows/desktop-release-artifacts.yml",
    message: state.failedJobAnnotationMessage,
  }] : []));
  process.exit(0);
}
if (key === "api\\0repos/" + repo + "/actions/runs/" + runId + "/artifacts") {
  console.log(JSON.stringify({
    artifacts: state.artifactMissing ? [] : [{
      expired: state.artifactExpired,
      name: "desktop-release-evidence",
      size_in_bytes: 1234,
    }],
  }));
  process.exit(0);
}
if (args[0] === "run" && args[1] === "download" && args[2] === runId && args[3] === "--repo" && args[4] === repo && args[5] === "--name" && args[6] === "desktop-release-evidence" && args[7] === "--dir" && args[8]) {
  writeDownloadedEvidence(args[8]);
  process.exit(0);
}
console.error("unexpected gh args: " + args.join(" "));
process.exit(2);
`,
    "utf8",
  );

  const fakeGitPath = join(binDir, "git.js");
  writeFileSync(
    fakeGitPath,
    `
const args = process.argv.slice(2);
const key = args.join("\\0");
if (key === "rev-parse\\0v0.1.0-beta.1^{}") {
  console.log(${JSON.stringify(HEAD_SHA)});
  process.exit(0);
}
if (key === "remote\\0get-url\\0origin") {
  console.log("https://github.com/${REPO}.git");
  process.exit(0);
}
console.error("unexpected git args: " + args.join(" "));
process.exit(2);
`,
    "utf8",
  );

  return {
    ATLASTERM_RELEASE_GH_ARGS: JSON.stringify([fakeGhPath]),
    ATLASTERM_RELEASE_GH_COMMAND: process.execPath,
    ATLASTERM_RELEASE_GIT_ARGS: JSON.stringify([fakeGitPath]),
    ATLASTERM_RELEASE_GIT_COMMAND: process.execPath,
  };
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function runDownloader(root, args = [], env = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH, "--root", root, "--repo", REPO, "--run-id", RUN_ID, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("downloads, imports, and verifies Desktop formal release evidence", (t) => {
  const { env, root } = createFixture(t);
  writeFile(root, "reports/release/desktop/stale.txt", "stale");

  const result = runDownloader(root, [], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Desktop release evidence verified for 3 artifact\(s\)/);
  assert.match(result.stdout, /Imported and verified Desktop release evidence from run 123456789/);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "stale.txt")), false);
  assert.equal(
    sha256File(join(root, "reports", "release", "desktop", "JoeSSH_0.1.0-beta.1_x64-setup.exe")),
    createHash("sha256").update("desktop installer").digest("hex"),
  );
  const source = JSON.parse(readFileSync(join(root, "reports", "release", "desktop", "release-evidence-source.json"), "utf8"));
  assert.equal(source.repository, REPO);
  assert.equal(source.releaseRef, "v0.1.0-beta.1");
  assert.equal(source.workflowRun.id, RUN_ID);
  assert.equal(source.workflowRun.workflowDatabaseId, 24680);
  assert.equal(source.formalEvidenceJob.name, "Package Formal Desktop Evidence");
  assert.match(
    readFileSync(join(root, "reports", "release", "desktop", "release-evidence-SHA256SUMS.txt"), "utf8"),
    /reports\/release\/desktop\/release-evidence-source\.json/,
  );
});

test("rejects workflow runs whose formal evidence job did not pass", (t) => {
  const { env, root } = createFixture(t, { formalEvidenceConclusion: "skipped" });
  const result = runDownloader(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Package Formal Desktop Evidence job must complete successfully/);
});

test("reports GitHub Actions failure annotations for failed workflow runs", (t) => {
  const { env, root } = createFixture(t, {
    failedJobAnnotationMessage:
      "The job was not started because recent account payments have failed or your spending limit needs to be increased.",
    runConclusion: "failure",
  });
  const result = runDownloader(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Desktop release evidence run 123456789 must be completed successfully/);
  assert.match(result.stderr, /Build Desktop linux: completed\/failure/);
  assert.match(result.stderr, /recent account payments have failed/);
});

test("reports GitHub Actions failure annotations for failed formal evidence jobs", (t) => {
  const { env, root } = createFixture(t, {
    failedJobAnnotationMessage: "Package Formal Desktop Evidence could not download signed platform artifacts.",
    formalEvidenceConclusion: "failure",
  });
  const result = runDownloader(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Package Formal Desktop Evidence job must complete successfully/);
  assert.match(result.stderr, /Package Formal Desktop Evidence: completed\/failure/);
  assert.match(result.stderr, /could not download signed platform artifacts/);
});

test("rejects workflow runs from a different commit than the release tag", (t) => {
  const { env, root } = createFixture(t, { headSha: "def456" });
  const result = runDownloader(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /was built from def456, but v0\.1\.0-beta\.1 points at abc123/);
});

test("rejects missing or expired Desktop evidence artifacts", (t) => {
  const missing = createFixture(t, { artifactMissing: true });
  const missingResult = runDownloader(missing.root, [], missing.env);

  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /does not contain artifact desktop-release-evidence/);

  const expired = createFixture(t, { artifactExpired: true });
  const expiredResult = runDownloader(expired.root, [], expired.env);

  assert.equal(expiredResult.status, 1);
  assert.match(expiredResult.stderr, /has expired/);
});

test("rejects ambiguous downloaded file names", (t) => {
  const { env, root } = createFixture(t, { duplicateBasename: true });
  const result = runDownloader(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate file name SHA256SUMS\.txt/);
});

test("requires an explicit workflow run id", (t) => {
  const { env, root } = createFixture(t);
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "--root", root, "--repo", REPO], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--run-id is required/);
});
