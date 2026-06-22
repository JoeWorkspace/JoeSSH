import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const { checksumPath, provenancePath, root, skipCurrentGitCheck } = parseArgs(
  process.argv.slice(2),
);
const packageJson = readJson("package.json");
const releaseTag = `v${packageJson.version}`;
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_RELEASE_GIT_ARGS",
);
const npmCommand =
  process.env.ATLASTERM_RELEASE_NPM_COMMAND ?? defaultNpmCommand();
const npmCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_RELEASE_NPM_ARGS",
);
const cargoCommand = process.env.ATLASTERM_RELEASE_CARGO_COMMAND ?? "cargo";
const cargoCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_RELEASE_CARGO_ARGS",
);
const rustcCommand = process.env.ATLASTERM_RELEASE_RUSTC_COMMAND ?? "rustc";
const rustcCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_RELEASE_RUSTC_ARGS",
);
const requiredLockfiles = [
  "package-lock.json",
  "Cargo.lock",
  "apps/desktop/src-tauri/Cargo.lock",
];
const requiredChecksumManifests = [
  "reports/release/SBOM-SHA256SUMS.txt",
  "reports/release/desktop/SHA256SUMS.txt",
  "reports/release/desktop/release-evidence-SHA256SUMS.txt",
  "reports/release/sync/SHA256SUMS.txt",
  "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt",
  "reports/release/web/SHA256SUMS.txt",
];
const errors = [];

const provenance = readProvenance();
validateTopLevel();
validateCurrentGit();
validateToolchain();
validateLockfiles();
validateChecksumManifests();
validateProvenanceChecksum();

if (errors.length > 0) {
  fail(`Release provenance verification failed:\n- ${errors.join("\n- ")}`);
}

console.log(`Release provenance verified for ${releaseTag}.`);

