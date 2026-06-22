import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const scriptRoot = resolve(import.meta.dirname, "..");
const {
  noFail,
  outputPath,
  repo: explicitRepo,
  root,
  skipGithub,
} = parseArgs(process.argv.slice(2));
const gitCommand = process.env.ATLASTERM_RC_AUDIT_GIT_COMMAND ?? process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RC_AUDIT_GIT_ARGS");
const ghCommand = process.env.ATLASTERM_RC_AUDIT_GH_COMMAND ?? process.env.ATLASTERM_RELEASE_GH_COMMAND ?? "gh";
const ghCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RC_AUDIT_GH_ARGS");
const npmCommand =
  process.env.ATLASTERM_RC_AUDIT_NPM_COMMAND ?? (process.platform === "win32" ? "npm.cmd" : "npm");
const npmCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RC_AUDIT_NPM_ARGS");
const packageJson = readJson("package.json");
const releaseTag = `v${packageJson.version}`;
const repo = explicitRepo ?? resolveRepoFromOrigin();
const checks = [];
const blockers = [];

const report = {
  blockers,
  checks,
  decision: "no-go",
  generatedAt: new Date().toISOString(),
  releaseTag,
  repository: repo,
  root,
  version: packageJson.version,
};

auditGit();
auditReleaseManifests();
auditDesktopArtifactVersions();
auditDesktopDogfood();
auditPublishPreflight();
auditDesktopSigningSecrets();
if (!skipGithub) {
  auditLatestCi();
} else {
  addCheck("github-ci", "GitHub CI status", "unknown", "Skipped by --skip-github.");
}

report.decision = blockers.length === 0 ? "go" : "no-go";
writeReport();

const summary = `Public Beta RC audit: ${report.decision.toUpperCase()} (${blockers.length} blocker${blockers.length === 1 ? "" : "s"}).`;
console.log(summary);
console.log(`Wrote ${toReleasePath(outputPath)}`);
console.log(`Wrote ${toReleasePath(checksumPathFor(outputPath))}`);

if (report.decision !== "go" && !noFail) {
  process.exit(1);
}

function auditGit() {
  const head = runGit(["rev-parse", "HEAD"]);
  if (head.status !== 0) {
    addCheck("git-head", "Git HEAD resolves", "fail", commandDiagnostic(head), true);
    return;
  }
  const headSha = head.stdout.trim();
  report.head = headSha;
  addCheck("git-head", "Git HEAD resolves", "pass", headSha);

  const tag = runGit(["rev-parse", "--verify", `${releaseTag}^{commit}`]);
  if (tag.status !== 0) {
    addCheck("release-tag", "Release tag exists and points at HEAD", "fail", commandDiagnostic(tag), true);
  } else {
    const tagSha = tag.stdout.trim();
    report.releaseTagCommit = tagSha;
    addCheck(
      "release-tag",
      "Release tag exists and points at HEAD",
      tagSha === headSha ? "pass" : "fail",
      tagSha === headSha ? tagSha : `${releaseTag} points at ${shortSha(tagSha)}; HEAD is ${shortSha(headSha)}.`,
      tagSha !== headSha,
    );
  }

  const status = runGit([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude)reports",
  ]);
  if (status.status !== 0) {
    addCheck("git-clean", "Git working tree outside reports is clean", "fail", commandDiagnostic(status), true);
  } else {
    addCheck(
      "git-clean",
      "Git working tree outside reports is clean",
      status.stdout.trim() === "" ? "pass" : "fail",
      status.stdout.trim() === "" ? "clean" : status.stdout.trim(),
      status.stdout.trim() !== "",
    );
  }
}

function auditReleaseManifests() {
  const manifests = [
    ["release-web", "Web Admin release checksum manifest", "reports/release/web/SHA256SUMS.txt", true],
    ["release-sync", "Sync release checksum manifest", "reports/release/sync/SHA256SUMS.txt", true],
    ["release-sbom", "SBOM checksum manifest", "reports/release/SBOM-SHA256SUMS.txt", true],
    ["release-desktop", "Desktop signed release checksum manifest", "reports/release/desktop/SHA256SUMS.txt", true],
    [
      "release-desktop-evidence",
      "Desktop signed release evidence checksum manifest",
      "reports/release/desktop/release-evidence-SHA256SUMS.txt",
      true,
    ],
  ];

  for (const [id, label, relativePath, blocking] of manifests) {
    const result = verifyChecksumManifest(relativePath);
    addCheck(id, label, result.ok ? "pass" : "fail", result.detail, blocking && !result.ok);
  }
}

