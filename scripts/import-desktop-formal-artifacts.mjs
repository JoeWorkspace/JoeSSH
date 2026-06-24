import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const scriptName = "import-desktop-formal-artifacts.mjs";
const scriptDir = import.meta.dirname;
const defaultRoot = resolve(scriptDir, "..");
const packagerPath = resolve(scriptDir, "package-desktop-release.mjs");
const verifierPath = resolve(scriptDir, "verify-desktop-release-evidence.mjs");

const options = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(readFileSync(resolve(options.root, "package.json"), "utf8"));
const releaseVersion = packageJson.version;
const releaseTag = `v${releaseVersion}`;
const inputDir = options.inputDir;
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");

if (!existsSync(inputDir) || !statSync(inputDir).isDirectory()) {
  fail(`--input-dir must point to a directory: ${displayPath(inputDir)}`);
}
validateInputDirectoryLocation(inputDir);

const inputFiles = collectFiles(inputDir);
const sourceArtifacts = inputFiles
  .map((path) => ({ classification: classifyArtifact(path), path }))
  .filter((artifact) => artifact.classification !== null);

if (sourceArtifacts.length === 0) {
  fail(`No Desktop release artifacts found in ${displayPath(inputDir)}.`);
}

const staleArtifacts = sourceArtifacts.filter((artifact) => !basename(artifact.path).includes(releaseVersion));
if (staleArtifacts.length > 0) {
  fail(
    `Desktop formal artifact input contains file(s) that do not include ${releaseVersion}: ${staleArtifacts
      .map((artifact) => displayPath(artifact.path))
      .join(", ")}`,
  );
}

validateDuplicateBasenames(sourceArtifacts);
validateRequiredPlatforms(sourceArtifacts, options.requiredPlatforms);
const gitSource = verifyReleaseGitCheckoutForExternalManifest();
const externalManifest = validateExternalManifest(inputFiles, sourceArtifacts, gitSource);

const platforms = new Set(sourceArtifacts.map((artifact) => artifact.classification.platform));
const windowsSignatureVerification = platforms.has("windows")
  ? readRequiredProof(
      "Windows signature verification",
      resolveProofFile(inputDir, inputFiles, options.windowsSignatureFile, [
        "windows-signature-verification.txt",
        "windows-signature.txt",
      ]),
    )
  : "";
const macosSignatureVerification = platforms.has("macos")
  ? readRequiredProof(
      "macOS signature verification",
      resolveProofFile(inputDir, inputFiles, options.macosSignatureFile, [
        "macos-signature-verification.txt",
        "macos-signature.txt",
      ]),
    )
  : "";
const macosNotarizationVerification = platforms.has("macos")
  ? readRequiredProof(
      "macOS notarization verification",
      resolveProofFile(inputDir, inputFiles, options.macosNotarizationFile, [
        "macos-notarization-verification.txt",
        "macos-notarization.txt",
      ]),
    )
  : "";

validateExternalProofBindings(
  "Windows signature verification",
  windowsSignatureVerification,
  sourceArtifacts.filter((artifact) => artifact.classification.platform === "windows"),
);
validateExternalProofBindings(
  "macOS signature verification",
  macosSignatureVerification,
  sourceArtifacts.filter((artifact) => artifact.classification.platform === "macos"),
);
validateExternalProofBindings(
  "macOS notarization verification",
  macosNotarizationVerification,
  sourceArtifacts.filter((artifact) => artifact.classification.platform === "macos"),
);

const tempDir = mkdtempSync(join(tmpdir(), "joessh-desktop-formal-artifacts-"));

