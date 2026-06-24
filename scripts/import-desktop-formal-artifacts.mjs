import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
const inputDir = options.inputDir;

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
