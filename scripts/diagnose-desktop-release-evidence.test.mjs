import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(
  new URL("./diagnose-desktop-release-evidence.mjs", import.meta.url),
);
const REPO = "JoeWorkspace/JoeSSH";
const HEAD_SHA = "abc123";

function createFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "desktop-release-diagnostics-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  if (options.completeDesktopEvidence) {
    writeCompleteDesktopEvidence(root);
  }
  return {
    env: createFakeCommands(root, options),
    ghLogPath: join(root, "fake-gh.log"),
    root,
  };
}

function writeCompleteDesktopEvidence(root) {
  const desktopArtifacts = [
    [
      "desktop installer",
      "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe",
    ],
    ["macos dmg", "reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg"],
    [
      "linux appimage",
      "reports/release/desktop/JoeSSH_0.1.0-beta.1_amd64.AppImage",
    ],
  ];
  for (const [content, path] of desktopArtifacts) {
    writeFile(root, path, content);
  }
  writeManifest(
    root,
    "reports/release/desktop/SHA256SUMS.txt",
    desktopArtifacts,
  );

  const desktopEvidence = JSON.stringify(
    {
      artifacts: [
        {
          path: desktopArtifacts[0][1],
          platform: "windows",
          sha256: sha256(desktopArtifacts[0][0]),
          signed: true,
          signatureVerification: `signtool verify /pa ${desktopArtifacts[0][1]} passed`,
        },
        {
          path: desktopArtifacts[1][1],
          platform: "macos",
          sha256: sha256(desktopArtifacts[1][0]),
          signed: true,
          notarized: true,
          signatureVerification: `codesign --verify ${desktopArtifacts[1][1]} passed`,
          notarizationVerification: `spctl --assess ${desktopArtifacts[1][1]} passed`,
        },
        {
          path: desktopArtifacts[2][1],
          platform: "linux",
          sha256: sha256(desktopArtifacts[2][0]),
          packageType: "AppImage",
        },
      ],
    },
    null,
    2,
  );
  const desktopEvidenceSource = JSON.stringify(
    {
      artifactName: "desktop-release-evidence",
      formalEvidenceJob: {
        conclusion: "success",
        databaseId: 123456780,
        name: "Package Formal Desktop Evidence",
        status: "completed",
      },
      importedAt: "2026-06-21T00:00:00.000Z",
      releaseRef: "v0.1.0-beta.1",
      releaseTagCommit: HEAD_SHA,
      repository: REPO,
      sourceVersion: 1,
      workflowRun: {
        conclusion: "success",
        headSha: HEAD_SHA,
        id: "123456789",
        status: "completed",
        url: "https://github.example/actions/runs/123456789",
        workflowDatabaseId: 987654321,
        workflowName: "Desktop Release Artifacts",
      },
    },
    null,
    2,
  );
  writeFile(
    root,
    "reports/release/desktop/release-evidence.json",
    desktopEvidence,
  );
  writeFile(
    root,
    "reports/release/desktop/release-evidence-source.json",
    desktopEvidenceSource,
  );
  writeManifest(
    root,
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    [
      [desktopEvidence, "reports/release/desktop/release-evidence.json"],
      [
        desktopEvidenceSource,
        "reports/release/desktop/release-evidence-source.json",
      ],
    ],
  );
}

