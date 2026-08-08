import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { verifyCanonicalReleaseCandidate } from "./release-candidate-github-contract.mjs";

const scriptRoot = resolve(import.meta.dirname, "..");
const { confirmBillingReady, dryRun, root, verifyPublished } = parseArgs(
  process.argv.slice(2),
);
const repository = "JoeWorkspace/JoeSSH";
const repositoryApiRoot = `repos/${repository}`;
const githubReleaseControlsPath = resolve(
  import.meta.dirname,
  "check-github-release-controls.mjs",
);
const gitCommand = process.env.ATLASTERM_SOURCE_PRERELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_SOURCE_PRERELEASE_GIT_ARGS",
);
const ghCommand = process.env.ATLASTERM_SOURCE_PRERELEASE_GH_COMMAND ?? "gh";
const ghCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_SOURCE_PRERELEASE_GH_ARGS",
);
let activeReleaseId = null;
const packagePath = resolve(root, "package.json");
const packageEvidence = captureRegularFile(
  packagePath,
  "root package manifest",
);
const packageJson = parseJson(packageEvidence.content, "package.json");

if (
  typeof packageJson.version !== "string" ||
  !/^\d+\.\d+\.\d+-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*$/u.test(
    packageJson.version,
  )
) {
  fail("Root package version must be a semantic prerelease version.");
}

const tag = `v${packageJson.version}`;
const title = `JoeSSH ${packageJson.version} Source Preview`;
const releaseNotesPath = resolve(
  root,
  "docs",
  "release-notes",
  `${packageJson.version}.md`,
);
const releaseNotesEvidence = captureRegularFile(
  releaseNotesPath,
  "source prerelease notes",
);
validateReleaseNotes(releaseNotesEvidence.content);

const candidate = assertSourcePrereleaseCandidate();

if (verifyPublished) {
  const release = readRequiredGithubJson(
    `${repositoryApiRoot}/releases/tags/${encodeURIComponent(tag)}`,
    `published source prerelease ${tag}`,
  );
  assertReleaseShape(release, { draft: false });
  assertSourceEvidenceUnchanged();
  assertSourcePrereleaseCandidate();
  console.log(
    `Verified published source prerelease ${tag} at ${release.html_url} with zero uploaded assets.`,
  );
  process.exit(0);
}

assertGithubReleaseDoesNotExist();

if (dryRun) {
  assertGithubReleaseControls();
  console.log(
    `Source prerelease dry run passed for ${tag} at protected ${candidate.branch} commit ${candidate.commit}.`,
  );
  console.log(
    "The release will contain only GitHub-generated source archives and zero uploaded assets.",
  );
  process.exit(0);
}

assertGithubReleaseControls();
let createdReleaseId = null;
try {
  assertSourceEvidenceUnchanged();
  assertSourcePrereleaseCandidate();
  const created = mutateGithubRelease("POST", `${repositoryApiRoot}/releases`, {
    body: normalizeReleaseBody(releaseNotesEvidence.content),
    draft: true,
    generate_release_notes: false,
    name: title,
    prerelease: true,
    tag_name: tag,
  });
  createdReleaseId = requireReleaseId(created);
  activeReleaseId = createdReleaseId;
  assertReleaseShape(created, { draft: true });

  const staged = readRequiredGithubJson(
    `${repositoryApiRoot}/releases/${createdReleaseId}`,
    `new source prerelease draft ${createdReleaseId}`,
  );
  assertReleaseShape(staged, { draft: true, id: createdReleaseId });
  assertSourceEvidenceUnchanged();
  assertSourcePrereleaseCandidate();
  assertGithubReleaseControls();

  const published = mutateGithubRelease(
    "PATCH",
    `${repositoryApiRoot}/releases/${createdReleaseId}`,
    {
      body: normalizeReleaseBody(releaseNotesEvidence.content),
      draft: false,
      name: title,
      prerelease: true,
      tag_name: tag,
    },
  );
  assertReleaseShape(published, { draft: false, id: createdReleaseId });

  const confirmed = readRequiredGithubJson(
    `${repositoryApiRoot}/releases/${createdReleaseId}`,
    `published source prerelease ${createdReleaseId}`,
  );
  assertReleaseShape(confirmed, { draft: false, id: createdReleaseId });
  assertSourceEvidenceUnchanged();
  assertSourcePrereleaseCandidate();
  activeReleaseId = null;
  console.log(
    `Published ${tag} as a source-only GitHub prerelease at ${confirmed.html_url} with zero uploaded assets.`,
  );
} catch (error) {
  const primary = error instanceof Error ? error.message : String(error);
  activeReleaseId = null;
  if (createdReleaseId === null) {
    fail(
      `${primary}\nNo GitHub Release ID was returned, so no automatic deletion was attempted. Inspect ${repository} for a partial draft before retrying.`,
    );
  }

  try {
    deleteGithubRelease(createdReleaseId);
  } catch (cleanupError) {
    fail(
      `${primary}\nAutomatic cleanup of GitHub Release ID ${createdReleaseId} failed: ${
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError)
      }`,
    );
  }
  fail(
    `${primary}\nRejected GitHub Release ID ${createdReleaseId} was deleted and its absence was confirmed.`,
  );
}

