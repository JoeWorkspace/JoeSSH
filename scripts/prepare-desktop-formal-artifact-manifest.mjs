import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

const scriptName = "prepare-desktop-formal-artifact-manifest.mjs";
const defaultRoot = resolve(import.meta.dirname, "..");
const defaultRequestPath = "reports/handoff/desktop/formal-artifact-request.json";
const defaultRequestChecksumFileName = "formal-artifact-request-SHA256SUMS.txt";
const defaultOutputFileName = "desktop-formal-artifact-manifest.json";

const options = parseArgs(process.argv.slice(2));
const packageJson = readJsonFile(resolve(options.root, "package.json"), "Root package.json");
const releaseVersion = packageJson.version;
const releaseTag = `v${releaseVersion}`;
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");

if (!existsSync(options.inputDir) || !statSync(options.inputDir).isDirectory()) {
  fail(`--input-dir must point to a directory: ${displayPath(options.inputDir)}`);
}
validateInputDirectoryLocation(options.inputDir);
if (!isInsidePath(options.outputPath, options.inputDir)) {
  fail("--output must stay inside --input-dir.");
}
if (existsSync(options.outputPath) && !options.force) {
  fail(`${defaultOutputFileName} already exists. Pass --force to overwrite it.`);
}
if (!isInsidePath(options.requestPath, options.root) || !isInsidePath(options.requestChecksumPath, options.root)) {
  fail("Desktop formal artifact request paths must stay inside the release root.");
}

const gitSource = verifyReleaseGitCheckoutForManifest();
const request = readCurrentFormalArtifactRequest(gitSource);
const inputFiles = collectFiles(options.inputDir)
  .filter((file) => resolve(file) !== options.outputPath)
  .sort((left, right) => left.localeCompare(right));
const sourceArtifacts = inputFiles
  .map((path) => ({ classification: classifyArtifact(path), path }))
  .filter((artifact) => artifact.classification !== null);

if (sourceArtifacts.length === 0) {
  fail(`No Desktop release artifacts found in ${displayPath(options.inputDir)}.`);
}

const staleArtifacts = sourceArtifacts.filter(
  (artifact) => !basename(artifact.path).includes(releaseVersion),
);
if (staleArtifacts.length > 0) {
  fail(
    `Desktop formal artifact input contains file(s) that do not include ${releaseVersion}: ${staleArtifacts
      .map((artifact) => displayPath(artifact.path))
      .join(", ")}`,
  );
}

validateDuplicateBasenames(sourceArtifacts);
validateRequiredPlatforms(sourceArtifacts, options.requiredPlatforms);

const manifest = {
  artifacts: sourceArtifacts.map((artifact) => ({
    fileName: basename(artifact.path),
    packageType: artifact.classification.packageType ?? null,
    platform: artifact.classification.platform,
    sha256: sha256File(artifact.path),
    sizeBytes: statSync(artifact.path).size,
  })),
  kind: "joessh-desktop-formal-artifact-manifest",
  manifestVersion: 1,
  product: "JoeSSH",
  releaseTag,
  requestId: request.requestId,
  source: {
    gitCommit: gitSource.head,
    gitFsckStrict: true,
    releaseTagCommit: gitSource.tagCommit,
    repository: gitSource.repository,
  },
  sourceAuthority: options.sourceAuthority,
  version: releaseVersion,
};

mkdirSync(dirname(options.outputPath), { recursive: true });
writeFileSync(options.outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `Wrote Desktop formal artifact manifest for ${manifest.artifacts.length} artifact(s) to ${displayPath(
    options.outputPath,
  )}`,
);

function collectFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) {
    return [path];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(child);
    }
    return entry.isFile() ? [child] : [];
  });
}

function classifyArtifact(path) {
  const lower = path.toLowerCase();
  if (/\.(exe|msi|msix)$/.test(lower)) {
    return { platform: "windows" };
  }
  if (lower.endsWith(".dmg") || lower.endsWith(".pkg") || lower.endsWith(".app.tar.gz")) {
    return { platform: "macos" };
  }
  if (lower.endsWith(".appimage")) {
    return { packageType: "AppImage", platform: "linux" };
  }
  if (lower.endsWith(".deb")) {
    return { packageType: "deb", platform: "linux" };
  }
  if (lower.endsWith(".rpm")) {
    return { packageType: "rpm", platform: "linux" };
  }
  return null;
}

function validateDuplicateBasenames(artifacts) {
  const seen = new Set();
  for (const artifact of artifacts) {
    const name = basename(artifact.path);
    if (seen.has(name)) {
      fail(`Desktop formal artifact input contains duplicate file name: ${name}`);
    }
    seen.add(name);
  }
}

