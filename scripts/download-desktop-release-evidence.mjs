import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

const scriptRoot = resolve(import.meta.dirname, "..");
const {
  artifactName,
  ref,
  repo: explicitRepo,
  root,
  runId,
} = parseArgs(process.argv.slice(2));
const ghCommand = process.env.ATLASTERM_RELEASE_GH_COMMAND ?? "gh";
const ghCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GH_ARGS");
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const releaseRef = ref ?? `v${packageJson.version}`;
const expectedHeadSha = runGit(["rev-parse", `${releaseRef}^{}`], `Unable to resolve ${releaseRef}.`).stdout.trim();
const repo = explicitRepo ?? resolveRepoFromOrigin();
const desktopReleaseDir = resolve(root, "reports", "release", "desktop");

console.log(`Downloading Desktop formal release evidence from run ${runId} for ${repo} at ${releaseRef}.`);

runGh(["--version"], "GitHub CLI is required to download Desktop release evidence.");
runGh(["auth", "status"], "GitHub CLI must be authenticated to download Desktop release evidence.");
verifyRun();
verifyArtifact();

const downloadRoot = mkdtempSync(resolve(tmpdir(), "joessh-desktop-evidence-"));
try {
  runGh(
    ["run", "download", runId, "--repo", repo, "--name", artifactName, "--dir", downloadRoot],
    `Failed to download Desktop release evidence artifact ${artifactName} from run ${runId}.`,
  );
  importEvidence(downloadRoot);
  verifyImportedEvidence();
} finally {
  rmSync(downloadRoot, { recursive: true, force: true });
}

console.log(`Imported and verified Desktop release evidence from run ${runId}.`);

function verifyRun() {
  const result = runGh(
    ["run", "view", runId, "--repo", repo, "--json", "status,conclusion,headSha,jobs,url"],
    `Unable to inspect GitHub Actions run ${runId}.`,
  );
  const run = parseJson(result.stdout, `GitHub Actions run ${runId}`);

  if (run.status !== "completed" || run.conclusion !== "success") {
    const diagnostics = collectRunFailureDiagnostics(run);
    fail(
      `Desktop release evidence run ${runId} must be completed successfully; got ${run.status}/${run.conclusion}.${diagnostics}`,
    );
  }
  if (run.headSha !== expectedHeadSha) {
    fail(
      `Desktop release evidence run ${runId} was built from ${run.headSha}, but ${releaseRef} points at ${expectedHeadSha}.`,
    );
  }

  const formalEvidenceJob = Array.isArray(run.jobs)
    ? run.jobs.find((job) => job?.name === "Package Formal Desktop Evidence")
    : null;
  if (!formalEvidenceJob) {
    fail(`Desktop release evidence run ${runId} is missing the Package Formal Desktop Evidence job.`);
  }
  if (formalEvidenceJob.status !== "completed" || formalEvidenceJob.conclusion !== "success") {
    const diagnostics = collectJobFailureDiagnostics(formalEvidenceJob);
    fail(
      `Package Formal Desktop Evidence job must complete successfully before import; got ${formalEvidenceJob.status}/${formalEvidenceJob.conclusion}.${diagnostics}`,
    );
  }
}

function collectRunFailureDiagnostics(run) {
  const jobs = Array.isArray(run.jobs) ? run.jobs : [];
  const failedJobs = jobs.filter((job) => job?.conclusion && job.conclusion !== "success" && job.conclusion !== "skipped");
  const diagnostics = failedJobs.flatMap((job) => collectJobFailureDiagnostics(job, { asList: true }));
  return formatDiagnostics(diagnostics);
}

function collectJobFailureDiagnostics(job, { asList = false } = {}) {
  const jobName = typeof job?.name === "string" && job.name ? job.name : "unknown job";
  const status = `${job?.status ?? "unknown"}/${job?.conclusion ?? "unknown"}`;
  const lines = [`${jobName}: ${status}`];
  if (job?.databaseId) {
    const annotations = collectCheckRunAnnotations(job.databaseId);
    for (const annotation of annotations) {
      lines.push(`${jobName}: ${annotation}`);
    }
  }
  return asList ? lines : formatDiagnostics(lines);
}