function auditDesktopArtifactVersions() {
  const artifacts = collectFiles(resolve(root, "reports", "release", "desktop"))
    .filter((path) => classifyDesktopArtifact(path) !== null)
    .map((path) => toReleasePath(path))
    .sort();
  if (artifacts.length === 0) {
    addCheck(
      "release-desktop-stale-artifacts",
      "Desktop staged artifact versions",
      "pass",
      "No staged Desktop artifacts found; checksum manifest gates cover required artifacts.",
    );
    return;
  }

  const staleArtifacts = artifacts.filter(
    (path) => !artifactFileName(path).includes(packageJson.version),
  );
  addCheck(
    "release-desktop-stale-artifacts",
    "Desktop staged artifact versions",
    staleArtifacts.length === 0 ? "pass" : "fail",
    staleArtifacts.length === 0
      ? `All ${artifacts.length} staged Desktop artifact(s) include ${packageJson.version}.`
      : `Desktop artifact(s) do not include ${packageJson.version}: ${staleArtifacts.join(", ")}.`,
    staleArtifacts.length > 0,
  );
}

function auditDesktopDogfood() {
  const evidencePath = "reports/smoke/desktop/real-ssh-smoke.json";
  const checksumPath = "reports/smoke/desktop/real-ssh-smoke-SHA256SUMS.txt";
  const checksum = verifyChecksumManifest(checksumPath);
  if (!checksum.ok) {
    addCheck("desktop-dogfood-checksum", "Desktop real SSH dogfood checksum", "fail", checksum.detail, true);
    return;
  }
  addCheck("desktop-dogfood-checksum", "Desktop real SSH dogfood checksum", "pass", checksum.detail);

  const evidence = readJsonIfExists(evidencePath);
  const requiredChecks = [
    "host-key probe",
    "pinned host-key authentication",
    "exec marker",
    "SFTP list/download/upload/overwrite",
    "PTY marker",
    "local forwarding start/traffic/shutdown",
  ];
  const missing = requiredChecks.filter((check) => !evidence?.checks?.includes(check));
  const passed = evidence?.status === "passed" && missing.length === 0;
  addCheck(
    "desktop-dogfood",
    "Desktop real SSH dogfood evidence",
    passed ? "pass" : "fail",
    passed
      ? `${evidence.fixture} ${evidence.auth} finished ${evidence.finishedAt}`
      : `Dogfood evidence missing/failed${missing.length > 0 ? `; missing checks: ${missing.join(", ")}` : ""}.`,
    !passed,
  );
}

function auditPublishPreflight() {
  const result = runNpm(["run", "release:publish-preflight"]);
  addCheck(
    "publish-preflight",
    "Release publish preflight",
    result.status === 0 ? "pass" : "fail",
    result.status === 0 ? "passed" : tail(commandDiagnostic(result)).join("\n"),
    result.status !== 0,
  );
}

function auditDesktopSigningSecrets() {
  const result = runNpm(["run", "release:desktop:configure-secrets", "--", "--verify-only"]);
  addCheck(
    "desktop-signing-secrets",
    "Desktop signing/notarization secret preflight",
    result.status === 0 ? "pass" : "fail",
    result.status === 0 ? "passed" : tail(commandDiagnostic(result)).join("\n"),
    result.status !== 0,
  );
}

function auditLatestCi() {
  const auth = runGh(["auth", "status"]);
  if (auth.status !== 0) {
    addCheck("github-auth", "GitHub CLI authentication", "fail", commandDiagnostic(auth), true);
    return;
  }
  addCheck("github-auth", "GitHub CLI authentication", "pass", "authenticated");

  const runsResult = runGh([
    "run",
    "list",
    "--repo",
    repo,
    "--branch",
    "main",
    "--limit",
    "10",
    "--json",
    "databaseId,headSha,status,conclusion,workflowName,url,displayTitle,createdAt",
  ]);
  if (runsResult.status !== 0) {
    addCheck("github-ci", "Latest GitHub CI for HEAD", "fail", commandDiagnostic(runsResult), true);
    return;
  }

  const runs = parseJsonOrNull(runsResult.stdout) ?? [];
  const head = report.head ?? "";
  const ciRun = runs.find((run) => run.workflowName === "CI" && run.headSha === head);
  if (!ciRun) {
    addCheck("github-ci", "Latest GitHub CI for HEAD", "fail", `No CI run found for ${shortSha(head)}.`, true);
    return;
  }

  report.ciRun = {
    conclusion: ciRun.conclusion,
    id: ciRun.databaseId,
    status: ciRun.status,
    url: ciRun.url,
  };

  if (ciRun.status === "completed" && ciRun.conclusion === "success") {
    addCheck("github-ci", "Latest GitHub CI for HEAD", "pass", ciRun.url);
    return;
  }

  const diagnostics = collectRunFailureDiagnostics(ciRun.databaseId);
  addCheck(
    "github-ci",
    "Latest GitHub CI for HEAD",
    "fail",
    [ciRun.url, ...diagnostics].filter(Boolean).join("\n"),
    true,
  );
}

function collectRunFailureDiagnostics(runId) {
  const view = runGh(["run", "view", String(runId), "--repo", repo, "--json", "jobs"]);
  if (view.status !== 0) {
    return [`Unable to inspect failed CI jobs: ${commandDiagnostic(view)}`];
  }
  const jobs = parseJsonOrNull(view.stdout)?.jobs ?? [];
  const failedJobs = jobs.filter((job) => job.conclusion === "failure");
  const lines = [];
  for (const job of failedJobs.slice(0, 8)) {
    lines.push(`${job.name}: ${job.status}/${job.conclusion}`);
    const annotations = collectCheckRunAnnotations(job.databaseId);
    for (const annotation of annotations.slice(0, 3)) {
      lines.push(`${job.name}: ${annotation.path ?? ".github"}: ${annotation.message}`);
    }
  }
  return lines;
}