function createFakeCommands(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    annotations: [],
    ciJobs: [],
    ciRuns: [
      {
        conclusion: "success",
        databaseId: 222,
        headSha: HEAD_SHA,
        status: "completed",
        url: "https://github.example/actions/runs/222",
        workflowName: "CI",
      },
    ],
    desktopRuns: [
      {
        conclusion: "success",
        databaseId: 111,
        headSha: HEAD_SHA,
        status: "completed",
        url: "https://github.example/actions/runs/111",
        workflowName: "Desktop Release Artifacts",
      },
    ],
    ghAuthFails: false,
    remoteRefs: {
      "refs/tags/v0.1.0-beta.1": HEAD_SHA,
      "refs/tags/v0.1.0-beta.1^{}": HEAD_SHA,
    },
    tagCommit: HEAD_SHA,
    upstream: "origin/main",
    upstreamAhead: "0",
    upstreamBehind: "0",
    workflowMissing: false,
    ...options,
  };

  const fakeGitPath = join(binDir, "git.js");
  writeFileSync(
    fakeGitPath,
    `
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join("\\0");
if (key === "remote\\0get-url\\0origin") {
  console.log("https://github.com/${REPO}.git");
  process.exit(0);
}
if (key === "rev-parse\\0HEAD") {
  console.log(${JSON.stringify(HEAD_SHA)});
  process.exit(0);
}
if (key === "rev-parse\\0--verify\\0v0.1.0-beta.1^{}") {
  console.log(state.tagCommit);
  process.exit(0);
}
if (key === "fsck\\0--strict") {
  process.exit(0);
}
if (args[0] === "ls-remote" && args[1] === "--exit-code" && args[2] === "origin") {
  const ref = args[3];
  if (state.remoteRefs[ref]) {
    console.log(state.remoteRefs[ref] + "\\t" + ref);
    process.exit(0);
  }
  console.error("not found " + ref);
  process.exit(2);
}
if (key === "rev-parse\\0--abbrev-ref\\0--symbolic-full-name\\0@{u}") {
  if (!state.upstream) {
    process.exit(1);
  }
  console.log(state.upstream);
  process.exit(0);
}
if (args[0] === "rev-list" && args[1] === "--left-right" && args[2] === "--count") {
  console.log(state.upstreamBehind + "\\t" + state.upstreamAhead);
  process.exit(0);
}
console.error("unexpected git args: " + args.join(" "));
process.exit(2);
`,
    "utf8",
  );

  const fakeGhPath = join(binDir, "gh.js");
  writeFileSync(
    fakeGhPath,
    `
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join("\\0");
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\\n");
if (key === "--version") {
  console.log("gh version 2.70.0");
  process.exit(0);
}
if (key === "auth\\0status") {
  if (state.ghAuthFails) {
    console.error("not logged in");
    process.exit(1);
  }
  console.log("Logged in");
  process.exit(0);
}
if (key === "workflow\\0view\\0desktop-release-artifacts.yml\\0--repo\\0${REPO}") {
  if (state.workflowMissing) {
    console.error("workflow not found");
    process.exit(1);
  }
  console.log("Desktop Release Artifacts");
  process.exit(0);
}
if (args[0] === "run" && args[1] === "list" && args[2] === "--repo" && args[3] === "${REPO}" && args[4] === "--workflow" && args[5] === "desktop-release-artifacts.yml") {
  console.log(JSON.stringify(state.desktopRuns));
  process.exit(0);
}
if (args[0] === "run" && args[1] === "list" && args[2] === "--repo" && args[3] === "${REPO}" && args[4] === "--workflow" && args[5] === "CI") {
  console.log(JSON.stringify(state.ciRuns));
  process.exit(0);
}
if (args[0] === "run" && args[1] === "view" && args[2] === "222" && args[3] === "--repo" && args[4] === "${REPO}" && args[5] === "--json" && args[6] === "jobs") {
  console.log(JSON.stringify({ jobs: state.ciJobs }));
  process.exit(0);
}
if (args[0] === "api" && args[1] === "repos/${REPO}/check-runs/333/annotations") {
  console.log(JSON.stringify(state.annotations));
  process.exit(0);
}
console.error("unexpected gh args: " + args.join(" "));
process.exit(2);
`,
    "utf8",
  );

  const fakePowerShellPath = join(binDir, "powershell.js");
  writeFileSync(
    fakePowerShellPath,
    `
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ Status: "Valid", StatusMessage: "Signature verified" }));
});
`,
    "utf8",
  );

  return {
    ATLASTERM_RELEASE_GH_ARGS: JSON.stringify([fakeGhPath]),
    ATLASTERM_RELEASE_GH_COMMAND: process.execPath,
    ATLASTERM_RELEASE_GIT_ARGS: JSON.stringify([fakeGitPath]),
    ATLASTERM_RELEASE_GIT_COMMAND: process.execPath,
    ATLASTERM_RELEASE_POWERSHELL_ARGS: JSON.stringify([fakePowerShellPath]),
    ATLASTERM_RELEASE_POWERSHELL_COMMAND: process.execPath,
    FAKE_GH_LOG: join(root, "fake-gh.log"),
  };
}

function runDiagnostics(root, args = [], env = {}) {
  return spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--root", root, "--repo", REPO, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    },
  );
}