function assertGithubReleaseControls() {
  const args = [githubReleaseControlsPath, "--repo", repository];
  if (confirmBillingReady) {
    args.push("--confirm-billing-ready");
  }
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      JOESSH_GITHUB_RELEASE_CONTROLS_GH_ARGS:
        JSON.stringify(ghCommandPrefixArgs),
      JOESSH_GITHUB_RELEASE_CONTROLS_GH_COMMAND: ghCommand,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.status !== 0) {
    fail(
      `GitHub release controls must pass immediately before source prerelease mutation.\n${commandDiagnostic(result)}`,
    );
  }
  const summary = String(result.stdout ?? "")
    .trim()
    .split(/\r?\n/u)
    .at(-1);
  if (summary) {
    console.log(summary);
  }
}

function assertSourcePrereleaseCandidate() {
  assertSourceEvidenceUnchanged();
  assertNoReleasePayloads();

  const inside = runGit(["rev-parse", "--is-inside-work-tree"], {
    message: "Git checkout metadata is required for a source prerelease.",
  });
  if (inside !== "true") {
    fail("Git checkout metadata is required for a source prerelease.");
  }

  const status = runGit(
    ["status", "--porcelain=v1", "--untracked-files=all", "--", "."],
    { message: "Git working tree status is required for a source prerelease." },
  );
  if (status !== "") {
    fail(`Git working tree must be completely clean:\n${status}`);
  }

  const head = runGit(["rev-parse", "HEAD"], {
    message: "Unable to resolve source prerelease HEAD.",
  });
  const tagCommit = runGit(["rev-parse", "--verify", `${tag}^{}`], {
    message: `Annotated source prerelease tag ${tag} must exist locally.`,
  });
  if (tagCommit !== head) {
    fail(`Source prerelease tag ${tag} must point at HEAD ${head}.`);
  }
  const localTagType = runGit(["cat-file", "-t", tag], {
    message: `Unable to inspect local source prerelease tag ${tag}.`,
  });
  if (localTagType !== "tag") {
    fail(`Source prerelease tag ${tag} must be an annotated Git tag.`);
  }

  runGit(["fsck", "--strict"], {
    message: "git fsck --strict must pass for a source prerelease.",
  });
  const origin = runGit(["remote", "get-url", "origin"], {
    message: "Git remote origin is required for a source prerelease.",
  });
  if (!isCanonicalOrigin(origin)) {
    fail(`Git origin does not identify ${repository}: ${origin}`);
  }

  runGh(["--version"], {
    message: "GitHub CLI is required for a source prerelease.",
  });
  runGh(["auth", "status"], {
    message: "GitHub CLI must be authenticated for a source prerelease.",
  });

  const remoteTagCommit = resolveRemoteTagCommit();
  if (remoteTagCommit !== head) {
    fail(
      `Remote source prerelease tag ${tag} points at ${remoteTagCommit}; expected ${head}.`,
    );
  }

  let verified;
  try {
    verified = verifyCanonicalReleaseCandidate({
      candidateCommit: head,
      readGithubJson: readRequiredGithubJson,
      repository,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  return verified;
}

function validateReleaseNotes(notes) {
  const normalized = normalizeReleaseBody(notes);
  const required = [
    packageJson.version,
    "source-only GitHub prerelease",
    "automatically generated source archives",
    "does not include Desktop installers",
    "zero uploaded assets",
    "no WCAG",
    "conformance claim",
  ];
  const missing = required.filter((text) => !normalized.includes(text));
  if (missing.length > 0) {
    fail(
      `Source prerelease notes are missing required boundary text:\n- ${missing.join("\n- ")}`,
    );
  }
}

function assertNoReleasePayloads() {
  const releaseRoot = resolve(root, "reports", "release");
  if (!existsSync(releaseRoot)) {
    return;
  }
  const payloads = collectNonDirectoryEntries(releaseRoot).map((path) =>
    toRootPath(path),
  );
  if (payloads.length > 0) {
    fail(
      `Source prerelease requires zero staged release files; remove or isolate:\n- ${payloads.join("\n- ")}`,
    );
  }
}

function collectNonDirectoryEntries(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      return collectNonDirectoryEntries(child);
    }
    return [child];
  });
}

