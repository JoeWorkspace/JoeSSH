import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const {
  checksumPath,
  reportPath,
  root,
  skipCurrentGitCheck,
} = parseArgs(process.argv.slice(2));
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");
const packageJson = readJson("package.json");
const releaseTag = `v${packageJson.version}`;
const reportReleasePath = toReleasePath(reportPath);
const checksumReleasePath = toReleasePath(checksumPath);
const errors = [];

if (!isInsideRoot(reportPath) || !isInsideRoot(checksumPath)) {
  fail("--report and --checksum must stay inside --root.");
}
if (isInsideReleaseReports(reportPath) || isInsideReleaseReports(checksumPath)) {
  fail("Unsigned Desktop staging evidence must stay outside reports/release.");
}

const report = readReport();
validateChecksum();
validateTopLevel();
validateGit();
validateNoPublicDesktopArtifacts();
validateArtifacts();

if (errors.length > 0) {
  fail(`Unsigned Desktop staging verification failed:\n- ${errors.join("\n- ")}`);
}

console.log(`Unsigned Desktop staging evidence verified for ${releaseTag}.`);

function readReport() {
  if (!existsSync(reportPath) || !statSync(reportPath).isFile()) {
    fail(`Missing unsigned Desktop staging report: ${reportReleasePath}`);
  }
  try {
    return JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    fail(`Unsigned Desktop staging report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateChecksum() {
  if (!existsSync(checksumPath) || !statSync(checksumPath).isFile()) {
    errors.push(`missing unsigned Desktop staging checksum manifest ${checksumReleasePath}`);
    return;
  }

  const entries = readFileSync(checksumPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (entries.length !== 1) {
    errors.push("unsigned Desktop staging checksum manifest must contain exactly one entry");
    return;
  }

  const match = entries[0].match(/^([a-f0-9]{64})\s\s(.+)$/);
  if (!match) {
    errors.push("unsigned Desktop staging checksum manifest line is invalid");
    return;
  }
  if (match[2].replaceAll("\\", "/") !== reportReleasePath) {
    errors.push(`unsigned Desktop staging checksum manifest must list ${reportReleasePath}`);
  }
  if (match[1] !== sha256File(reportPath)) {
    errors.push("unsigned Desktop staging checksum manifest hash mismatch");
  }
}

function validateTopLevel() {
  if (!isRecord(report)) {
    errors.push("unsigned Desktop staging report must be a JSON object");
    return;
  }
  if (report.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1");
  }
  if (report.version !== packageJson.version) {
    errors.push(`version must be ${packageJson.version}`);
  }
  if (report.decision !== "internal-staging-only") {
    errors.push("decision must be internal-staging-only");
  }
  if (report.publicReleaseEvidence !== false) {
    errors.push("publicReleaseEvidence must be false");
  }
  if (
    typeof report.boundary !== "string" ||
    !report.boundary.includes("must not be copied into reports/release")
  ) {
    errors.push("boundary must state that unsigned staging evidence must not be copied into reports/release");
  }
  if (!isSafeRelativePath(report.bundleDir)) {
    errors.push("bundleDir must be a safe relative path");
  } else if (isInsideReleaseReports(resolve(root, report.bundleDir))) {
    errors.push("bundleDir must stay outside reports/release");
  }
  if (!Array.isArray(report.artifacts) || report.artifacts.length === 0) {
    errors.push("artifacts must be a non-empty array");
  }
}

function validateGit() {
  if (!isRecord(report.git)) {
    errors.push("git must be a JSON object");
    return;
  }
  if (!isShaLike(report.git.head)) {
    errors.push("git.head must be a Git commit hash");
  }
  if (!Array.isArray(report.git.statusShort)) {
    errors.push("git.statusShort must be an array");
  }
  if (!Array.isArray(report.git.tagsAtHead)) {
    errors.push("git.tagsAtHead must be an array");
  } else if (!report.git.tagsAtHead.includes(releaseTag)) {
    errors.push(`git.tagsAtHead must include ${releaseTag}`);
  }
  if (skipCurrentGitCheck) {
    return;
  }

  const head = runGit(["rev-parse", "HEAD"]);
  const tag = runGit(["rev-parse", "--verify", `${releaseTag}^{}`]);
  const fsck = runGit(["fsck", "--strict"]);
  const tagsAtHead = runGit(["tag", "--points-at", "HEAD"]);
  if (head.status !== 0 || tag.status !== 0 || fsck.status !== 0 || tagsAtHead.status !== 0) {
    errors.push("unable to inspect current Git state for unsigned Desktop staging evidence");
    return;
  }
  const headSha = head.stdout.trim();
  const tagSha = tag.stdout.trim();
  if (report.git.head !== headSha) {
    errors.push("git.head does not match current HEAD");
  }
  if (headSha !== tagSha) {
    errors.push(`release tag ${releaseTag} must point at HEAD`);
  }
  const currentTags = tagsAtHead.stdout.split(/\r?\n/).filter(Boolean);
  if (!currentTags.includes(releaseTag)) {
    errors.push(`current HEAD must be tagged ${releaseTag}`);
  }
}

function validateArtifacts() {
  if (!Array.isArray(report.artifacts)) {
    return;
  }

  const seenPaths = new Set();
  for (const [index, artifact] of report.artifacts.entries()) {
    const label = `artifacts[${index}]`;
    if (!isRecord(artifact)) {
      errors.push(`${label} must be a JSON object`);
      continue;
    }
    if (!isSafeRelativePath(artifact.path)) {
      errors.push(`${label}.path must be a safe relative path`);
      continue;
    }
    if (seenPaths.has(artifact.path)) {
      errors.push(`${label}.path is duplicated`);
    }
    seenPaths.add(artifact.path);

    const artifactPath = resolve(root, artifact.path);
    if (isInsideReleaseReports(artifactPath)) {
      errors.push(`${label}.path must stay outside reports/release`);
      continue;
    }
    if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
      errors.push(`${label}.path references a missing file`);
      continue;
    }

    const stat = statSync(artifactPath);
    const fileName = basename(artifactPath);
    if (artifact.fileName !== fileName) {
      errors.push(`${label}.fileName must match the artifact path basename`);
    }
    if (!fileName.includes(packageJson.version)) {
      errors.push(`${label}.fileName must include ${packageJson.version}`);
    }
    if (artifact.versionMatchesPackage !== true) {
      errors.push(`${label}.versionMatchesPackage must be true`);
    }
    if (!["windows", "macos", "linux"].includes(artifact.platform)) {
      errors.push(`${label}.platform must be windows, macos, or linux`);
    }
    if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes !== stat.size) {
      errors.push(`${label}.sizeBytes must match the artifact file size`);
    }
    if (!isSha256(artifact.sha256)) {
      errors.push(`${label}.sha256 must be a lowercase SHA256`);
    } else if (artifact.sha256 !== sha256File(artifactPath)) {
      errors.push(`${label}.sha256 does not match the artifact file`);
    }
  }
}

function validateNoPublicDesktopArtifacts() {
  const releaseDir = resolve(root, "reports", "release");
  const desktopArtifacts = collectFiles(releaseDir)
    .filter((path) => classifyDesktopArtifact(path) !== null || isUnsignedStagingFile(path))
    .map((path) => toReleasePath(path))
    .sort();
  if (desktopArtifacts.length > 0) {
    errors.push(
      `desktop-local-unsigned release profile must not stage public Desktop artifacts or unsigned staging evidence in reports/release: ${desktopArtifacts.join(", ")}`,
    );
  }
}

function collectFiles(path) {
  if (!existsSync(path)) {
    return [];
  }
  const stat = statSync(path);
  if (stat.isFile()) {
    return [path];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(child);
    }
    return entry.isFile() ? [child] : [];
  });
}

function classifyDesktopArtifact(path) {
  const name = basename(path).toLowerCase();
  if (!name.startsWith("joessh_")) {
    return null;
  }
  const lower = path.toLowerCase();
  if (/\.(exe|msi|msix)$/.test(lower)) {
    return { platform: "windows" };
  }
  if (lower.endsWith(".dmg") || lower.endsWith(".pkg") || lower.endsWith(".app.tar.gz")) {
    return { platform: "macos" };
  }
  if (lower.endsWith(".appimage") || lower.endsWith(".deb") || lower.endsWith(".rpm")) {
    return { platform: "linux" };
  }
  return null;
}

function isUnsignedStagingFile(path) {
  return basename(path).toLowerCase().includes("unsigned-staging");
}

function runGit(args) {
  return spawnSync(gitCommand, [...gitCommandPrefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function toReleasePath(path) {
  return relative(root, resolve(path)).replace(/\\/g, "/");
}

function isInsideRoot(path) {
  const relativePath = relative(root, resolve(path));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isInsideReleaseReports(path) {
  const relativePath = toReleasePath(path);
  return relativePath === "reports/release" || relativePath.startsWith("reports/release/");
}

function isSafeRelativePath(path) {
  if (typeof path !== "string" || path.trim() === "" || isAbsolute(path)) {
    return false;
  }
  return isInsideRoot(resolve(root, path));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isShaLike(value) {
  return typeof value === "string" && /^[a-f0-9]{6,64}$/.test(value);
}

function parseArgs(args) {
  let root = defaultRoot;
  let report = "reports/handoff/desktop/unsigned-staging-report.json";
  let checksum = "reports/handoff/desktop/unsigned-staging-report-SHA256SUMS.txt";
  let skipCurrentGitCheck = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--skip-current-git-check") {
      skipCurrentGitCheck = true;
      continue;
    }
    if (arg === "--root") {
      root = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
      continue;
    }
    if (arg === "--report") {
      report = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--report=")) {
      report = arg.slice("--report=".length);
      continue;
    }
    if (arg === "--checksum") {
      checksum = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--checksum=")) {
      checksum = arg.slice("--checksum=".length);
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return {
    checksumPath: resolve(root, checksum),
    reportPath: resolve(root, report),
    root,
    skipCurrentGitCheck,
  };
}

function readValue(args, index, arg) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${arg} requires a value.`);
  }
  return value;
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