function collectCheckRunAnnotations(checkRunId) {
  const result = runGhOptional(["api", `repos/${repo}/check-runs/${checkRunId}/annotations`]);
  if (!result || result.status !== 0) {
    return [];
  }
  const annotations = parseJsonOrNull(result.stdout);
  if (!Array.isArray(annotations)) {
    return [];
  }

  return annotations
    .map((annotation) => {
      const message = typeof annotation?.message === "string" ? annotation.message.trim() : "";
      const path = typeof annotation?.path === "string" ? annotation.path.trim() : "";
      return [path, message].filter(Boolean).join(": ");
    })
    .filter(Boolean);
}

function formatDiagnostics(lines) {
  const uniqueLines = [...new Set(lines.filter(Boolean))];
  if (uniqueLines.length === 0) {
    return "";
  }
  return `\nFailure diagnostics:\n- ${uniqueLines.join("\n- ")}`;
}

function verifyArtifact() {
  const result = runGh(
    ["api", `repos/${repo}/actions/runs/${runId}/artifacts`],
    `Unable to list artifacts for GitHub Actions run ${runId}.`,
  );
  const payload = parseJson(result.stdout, `GitHub Actions run ${runId} artifacts`);
  const artifact = Array.isArray(payload.artifacts)
    ? payload.artifacts.find((entry) => entry?.name === artifactName)
    : null;

  if (!artifact) {
    fail(`GitHub Actions run ${runId} does not contain artifact ${artifactName}.`);
  }
  if (artifact.expired) {
    fail(`GitHub Actions artifact ${artifactName} from run ${runId} has expired.`);
  }
}

function importEvidence(downloadRoot) {
  const filesByName = indexDownloadedFiles(downloadRoot);
  const manifestSource = requireDownloadedFile(filesByName, "SHA256SUMS.txt");
  const evidenceSource = requireDownloadedFile(filesByName, "release-evidence.json");
  const evidenceChecksumSource = requireDownloadedFile(filesByName, "release-evidence-SHA256SUMS.txt");
  const artifactPaths = readManifestArtifactPaths(manifestSource);

  rmSync(desktopReleaseDir, { recursive: true, force: true });
  mkdirSync(desktopReleaseDir, { recursive: true });

  copyToReleasePath(manifestSource, "reports/release/desktop/SHA256SUMS.txt");
  copyToReleasePath(evidenceSource, "reports/release/desktop/release-evidence.json");
  copyToReleasePath(evidenceChecksumSource, "reports/release/desktop/release-evidence-SHA256SUMS.txt");

  for (const artifactPath of artifactPaths) {
    const artifactSource = requireDownloadedFile(filesByName, basename(artifactPath));
    copyToReleasePath(artifactSource, artifactPath);
  }
}

function verifyImportedEvidence() {
  const result = spawnSync(process.execPath, [resolve(scriptRoot, "scripts", "verify-desktop-release-evidence.mjs"), "--root", root], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function indexDownloadedFiles(path) {
  const files = collectFiles(path);
  if (files.length === 0) {
    fail(`Downloaded Desktop evidence artifact ${artifactName} is empty.`);
  }

  const filesByName = new Map();
  for (const file of files) {
    const name = basename(file);
    const existing = filesByName.get(name);
    if (existing) {
      fail(`Downloaded Desktop evidence artifact contains duplicate file name ${name}:\n- ${existing}\n- ${file}`);
    }
    filesByName.set(name, file);
  }
  return filesByName;
}

function collectFiles(path) {
  if (!existsSync(path)) {
    return [];
  }
  const entries = readdirSync(path, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(child);
    }
    return entry.isFile() ? [child] : [];
  });
}

