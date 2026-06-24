import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const { checksumPath, evidencePath, root, skipCurrentGitCheck } = parseArgs(process.argv.slice(2));
const packageJson = readJson("package.json");
const releaseTag = `v${packageJson.version}`;
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");
const errors = [];

const evidence = readEvidence();
validateTopLevel();
validateSource();
validateReleaseGate();
validatePublication();
validateAuthorityChecksum();

if (errors.length > 0) {
  fail(`Local release authority verification failed:\n- ${errors.join("\n- ")}`);
}

console.log(`Local release authority verified for ${releaseTag}.`);

function readEvidence() {
  if (!existsSync(evidencePath)) {
    fail(`Missing local release authority evidence: ${toReleasePath(evidencePath)}`);
  }
  if (!statSync(evidencePath).isFile()) {
    fail(`Local release authority evidence is not a file: ${toReleasePath(evidencePath)}`);
  }
  try {
    return JSON.parse(readFileSync(evidencePath, "utf8"));
  } catch (error) {
    fail(`Local release authority evidence is not valid JSON: ${error.message}`);
  }
}

function validateTopLevel() {
  if (!isRecord(evidence)) {
    errors.push("local release authority evidence must be a JSON object");
    return;
  }
  if (evidence.authorityVersion !== 1) {
    errors.push("authorityVersion must be 1");
  }
  if (!["local", "self-hosted"].includes(evidence.authority)) {
    errors.push("authority must be local or self-hosted");
  }
  if (evidence.version !== packageJson.version) {
    errors.push(`version must match package.json version ${packageJson.version}`);
  }
  if (evidence.releaseTag !== releaseTag) {
    errors.push(`releaseTag must be ${releaseTag}`);
  }
  if (!isIsoTimestamp(evidence.generatedAt)) {
    errors.push("generatedAt must be an ISO timestamp");
  }
  if (!nonEmptyString(evidence.operator)) {
    errors.push("operator is required");
  }
  if (!isRecord(evidence.runner)) {
    errors.push("runner must be a JSON object");
  } else if (!nonEmptyString(evidence.runner.type)) {
    errors.push("runner.type is required");
  }
}

function validateSource() {
  const source = evidence.source;
  if (!isRecord(source)) {
    errors.push("source must be a JSON object");
    return;
  }
  if (!isShaLike(source.gitCommit)) {
    errors.push("source.gitCommit must be a Git commit hash");
  }
  if (!isShaLike(source.releaseTagCommit)) {
    errors.push("source.releaseTagCommit must be a Git commit hash");
  }
  if (source.gitCommit !== source.releaseTagCommit) {
    errors.push("source.releaseTagCommit must match source.gitCommit");
  }
  if (!nonEmptyString(source.repository)) {
    errors.push("source.repository is required");
  }
  if (source.cleanTreeExcluding !== "reports/release") {
    errors.push("source.cleanTreeExcluding must be reports/release");
  }
  if (source.gitFsckStrict !== true) {
    errors.push("source.gitFsckStrict must be true");
  }
  if (skipCurrentGitCheck) {
    return;
  }

  const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree.status !== 0 || insideWorkTree.stdout.trim() !== "true") {
    errors.push("Git checkout metadata is required to verify local release authority");
    return;
  }
  const status = runGit([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude)reports/release",
  ]);
  if (status.status !== 0) {
    errors.push("Git working tree status is required to verify local release authority");
    return;
  }
  if (status.stdout.trim() !== "") {
    errors.push(
      `Git working tree outside reports/release must be clean to verify local release authority: ${status.stdout.trim()}`,
    );
  }

  const head = runGit(["rev-parse", "HEAD"]);
  const tagCommit = runGit(["rev-parse", "--verify", `${releaseTag}^{}`]);
  const repository = runGit(["remote", "get-url", "origin"]);
  const fsck = runGit(["fsck", "--strict"]);
  if (head.status !== 0) {
    errors.push("Unable to resolve HEAD while verifying local release authority");
  } else if (head.stdout.trim() !== source.gitCommit) {
    errors.push("source.gitCommit does not match current HEAD");
  }
  if (tagCommit.status !== 0) {
    errors.push(`Release tag ${releaseTag} must exist to verify local release authority`);
  } else if (tagCommit.stdout.trim() !== source.releaseTagCommit) {
    errors.push(`source.releaseTagCommit does not match ${releaseTag}`);
  }
  if (repository.status !== 0) {
    errors.push("Git remote origin is required to verify local release authority");
  } else if (repository.stdout.trim() !== source.repository) {
    errors.push("source.repository does not match current Git remote origin");
  }
  if (fsck.status !== 0) {
    errors.push("git fsck --strict must pass to verify local release authority");
  }
}