function collectCheckRunAnnotations(checkRunId) {
  const result = runGh(["api", `repos/${repo}/check-runs/${checkRunId}/annotations`]);
  if (result.status !== 0) {
    return [];
  }
  return parseJsonOrNull(result.stdout) ?? [];
}

function verifyChecksumManifest(relativePath) {
  const manifestPath = resolve(root, relativePath);
  if (!existsSync(manifestPath)) {
    return { ok: false, detail: `${relativePath} is missing.` };
  }

  const lines = readFileSync(manifestPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { ok: false, detail: `${relativePath} is empty.` };
  }

  for (const line of lines) {
    const match = line.match(/^(?<hash>[a-f0-9]{64})\s+\*?(?<path>.+)$/i);
    if (!match?.groups) {
      return { ok: false, detail: `${relativePath} contains an invalid checksum line.` };
    }
    if (isManifestAbsolutePath(match.groups.path)) {
      return { ok: false, detail: `${match.groups.path} referenced by ${relativePath} must be relative.` };
    }
    const artifactPath = resolveManifestEntryPath(match.groups.path);
    if (!isInsideRoot(artifactPath, root)) {
      return { ok: false, detail: `${match.groups.path} referenced by ${relativePath} escapes the release root.` };
    }
    if (!existsSync(artifactPath)) {
      return { ok: false, detail: `${match.groups.path} referenced by ${relativePath} is missing.` };
    }
    const actual = sha256(artifactPath);
    if (actual !== match.groups.hash.toLowerCase()) {
      return { ok: false, detail: `${match.groups.path} hash mismatch in ${relativePath}.` };
    }
  }

  return { ok: true, detail: `verified ${lines.length} checksum${lines.length === 1 ? "" : "s"}` };
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

function artifactFileName(path) {
  return path.split(/[\\/]/).pop() ?? path;
}

function resolveManifestEntryPath(entryPath) {
  return resolve(root, ...entryPath.split(/[\\/]+/).filter(Boolean));
}

function isManifestAbsolutePath(entryPath) {
  return isAbsolute(entryPath) || /^[A-Za-z]:[\\/]/.test(entryPath);
}

function writeReport() {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  const checksumPath = checksumPathFor(outputPath);
  writeFileSync(checksumPath, `${sha256(outputPath)}  ${toReleasePath(outputPath)}\n`);
}

function addCheck(id, label, status, detail, blocking = false) {
  checks.push({ blocking, detail, id, label, status });
  if (blocking && status === "fail") {
    blockers.push({ detail, id, label });
  }
}

function resolveRepoFromOrigin() {
  const result = runGit(["remote", "get-url", "origin"]);
  if (result.status !== 0) {
    return "unknown/unknown";
  }
  const origin = result.stdout.trim();
  const match = origin.match(/github\.com[:/](?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?$/i);
  return match?.groups ? `${match.groups.owner}/${match.groups.repo}` : "unknown/unknown";
}

function runGit(args) {
  return runCommand(gitCommand, [...gitCommandPrefixArgs, ...args]);
}

function runGh(args) {
  return runCommand(ghCommand, [...ghCommandPrefixArgs, ...args]);
}

function runNpm(args) {
  return runCommand(npmCommand, [...npmCommandPrefixArgs, ...args], {
    shell: process.platform === "win32" && /\.cmd$/i.test(npmCommand),
  });
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

function readJsonIfExists(relativePath) {
  const path = resolve(root, relativePath);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function checksumPathFor(path) {
  return resolve(dirname(path), `${basename(path, ".json")}-SHA256SUMS.txt`);
}

function commandDiagnostic(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

function tail(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-12);
}

function parseJsonOrNull(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function shortSha(value) {
  return value ? value.slice(0, 7) : "unknown";
}

function toReleasePath(path) {
  const relative = path.startsWith(root) ? path.slice(root.length + 1) : path;
  return relative.replace(/\\/g, "/");
}

function parseArgs(args) {
  let noFail = false;
  let outputPath = null;
  let repo = null;
  let root = scriptRoot;
  let skipGithub = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-fail") {
      noFail = true;
      continue;
    }
    if (arg === "--skip-github") {
      skipGithub = true;
      continue;
    }
    if (arg === "--output") {
      outputPath = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputPath = resolve(arg.slice("--output=".length));
      continue;
    }
    if (arg === "--repo") {
      repo = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      repo = arg.slice("--repo=".length);
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
    fail(`Unknown argument: ${arg}`);
  }

  outputPath ??= resolve(root, "reports", "release", "public-beta-rc-audit.json");
  if (!isInsideRoot(outputPath, root)) {
    fail("--output must stay inside --root.");
  }

  return { noFail, outputPath, repo, root, skipGithub };
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

function isInsideRoot(path, rootPath) {
  const relativePath = relative(rootPath, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