function assertSourceEvidenceUnchanged() {
  assertRegularFileUnchanged(packageEvidence);
  assertRegularFileUnchanged(releaseNotesEvidence);
}

function captureRegularFile(path, label) {
  let link;
  let stat;
  try {
    link = lstatSync(path);
    stat = statSync(path);
  } catch {
    fail(`${label} is missing: ${toRootPath(path)}`);
  }
  if (
    link.isSymbolicLink() ||
    !link.isFile() ||
    !stat.isFile() ||
    link.nlink !== 1 ||
    stat.nlink !== 1
  ) {
    fail(`${label} must be a direct regular file: ${toRootPath(path)}`);
  }
  const content = readFileSync(path, "utf8");
  return {
    content,
    label,
    path,
    sha256: sha256(content),
    size: stat.size,
  };
}

function assertRegularFileUnchanged(evidence) {
  const current = captureRegularFile(evidence.path, evidence.label);
  if (current.sha256 !== evidence.sha256 || current.size !== evidence.size) {
    fail(`${evidence.label} changed during source prerelease verification.`);
  }
}

function assertGithubReleaseDoesNotExist() {
  const result = runGhRaw([
    "api",
    "--method",
    "GET",
    `${repositoryApiRoot}/releases/tags/${encodeURIComponent(tag)}`,
  ]);
  if (result.status === 0) {
    fail(
      `GitHub Release ${tag} already exists; refusing to create a duplicate.`,
    );
  }
  if (!isNotFound(result)) {
    fail(
      `Unable to confirm GitHub Release ${tag} does not exist: ${commandDiagnostic(result)}`,
    );
  }
}

