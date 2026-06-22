import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

const scriptRoot = resolve(import.meta.dirname, "..");
const { dryRun, notesFile, root } = parseArgs(process.argv.slice(2));
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");
const ghCommand = process.env.ATLASTERM_RELEASE_GH_COMMAND ?? "gh";
const ghCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GH_ARGS");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const tag = `v${packageJson.version}`;
const releaseTitle = `JoeSSH ${packageJson.version}`;
const releaseNotesPath = resolve(root, notesFile ?? `docs/release-notes/${packageJson.version}.md`);
const requiredChecksumManifests = [
  "reports/release/SBOM-SHA256SUMS.txt",
  "reports/release/desktop/SHA256SUMS.txt",
  "reports/release/desktop/release-evidence-SHA256SUMS.txt",
  "reports/release/release-provenance-SHA256SUMS.txt",
  "reports/release/web/SHA256SUMS.txt",
  "reports/release/sync/SHA256SUMS.txt",
  "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt",
];
const artifacts = collectReleaseArtifacts();
const checksumManifests = [...new Set([...requiredChecksumManifests, ...collectChecksumManifests()])];
const localOnlyReleaseFiles = [
  "reports/release/desktop/formal-evidence-unblock-report.json",
  "reports/release/desktop/secret-input-template.env",
];

if (!dryRun) {
  assertReleaseMachineReady();
}

validateReleaseNotes();

if (artifacts.length === 0) {
  console.error("No release artifacts found. Build desktop/web/sync artifacts and checksums before drafting a release.");
  process.exit(1);
}

const localOnlyArtifacts = artifacts.filter((artifact) => localOnlyReleaseFiles.includes(artifact));
if (localOnlyArtifacts.length > 0) {
  console.error(
    `Local-only handoff file(s) must not be uploaded from reports/release:\n- ${localOnlyArtifacts.join(
      "\n- ",
    )}\nMove diagnostics and signing-secret templates under reports/handoff before drafting a release.`,
  );
  process.exit(1);
}

const missingChecksumManifests = requiredChecksumManifests.filter((manifest) => !existsSync(resolve(root, manifest)));
if (missingChecksumManifests.length > 0) {
  console.error(
    `Missing required SHA256 checksum manifest(s):\n- ${missingChecksumManifests.join("\n- ")}\nGenerate desktop, web, and sync checksums before drafting a release.`,
  );
  process.exit(1);
}

const expectedWebArtifact = `reports/release/web/joessh-web-admin-${packageJson.version}.zip`;
const webManifestArtifacts = readChecksumManifestArtifactPaths(resolve(root, "reports", "release", "web", "SHA256SUMS.txt"));
if (!webManifestArtifacts.includes(expectedWebArtifact)) {
  console.error(
    `Missing Web Admin release package in reports/release/web/SHA256SUMS.txt: ${expectedWebArtifact}\nRun npm run release:web before drafting a release.`,
  );
  process.exit(1);
}