function readProvenance() {
  if (!existsSync(provenancePath)) {
    fail(`Missing release provenance: ${toReleasePath(provenancePath)}`);
  }
  if (!statSync(provenancePath).isFile()) {
    fail(`Release provenance is not a file: ${toReleasePath(provenancePath)}`);
  }

  try {
    return JSON.parse(readFileSync(provenancePath, "utf8"));
  } catch (error) {
    fail(
      `Release provenance is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function validateTopLevel() {
  if (
    provenance === null ||
    typeof provenance !== "object" ||
    Array.isArray(provenance)
  ) {
    errors.push("release provenance must be a JSON object");
    return;
  }
  if (provenance.provenanceVersion !== 1) {
    errors.push("provenanceVersion must be 1");
  }
  if (provenance.product !== "JoeSSH") {
    errors.push("product must be JoeSSH");
  }
  if (provenance.version !== packageJson.version) {
    errors.push(
      `version must match package.json version ${packageJson.version}`,
    );
  }
  if (provenance.releaseTag !== releaseTag) {
    errors.push(`releaseTag must be ${releaseTag}`);
  }
  if (
    typeof provenance.generatedAt !== "string" ||
    Number.isNaN(Date.parse(provenance.generatedAt))
  ) {
    errors.push("generatedAt must be an ISO timestamp");
  }
  if (
    provenance.source === null ||
    typeof provenance.source !== "object" ||
    Array.isArray(provenance.source)
  ) {
    errors.push("source must be a JSON object");
  }
  if (
    !Array.isArray(provenance.lockfiles) ||
    provenance.lockfiles.length === 0
  ) {
    errors.push("lockfiles must be a non-empty array");
  }
  if (
    !Array.isArray(provenance.checksumManifests) ||
    provenance.checksumManifests.length === 0
  ) {
    errors.push("checksumManifests must be a non-empty array");
  }
  validateReleaseNotes();
  validateVerifiers();
}

function validateCurrentGit() {
  const source = provenance.source;
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return;
  }

  if (!isShaLike(source.gitCommit)) {
    errors.push("source.gitCommit must be a Git commit hash");
  }
  if (!isShaLike(source.releaseTagCommit)) {
    errors.push("source.releaseTagCommit must be a Git commit hash");
  }
  if (
    typeof source.repository !== "string" ||
    source.repository.trim() === ""
  ) {
    errors.push("source.repository must record the Git remote origin URL");
  }
  if (source.gitFsckStrict !== true) {
    errors.push("source.gitFsckStrict must be true");
  }
  if (source.cleanTreeExcluding !== "reports/release") {
    errors.push("source.cleanTreeExcluding must be reports/release");
  }
  if (skipCurrentGitCheck) {
    return;
  }

  const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree.status !== 0 || insideWorkTree.stdout.trim() !== "true") {
    errors.push(
      "Git checkout metadata is required to verify release provenance",
    );
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
    errors.push(
      "Git working tree status is required to verify release provenance",
    );
    return;
  }
  if (status.stdout.trim() !== "") {
    errors.push(
      `Git working tree outside reports/release must be clean to verify release provenance: ${status.stdout.trim()}`,
    );
  }

  const head = runGit(["rev-parse", "HEAD"]);
  if (head.status !== 0) {
    errors.push("Unable to resolve HEAD while verifying release provenance");
    return;
  }
  const tagCommit = runGit(["rev-parse", "--verify", `${releaseTag}^{}`]);
  if (tagCommit.status !== 0) {
    errors.push(
      `Release tag ${releaseTag} must exist to verify release provenance`,
    );
    return;
  }

  if (head.stdout.trim() !== source.gitCommit) {
    errors.push("source.gitCommit does not match current HEAD");
  }
  if (tagCommit.stdout.trim() !== source.releaseTagCommit) {
    errors.push(`source.releaseTagCommit does not match ${releaseTag}`);
  }
  if (head.stdout.trim() !== tagCommit.stdout.trim()) {
    errors.push(
      `Release tag ${releaseTag} must point at HEAD to verify release provenance`,
    );
  }

  const fsck = runGit(["fsck", "--strict"]);
  if (fsck.status !== 0) {
    errors.push("git fsck --strict must pass to verify release provenance");
  }
  const repository = runGit(["remote", "get-url", "origin"]);
  if (repository.status !== 0) {
    errors.push("Git remote origin is required to verify release provenance");
  } else if (repository.stdout.trim() !== source.repository) {
    errors.push("source.repository does not match current Git remote origin");
  }
}

function validateReleaseNotes() {
  const releaseNotes = provenance.releaseNotes;
  if (!isRecord(releaseNotes)) {
    errors.push("releaseNotes must be a JSON object");
    return;
  }
  if (!isSafeRelativePath(releaseNotes.path)) {
    errors.push("releaseNotes.path must be a safe relative path");
    return;
  }
  if (!isSha256(releaseNotes.sha256)) {
    errors.push("releaseNotes.sha256 must record a lowercase SHA256");
    return;
  }

  const notesPath = resolve(root, releaseNotes.path);
  if (!existsSync(notesPath) || !statSync(notesPath).isFile()) {
    errors.push(`release notes file is missing: ${releaseNotes.path}`);
    return;
  }
  if (sha256File(notesPath) !== releaseNotes.sha256) {
    errors.push(`release notes hash mismatch for ${releaseNotes.path}`);
  }
  if (!readFileSync(notesPath, "utf8").includes(packageJson.version)) {
    errors.push(`release notes file must mention ${packageJson.version}`);
  }
}

function validateVerifiers() {
  const expectedVerifiers = [
    "verify-artifact-checksums.mjs --all-release",
    "verify-web-release-package.mjs",
    "verify-sync-release-evidence.mjs",
    "verify-desktop-release-evidence.mjs",
    "verify-release-sbom.mjs",
    "verify-release-provenance.mjs",
  ];

  if (!Array.isArray(provenance.verifiers)) {
    errors.push("verifiers must be an array");
    return;
  }
  for (const verifier of expectedVerifiers) {
    if (!provenance.verifiers.includes(verifier)) {
      errors.push(`release provenance is missing verifier ${verifier}`);
    }
  }
}

function validateToolchain() {
  const toolchain = provenance.toolchain;
  if (
    toolchain === null ||
    typeof toolchain !== "object" ||
    Array.isArray(toolchain)
  ) {
    errors.push("toolchain must be a JSON object");
    return;
  }

  const expected = {
    node: process.version,
    npm: runTool(npmCommand, npmCommandPrefixArgs, ["--version"]),
    cargo: runTool(cargoCommand, cargoCommandPrefixArgs, ["--version"]),
    rustc: runTool(rustcCommand, rustcCommandPrefixArgs, ["--version"]),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (toolchain[key] !== value) {
      errors.push(
        `toolchain.${key} must match the current release machine ${key} version`,
      );
    }
  }

  const expectedTauri = collectTauriVersions();
  if (
    toolchain.tauri === null ||
    typeof toolchain.tauri !== "object" ||
    Array.isArray(toolchain.tauri)
  ) {
    errors.push("toolchain.tauri must be a JSON object");
    return;
  }
  for (const [key, value] of Object.entries(expectedTauri)) {
    if (toolchain.tauri[key] !== value) {
      errors.push(
        `toolchain.tauri.${key} must match the current lockfile version`,
      );
    }
  }
}

function validateLockfiles() {
  if (!Array.isArray(provenance.lockfiles)) {
    return;
  }

  const entries = new Map();
  for (const entry of provenance.lockfiles) {
    if (!isRecord(entry)) {
      errors.push("lockfiles entries must be JSON objects");
      continue;
    }
    if (!isSafeRelativePath(entry.path)) {
      errors.push("lockfiles entries must use safe relative paths");
      continue;
    }
    if (!isSha256(entry.sha256)) {
      errors.push(`lockfile ${entry.path} must record a lowercase SHA256`);
      continue;
    }
    entries.set(entry.path, entry);
  }

  for (const path of requiredLockfiles) {
    const entry = entries.get(path);
    if (!entry) {
      errors.push(`release provenance is missing lockfile ${path}`);
      continue;
    }
    const fullPath = resolve(root, path);
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      errors.push(`lockfile is missing: ${path}`);
      continue;
    }
    const actualHash = sha256File(fullPath);
    if (actualHash !== entry.sha256) {
      errors.push(`lockfile hash mismatch for ${path}`);
    }
  }
}

function validateChecksumManifests() {
  if (!Array.isArray(provenance.checksumManifests)) {
    return;
  }

  const stagedManifestPaths = collectReleaseChecksumManifests();
  const missingStagedManifests = requiredChecksumManifests.filter(
    (path) => !stagedManifestPaths.includes(path),
  );
  for (const path of missingStagedManifests) {
    errors.push(
      `required Public Beta checksum manifest is missing from reports/release: ${path}`,
    );
  }
  const unexpectedStagedManifests = stagedManifestPaths.filter(
    (path) => !requiredChecksumManifests.includes(path),
  );
  for (const path of unexpectedStagedManifests) {
    errors.push(`unexpected Public Beta checksum manifest is staged: ${path}`);
  }

  const expectedManifestPaths = requiredChecksumManifests;
  const manifestEntries = new Map();
  for (const manifest of provenance.checksumManifests) {
    if (!isRecord(manifest)) {
      errors.push("checksumManifests entries must be JSON objects");
      continue;
    }
    if (
      !isSafeRelativePath(manifest.path) ||
      !manifest.path.endsWith("SHA256SUMS.txt")
    ) {
      errors.push(
        "checksumManifests entries must use safe SHA256SUMS.txt paths",
      );
      continue;
    }
    if (!isSha256(manifest.sha256)) {
      errors.push(
        `checksum manifest ${manifest.path} must record a lowercase SHA256`,
      );
      continue;
    }
    if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
      errors.push(`checksum manifest ${manifest.path} must include entries`);
      continue;
    }
    manifestEntries.set(manifest.path, manifest);
  }

  for (const path of expectedManifestPaths) {
    if (!manifestEntries.has(path)) {
      errors.push(`release provenance is missing checksum manifest ${path}`);
    }
  }
  for (const path of manifestEntries.keys()) {
    if (!expectedManifestPaths.includes(path)) {
      errors.push(
        `release provenance references stale checksum manifest ${path}`,
      );
    }
  }

  for (const manifest of manifestEntries.values()) {
    validateChecksumManifest(manifest);
  }
}

function validateChecksumManifest(manifest) {
  const manifestPath = resolve(root, manifest.path);
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    errors.push(`checksum manifest is missing: ${manifest.path}`);
    return;
  }
  if (sha256File(manifestPath) !== manifest.sha256) {
    errors.push(`checksum manifest hash mismatch for ${manifest.path}`);
  }

  const actualEntries = parseChecksumManifest(manifestPath);
  const expectedEntries = new Map();
  for (const entry of manifest.entries) {
    if (!isRecord(entry)) {
      errors.push(
        `checksum manifest ${manifest.path} entries must be JSON objects`,
      );
      continue;
    }
    if (!isSafeRelativePath(entry.path)) {
      errors.push(
        `checksum manifest ${manifest.path} has an unsafe artifact path`,
      );
      continue;
    }
    if (!isSha256(entry.sha256)) {
      errors.push(
        `checksum manifest ${manifest.path} entry ${entry.path} must record a lowercase SHA256`,
      );
      continue;
    }
    expectedEntries.set(entry.path, entry.sha256);
  }

  for (const actualEntry of actualEntries) {
    if (!expectedEntries.has(actualEntry.path)) {
      errors.push(
        `release provenance is missing artifact ${actualEntry.path} from ${manifest.path}`,
      );
      continue;
    }
    if (expectedEntries.get(actualEntry.path) !== actualEntry.sha256) {
      errors.push(`release provenance hash mismatch for ${actualEntry.path}`);
    }
    const artifactPath = resolve(root, actualEntry.path);
    if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
      errors.push(
        `checksum manifest ${manifest.path} references missing artifact ${actualEntry.path}`,
      );
      continue;
    }
    if (sha256File(artifactPath) !== actualEntry.sha256) {
      errors.push(`artifact hash mismatch for ${actualEntry.path}`);
    }
  }
  for (const expectedPath of expectedEntries.keys()) {
    if (!actualEntries.some((entry) => entry.path === expectedPath)) {
      errors.push(
        `release provenance references stale artifact ${expectedPath} from ${manifest.path}`,
      );
    }
  }
}

function validateProvenanceChecksum() {
  if (!existsSync(checksumPath)) {
    errors.push(
      `missing provenance checksum manifest ${toReleasePath(checksumPath)}`,
    );
    return;
  }
  if (!statSync(checksumPath).isFile()) {
    errors.push(
      `provenance checksum manifest is not a file ${toReleasePath(checksumPath)}`,
    );
    return;
  }

  const entries = parseChecksumManifest(checksumPath);
  const provenanceReleasePath = toReleasePath(provenancePath);
  const entry = entries.find(
    (candidate) => candidate.path === provenanceReleasePath,
  );
  if (!entry) {
    errors.push(
      `provenance checksum manifest does not list ${provenanceReleasePath}`,
    );
    return;
  }
  if (entry.sha256 !== sha256File(provenancePath)) {
    errors.push(
      `provenance checksum manifest hash mismatch for ${provenanceReleasePath}`,
    );
  }
}

function collectTauriVersions() {
  const packageLock = readJson("package-lock.json");
  const desktopCargoLock = readText("apps/desktop/src-tauri/Cargo.lock");
  return {
    npmApi: getPackageLockVersion(packageLock, "node_modules/@tauri-apps/api"),
    npmCli: getPackageLockVersion(packageLock, "node_modules/@tauri-apps/cli"),
    rustCrate: getCargoLockPackageVersion(desktopCargoLock, "tauri"),
  };
}

function collectReleaseChecksumManifests() {
  return collectFiles(resolve(root, "reports", "release"))
    .filter((path) => path.endsWith("SHA256SUMS.txt"))
    .map((path) => toReleasePath(path))
    .filter((path) => path !== toReleasePath(checksumPath))
    .sort();
}

function parseChecksumManifest(manifestPath) {
  const entries = [];
  const displayManifestPath = toReleasePath(manifestPath);
  readFileSync(manifestPath, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (line.trim() === "" || line.trimStart().startsWith("#")) {
        return;
      }

      const match = line.match(/^([a-fA-F0-9]{64})\s\s(.+)$/);
      if (!match) {
        errors.push(
          `${displayManifestPath}:${index + 1} is not '<sha256>  <relative-path>'`,
        );
        return;
      }

      const artifactPath = match[2].replaceAll("\\", "/");
      if (!isSafeRelativePath(artifactPath)) {
        errors.push(
          `${displayManifestPath}:${index + 1} uses an unsafe artifact path`,
        );
        return;
      }

      entries.push({
        path: toReleasePath(resolve(root, artifactPath)),
        sha256: match[1].toLowerCase(),
      });
    });
  return entries;
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

function getPackageLockVersion(packageLock, packagePath) {
  const version = packageLock?.packages?.[packagePath]?.version;
  if (typeof version !== "string" || version.trim() === "") {
    errors.push(`package-lock.json is missing ${packagePath} version`);
    return "";
  }
  return version;
}

function getCargoLockPackageVersion(lockText, packageName) {
  const packagePattern = new RegExp(
    String.raw`\[\[package\]\]\s+name = "${escapeRegExp(packageName)}"\s+version = "([^"]+)"`,
    "m",
  );
  const match = lockText.match(packagePattern);
  if (!match) {
    errors.push(
      `apps/desktop/src-tauri/Cargo.lock is missing ${packageName} version`,
    );
    return "";
  }
  return match[1];
}