function validateRequiredPlatforms(artifacts, requiredPlatforms) {
  const platforms = new Set(artifacts.map((artifact) => artifact.classification.platform));
  const missingPlatforms = requiredPlatforms.filter((platform) => !platforms.has(platform));
  if (missingPlatforms.length > 0) {
    fail(`Desktop formal artifact input is missing required platform(s): ${missingPlatforms.join(", ")}`);
  }
}

function readCurrentFormalArtifactRequest(gitSource) {
  if (!existsSync(options.requestPath) || !statSync(options.requestPath).isFile()) {
    fail(
      "Current Desktop formal artifact request is required before writing a formal artifact manifest. Run npm run release:desktop:formal-artifacts:request -- --source-authority local.",
    );
  }
  if (!existsSync(options.requestChecksumPath) || !statSync(options.requestChecksumPath).isFile()) {
    fail("Current Desktop formal artifact request checksum manifest is required before writing a formal artifact manifest.");
  }

  const expectedRequestPath = toReleasePath(options.requestPath);
  const requestChecksumLines = readFileSync(options.requestChecksumPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const requestEntry = requestChecksumLines.find((line) => line.endsWith(`  ${expectedRequestPath}`));
  if (!requestEntry) {
    fail(`Current Desktop formal artifact request checksum manifest must list ${expectedRequestPath}.`);
  }
  const [requestHash] = requestEntry.split(/\s+/);
  if (requestHash !== sha256File(options.requestPath)) {
    fail("Current Desktop formal artifact request checksum does not match the request JSON.");
  }

  const request = readJsonFile(options.requestPath, "Current Desktop formal artifact request");
  const blockers = [];
  if (request.kind !== "joessh-desktop-formal-artifact-request") {
    blockers.push("request.kind must be joessh-desktop-formal-artifact-request");
  }
  if (request.product !== "JoeSSH") {
    blockers.push("request.product must be JoeSSH");
  }
  if (request.version !== releaseVersion) {
    blockers.push(`request.version must be ${releaseVersion}`);
  }
  if (request.releaseTag !== releaseTag) {
    blockers.push(`request.releaseTag must be ${releaseTag}`);
  }
  if (request.sourceAuthority !== options.sourceAuthority) {
    blockers.push(`request.sourceAuthority must be ${options.sourceAuthority}`);
  }
  if (request.source?.repository !== gitSource.repository) {
    blockers.push("request.source.repository must match the current release checkout origin");
  }
  if (request.source?.gitCommit !== gitSource.head) {
    blockers.push("request.source.gitCommit must match current HEAD");
  }
  if (request.source?.releaseTagCommit !== gitSource.tagCommit) {
    blockers.push(`request.source.releaseTagCommit must match ${releaseTag}`);
  }
  if (request.source?.gitFsckStrict !== true) {
    blockers.push("request.source.gitFsckStrict must be true");
  }
  const requestedPlatforms = Array.isArray(request.requiredPlatforms) ? request.requiredPlatforms : [];
  const missingRequestedPlatforms = options.requiredPlatforms.filter(
    (platform) => !requestedPlatforms.includes(platform),
  );
  if (missingRequestedPlatforms.length > 0) {
    blockers.push(`request.requiredPlatforms must include ${missingRequestedPlatforms.join(", ")}`);
  }
  if (typeof request.requestId !== "string" || request.requestId.trim() === "") {
    blockers.push("request.requestId must be a non-empty string");
  }
  if (blockers.length > 0) {
    fail(`Current Desktop formal artifact request failed validation:\n- ${blockers.join("\n- ")}`);
  }
  return request;
}

function verifyReleaseGitCheckoutForManifest() {
  const insideWorkTree = runGit(
    ["rev-parse", "--is-inside-work-tree"],
    "Git checkout metadata is required for Desktop formal artifact manifest generation.",
  );
  if (insideWorkTree !== "true") {
    fail("Git checkout metadata is required for Desktop formal artifact manifest generation.");
  }
  const status = runGit(
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude)reports/release",
      ":(exclude)reports/handoff",
    ],
    "Git working tree status is required for Desktop formal artifact manifest generation.",
  );
  if (status.trim() !== "") {
    fail(`Git working tree outside reports/release and reports/handoff must be clean:\n${status}`);
  }
  const head = runGit(["rev-parse", "HEAD"], "Unable to resolve HEAD for Desktop formal artifact manifest generation.");
  const tagCommit = runGit(
    ["rev-parse", "--verify", `${releaseTag}^{}`],
    `Release tag ${releaseTag} must exist for Desktop formal artifact manifest generation.`,
  );
  if (head !== tagCommit) {
    fail(`Release tag ${releaseTag} must point at HEAD for Desktop formal artifact manifest generation.`);
  }
  const repository = runGit(
    ["remote", "get-url", "origin"],
    "Git remote origin is required for Desktop formal artifact manifest generation.",
  );
  runGit(["fsck", "--strict"], "git fsck --strict must pass for Desktop formal artifact manifest generation.");
  return { head, repository, tagCommit };
}