const desktopEvidenceVerification = spawnSync(
  process.execPath,
  [resolve(scriptRoot, "scripts", "verify-desktop-release-evidence.mjs"), "--root", root, "--require-source"],
  {
    cwd: scriptRoot,
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (desktopEvidenceVerification.status !== 0) {
  process.exit(desktopEvidenceVerification.status ?? 1);
}

const checksumVerification = spawnSync(
  process.execPath,
  [resolve(scriptRoot, "scripts", "verify-artifact-checksums.mjs"), "--root", root, ...checksumManifests],
  {
    cwd: scriptRoot,
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (checksumVerification.status !== 0) {
  process.exit(checksumVerification.status ?? 1);
}

assertReleaseArtifactsChecksumCovered();

const sbomVerification = spawnSync(
  process.execPath,
  [resolve(scriptRoot, "scripts", "verify-release-sbom.mjs"), "--root", root],
  {
    cwd: scriptRoot,
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (sbomVerification.status !== 0) {
  process.exit(sbomVerification.status ?? 1);
}

const provenanceVerificationArgs = [resolve(scriptRoot, "scripts", "verify-release-provenance.mjs"), "--root", root];
if (dryRun) {
  provenanceVerificationArgs.push("--skip-current-git-check");
}
const provenanceVerification = spawnSync(process.execPath, provenanceVerificationArgs, {
  cwd: scriptRoot,
  encoding: "utf8",
  stdio: "inherit",
});
if (provenanceVerification.status !== 0) {
  process.exit(provenanceVerification.status ?? 1);
}

const releaseArgs = ["release", "create", tag, "--draft", "--title", releaseTitle, "--notes-file", releaseNotesPath, ...artifacts];
if (dryRun) {
  console.log(`Release draft dry run passed for ${tag} with ${artifacts.length} artifact(s).`);
  console.log(`gh ${releaseArgs.map(shellQuote).join(" ")}`);
  process.exit(0);
}

const result = spawnSync(ghCommand, [...ghCommandPrefixArgs, ...releaseArgs], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});

process.exit(result.status ?? 1);

function collectReleaseArtifacts() {
  return collectFiles(resolve(root, "reports", "release"))
    .filter((file) => !file.endsWith(".map"))
    .map((file) => toReleasePath(file));
}

function collectChecksumManifests() {
  return collectFiles(resolve(root, "reports", "release"))
    .filter((file) => file.endsWith("SHA256SUMS.txt"))
    .map((file) => toReleasePath(file));
}

function readChecksumManifestArtifactPaths(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.match(/^[a-fA-F0-9]{64}\s\s(.+)$/)?.[1]?.replaceAll("\\", "/"))
    .filter((artifactPath) => typeof artifactPath === "string");
}

function assertReleaseArtifactsChecksumCovered() {
  const coveredArtifacts = new Set(
    checksumManifests.flatMap((manifest) => readChecksumManifestArtifactPaths(resolve(root, manifest))),
  );
  const missingCoverage = artifacts.filter(
    (artifact) => !artifact.endsWith("SHA256SUMS.txt") && !coveredArtifacts.has(artifact),
  );

  if (missingCoverage.length === 0) {
    return;
  }

  fail(
    `Release artifacts missing SHA256 coverage:\n- ${missingCoverage.join(
      "\n- ",
    )}\nEvery uploaded file under reports/release must be listed in a SHA256SUMS.txt manifest before drafting a release.`,
  );
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

function toReleasePath(file) {
  return relative(root, file).replace(/\\/g, "/");
}

function parseArgs(args) {
  let dryRun = false;
  let notesFile = null;
  let root = scriptRoot;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--desktop") {
      continue;
    }
    if (arg === "--notes-file") {
      const value = args[index + 1];
      if (!value) {
        fail("--notes-file requires a path.");
      }
      notesFile = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--notes-file=")) {
      notesFile = arg.slice("--notes-file=".length);
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

  return { dryRun, notesFile, root };
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:@-]+$/.test(value) ? value : JSON.stringify(value);
}

function validateReleaseNotes() {
  if (!existsSync(releaseNotesPath) || !statSync(releaseNotesPath).isFile()) {
    fail(`Release notes file is required: ${toReleasePath(releaseNotesPath)}`);
  }

  const notes = readFileSync(releaseNotesPath, "utf8").trim();
  if (notes.length === 0) {
    fail(`Release notes file must not be empty: ${toReleasePath(releaseNotesPath)}`);
  }
  if (!notes.includes(packageJson.version)) {
    fail(`Release notes file must mention ${packageJson.version}: ${toReleasePath(releaseNotesPath)}`);
  }
}

function assertReleaseMachineReady() {
  const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"], {
    message: "Git checkout metadata is required to draft a release.",
  });
  if (insideWorkTree !== "true") {
    fail("Git checkout metadata is required to draft a release.");
  }

  const status = runGit(
    ["status", "--porcelain=v1", "--untracked-files=all", "--", ".", ":(exclude)reports/release"],
    {
      message: "Git working tree outside reports/release must be clean before drafting a public release.",
    },
  );
  if (status.trim() !== "") {
    fail(`Git working tree outside reports/release must be clean before drafting a public release:\n${status}`);
  }

  const head = runGit(["rev-parse", "HEAD"], {
    message: "Unable to resolve the current Git commit before drafting a release.",
  });
  const tagCommit = runGit(["rev-parse", "--verify", `${tag}^{}`], {
    message: `Release tag ${tag} must exist before drafting a public release.`,
  });
  if (head !== tagCommit) {
    fail(`Release tag ${tag} must point at HEAD before drafting a public release.`);
  }

  runGh(["--version"], {
    message: "GitHub CLI is required to draft a release.",
  });
  runGh(["auth", "status"], {
    message: "GitHub CLI must be authenticated before drafting a release.",
  });
  assertGithubReleaseDoesNotExist();
}

function assertGithubReleaseDoesNotExist() {
  const result = spawnSync(ghCommand, [...ghCommandPrefixArgs, "release", "view", tag, "--json", "url"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) {
    fail(`GitHub Release ${tag} already exists; refusing to create a duplicate draft.`);
  }

  const diagnostic = `${result.stdout}\n${result.stderr}`;
  if (!/not found|not_found|could not find|HTTP 404/i.test(diagnostic)) {
    fail(`Unable to confirm GitHub Release ${tag} does not already exist:\n${diagnostic.trim()}`);
  }
}

function runGit(args, options) {
  return runCommand(gitCommand, [...gitCommandPrefixArgs, ...args], options);
}

function runGh(args, options) {
  return runCommand(ghCommand, [...ghCommandPrefixArgs, ...args], options);
}

function runCommand(command, args, { message }) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const diagnostic = `${result.stdout}\n${result.stderr}`.trim();
    fail(diagnostic ? `${message}\n${diagnostic}` : message);
  }
  return result.stdout.trim();
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
