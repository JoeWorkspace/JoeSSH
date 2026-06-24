import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const root = resolve(process.env.ATLASTERM_DOGFOOD_ROOT ?? resolve(import.meta.dirname, ".."));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const expectedVersion = packageJson.version;
const expectedReleaseTag = `v${expectedVersion}`;
const args = parseArgs(process.argv.slice(2));
const gitSource = readGitSourceIfAvailable();
const expectedArtifacts = createExpectedArtifacts(args);
const requiredTaskEvidencePaths = createRequiredTaskEvidencePaths(expectedArtifacts);
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

function createExpectedArtifacts({ releaseAuthority, releaseProfile }) {
  return {
    desktopSmoke: "reports/smoke/desktop/real-ssh-smoke.json",
    webRelease: `reports/release/web/joessh-web-admin-${expectedVersion}.zip`,
    syncRelease: `reports/release/sync/joessh-sync-${expectedVersion}-win32-x64.exe`,
    rcAudit: `reports/release/public-beta-rc-audit.${releaseAuthority}.${releaseProfile}.json`,
  };
}

function createRequiredTaskEvidencePaths(artifacts) {
  return {
    "desktop-install-launch": ["reports/handoff/desktop/unsigned-staging-report.json"],
    "desktop-connection-host-key": [artifacts.desktopSmoke],
    "desktop-command-safety": ["apps/desktop/src/safety.test.ts"],
    "desktop-forwarding": [artifacts.desktopSmoke],
    "desktop-pty-session": [artifacts.desktopSmoke],
    "desktop-sftp-transfer": [artifacts.desktopSmoke],
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
    "web-admin-live-sync": [artifacts.webRelease, "reports/release/web/rollback-smoke.json"],
  };
}

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

if (args.writeTemplate) {
  writeTemplate(args.writeTemplate);
  process.exit(0);
}

const evidencePath = args.evidence ?? defaultEvidencePath();
const evidence = readJson(evidencePath);
const failures = validateEvidence(evidence);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  process.exit(1);
}

console.log(`Public Beta dogfood evidence verified for ${requiredTasks.length} task(s).`);

function defaultEvidencePath() {
  const profilePath = resolve(
    root,
    "reports/dogfood/public-beta",
    `latest.${args.releaseAuthority}.${args.releaseProfile}.json`,
  );
  if (existsSync(profilePath)) {
    return profilePath;
  }
  return resolve(root, "reports/dogfood/public-beta/latest.json");
}

