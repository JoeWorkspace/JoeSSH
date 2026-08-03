import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
  const dir = mkdtempSync(join(tmpdir(), "joessh-dogfood-template-"));
  const path = join(dir, "template.json");

  execFileSync(node, [script, "--write-template", path], { encoding: "utf8" });

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
  const path = writeEvidence();

  const output = execFileSync(node, [script, "--evidence", path], {
    encoding: "utf8",
  });

  assert.match(output, /Public Beta dogfood evidence verified for 10 task/);
});

test("rejects missing required task evidence", () => {
  const path = writeEvidence({
    tasks: completeTasks().filter((task) => task.id !== "desktop-forwarding"),
  });
  const failure = runFailure(path);

  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /missing task: desktop-forwarding/);
});

test("rejects open P0 and P1 findings", () => {
  const path = writeEvidence({
    findings: [
      {
        id: "dangerous-command",
        severity: "P1",
        status: "open",
        summary: "Blocked command status was misleading.",
      },
    ],
  });
  const failure = runFailure(path);

  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /open P1 finding blocks Public Beta dogfood completion/);
});

function writeEvidence(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "joessh-dogfood-evidence-"));
  const path = join(dir, "dogfood.json");
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
    artifacts: {
      desktopSmoke: "reports/smoke/desktop/real-ssh-smoke.json",
      webRelease: `reports/release/web/joessh-web-admin-${version}.zip`,
      syncRelease: `reports/release/sync/joessh-sync-${version}-win32-x64.exe`,
      rcAudit: "reports/handoff/release/public-beta-rc-audit.json",
    },
    tasks: completeTasks(),
    findings: [],
    ...overrides,
  };
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  return path;
}

function completeTasks() {
  return requiredTaskIds.map((id) => ({
    id,
    status: "passed",
    evidence: [`${id} completed with redacted notes`],
    notes: "",
  }));
}

function runFailure(path) {
  return spawnSync(node, [script, "--evidence", path], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