try {
  for (const artifact of sourceArtifacts) {
    copyFileSync(artifact.path, resolve(tempDir, basename(artifact.path)));
  }

  runNodeScript("Desktop formal artifact packaging", packagerPath, [
    "--root",
    options.root,
    "--bundle-dir",
    tempDir,
    "--source-authority",
    options.sourceAuthority,
    "--runner-type",
    options.runnerType,
    "--require-platforms",
    options.requiredPlatforms.join(","),
    ...(options.preflightOnly ? ["--preflight-only"] : []),
  ], {
    ATLASTERM_DESKTOP_MACOS_NOTARIZATION_VERIFICATION: macosNotarizationVerification,
    ATLASTERM_DESKTOP_MACOS_SIGNATURE_VERIFICATION: macosSignatureVerification,
    ATLASTERM_DESKTOP_WINDOWS_SIGNATURE_VERIFICATION: windowsSignatureVerification,
  });

  if (!options.preflightOnly) {
    attachExternalManifestToSourceEvidence(externalManifest);
    runNodeScript("Desktop formal evidence verification", verifierPath, [
      "--root",
      options.root,
      "--require-source",
      "--require-current-git-source",
      "--require-source-authority",
      options.sourceAuthority,
    ]);
  }
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

if (options.preflightOnly) {
  console.log(
    `Desktop formal artifact input preflight passed for ${sourceArtifacts.length} artifact(s) with ${options.sourceAuthority} source evidence.`,
  );
} else {
  console.log(
    `Imported ${sourceArtifacts.length} Desktop formal artifact(s) into reports/release/desktop with ${options.sourceAuthority} source evidence.`,
  );
}

function runNodeScript(label, scriptPath, args, env = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    fail(`${label} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

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

function validateExternalManifest(inputFiles, artifacts, gitSource) {
  const manifestPath = resolveSingleInputFile(inputFiles, [
    "desktop-formal-artifact-manifest.json",
  ], "Desktop formal artifact manifest");
  const manifest = readJsonFile(manifestPath, "Desktop formal artifact manifest");
  const request = readCurrentFormalArtifactRequest(gitSource);
  const blockers = [];
  const source = manifest.source;

  if (manifest.manifestVersion !== 1) {
    blockers.push("manifestVersion must be 1");
  }
  if (manifest.kind !== "joessh-desktop-formal-artifact-manifest") {
    blockers.push("kind must be joessh-desktop-formal-artifact-manifest");
  }
  if (typeof manifest.requestId !== "string" || manifest.requestId.trim() === "") {
    blockers.push("requestId must be a non-empty string");
  } else if (manifest.requestId !== request.requestId) {
    blockers.push(
      `requestId must match the current Desktop formal artifact request ${request.requestId}`,
    );
  }
  if (manifest.product !== "JoeSSH") {
    blockers.push("product must be JoeSSH");
  }
  if (manifest.version !== releaseVersion) {
    blockers.push(`version must be ${releaseVersion}`);
  }
  if (manifest.releaseTag !== releaseTag) {
    blockers.push(`releaseTag must be ${releaseTag}`);
  }
  if (manifest.sourceAuthority !== options.sourceAuthority) {
    blockers.push(`sourceAuthority must be ${options.sourceAuthority}`);
  }
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    blockers.push("source must be an object");
  } else {
    if (source.repository !== gitSource.repository) {
      blockers.push("source.repository must match the current release checkout origin");
    }
    if (source.gitCommit !== gitSource.head) {
      blockers.push("source.gitCommit must match current HEAD");
    }
    if (source.releaseTagCommit !== gitSource.tagCommit) {
      blockers.push(`source.releaseTagCommit must match ${releaseTag}`);
    }
    if (source.gitFsckStrict !== true) {
      blockers.push("source.gitFsckStrict must be true");
    }
  }

  const manifestArtifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : null;
  if (!manifestArtifacts) {
    blockers.push("artifacts must be an array");
  } else {
    validateExternalManifestArtifacts(blockers, manifestArtifacts, artifacts);
  }

  if (blockers.length > 0) {
    fail(`Desktop formal artifact manifest failed validation:\n- ${blockers.join("\n- ")}`);
  }

  return {
    artifacts: artifacts.map((artifact) => {
      const name = basename(artifact.path);
      return {
        fileName: name,
        packageType: artifact.classification.packageType ?? null,
        platform: artifact.classification.platform,
        sha256: sha256File(artifact.path),
        sizeBytes: statSync(artifact.path).size,
      };
    }),
    kind: manifest.kind,
    manifestPath,
    manifestSha256: sha256File(manifestPath),
    manifestVersion: manifest.manifestVersion,
    requestId: manifest.requestId,
    source: {
      gitCommit: source.gitCommit,
      gitFsckStrict: source.gitFsckStrict,
      releaseTagCommit: source.releaseTagCommit,
      repository: source.repository,
    },
  };
}

function readCurrentFormalArtifactRequest(gitSource) {
  const currentRequestPath = resolve(options.root, "reports", "handoff", "desktop", "formal-artifact-request.json");
  const currentRequestChecksumPath = resolve(
    options.root,
    "reports",
    "handoff",
    "desktop",
    "formal-artifact-request-SHA256SUMS.txt",
  );
  if (!existsSync(currentRequestPath) || !statSync(currentRequestPath).isFile()) {
    fail(
      "Current Desktop formal artifact request is required before importing formal artifacts. Run npm run release:desktop:formal-artifacts:request -- --source-authority local.",
    );
  }
  if (!existsSync(currentRequestChecksumPath) || !statSync(currentRequestChecksumPath).isFile()) {
    fail("Current Desktop formal artifact request checksum manifest is required before importing formal artifacts.");
  }
  const requestChecksumLines = readFileSync(currentRequestChecksumPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const expectedRequestPath = "reports/handoff/desktop/formal-artifact-request.json";
  const requestEntry = requestChecksumLines.find((line) => line.endsWith(`  ${expectedRequestPath}`));
  if (!requestEntry) {
    fail(`Current Desktop formal artifact request checksum manifest must list ${expectedRequestPath}.`);
  }
  const [requestHash] = requestEntry.split(/\s+/);
  if (requestHash !== sha256File(currentRequestPath)) {
    fail("Current Desktop formal artifact request checksum does not match formal-artifact-request.json.");
  }

  const request = readJsonFile(currentRequestPath, "Current Desktop formal artifact request");
  const blockers = [];
  if (request.kind !== "joessh-desktop-formal-artifact-request") {
    blockers.push("request.kind must be joessh-desktop-formal-artifact-request");
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
    blockers.push(
      `request.requiredPlatforms must include ${missingRequestedPlatforms.join(", ")}`,
    );
  }
  if (typeof request.requestId !== "string" || request.requestId.trim() === "") {
    blockers.push("request.requestId must be a non-empty string");
  }
  if (blockers.length > 0) {
    fail(`Current Desktop formal artifact request failed validation:\n- ${blockers.join("\n- ")}`);
  }
  return request;
}

function validateExternalManifestArtifacts(blockers, manifestArtifacts, artifacts) {
  const manifestByFileName = new Map();
  const sourceNames = new Set(artifacts.map((artifact) => basename(artifact.path)));
  for (const artifact of manifestArtifacts) {
    if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) {
      blockers.push("artifacts entries must be objects");
      continue;
    }
    const fileName = typeof artifact.fileName === "string" ? artifact.fileName : basename(String(artifact.path ?? ""));
    if (!fileName) {
      blockers.push("artifact.fileName is required");
      continue;
    }
    if (manifestByFileName.has(fileName)) {
      blockers.push(`artifacts contains duplicate fileName: ${fileName}`);
    }
    manifestByFileName.set(fileName, artifact);
  }
  for (const fileName of manifestByFileName.keys()) {
    if (!sourceNames.has(fileName)) {
      blockers.push(`artifacts contains unexpected fileName: ${fileName}`);
    }
  }

  for (const sourceArtifact of artifacts) {
    const fileName = basename(sourceArtifact.path);
    const manifestArtifact = manifestByFileName.get(fileName);
    if (!manifestArtifact) {
      blockers.push(`artifacts must include ${fileName}`);
      continue;
    }
    const artifactSha256 = sha256File(sourceArtifact.path);
    const sizeBytes = statSync(sourceArtifact.path).size;
    if (manifestArtifact.platform !== sourceArtifact.classification.platform) {
      blockers.push(`${fileName}.platform must be ${sourceArtifact.classification.platform}`);
    }
    if ((manifestArtifact.packageType ?? null) !== (sourceArtifact.classification.packageType ?? null)) {
      blockers.push(`${fileName}.packageType must match the detected package type`);
    }
    if (manifestArtifact.sha256 !== artifactSha256) {
      blockers.push(`${fileName}.sha256 must match the artifact bytes`);
    }
    if (manifestArtifact.sizeBytes !== sizeBytes) {
      blockers.push(`${fileName}.sizeBytes must match the artifact bytes`);
    }
  }
}

function validateExternalProofBindings(label, proofText, artifacts) {
  if (!proofText) {
    return;
  }
  for (const artifact of artifacts) {
    const artifactName = basename(artifact.path);
    const artifactSha256 = sha256File(artifact.path);
    if (!proofText.includes(artifactName) || !proofText.includes(artifactSha256)) {
      fail(`${label} proof must mention both the artifact file name and SHA256: ${artifactName}`);
    }
  }
}

function resolveSingleInputFile(files, candidateNames, label) {
  const candidates = new Set(candidateNames.map((name) => name.toLowerCase()));
  const matches = files.filter((file) => candidates.has(basename(file).toLowerCase()));
  if (matches.length === 0) {
    fail(`${label} is required: ${candidateNames.join(" or ")}`);
  }
  if (matches.length > 1) {
    fail(`Multiple ${label} files found under ${displayPath(inputDir)}; keep exactly one ${candidateNames.join(" or ")}.`);
  }
  return matches[0];
}

function validateInputDirectoryLocation(path) {
  if (isInsidePath(path, options.root)) {
    fail(
      "--input-dir must be outside the release workspace so Desktop source evidence can prove the source tree is clean and release upload tools cannot pick up staging-only files.",
    );
  }
}

function resolveProofFile(inputPath, files, configuredPath, candidateNames) {
  if (configuredPath) {
    return configuredPath;
  }

  const candidates = new Set(candidateNames.map((name) => name.toLowerCase()));
  const matches = files.filter((file) => candidates.has(basename(file).toLowerCase()));
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    fail(
      `Multiple proof files match ${candidateNames.join(" or ")} under ${displayPath(
        inputPath,
      )}; pass the exact proof file flag.`,
    );
  }
  return "";
}

function readRequiredProof(label, path) {
  if (!path) {
    fail(`${label} proof file is required.`);
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail(`${label} proof file is missing: ${displayPath(path)}`);
  }
  const text = readTextFile(path).trim();
  if (text === "") {
    fail(`${label} proof file is empty: ${displayPath(path)}`);
  }
  return text;
}

function attachExternalManifestToSourceEvidence(manifest) {
  const sourcePath = resolve(options.root, "reports/release/desktop/release-evidence-source.json");
  const checksumPath = resolve(options.root, "reports/release/desktop/release-evidence-SHA256SUMS.txt");
  const source = readJsonFile(sourcePath, "Desktop release evidence source sidecar");
  source.formalArtifactManifest = {
    artifacts: manifest.artifacts,
    kind: manifest.kind,
    path: displayPath(manifest.manifestPath),
    requestId: manifest.requestId,
    sha256: manifest.manifestSha256,
    source: manifest.source,
    version: manifest.manifestVersion,
  };
  writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);

  const evidence = resolve(options.root, "reports/release/desktop/release-evidence.json");
  const lines = [`${sha256File(evidence)}  reports/release/desktop/release-evidence.json`];
  lines.push(`${sha256File(sourcePath)}  reports/release/desktop/release-evidence-source.json`);
  writeFileSync(checksumPath, `${lines.join("\n")}\n`);
}

function readTextFile(path) {
  const bytes = readFileSync(path);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    fail(`Unsupported UTF-16BE proof file: ${displayPath(path)}`);
  }

  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  let zeroOddBytes = 0;
  for (let index = 1; index < sample.length; index += 2) {
    if (sample[index] === 0) {
      zeroOddBytes += 1;
    }
  }
  if (zeroOddBytes > Math.max(2, sample.length / 6)) {
    return bytes.toString("utf16le").replace(/^\uFEFF/, "");
  }

  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

function readJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function verifyReleaseGitCheckoutForExternalManifest() {
  const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"], "Git checkout metadata is required for Desktop formal artifact import.");
  if (insideWorkTree !== "true") {
    fail("Git checkout metadata is required for Desktop formal artifact import.");
  }
  const status = runGit(
    ["status", "--porcelain=v1", "--untracked-files=all", "--", ".", ":(exclude)reports/release"],
    "Git working tree status is required for Desktop formal artifact import.",
  );
  if (status.trim() !== "") {
    fail(`Git working tree outside reports/release must be clean for Desktop formal artifact import:\n${status}`);
  }
  const head = runGit(["rev-parse", "HEAD"], "Unable to resolve HEAD for Desktop formal artifact import.");
  const tagCommit = runGit(
    ["rev-parse", "--verify", `${releaseTag}^{}`],
    `Release tag ${releaseTag} must exist for Desktop formal artifact import.`,
  );
  if (head !== tagCommit) {
    fail(`Release tag ${releaseTag} must point at HEAD for Desktop formal artifact import.`);
  }
  const repository = runGit(["remote", "get-url", "origin"], "Git remote origin is required for Desktop formal artifact import.");
  runGit(["fsck", "--strict"], "git fsck --strict must pass for Desktop formal artifact import.");
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

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArgs(args) {
  let root = defaultRoot;
  let inputPath = "";
  let sourceAuthority = "local";
  let runnerType = "";
  let requiredPlatforms = ["windows", "macos", "linux"];
  let windowsSignatureFile = "";
  let macosSignatureFile = "";
  let macosNotarizationFile = "";
  let preflightOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--preflight-only") {
      preflightOnly = true;
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
    if (arg === "--source-authority") {
      sourceAuthority = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--source-authority=")) {
      sourceAuthority = arg.slice("--source-authority=".length);
      continue;
    }
    if (arg === "--runner-type") {
      runnerType = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--runner-type=")) {
      runnerType = arg.slice("--runner-type=".length);
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
    if (arg === "--windows-signature-file") {
      windowsSignatureFile = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--windows-signature-file=")) {
      windowsSignatureFile = resolve(arg.slice("--windows-signature-file=".length));
      continue;
    }
    if (arg === "--macos-signature-file") {
      macosSignatureFile = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--macos-signature-file=")) {
      macosSignatureFile = resolve(arg.slice("--macos-signature-file=".length));
      continue;
    }
    if (arg === "--macos-notarization-file") {
      macosNotarizationFile = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--macos-notarization-file=")) {
      macosNotarizationFile = resolve(arg.slice("--macos-notarization-file=".length));
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

  runnerType = runnerType.trim();
  if (runnerType === "") {
    runnerType = sourceAuthority === "self-hosted" ? "self-hosted-release-machine" : "local-release-machine";
  }

  return {
    inputDir: resolve(inputPath),
    macosNotarizationFile,
    macosSignatureFile,
    preflightOnly,
    requiredPlatforms,
    root,
    runnerType,
    sourceAuthority,
    windowsSignatureFile,
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
