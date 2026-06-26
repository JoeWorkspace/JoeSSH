import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";

const node = process.execPath;
const script = "scripts/verify-public-beta-dogfood-evidence.mjs";
const version = JSON.parse(readFileSync("package.json", "utf8")).version;

const requiredTaskIds = [
  "desktop-install-launch",
  "desktop-connection-host-key",
  "desktop-pty-session",
  "desktop-command-safety",
  "desktop-sftp-transfer",
  "desktop-forwarding",
  "web-admin-live-sync",
  "sync-device-flow",
  "sync-backup-restore-rollback",
  "release-evidence-review",
];

test("writes a reusable Public Beta dogfood evidence template", () => {
  const root = createReleaseRoot();
  const path = join(root, "template.json");

  execFileSync(node, [script, "--write-template", path], {
    encoding: "utf8",
    env: scriptEnv(root),
  });

  const template = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(template.version, version);
  assert.equal(template.releaseTag, `v${version}`);
  assert.equal(template.releaseAuthority, "github");
  assert.equal(template.releaseProfile, "full");
  assert.deepEqual(
    template.tasks.map((task) => task.id),
    requiredTaskIds,
  );
  assert(template.tasks.every((task) => task.status === "pending"));
});

test("writes a profile-bound dogfood template for local unsigned Desktop staging", () => {
  const root = createReleaseRoot({ releaseAuthority: "local", releaseProfile: "desktop-local-unsigned" });
  const path = join(root, "template.json");

  execFileSync(
    node,
    [
      script,
      "--release-authority",
      "local",
      "--release-profile",
      "desktop-local-unsigned",
      "--write-template",
      path,
    ],
    {
      encoding: "utf8",
      env: scriptEnv(root),
    },
  );

  const template = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(template.releaseAuthority, "local");
  assert.equal(template.releaseProfile, "desktop-local-unsigned");
  assert.equal(template.artifacts.rcAudit, "reports/release/public-beta-rc-audit.local.desktop-local-unsigned.json");
});

test("accepts complete dogfood evidence with all required tasks passed", () => {
  const { path, root } = writeEvidence();

  const output = execFileSync(node, [script, "--evidence", path], {
    encoding: "utf8",
    env: scriptEnv(root),
  });

  assert.match(output, /Public Beta dogfood evidence verified for 10 task/);
});

test("accepts complete dogfood evidence bound to the current Git checkout", () => {
  const { path, root } = writeEvidence({}, { gitSource: true });

  const output = execFileSync(node, [script, "--evidence", path], {
    encoding: "utf8",
    env: scriptEnv(root),
  });

  assert.match(output, /Public Beta dogfood evidence verified for 10 task/);
});

test("accepts complete dogfood evidence for local unsigned Desktop staging profile", () => {
  const options = { releaseAuthority: "local", releaseProfile: "desktop-local-unsigned" };
  const { path, root } = writeEvidence({}, options);

  const output = execFileSync(
    node,
    [script, "--release-authority", "local", "--release-profile", "desktop-local-unsigned", "--evidence", path],
    {
      encoding: "utf8",
      env: scriptEnv(root),
    },
  );

  assert.match(output, /Public Beta dogfood evidence verified for 10 task/);
});

test("rejects dogfood evidence whose gitCommit is stale", () => {
  const { path, root } = writeEvidence({ gitCommit: "0".repeat(40) }, { gitSource: true });
  const failure = runFailure(path, root);

  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /gitCommit must match current HEAD/);
});

test("rejects dogfood evidence whose releaseTagCommit is stale", () => {
  const { path, root } = writeEvidence({ releaseTagCommit: "1".repeat(40) }, { gitSource: true });
  const failure = runFailure(path, root);

  assert.equal(failure.status, 1);
  assert.match(failure.stderr, new RegExp(`releaseTagCommit must match v${escapeRegExp(version)}`));
});

test("prefers profile-bound default dogfood evidence before legacy latest.json", () => {
  const options = {
    evidencePath: "reports/dogfood/public-beta/latest.local.desktop-local-unsigned.json",
    releaseAuthority: "local",
    releaseProfile: "desktop-local-unsigned",
  };
  const { root } = writeEvidence({}, options);
  writeFile(root, "reports/dogfood/public-beta/latest.json", "{}\n");

  const output = execFileSync(
    node,
    [script, "--release-authority", "local", "--release-profile", "desktop-local-unsigned"],
    {
      encoding: "utf8",
      env: scriptEnv(root),
    },
  );

  assert.match(output, /Public Beta dogfood evidence verified for 10 task/);
});

