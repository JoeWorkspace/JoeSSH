import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const {
  checksumPath,
  outputPath,
  root,
  skipCurrentGitCheck,
  write,
} = parseArgs(process.argv.slice(2));
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");
const packageJson = readJson("package.json");
const releaseTag = `v${packageJson.version}`;
const exclusionReleasePath = toReleasePath(outputPath);

const desktopReleaseDir = resolve(root, "reports", "release", "desktop");
const desktopReleaseFiles = collectFiles(desktopReleaseDir).map((path) => toReleasePath(path)).sort();
const desktopArtifacts = desktopReleaseFiles.filter((path) => classifyDesktopArtifact(path) !== null);

if (write) {
  writeExclusionEvidence();
} else {
  verifyExclusionEvidence();
}

function writeExclusionEvidence() {
  assertNoDesktopReleaseFiles();
  const git = inspectGit({ required: !skipCurrentGitCheck });
  const evidence = {
    artifact: "desktop-public-exclusion",
    assertions: [
      "no public Desktop downloads are included in this release profile",
      "reports/release/desktop contains no Desktop release artifacts",
      "unsigned Desktop staging evidence stays under reports/handoff",
      "signed Desktop formal evidence remains required if Desktop downloads are published",
    ],
    desktopReleaseDir: "reports/release/desktop",
    evidenceVersion: 1,
    generatedAt: new Date().toISOString(),
    product: "JoeSSH",
    publicDesktopDownloads: false,
    releaseProfile: "web-sync-only",
    releaseTag,
    source: git,
    version: packageJson.version,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  mkdirSync(dirname(checksumPath), { recursive: true });
  writeFileSync(checksumPath, `${sha256File(outputPath)}  ${exclusionReleasePath}\n`);
  console.log(`Wrote Desktop public exclusion evidence to ${exclusionReleasePath}.`);
  console.log(`Wrote Desktop public exclusion checksum to ${toReleasePath(checksumPath)}.`);
}

function verifyExclusionEvidence() {
  assertNoDesktopReleaseFiles();
  const evidence = readEvidence();
  const errors = [];

  if (evidence.artifact !== "desktop-public-exclusion") {
    errors.push("artifact must be desktop-public-exclusion");
  }
  if (evidence.evidenceVersion !== 1) {
    errors.push("evidenceVersion must be 1");
  }
  if (evidence.product !== "JoeSSH") {
    errors.push("product must be JoeSSH");
  }
  if (evidence.version !== packageJson.version) {
    errors.push(`version must be ${packageJson.version}`);
  }
  if (evidence.releaseTag !== releaseTag) {
    errors.push(`releaseTag must be ${releaseTag}`);
  }
  if (evidence.releaseProfile !== "web-sync-only") {
    errors.push("releaseProfile must be web-sync-only");
  }
  if (evidence.publicDesktopDownloads !== false) {
    errors.push("publicDesktopDownloads must be false");
  }
  if (evidence.desktopReleaseDir !== "reports/release/desktop") {
    errors.push("desktopReleaseDir must be reports/release/desktop");
  }
  const requiredAssertions = [
    "no public Desktop downloads are included in this release profile",
    "reports/release/desktop contains no Desktop release artifacts",
    "signed Desktop formal evidence remains required if Desktop downloads are published",
  ];
  const missingAssertions = requiredAssertions.filter(
    (assertion) => !evidence.assertions?.includes(assertion),
  );
  if (missingAssertions.length > 0) {
    errors.push(`missing assertion(s): ${missingAssertions.join(", ")}`);
  }
  validateSource(evidence.source, errors);
  validateChecksum(errors);

  if (errors.length > 0) {
    fail(`Desktop public exclusion verification failed:\n- ${errors.join("\n- ")}`);
  }

  console.log(`Desktop public exclusion verified for ${releaseTag}.`);
}

function readEvidence() {
  if (!existsSync(outputPath) || !statSync(outputPath).isFile()) {
    fail(`Missing Desktop public exclusion evidence: ${exclusionReleasePath}`);
  }
  try {
    return JSON.parse(readFileSync(outputPath, "utf8"));
  } catch (error) {
    fail(`Desktop public exclusion evidence is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateSource(source, errors) {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    errors.push("source must be a JSON object");
    return;
  }
  if (!isShaLike(source.gitCommit)) {
    errors.push("source.gitCommit must be a Git commit hash");
  }
  if (!isShaLike(source.releaseTagCommit)) {
    errors.push("source.releaseTagCommit must be a Git commit hash");
  }
  if (source.gitFsckStrict !== true) {
    errors.push("source.gitFsckStrict must be true");
  }
  if (source.cleanTreeExcluding !== "reports/release") {
    errors.push("source.cleanTreeExcluding must be reports/release");
  }
  if (typeof source.repository !== "string" || source.repository.trim() === "") {
    errors.push("source.repository must record the Git remote origin URL");
  }
  if (skipCurrentGitCheck) {
    return;
  }

  const git = inspectGit({ required: true });
  if (git.gitCommit !== source.gitCommit) {
    errors.push("source.gitCommit does not match current HEAD");
  }
  if (git.releaseTagCommit !== source.releaseTagCommit) {
    errors.push(`source.releaseTagCommit does not match ${releaseTag}`);
  }
  if (git.repository !== source.repository) {
    errors.push("source.repository does not match current Git remote origin");
  }
}

function validateChecksum(errors) {
  if (!existsSync(checksumPath) || !statSync(checksumPath).isFile()) {
    errors.push(`missing Desktop public exclusion checksum manifest ${toReleasePath(checksumPath)}`);
    return;
  }
  const entries = readFileSync(checksumPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (entries.length !== 1) {
    errors.push("Desktop public exclusion checksum manifest must contain exactly one entry");
    return;
  }
  const match = entries[0].match(/^([a-f0-9]{64})\s\s(.+)$/);
  if (!match) {
    errors.push("Desktop public exclusion checksum manifest line is invalid");
    return;
  }
  if (match[2].replaceAll("\\", "/") !== exclusionReleasePath) {
    errors.push(`Desktop public exclusion checksum manifest must list ${exclusionReleasePath}`);
  }
  if (match[1] !== sha256File(outputPath)) {
    errors.push("Desktop public exclusion checksum manifest hash mismatch");
  }
}

function assertNoDesktopReleaseFiles() {
  if (desktopReleaseFiles.length === 0) {
    return;
  }
  const detail =
    desktopArtifacts.length > 0
      ? desktopArtifacts.join(", ")
      : desktopReleaseFiles.join(", ");
  fail(
    `No public Desktop downloads are allowed in the web-sync-only release profile; remove staged Desktop release file(s): ${detail}`,
  );
}

function inspectGit({ required }) {
  const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree.status !== 0 || insideWorkTree.stdout.trim() !== "true") {
    if (required) {
      fail("Git checkout metadata is required for Desktop public exclusion evidence.");
    }
    return null;
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
    fail("Git working tree status is required for Desktop public exclusion evidence.");
  }
  if (status.stdout.trim() !== "") {
    fail(`Git working tree outside reports/release must be clean for Desktop public exclusion evidence:\n${status.stdout}`);
  }

  const head = runGit(["rev-parse", "HEAD"]);
  const tag = runGit(["rev-parse", "--verify", `${releaseTag}^{}`]);
  const fsck = runGit(["fsck", "--strict"]);
  const repository = runGit(["remote", "get-url", "origin"]);
  if (head.status !== 0 || tag.status !== 0 || fsck.status !== 0 || repository.status !== 0) {
    fail("Unable to inspect release Git metadata for Desktop public exclusion evidence.");
  }
  if (head.stdout.trim() !== tag.stdout.trim()) {
    fail(`Release tag ${releaseTag} must point at HEAD for Desktop public exclusion evidence.`);
  }

  return {
    cleanTreeExcluding: "reports/release",
    gitCommit: head.stdout.trim(),
    gitFsckStrict: true,
    releaseTagCommit: tag.stdout.trim(),
    repository: repository.stdout.trim(),
  };
}

function runGit(args) {
  return spawnSync(gitCommand, [...gitCommandPrefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
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

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function toReleasePath(path) {
  return relative(root, resolve(path)).replace(/\\/g, "/");
}

function isInsideRoot(path, rootPath) {
  const relativePath = relative(rootPath, resolve(path));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isShaLike(value) {
  return typeof value === "string" && /^[a-f0-9]{6,64}$/.test(value);
}

function parseArgs(args) {
  let root = defaultRoot;
  let outputPath = "reports/release/desktop-exclusion.json";
  let checksumPath = "reports/release/desktop-exclusion-SHA256SUMS.txt";
  let skipCurrentGitCheck = false;
  let write = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--write") {
      write = true;
      continue;
    }
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
    if (arg === "--output") {
      outputPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
      continue;
    }
    if (arg === "--checksum") {
      checksumPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--checksum=")) {
      checksumPath = arg.slice("--checksum=".length);
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  const resolvedOutputPath = resolve(root, outputPath);
  const resolvedChecksumPath = resolve(root, checksumPath);
  if (!isInsideRoot(resolvedOutputPath, root) || !isInsideRoot(resolvedChecksumPath, root)) {
    fail("--output and --checksum must stay inside --root.");
  }

  return {
    checksumPath: resolvedChecksumPath,
    outputPath: resolvedOutputPath,
    root,
    skipCurrentGitCheck,
    write,
  };
}

function readValue(args, index, arg) {
  const value = args[index + 1];
  if (!value) {
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