function runGit(args) {
  return spawnSync(gitCommand, [...gitCommandPrefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runTool(command, prefixArgs, args) {
  const result = spawnSync(command, [...prefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    shell: shouldRunWithShell(command),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return "";
  }
  return result.stdout.trim();
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function toReleasePath(path) {
  return relative(root, resolve(path)).replace(/\\/g, "/");
}

function isSafeRelativePath(path) {
  if (typeof path !== "string" || path.trim() === "" || isAbsolute(path)) {
    return false;
  }
  const fullPath = resolve(root, path);
  const relativePath = relative(root, fullPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isShaLike(value) {
  return typeof value === "string" && /^[a-f0-9]{6,64}$/.test(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(args) {
  let root = defaultRoot;
  let provenancePath = null;
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
    if (arg === "--provenance") {
      const value = args[index + 1];
      if (!value) {
        fail("--provenance requires a path.");
      }
      provenancePath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--provenance=")) {
      provenancePath = arg.slice("--provenance=".length);
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
    checksumPath: resolve(
      root,
      checksumPath ?? "reports/release/release-provenance-SHA256SUMS.txt",
    ),
    provenancePath: resolve(
      root,
      provenancePath ?? "reports/release/release-provenance.json",
    ),
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
    if (
      Array.isArray(value) &&
      value.every((entry) => typeof entry === "string")
    ) {
      return value;
    }
  } catch {
    // Fall through to the explicit failure below.
  }

  fail(`${envName} must be a JSON string array when set.`);
}

function defaultNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function shouldRunWithShell(command) {
  return (
    process.platform === "win32" && /(^|[\\/])npm(?:\.cmd)?$/i.test(command)
  );
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