function requireDownloadedFile(filesByName, name) {
  const path = filesByName.get(name);
  if (!path) {
    fail(`Downloaded Desktop evidence artifact is missing ${name}.`);
  }
  return path;
}

function readManifestArtifactPaths(path) {
  const artifactPaths = [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      return;
    }

    const match = line.match(/^([a-fA-F0-9]{64})\s\s(.+)$/);
    if (!match) {
      fail(`${basename(path)}:${index + 1} is not '<sha256>  <relative-path>'.`);
    }

    const artifactPath = normalizeReleasePath(match[2]);
    if (!artifactPath.startsWith("reports/release/desktop/")) {
      fail(`${basename(path)}:${index + 1} must list a reports/release/desktop artifact path.`);
    }
    artifactPaths.push(artifactPath);
  });

  if (artifactPaths.length === 0) {
    fail("Downloaded Desktop checksum manifest contains no artifacts.");
  }
  return artifactPaths;
}

function copyToReleasePath(source, releasePath) {
  const normalizedReleasePath = normalizeReleasePath(releasePath);
  if (isAbsolute(normalizedReleasePath)) {
    fail(`Refusing to import absolute Desktop release path ${normalizedReleasePath}.`);
  }

  const destination = resolve(root, normalizedReleasePath);
  if (!isInsideRoot(destination) || !isInsideDirectory(destination, desktopReleaseDir)) {
    fail(`Refusing to import Desktop release file outside reports/release/desktop: ${normalizedReleasePath}.`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function resolveRepoFromOrigin() {
  const origin = runGit(["remote", "get-url", "origin"], "Unable to read Git origin URL.").stdout.trim();
  const match = origin.match(/github\.com[:/](?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?$/i);
  if (!match?.groups) {
    fail(`Unable to infer GitHub repository from origin URL: ${origin}`);
  }
  return validateRepo(`${match.groups.owner}/${match.groups.repo}`);
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`Unable to parse ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseJsonOrNull(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function runGh(args, message) {
  return runCommand(ghCommand, [...ghCommandPrefixArgs, ...args], message);
}

function runGhOptional(args) {
  return spawnSync(ghCommand, [...ghCommandPrefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGit(args, message) {
  return runCommand(gitCommand, [...gitCommandPrefixArgs, ...args], message);
}

function runCommand(command, args, message) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const diagnostic = `${result.stdout}\n${result.stderr}`.trim();
    fail(diagnostic ? `${message}\n${diagnostic}` : message);
  }
  return result;
}

function parseArgs(args) {
  let artifactName = "desktop-release-evidence";
  let ref = null;
  let repo = null;
  let root = scriptRoot;
  let runId = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--artifact-name") {
      artifactName = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact-name=")) {
      artifactName = arg.slice("--artifact-name=".length);
      continue;
    }
    if (arg === "--ref") {
      ref = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--ref=")) {
      ref = arg.slice("--ref=".length);
      continue;
    }
    if (arg === "--repo") {
      repo = validateRepo(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      repo = validateRepo(arg.slice("--repo=".length));
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
    if (arg === "--run-id") {
      runId = validateRunId(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      runId = validateRunId(arg.slice("--run-id=".length));
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!runId) {
    fail("--run-id is required so Desktop release evidence cannot be imported from an ambiguous workflow run.");
  }

  return { artifactName, ref, repo, root, runId };
}

function readValue(args, index, arg) {
  const value = args[index + 1];
  if (!value) {
    fail(`${arg} requires a value.`);
  }
  return value;
}

function validateRepo(value) {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    return value;
  }
  fail(`--repo must use owner/name format, received: ${value}`);
}

function validateRunId(value) {
  if (/^[1-9][0-9]*$/.test(value)) {
    return value;
  }
  fail(`--run-id must be a positive integer, received: ${value}`);
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

function normalizeReleasePath(path) {
  return path.replaceAll("\\", "/");
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isInsideDirectory(path, directory) {
  const relativePath = relative(directory, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