function writeTemplate(path) {
  const outputPath = resolve(root, path);
  const template = {
    version: expectedVersion,
    releaseTag: expectedReleaseTag,
    releaseAuthority: args.releaseAuthority,
    releaseProfile: args.releaseProfile,
    gitCommit: gitSource?.head ?? "",
    releaseTagCommit: gitSource?.tagCommit ?? "",
    generatedAt: new Date().toISOString(),
    operator: "",
    environment: {
      desktop: "",
      webAdmin: "",
      sync: "",
      profile: "clean",
      desktopBuild: "unsigned internal staging or signed formal evidence",
    },
    artifacts: expectedArtifacts,
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
  if (evidence.releaseAuthority !== args.releaseAuthority) {
    failures.push(`releaseAuthority must be ${args.releaseAuthority}`);
  }
  if (evidence.releaseProfile !== args.releaseProfile) {
    failures.push(`releaseProfile must be ${args.releaseProfile}`);
  }
  validateGitSourceBinding(evidence, failures);
  if (!nonEmptyString(evidence.operator)) {
    failures.push("operator is required");
  }
  for (const key of ["desktop", "webAdmin", "sync", "profile", "desktopBuild"]) {
    if (!nonEmptyString(evidence.environment?.[key])) {
      failures.push(`environment.${key} is required`);
    }
  }
  for (const [key, expectedPath] of Object.entries(expectedArtifacts)) {
    const artifactPath = evidence.artifacts?.[key];
    if (!nonEmptyString(artifactPath)) {
      failures.push(`artifacts.${key} is required`);
      continue;
    }
    if (normalizePath(artifactPath) !== expectedPath) {
      failures.push(`artifacts.${key} must be ${expectedPath}`);
      continue;
    }
    const artifactFailure = validateRelativeFilePath(`artifacts.${key}`, artifactPath);
    if (artifactFailure) {
      failures.push(artifactFailure);
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
      validateRequiredTaskEvidence(id, task, failures);
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

function validateGitSourceBinding(evidence, failures) {
  if (!gitSource) {
    return;
  }

  if (!nonEmptyString(evidence.gitCommit)) {
    failures.push("gitCommit is required when validating dogfood evidence in a Git checkout");
  } else if (!isShaLike(evidence.gitCommit)) {
    failures.push("gitCommit must be a Git commit hash");
  } else if (evidence.gitCommit !== gitSource.head) {
    failures.push("gitCommit must match current HEAD");
  }

  if (!gitSource.tagCommit) {
    failures.push(`release tag ${expectedReleaseTag} must resolve to a commit`);
  }

  if (!nonEmptyString(evidence.releaseTagCommit)) {
    failures.push("releaseTagCommit is required when validating dogfood evidence in a Git checkout");
  } else if (!isShaLike(evidence.releaseTagCommit)) {
    failures.push("releaseTagCommit must be a Git commit hash");
  } else if (gitSource.tagCommit && evidence.releaseTagCommit !== gitSource.tagCommit) {
    failures.push(`releaseTagCommit must match ${expectedReleaseTag}`);
  }

  if (
    nonEmptyString(evidence.gitCommit) &&
    nonEmptyString(evidence.releaseTagCommit) &&
    evidence.gitCommit !== evidence.releaseTagCommit
  ) {
    failures.push("releaseTagCommit must match gitCommit");
  }
}

function validateRequiredTaskEvidence(id, task, failures) {
  const requiredPaths = requiredTaskEvidencePaths[id] ?? [];
  const evidenceEntries = new Set((task.evidence ?? []).map((entry) => normalizePath(entry)));
  for (const requiredPath of requiredPaths) {
    if (!evidenceEntries.has(requiredPath)) {
      failures.push(`task ${id} must include evidence path ${requiredPath}`);
      continue;
    }
    const artifactFailure = validateRelativeFilePath(`task ${id} evidence ${requiredPath}`, requiredPath);
    if (artifactFailure) {
      failures.push(artifactFailure);
    }
  }
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
  const parsed = {
    releaseAuthority: process.env.ATLASTERM_RELEASE_AUTHORITY ?? "github",
    releaseProfile: normalizeReleaseProfile(process.env.ATLASTERM_RELEASE_PROFILE ?? "full"),
  };
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
    if (arg === "--release-authority" || arg === "--authority") {
      parsed.releaseAuthority = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--release-authority=")) {
      parsed.releaseAuthority = arg.slice("--release-authority=".length);
      continue;
    }
    if (arg.startsWith("--authority=")) {
      parsed.releaseAuthority = arg.slice("--authority=".length);
      continue;
    }
    if (arg === "--release-profile" || arg === "--profile") {
      parsed.releaseProfile = normalizeReleaseProfile(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--release-profile=")) {
      parsed.releaseProfile = normalizeReleaseProfile(arg.slice("--release-profile=".length));
      continue;
    }
    if (arg.startsWith("--profile=")) {
      parsed.releaseProfile = normalizeReleaseProfile(arg.slice("--profile=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["github", "local"].includes(parsed.releaseAuthority)) {
    throw new Error("--release-authority must be github or local.");
  }
  if (parsed.releaseProfile === "desktop-local-unsigned" && parsed.releaseAuthority !== "local") {
    throw new Error("--release-profile desktop-local-unsigned requires --release-authority local.");
  }
  return parsed;
}

function normalizeReleaseProfile(value) {
  if (value === "full") {
    return "full";
  }
  if (value === "web-sync-only") {
    return "web-sync-only";
  }
  if (value === "desktop-local-unsigned" || value === "local-unsigned-desktop") {
    return "desktop-local-unsigned";
  }
  throw new Error("--release-profile must be full, web-sync-only, or desktop-local-unsigned.");
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

function isShaLike(value) {
  return /^[a-f0-9]{7,40}$/i.test(value);
}

function readGitSourceIfAvailable() {
  const head = runGit(["rev-parse", "HEAD"]);
  if (head.status !== 0) {
    return null;
  }

  const tagCommit = runGit(["rev-parse", "--verify", `${expectedReleaseTag}^{commit}`]);
  return {
    head: head.stdout.trim(),
    tagCommit: tagCommit.status === 0 ? tagCommit.stdout.trim() : null,
  };
}

function runGit(args) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function validateRelativeFilePath(label, value) {
  if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    return `${label} must be a relative path`;
  }
  const resolvedPath = resolve(root, value);
  if (!isInsideRoot(resolvedPath)) {
    return `${label} must stay inside the release workspace`;
  }
  if (!existsSync(resolvedPath)) {
    return `${label} file is missing: ${normalizePath(value)}`;
  }
  if (!statSync(resolvedPath).isFile()) {
    return `${label} must reference a file`;
  }
  return null;
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function displayPath(path) {
  return path.startsWith(root) ? path.slice(root.length + 1).replaceAll("\\", "/") : path;
}