function validateReleaseGate() {
  const gate = evidence.releaseGate;
  if (!isRecord(gate)) {
    errors.push("releaseGate must be a JSON object");
    return;
  }
  const allowedGateCommands = [
    "npm run qa:release:public",
    "npm run qa:release:public:fixture",
    "npm run qa:release:public:local",
    "npm run qa:release:public:web-sync-only:local",
  ];
  if (!allowedGateCommands.includes(gate.command)) {
    errors.push(`releaseGate.command must be one of: ${allowedGateCommands.join(", ")}`);
  }
  if (gate.status !== "passed") {
    errors.push("releaseGate.status must be passed");
  }
  if (!isIsoTimestamp(gate.completedAt)) {
    errors.push("releaseGate.completedAt must be an ISO timestamp");
  }
  if (!isSafeRelativeFile(gate.logPath)) {
    errors.push("releaseGate.logPath must be a safe relative file path");
    return;
  }
  const logPath = resolve(root, gate.logPath);
  if (!isSha256(gate.logSha256)) {
    errors.push("releaseGate.logSha256 must be a lowercase SHA256");
  } else if (sha256File(logPath) !== gate.logSha256) {
    errors.push(`releaseGate.logSha256 does not match ${gate.logPath}`);
  }
  const logText = readTextFile(logPath);
  if (!logText.includes("qa:release:public")) {
    errors.push("releaseGate log must include the public release gate command");
  }
  if (!logText.includes("Public Beta release readiness checks passed")) {
    errors.push("releaseGate log must include the release readiness success marker");
  }
}

function validatePublication() {
  const publication = evidence.publication;
  if (!isRecord(publication)) {
    errors.push("publication must be a JSON object");
    return;
  }
  if (!nonEmptyString(publication.target)) {
    errors.push("publication.target is required");
  }
  if (publication.artifactRoot !== "reports/release") {
    errors.push("publication.artifactRoot must be reports/release");
  }
  if (publication.duplicateCheck !== "operator-confirmed-no-existing-release-for-tag") {
    errors.push("publication.duplicateCheck must confirm no existing release for the tag");
  }
}

function validateAuthorityChecksum() {
  if (!existsSync(checksumPath)) {
    errors.push(`missing local release authority checksum manifest ${toReleasePath(checksumPath)}`);
    return;
  }
  if (!statSync(checksumPath).isFile()) {
    errors.push(`local release authority checksum manifest is not a file ${toReleasePath(checksumPath)}`);
    return;
  }
  const lines = readFileSync(checksumPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const expectedPath = toReleasePath(evidencePath);
  const entry = lines.find((line) => line.endsWith(`  ${expectedPath}`));
  if (!entry) {
    errors.push(`local release authority checksum manifest must list ${expectedPath}`);
    return;
  }
  const [hash] = entry.split(/\s+/);
  if (hash !== sha256File(evidencePath)) {
    errors.push(`local release authority checksum mismatch for ${expectedPath}`);
  }
}

function isSafeRelativeFile(value) {
  if (typeof value !== "string" || value.trim() === "" || isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    return false;
  }
  const fullPath = resolve(root, value);
  if (!isInsideRoot(fullPath) || !existsSync(fullPath) || !statSync(fullPath).isFile()) {
    return false;
  }
  return true;
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isShaLike(value) {
  return typeof value === "string" && /^[a-f0-9]{6,64}$/.test(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readTextFile(path) {
  const bytes = readFileSync(path);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  if (bytes.subarray(0, Math.min(bytes.length, 256)).includes(0)) {
    return bytes.toString("utf16le").replace(/^\uFEFF/, "");
  }
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function runGit(args) {
  return spawnSync(gitCommand, [...gitCommandPrefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function toReleasePath(path) {
  return relative(root, resolve(path)).replace(/\\/g, "/");
}

function parseArgs(args) {
  let root = defaultRoot;
  let evidencePath = null;
  let checksumPath = null;
  let skipCurrentGitCheck = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--skip-current-git-check") {
      skipCurrentGitCheck = true;
      continue;
    }
    if (arg === "--root") {
      const value = args[index + 1];
      if (!value) {
        fail("--root requires a path.");
      }
      root = resolve(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
      continue;
    }
    if (arg === "--evidence") {
      const value = args[index + 1];
      if (!value) {
        fail("--evidence requires a path.");
      }
      evidencePath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--evidence=")) {
      evidencePath = arg.slice("--evidence=".length);
      continue;
    }
    if (arg === "--checksum") {
      const value = args[index + 1];
      if (!value) {
        fail("--checksum requires a path.");
      }
      checksumPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--checksum=")) {
      checksumPath = arg.slice("--checksum=".length);
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return {
    checksumPath: resolve(root, checksumPath ?? "reports/release/local-release-authority-SHA256SUMS.txt"),
    evidencePath: resolve(root, evidencePath ?? "reports/release/local-release-authority.json"),
    root,
    skipCurrentGitCheck,
  };
}

function parseCommandPrefixArgs(envName) {
  const raw = process.env[envName];
  if (!raw) {
    return [];
  }
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      return value;
    }
  } catch {
    // Fall through to the explicit failure below.
  }
  fail(`${envName} must be a JSON string array when set.`);
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
