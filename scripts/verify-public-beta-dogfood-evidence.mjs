import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const expectedVersion = packageJson.version;
const expectedReleaseTag = `v${expectedVersion}`;

const requiredTasks = [
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

const taskLabels = {
  "desktop-install-launch": "Desktop install or clean-profile launch",
  "desktop-connection-host-key": "Desktop connection and host-key confirmation",
  "desktop-pty-session": "Desktop PTY session, resize, close, and reconnect",
  "desktop-command-safety": "Desktop blocked-command safety state",
  "desktop-sftp-transfer": "Desktop SFTP list/download/upload/overwrite safety",
  "desktop-forwarding": "Desktop forwarding start/traffic/stop",
  "web-admin-live-sync": "Web Admin live Sync snapshot and fixture indicator",
  "sync-device-flow": "Sync device register, push, pull, and admin snapshot",
  "sync-backup-restore-rollback": "Sync backup/restore rollback rehearsal",
  "release-evidence-review": "Release evidence, No-Go, and unsigned boundary review",
};

const args = parseArgs(process.argv.slice(2));

if (args.writeTemplate) {
  writeTemplate(args.writeTemplate);
  process.exit(0);
}

const evidencePath = args.evidence ?? resolve(root, "reports/dogfood/public-beta/latest.json");
const evidence = readJson(evidencePath);
const failures = validateEvidence(evidence);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  process.exit(1);
}

console.log(`Public Beta dogfood evidence verified for ${requiredTasks.length} task(s).`);

function writeTemplate(path) {
  const outputPath = resolve(root, path);
  const template = {
    version: expectedVersion,
    releaseTag: expectedReleaseTag,
    generatedAt: new Date().toISOString(),
    operator: "",
    environment: {
      desktop: "",
      webAdmin: "",
      sync: "",
      profile: "clean",
      desktopBuild: "unsigned internal staging or signed formal evidence",
    },
    artifacts: {
      desktopSmoke: "reports/smoke/desktop/real-ssh-smoke.json",
      webRelease: `reports/release/web/joessh-web-admin-${expectedVersion}.zip`,
      syncRelease: `reports/release/sync/joessh-sync-${expectedVersion}-win32-x64.exe`,
      rcAudit: "reports/handoff/release/public-beta-rc-audit.json",
    },
    tasks: requiredTasks.map((id) => ({
      id,
      label: taskLabels[id],
      status: "pending",
      evidence: [],
      notes: "",
    })),
    findings: [],
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(template, null, 2)}\n`);
  console.log(`Wrote ${displayPath(outputPath)}`);
}

function validateEvidence(evidence) {
  const failures = [];

  if (evidence.version !== expectedVersion) {
    failures.push(`version must be ${expectedVersion}`);
  }
  if (evidence.releaseTag !== expectedReleaseTag) {
    failures.push(`releaseTag must be ${expectedReleaseTag}`);
  }
  if (!nonEmptyString(evidence.operator)) {
    failures.push("operator is required");
  }
  for (const key of ["desktop", "webAdmin", "sync", "profile", "desktopBuild"]) {
    if (!nonEmptyString(evidence.environment?.[key])) {
      failures.push(`environment.${key} is required`);
    }
  }
  for (const key of ["desktopSmoke", "webRelease", "syncRelease", "rcAudit"]) {
    if (!nonEmptyString(evidence.artifacts?.[key])) {
      failures.push(`artifacts.${key} is required`);
    }
  }

  if (!Array.isArray(evidence.tasks)) {
    failures.push("tasks must be an array");
  } else {
    const byId = new Map();
    for (const task of evidence.tasks) {
      if (typeof task?.id !== "string") {
        failures.push("each task must have a string id");
        continue;
      }
      if (byId.has(task.id)) {
        failures.push(`duplicate task id: ${task.id}`);
      }
      byId.set(task.id, task);
    }

    for (const id of requiredTasks) {
      const task = byId.get(id);
      if (!task) {
        failures.push(`missing task: ${id}`);
        continue;
      }
      if (task.status !== "passed") {
        failures.push(`task ${id} must be passed`);
      }
      if (!Array.isArray(task.evidence) || task.evidence.length === 0) {
        failures.push(`task ${id} must include non-secret evidence`);
      } else if (!task.evidence.every(nonEmptyString)) {
        failures.push(`task ${id} evidence entries must be non-empty strings`);
      }
    }
  }

  if (!Array.isArray(evidence.findings)) {
    failures.push("findings must be an array");
  } else {
    for (const finding of evidence.findings) {
      const severity = finding?.severity;
      const status = finding?.status;
      if (!["P0", "P1", "P2", "P3"].includes(severity)) {
        failures.push("each finding severity must be P0, P1, P2, or P3");
      }
      if (!["open", "closed", "accepted"].includes(status)) {
        failures.push("each finding status must be open, closed, or accepted");
      }
      if (severity === "P0" && status !== "closed") {
        failures.push("open P0 finding blocks Public Beta dogfood completion");
      }
      if (severity === "P1" && status !== "closed") {
        failures.push("open P1 finding blocks Public Beta dogfood completion");
      }
    }
  }

  return failures;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    console.error(`verify-public-beta-dogfood-evidence.mjs: ${error.message}`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--evidence") {
      parsed.evidence = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--evidence=")) {
      parsed.evidence = arg.slice("--evidence=".length);
      continue;
    }
    if (arg === "--write-template") {
      parsed.writeTemplate = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--write-template=")) {
      parsed.writeTemplate = arg.slice("--write-template=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function displayPath(path) {
  return path.startsWith(root) ? path.slice(root.length + 1).replaceAll("\\", "/") : path;
}