function readReport(root) {
  return JSON.parse(
    readFileSync(
      join(
        root,
        "reports",
        "handoff",
        "desktop",
        "formal-evidence-unblock-report.json",
      ),
      "utf8",
    ),
  );
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
    entries
      .map(([content, artifactPath]) => `${sha256(content)}  ${artifactPath}`)
      .join("\n") + "\n",
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertNoSigningEnvironmentCalls(ghLogPath) {
  const calls = existsSync(ghLogPath) ? readFileSync(ghLogPath, "utf8") : "";
  assert.doesNotMatch(calls, /"secret","(?:list|set)"/);
  assert.doesNotMatch(calls, /desktop-release-signing|--env/);
}

test("writes a no-go report with missing evidence, disabled signing, and CI annotations", (t) => {
  const { env, ghLogPath, root } = createFixture(t, {
    annotations: [
      {
        message:
          "The job was not started because recent account payments have failed or your spending limit needs to be increased.",
        path: ".github",
      },
    ],
    ciJobs: [
      {
        conclusion: "failure",
        databaseId: 333,
        name: "Unit Tests",
        status: "completed",
      },
    ],
    ciRuns: [
      {
        conclusion: "failure",
        databaseId: 222,
        headSha: HEAD_SHA,
        status: "completed",
        url: "https://github.example/actions/runs/222",
        workflowName: "CI",
      },
    ],
    desktopRuns: [],
  });

  const result = runDiagnostics(root, ["--no-fail"], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /formal-evidence-unblock-report\.json \(no-go\)/);
  const report = readReport(root);
  assert.equal(report.decision, "no-go");
  assert.equal(report.version, "0.1.0-beta.1");
  assert.ok(
    report.blockers.some((blocker) => blocker.id === "release-desktop"),
  );
  assert.ok(
    report.blockers.some(
      (blocker) => blocker.id === "desktop-formal-signing-disabled",
    ),
  );
  assert.ok(report.blockers.some((blocker) => blocker.id === "github-ci"));
  assert.equal(report.git.remoteReleaseRef.status, "published");
  assert.equal(report.git.upstream.name, "origin/main");
  assert.match(JSON.stringify(report), /recent account payments have failed/);
  assert.equal(
    report.formalSigning.repositoryAutomation,
    "FORMAL_SIGNING_DISABLED",
  );
  assertNoSigningEnvironmentCalls(ghLogPath);
});

test("reports unpublished release refs separately from local tag state", (t) => {
  const { env, root } = createFixture(t, { remoteRefs: {} });

  const result = runDiagnostics(root, ["--no-fail"], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = readReport(root);
  assert.equal(report.git.remoteReleaseRef.status, "missing");
  assert.ok(
    report.blockers.some((blocker) => blocker.id === "release-remote-ref"),
  );
});

test("flags staged Desktop artifacts that do not match the package version", (t) => {
  const { env, root } = createFixture(t, { completeDesktopEvidence: true });
  writeFile(
    root,
    "reports/release/desktop/JoeSSH_0.1.0-beta.0_x64-setup.exe",
    "old installer",
  );

  const result = runDiagnostics(root, ["--no-fail"], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = readReport(root);
  const blocker = report.blockers.find(
    (entry) => entry.id === "release-desktop-stale-artifacts",
  );
  assert.ok(blocker);
  assert.match(blocker.detail, /0\.1\.0-beta\.1/);
  assert.match(blocker.detail, /0\.1\.0-beta\.0/);
  assert.equal(report.localEvidence.staleArtifacts.length, 1);
});

test("complete historical evidence remains no-go while repository formal signing is disabled", (t) => {
  const { env, ghLogPath, root } = createFixture(t, {
    completeDesktopEvidence: true,
  });

  const result = runDiagnostics(root, ["--no-fail"], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /formal-evidence-unblock-report\.json \(no-go\)/);
  const report = readReport(root);
  assert.equal(report.decision, "no-go");
  assert.deepEqual(
    report.blockers.map((blocker) => blocker.id),
    ["desktop-formal-signing-disabled"],
  );
  assert.equal(report.localEvidence.artifacts.length, 3);
  assert.equal(report.git.remoteReleaseRef.status, "published");
  assert.equal(report.github.formalSigning, "FORMAL_SIGNING_DISABLED");
  assert.equal(report.github.ci.status, "success");
  assert.equal(
    existsSync(
      join(
        root,
        "reports",
        "handoff",
        "desktop",
        "formal-evidence-unblock-report.json",
      ),
    ),
    true,
  );
  assert.match(
    report.unblockSteps.join("\n"),
    /externally managed isolated signer/,
  );
  assertNoSigningEnvironmentCalls(ghLogPath);
});