test("rejects missing required task evidence", () => {
  const { path, root } = writeEvidence({
    tasks: completeTasks().filter((task) => task.id !== "desktop-forwarding"),
  });
  const failure = runFailure(path, root);

  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /missing task: desktop-forwarding/);
});

test("rejects open P0 and P1 findings", () => {
  const { path, root } = writeEvidence({
    findings: [
      {
        id: "dangerous-command",
        severity: "P1",
        status: "open",
        summary: "Blocked command status was misleading.",
      },
    ],
  });
  const failure = runFailure(path, root);

  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /open P1 finding blocks Public Beta dogfood completion/);
});

test("rejects missing artifact files", () => {
  const { path, root } = writeEvidence({
    artifacts: {
      ...expectedArtifacts(),
      rcAudit: "reports/release/public-beta-rc-audit-missing.json",
    },
  });
  const failure = runFailure(path, root);

  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /artifacts.rcAudit must be reports\/release\/public-beta-rc-audit\.github\.full\.json/);
});

test("rejects dogfood evidence that references a No-Go RC audit", () => {
  const { path, root } = writeEvidence({}, { rcAuditDecision: "no-go" });
  const failure = runFailure(path, root);

  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /artifacts\.rcAudit decision must be "go"/);
  assert.match(failure.stderr, /artifacts\.rcAudit must not contain blockers/);
});

test("rejects artifact paths that escape the release workspace", () => {
  const { path, root } = writeEvidence({
    artifacts: {
      ...expectedArtifacts(),
      rcAudit: "../reports/release/public-beta-rc-audit.github.full.json",
    },
  });
  const failure = runFailure(path, root);

  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /artifacts.rcAudit must be reports\/release\/public-beta-rc-audit\.github\.full\.json/);
});

test("rejects dogfood evidence for the wrong release profile", () => {
  const { path, root } = writeEvidence({ releaseProfile: "web-sync-only" });
  const failure = runFailure(path, root);

  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /releaseProfile must be full/);
});

test("rejects expected artifact paths when the file is absent", () => {
  const { path, root } = writeEvidence({}, { omitArtifacts: ["reports/release/web/joessh-web-admin-" + version + ".zip"] });
  const failure = runFailure(path, root);

  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /artifacts.webRelease file is missing/);
});

test("rejects task evidence that is not bound to required evidence files", () => {
  const tasks = completeTasks();
  tasks.find((task) => task.id === "sync-backup-restore-rollback").evidence = ["operator says rollback passed"];
  const { path, root } = writeEvidence({ tasks });
  const failure = runFailure(path, root);

  assert.equal(failure.status, 1);
  assert.match(
    failure.stderr,
    /task sync-backup-restore-rollback must include evidence path reports\/release\/sync\/backup-restore-smoke\.json/,
  );
});

function writeEvidence(overrides = {}, options = {}) {
  return writeEvidenceWithOptions(overrides, options);
}