function runGit(args, message) {
  const result = spawnSync(gitCommand, [...gitCommandPrefixArgs, ...args], {
    cwd: options.root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const diagnostic = `${result.stdout}\n${result.stderr}`.trim();
    fail(diagnostic ? `${message}\n${diagnostic}` : message);
  }
  return result.stdout.trim();
}

function validateInputDirectoryLocation(path) {
  if (isInsidePath(path, options.root)) {
    fail(
      "--input-dir must be outside the release workspace so Desktop source evidence can prove the source tree is clean and release upload tools cannot pick up staging-only files.",
    );
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseArgs(args) {
  let root = defaultRoot;
  let inputPath = "";
  let outputPath = "";
  let requestPath = defaultRequestPath;
  let requestChecksumPath = "";
  let requiredPlatforms = ["windows", "macos", "linux"];
  let sourceAuthority = "local";
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") {
      force = true;
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
    if (arg === "--input-dir") {
      inputPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--input-dir=")) {
      inputPath = arg.slice("--input-dir=".length);
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
    if (arg === "--request") {
      requestPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--request=")) {
      requestPath = arg.slice("--request=".length);
      continue;
    }
    if (arg === "--request-checksum") {
      requestChecksumPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--request-checksum=")) {
      requestChecksumPath = arg.slice("--request-checksum=".length);
      continue;
    }
    if (arg === "--source-authority") {
      sourceAuthority = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--source-authority=")) {
      sourceAuthority = arg.slice("--source-authority=".length);
      continue;
    }
    if (arg === "--require-platforms") {
      requiredPlatforms = parsePlatformList(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--require-platforms=")) {
      requiredPlatforms = parsePlatformList(arg.slice("--require-platforms=".length));
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (inputPath.trim() === "") {
    fail("--input-dir is required.");
  }

  sourceAuthority = sourceAuthority.trim();
  if (!["local", "self-hosted"].includes(sourceAuthority)) {
    fail("--source-authority must be local or self-hosted.");
  }
  if (requiredPlatforms.length === 0) {
    fail("--require-platforms must include at least one platform.");
  }

  const inputDir = resolve(inputPath);
  const resolvedOutputPath = outputPath
    ? resolvePathFrom(inputDir, outputPath)
    : resolve(inputDir, defaultOutputFileName);
  const resolvedRequestPath = resolve(root, requestPath);
  const resolvedRequestChecksumPath = requestChecksumPath
    ? resolve(root, requestChecksumPath)
    : resolve(
        dirname(resolvedRequestPath),
        basename(resolvedRequestPath) === basename(defaultRequestPath)
          ? defaultRequestChecksumFileName
          : `${basename(resolvedRequestPath, ".json")}-SHA256SUMS.txt`,
      );

  return {
    force,
    inputDir,
    outputPath: resolvedOutputPath,
    requestChecksumPath: resolvedRequestChecksumPath,
    requestPath: resolvedRequestPath,
    requiredPlatforms,
    root,
    sourceAuthority,
  };
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value.`);
  }
  return value;
}

function parsePlatformList(value) {
  const platforms = value
    .split(",")
    .map((platform) => platform.trim())
    .filter(Boolean);
  const invalidPlatforms = platforms.filter((platform) => !["windows", "macos", "linux"].includes(platform));
  if (invalidPlatforms.length > 0) {
    fail(`Unsupported required platform(s): ${invalidPlatforms.join(", ")}`);
  }
  return [...new Set(platforms)];
}

function parseCommandPrefixArgs(envName) {
  const raw = process.env[envName];
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
      return parsed;
    }
  } catch {
    // Fall through to the actionable error below.
  }
  fail(`${envName} must be a JSON array of strings.`);
}

function resolvePathFrom(basePath, path) {
  return isAbsolute(path) ? resolve(path) : resolve(basePath, path);
}

function toReleasePath(path) {
  return relative(options.root, resolve(path)).replace(/\\/g, "/");
}

function displayPath(path) {
  const relativePath = relative(options?.root ?? defaultRoot, path);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return relativePath.replace(/\\/g, "/") || basename(path);
  }
  return path;
}

function isInsidePath(path, parent) {
  const relativePath = relative(parent, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function fail(message) {
  console.error(`${scriptName}: ${message}`);
  process.exit(1);
}