function mutateGithubRelease(method, endpoint, payload) {
  const result = runGhRaw(
    ["api", "--method", method, endpoint, "--input", "-"],
    JSON.stringify(payload),
  );
  if (result.status !== 0) {
    throw new Error(
      `GitHub ${method} ${endpoint} failed: ${commandDiagnostic(result)}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`GitHub ${method} ${endpoint} returned invalid JSON.`);
  }
}

function deleteGithubRelease(id) {
  const deleted = runGhRaw([
    "api",
    "--method",
    "DELETE",
    `${repositoryApiRoot}/releases/${id}`,
  ]);
  if (deleted.status !== 0) {
    throw new Error(commandDiagnostic(deleted));
  }
  const absent = runGhRaw([
    "api",
    "--method",
    "GET",
    `${repositoryApiRoot}/releases/${id}`,
  ]);
  if (!isNotFound(absent)) {
    throw new Error(
      `GitHub Release ID ${id} still exists or its absence is ambiguous: ${commandDiagnostic(absent)}`,
    );
  }
}

function assertReleaseShape(release, { draft, id = null }) {
  if (!isRecord(release)) {
    throw new Error("GitHub source prerelease response must be an object.");
  }
  const releaseId = requireReleaseId(release);
  const issues = [];
  if (id !== null && releaseId !== id) {
    issues.push(`id=${releaseId}, expected ${id}`);
  }
  if (release.tag_name !== tag) {
    issues.push(`tag_name=${String(release.tag_name)}, expected ${tag}`);
  }
  if (release.name !== title) {
    issues.push(`name=${String(release.name)}, expected ${title}`);
  }
  if (release.draft !== draft) {
    issues.push(`draft=${String(release.draft)}, expected ${draft}`);
  }
  if (release.prerelease !== true) {
    issues.push(`prerelease=${String(release.prerelease)}, expected true`);
  }
  if (!Array.isArray(release.assets) || release.assets.length !== 0) {
    issues.push("uploaded assets must be an empty array");
  }
  if (
    normalizeReleaseBody(String(release.body ?? "")) !==
    normalizeReleaseBody(releaseNotesEvidence.content)
  ) {
    issues.push("release body does not exactly match reviewed release notes");
  }
  if (!draft) {
    if (typeof release.html_url !== "string" || release.html_url === "") {
      issues.push("published release html_url is missing");
    }
    if (typeof release.zipball_url !== "string" || release.zipball_url === "") {
      issues.push("published source zip URL is missing");
    }
    if (typeof release.tarball_url !== "string" || release.tarball_url === "") {
      issues.push("published source tarball URL is missing");
    }
  }
  if (issues.length > 0) {
    throw new Error(
      `GitHub source prerelease verification failed for release ID ${releaseId}:\n- ${issues.join("\n- ")}`,
    );
  }
}

function requireReleaseId(release) {
  if (!Number.isSafeInteger(release?.id) || release.id <= 0) {
    throw new Error("GitHub did not return a positive source prerelease ID.");
  }
  return release.id;
}

function resolveRemoteTagCommit() {
  const reference = readRequiredGithubJson(
    `${repositoryApiRoot}/git/ref/tags/${encodeURIComponent(tag)}`,
    `remote source prerelease tag ${tag}`,
  );
  let object = readRemoteGitObject(reference, `remote tag ${tag}`);
  if (object.type !== "tag") {
    fail(`Remote source prerelease tag ${tag} must be an annotated Git tag.`);
  }
  const visited = new Set();
  for (let depth = 0; depth < 8; depth += 1) {
    if (object.type === "commit") {
      return object.sha;
    }
    if (object.type !== "tag" || visited.has(object.sha)) {
      break;
    }
    visited.add(object.sha);
    const annotated = readRequiredGithubJson(
      `${repositoryApiRoot}/git/tags/${encodeURIComponent(object.sha)}`,
      `annotated source prerelease tag ${object.sha}`,
    );
    object = readRemoteGitObject(annotated, `annotated tag ${object.sha}`);
  }
  fail(`Remote source prerelease tag ${tag} is not one unambiguous commit.`);
}

function readRemoteGitObject(payload, label) {
  const object = isRecord(payload) ? payload.object : null;
  if (
    !isRecord(object) ||
    !["commit", "tag"].includes(object.type) ||
    typeof object.sha !== "string" ||
    !/^[0-9a-f]+$/u.test(object.sha)
  ) {
    fail(`${label} returned an invalid Git object.`);
  }
  return { sha: object.sha, type: object.type };
}

function readRequiredGithubJson(endpoint, label) {
  const result = runGhRaw(["api", "--method", "GET", endpoint]);
  if (result.status !== 0) {
    throw new Error(`Unable to query ${label}: ${commandDiagnostic(result)}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Unable to parse ${label} as JSON.`);
  }
}

function runGit(args, { message }) {
  const result = spawnSync(gitCommand, [...gitCommandPrefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(`${message}\n${commandDiagnostic(result)}`);
  }
  return result.stdout.trim();
}

function runGh(args, { message }) {
  const result = runGhRaw(args);
  if (result.status !== 0) {
    fail(`${message}\n${commandDiagnostic(result)}`);
  }
  return result.stdout.trim();
}

function runGhRaw(args, input = undefined) {
  return spawnSync(ghCommand, [...ghCommandPrefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}

function commandDiagnostic(result) {
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (diagnostic !== "") {
    return diagnostic;
  }
  if (result.error instanceof Error) {
    return result.error.message;
  }
  return `command exited with status ${String(result.status)}`;
}

function isNotFound(result) {
  return (
    result.status !== 0 &&
    /(?:HTTP\s*404|not[_ -]?found|could not find)/iu.test(
      commandDiagnostic(result),
    )
  );
}

function isCanonicalOrigin(value) {
  const normalized = value
    .trim()
    .replace(/^ssh:\/\/git@github\.com\//u, "")
    .replace(/^git@github\.com:/u, "")
    .replace(/^https:\/\/github\.com\//u, "")
    .replace(/\.git$/u, "")
    .replace(/\/$/u, "");
  return normalized === repository;
}

function normalizeReleaseBody(value) {
  return value
    .replace(/^\uFEFF/u, "")
    .replaceAll("\r\n", "\n")
    .trimEnd();
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    fail(`${label} contains invalid JSON.`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toRootPath(path) {
  const candidate = relative(root, path).replaceAll("\\", "/");
  return candidate === "" ||
    candidate.startsWith("../") ||
    isAbsolute(candidate)
    ? basename(path)
    : candidate;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArgs(args) {
  let confirmBillingReady = false;
  let dryRun = false;
  let root = scriptRoot;
  let verifyPublished = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--confirm-billing-ready") {
      confirmBillingReady = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--verify-published") {
      verifyPublished = true;
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
    fail(`Unknown argument: ${arg}`);
  }
  if (dryRun && verifyPublished) {
    fail("--dry-run and --verify-published cannot be combined.");
  }
  return { confirmBillingReady, dryRun, root, verifyPublished };
}

function parseCommandPrefixArgs(envName) {
  const raw = process.env[envName];
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string")
    ) {
      return parsed;
    }
  } catch {
    // Fall through to the explicit failure below.
  }
  fail(`${envName} must be a JSON string array when set.`);
}

function fail(message) {
  if (activeReleaseId !== null) {
    throw new Error(message);
  }
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
