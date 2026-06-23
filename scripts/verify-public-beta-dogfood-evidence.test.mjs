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
  assert.deepEqual(
    template.tasks.map((task) => task.id),
    requiredTaskIds,
  );
  assert(template.tasks.every((task) => task.status === "pending"));
});

test("accepts complete dogfood evidence with all required tasks passed", () => {
  const { path, root } = writeEvidence();

  const output = execFileSync(node, [script, "--evidence", path], {
    encoding: "utf8",
    env: scriptEnv(root),
  });

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
  assert.match(failure.stderr, /artifacts.rcAudit must be reports\/release\/public-beta-rc-audit\.json/);
});

test("rejects artifact paths that escape the release workspace", () => {
  const { path, root } = writeEvidence({
    artifacts: {
      ...expectedArtifacts(),
      rcAudit: "../reports/release/public-beta-rc-audit.json",
    },
  });
  const failure = runFailure(path, root);

  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /artifacts.rcAudit must be reports\/release\/public-beta-rc-audit\.json/);
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
  const path = join(root, "dogfood.json");
  const evidence = {
    version,
    releaseTag: `v${version}`,
    operator: "release-operator",
    environment: {
      desktop: "Windows 11 unsigned internal staging",
      webAdmin: "localhost Web Admin live Sync",
      sync: "packaged Sync release smoke",
      profile: "clean",
      desktopBuild: "unsigned internal staging",
    },
    artifacts: expectedArtifacts(),
    tasks: completeTasks(),
    findings: [],
    ...overrides,
  };
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  return { path, root };
}

function createReleaseRoot(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "joessh-dogfood-root-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "package.json", JSON.stringify({ version }));
  for (const path of Object.values(expectedArtifacts())) {
    if (!options.omitArtifacts?.includes(path)) {
      writeFile(root, path, `${path} evidence`);
    }
  }
  for (const path of requiredTaskEvidencePaths()) {
    if (!options.omitArtifacts?.includes(path)) {
      writeFile(root, path, `${path} evidence`);
    }
  }
  return root;
}

function expectedArtifacts() {
  return {
    desktopSmoke: "reports/smoke/desktop/real-ssh-smoke.json",
    webRelease: `reports/release/web/joessh-web-admin-${version}.zip`,
    syncRelease: `reports/release/sync/joessh-sync-${version}-win32-x64.exe`,
    rcAudit: "reports/release/public-beta-rc-audit.json",
  };
}

function completeTasks() {
  return requiredTaskIds.map((id) => ({
    id,
    status: "passed",
    evidence: taskEvidence(id),
    notes: "",
  }));
}

function taskEvidence(id) {
  return {
    "desktop-install-launch": ["reports/handoff/desktop/unsigned-staging-report.json"],
    "desktop-connection-host-key": ["reports/smoke/desktop/real-ssh-smoke.json"],
    "desktop-command-safety": ["apps/desktop/src/safety.test.ts"],
    "desktop-forwarding": ["reports/smoke/desktop/real-ssh-smoke.json"],
    "desktop-pty-session": ["reports/smoke/desktop/real-ssh-smoke.json"],
    "desktop-sftp-transfer": ["reports/smoke/desktop/real-ssh-smoke.json"],
    "release-evidence-review": [
      "reports/release/public-beta-rc-audit.json",
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

function requiredTaskEvidencePaths() {
  return [...new Set(requiredTaskIds.flatMap((id) => taskEvidence(id)))];
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