function writeEvidenceWithOptions(overrides = {}, options = {}) {
  const root = createReleaseRoot(options);
  const path = options.evidencePath ? join(root, ...options.evidencePath.split("/")) : join(root, "dogfood.json");
  const gitSource = options.gitSource ? readFixtureGitSource(root) : null;
  const evidence = {
    version,
    releaseTag: `v${version}`,
    releaseAuthority: options.releaseAuthority ?? "github",
    releaseProfile: options.releaseProfile ?? "full",
    ...(gitSource
      ? {
          gitCommit: gitSource.head,
          releaseTagCommit: gitSource.tagCommit,
        }
      : {}),
    operator: "release-operator",
    environment: {
      desktop: "Windows 11 unsigned internal staging",
      webAdmin: "localhost Web Admin live Sync",
      sync: "packaged Sync release smoke",
      profile: "clean",
      desktopBuild: "unsigned internal staging",
    },
    artifacts: expectedArtifacts(options),
    tasks: completeTasks(options),
    findings: [],
    ...overrides,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  return { path, root };
}

function createReleaseRoot(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "joessh-dogfood-root-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "package.json", JSON.stringify({ version }));
  for (const path of Object.values(expectedArtifacts(options))) {
    if (!options.omitArtifacts?.includes(path)) {
      if (path.includes("public-beta-rc-audit")) {
        writeFile(root, path, rcAuditFixture(options));
      } else {
        writeFile(root, path, `${path} evidence`);
      }
    }
  }
  for (const path of requiredTaskEvidencePaths(options)) {
    if (!options.omitArtifacts?.includes(path)) {
      if (path.includes("public-beta-rc-audit")) {
        writeFile(root, path, rcAuditFixture(options));
      } else {
        writeFile(root, path, `${path} evidence`);
      }
    }
  }
  if (options.gitSource) {
    initializeGitRoot(root);
  }
  return root;
}

function initializeGitRoot(root) {
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "release-tests@example.invalid"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Release Tests"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["tag", `v${version}`], { cwd: root, stdio: "ignore" });
}

function readFixtureGitSource(root) {
  return {
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    tagCommit: execFileSync("git", ["rev-parse", "--verify", `v${version}^{commit}`], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectedArtifacts(options = {}) {
  const releaseAuthority = options.releaseAuthority ?? "github";
  const releaseProfile = options.releaseProfile ?? "full";
  return {
    desktopSmoke: "reports/smoke/desktop/real-ssh-smoke.json",
    webRelease: `reports/release/web/joessh-web-admin-${version}.zip`,
    syncRelease: `reports/release/sync/joessh-sync-${version}-win32-x64.exe`,
    rcAudit: `reports/release/public-beta-rc-audit.${releaseAuthority}.${releaseProfile}.json`,
  };
}

function completeTasks(options = {}) {
  return requiredTaskIds.map((id) => ({
    id,
    status: "passed",
    evidence: taskEvidence(id, options),
    notes: "",
  }));
}

function taskEvidence(id, options = {}) {
  const artifacts = expectedArtifacts(options);
  return {
    "desktop-install-launch": ["reports/handoff/desktop/unsigned-staging-report.json"],
    "desktop-connection-host-key": ["reports/smoke/desktop/real-ssh-smoke.json"],
    "desktop-command-safety": ["apps/desktop/src/safety.test.ts"],
    "desktop-forwarding": ["reports/smoke/desktop/real-ssh-smoke.json"],
    "desktop-pty-session": ["reports/smoke/desktop/real-ssh-smoke.json"],
    "desktop-sftp-transfer": ["reports/smoke/desktop/real-ssh-smoke.json"],
    "release-evidence-review": [
      artifacts.rcAudit,
      "reports/handoff/desktop/formal-evidence-unblock-report.json",
      "reports/release/web/rollback-smoke.json",
    ],
    "sync-backup-restore-rollback": [
      "reports/release/sync/backup-restore-smoke.json",
      "reports/release/web/rollback-smoke.json",
    ],
    "sync-device-flow": ["reports/release/sync/backup-restore-smoke.json"],
    "web-admin-live-sync": [
      `reports/release/web/joessh-web-admin-${version}.zip`,
      "reports/release/web/rollback-smoke.json",
    ],
  }[id] ?? [`${id} completed with redacted notes`];
}

function requiredTaskEvidencePaths(options = {}) {
  return [...new Set(requiredTaskIds.flatMap((id) => taskEvidence(id, options)))];
}

function rcAuditFixture(options = {}) {
  return `${JSON.stringify(
    {
      blockers: options.rcAuditDecision === "no-go" ? [{ id: "stale-provenance", severity: "P0" }] : [],
      decision: options.rcAuditDecision ?? "go",
      releaseAuthority: options.releaseAuthority ?? "github",
      releaseProfile: options.releaseProfile ?? "full",
      version,
    },
    null,
    2,
  )}\n`;
}

function runFailure(path, root) {
  return spawnSync(node, [script, "--evidence", path], {
    encoding: "utf8",
    env: scriptEnv(root),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function scriptEnv(root) {
  return {
    ...process.env,
    ATLASTERM_DOGFOOD_ROOT: root,
  };
}
