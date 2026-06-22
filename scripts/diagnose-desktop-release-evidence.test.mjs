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
const REQUIRED_SECRETS = [
  "ATLASTERM_WINDOWS_CERTIFICATE",
  "ATLASTERM_WINDOWS_CERTIFICATE_PASSWORD",
  "ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT",
  "ATLASTERM_WINDOWS_TIMESTAMP_URL",
  "ATLASTERM_APPLE_CERTIFICATE",
  "ATLASTERM_APPLE_CERTIFICATE_PASSWORD",
  "ATLASTERM_APPLE_ID",
  "ATLASTERM_APPLE_PASSWORD",
  "ATLASTERM_APPLE_TEAM_ID",
  "ATLASTERM_KEYCHAIN_PASSWORD",
];

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
    root,
  };
}

function writeCompleteDesktopEvidence(root) {
  const desktopArtifacts = [
    ["desktop installer", "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe"],
    ["macos dmg", "reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg"],
    ["linux appimage", "reports/release/desktop/JoeSSH_0.1.0-beta.1_amd64.AppImage"],
  ];
  for (const [content, path] of desktopArtifacts) {
    writeFile(root, path, content);
  }
  writeManifest(root, "reports/release/desktop/SHA256SUMS.txt", desktopArtifacts);

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
  writeFile(root, "reports/release/desktop/release-evidence.json", desktopEvidence);
  writeFile(
    root,
    "reports/release/desktop/release-evidence-source.json",
    desktopEvidenceSource,
  );
  writeManifest(root, "reports/release/desktop/release-evidence-SHA256SUMS.txt", [
    [desktopEvidence, "reports/release/desktop/release-evidence.json"],
    [desktopEvidenceSource, "reports/release/desktop/release-evidence-source.json"],
  ]);
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
    secrets: REQUIRED_SECRETS,
    tagCommit: HEAD_SHA,
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
console.error("unexpected git args: " + args.join(" "));
process.exit(2);
`,
    "utf8",
  );

  const fakeGhPath = join(binDir, "gh.js");
  writeFileSync(
    fakeGhPath,
    `
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join("\\0");
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
if (key === "api\\0repos/${REPO}/actions/secrets\\0--jq\\0.secrets[].name") {
  console.log(state.secrets.join("\\n"));
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
      join(root, "reports", "release", "desktop", "formal-evidence-unblock-report.json"),
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
    entries.map(([content, artifactPath]) => `${sha256(content)}  ${artifactPath}`).join("\n") + "\n",
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("writes a no-go unblock report with missing evidence, secrets, and CI annotations", (t) => {
  const { env, root } = createFixture(t, {
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
    secrets: [],
  });

  const result = runDiagnostics(root, ["--no-fail"], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /formal-evidence-unblock-report\.json \(no-go\)/);
  const report = readReport(root);
  assert.equal(report.decision, "no-go");
  assert.equal(report.version, "0.1.0-beta.1");
  assert.ok(report.blockers.some((blocker) => blocker.id === "release-desktop"));
  assert.ok(report.blockers.some((blocker) => blocker.id === "desktop-signing-secrets"));
  assert.ok(report.blockers.some((blocker) => blocker.id === "github-ci"));
  assert.match(JSON.stringify(report), /recent account payments have failed/);
});

test("passes when Desktop formal evidence, secrets, workflow, and CI are complete", (t) => {
  const { env, root } = createFixture(t, { completeDesktopEvidence: true });

  const result = runDiagnostics(root, [], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /formal-evidence-unblock-report\.json \(go\)/);
  const report = readReport(root);
  assert.equal(report.decision, "go");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.localEvidence.artifacts.length, 3);
  assert.equal(report.github.secrets.availableCount, REQUIRED_SECRETS.length);
  assert.equal(report.github.ci.status, "success");
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "formal-evidence-unblock-report.json")), true);
});
