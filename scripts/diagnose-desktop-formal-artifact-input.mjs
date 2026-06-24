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
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const scriptName = "diagnose-desktop-formal-artifact-input.mjs";
const scriptDir = import.meta.dirname;
const defaultRoot = resolve(scriptDir, "..");
const importerPath = resolve(scriptDir, "import-desktop-formal-artifacts.mjs");
const defaultOutputPath = "reports/handoff/desktop/formal-artifact-input-report.json";
const defaultChecksumFileName = "formal-artifact-input-report-SHA256SUMS.txt";
const options = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(readFileSync(resolve(options.root, "package.json"), "utf8"));
const releaseVersion = packageJson.version;

const report = buildReport();
mkdirSync(dirname(options.outputPath), { recursive: true });
writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
const checksumFileName =
  basename(options.outputPath) === basename(defaultOutputPath)
    ? defaultChecksumFileName
    : `${basename(options.outputPath, ".json")}-SHA256SUMS.txt`;
const checksumPath = resolve(dirname(options.outputPath), checksumFileName);
writeFileSync(checksumPath, `${sha256File(options.outputPath)}  ${toRootPath(options.outputPath)}\n`);

console.log(
  `Desktop formal artifact intake diagnostics wrote ${toRootPath(options.outputPath)} (${report.decision}).`,
);
for (const blocker of report.blockers) {
  console.log(`- ${blocker.id}: ${blocker.detail.split(/\r?\n/)[0]}`);
}

if (report.blockers.length > 0 && !options.noFail) {
  process.exit(1);
}

function buildReport() {
  const artifacts = [];
  const blockers = [];
  const proofFiles = {};
  let preflight = {
    attempted: false,
    status: "skipped",
    reason: "input did not pass local intake checks",
  };

  if (!options.inputDir) {
    blockers.push({
      id: "desktop-formal-input",
      label: "Desktop formal artifact input directory",
      detail: "--input-dir is required to diagnose signed Desktop formal artifacts.",
    });
    return createReport({ artifacts, blockers, preflight, proofFiles });
  }

  if (!existsSync(options.inputDir) || !statSync(options.inputDir).isDirectory()) {
    blockers.push({
      id: "desktop-formal-input",
      label: "Desktop formal artifact input directory",
      detail: `--input-dir must point to a directory: ${displayPath(options.inputDir)}`,
    });
    return createReport({ artifacts, blockers, preflight, proofFiles });
  }

  if (isInsidePath(options.inputDir, options.root)) {
    blockers.push({
      id: "desktop-formal-input-location",
      label: "Desktop formal artifact input location",
      detail:
        "--input-dir must be outside the release workspace so staged release artifacts cannot be mistaken for source artifacts.",
    });
  }

  const inputFiles = collectFiles(options.inputDir);
  const sourceArtifacts = inputFiles
    .map((path) => ({ classification: classifyArtifact(path), path }))
    .filter((artifact) => artifact.classification !== null);

  for (const artifact of sourceArtifacts) {
    artifacts.push({
      fileName: basename(artifact.path),
      packageType: artifact.classification.packageType ?? null,
      path: displayPath(artifact.path),
      platform: artifact.classification.platform,
      sha256: sha256File(artifact.path),
      sizeBytes: statSync(artifact.path).size,
      versionMatchesPackage: basename(artifact.path).includes(releaseVersion),
    });
  }

  if (sourceArtifacts.length === 0) {
    blockers.push({
      id: "desktop-formal-artifacts",
      label: "Desktop formal artifacts",
      detail: `No Desktop release artifacts found in ${displayPath(options.inputDir)}.`,
    });
  }

  const staleArtifacts = sourceArtifacts.filter((artifact) => !basename(artifact.path).includes(releaseVersion));
  if (staleArtifacts.length > 0) {
    blockers.push({
      id: "desktop-formal-artifact-version",
      label: "Desktop formal artifact versions",
      detail: `Desktop formal artifact input contains file(s) that do not include ${releaseVersion}: ${staleArtifacts
        .map((artifact) => displayPath(artifact.path))
        .join(", ")}`,
    });
  }

  const duplicateNames = findDuplicateBasenames(sourceArtifacts);
  if (duplicateNames.length > 0) {
    blockers.push({
      id: "desktop-formal-artifact-duplicates",
      label: "Desktop formal artifact duplicate file names",
      detail: `Desktop formal artifact input contains duplicate file name(s): ${duplicateNames.join(", ")}`,
    });
  }

  const platforms = new Set(sourceArtifacts.map((artifact) => artifact.classification.platform));
  const missingPlatforms = options.requiredPlatforms.filter((platform) => !platforms.has(platform));
  if (missingPlatforms.length > 0) {
    blockers.push({
      id: "desktop-formal-artifact-platforms",
      label: "Desktop formal artifact platforms",
      detail: `Desktop formal artifact input is missing required platform(s): ${missingPlatforms.join(", ")}`,
    });
  }

  if (platforms.has("windows")) {
    proofFiles.windowsSignature = inspectProofFile("Windows signature verification", inputFiles, options.windowsSignatureFile, [
      "windows-signature-verification.txt",
      "windows-signature.txt",
    ], sourceArtifacts.filter((artifact) => artifact.classification.platform === "windows"));
    blockers.push(...proofFiles.windowsSignature.blockers);
  }
  if (platforms.has("macos")) {
    proofFiles.macosSignature = inspectProofFile("macOS signature verification", inputFiles, options.macosSignatureFile, [
      "macos-signature-verification.txt",
      "macos-signature.txt",
    ], sourceArtifacts.filter((artifact) => artifact.classification.platform === "macos"));
    blockers.push(...proofFiles.macosSignature.blockers);
    proofFiles.macosNotarization = inspectProofFile("macOS notarization verification", inputFiles, options.macosNotarizationFile, [
      "macos-notarization-verification.txt",
      "macos-notarization.txt",
    ], sourceArtifacts.filter((artifact) => artifact.classification.platform === "macos"));
    blockers.push(...proofFiles.macosNotarization.blockers);
  }

  if (blockers.length === 0) {
    preflight = runImporterPreflight();
    if (preflight.status !== "pass") {
      blockers.push({
        id: "desktop-formal-artifact-preflight",
        label: "Desktop formal artifact preflight",
        detail: preflight.stderr || preflight.stdout || "Desktop formal artifact preflight failed.",
      });
    }
  }

  return createReport({ artifacts, blockers, preflight, proofFiles });
}

function createReport({ artifacts, blockers, preflight, proofFiles }) {
  return {
    artifacts,
    blockers,
    decision: blockers.length === 0 ? "go" : "no-go",
    expectedInput: {
      artifacts: [
        `JoeSSH_${releaseVersion}_*.exe, .msi, or .msix for Windows`,
        `JoeSSH_${releaseVersion}_*.dmg, .pkg, or .app.tar.gz for macOS`,
        `JoeSSH_${releaseVersion}_*.AppImage, .deb, or .rpm for Linux`,
      ],
      proofFiles: [
        "windows-signature-verification.txt",
        "macos-signature-verification.txt",
        "macos-notarization-verification.txt",
      ],
    },
    generatedAt: new Date().toISOString(),
    inputDir: options.inputDir ? displayPath(options.inputDir) : null,
    preflight,
    proofFiles: Object.fromEntries(
      Object.entries(proofFiles).map(([key, value]) => [
        key,
        {
          path: value.path,
          sha256: value.sha256,
          status: value.status,
        },
      ]),
    ),
    releaseVersion,
    requiredPlatforms: options.requiredPlatforms,
    sourceAuthority: options.sourceAuthority,
  };
}

function inspectProofFile(label, inputFiles, configuredPath, candidateNames, artifacts) {
  const blockers = [];
  const resolved = resolveProofFile(inputFiles, configuredPath, candidateNames);
  if (resolved.error) {
    blockers.push({
      id: proofBlockerId(label),
      label,
      detail: resolved.error,
    });
    return { blockers, path: null, sha256: null, status: "fail" };
  }
  if (!resolved.path) {
    blockers.push({
      id: proofBlockerId(label),
      label,
      detail: `${label} proof file is required.`,
    });
    return { blockers, path: null, sha256: null, status: "fail" };
  }
  if (!existsSync(resolved.path) || !statSync(resolved.path).isFile()) {
    blockers.push({
      id: proofBlockerId(label),
      label,
      detail: `${label} proof file is missing: ${displayPath(resolved.path)}`,
    });
    return { blockers, path: displayPath(resolved.path), sha256: null, status: "fail" };
  }

  let text = "";
  try {
    text = readTextFile(resolved.path).trim();
  } catch (error) {
    blockers.push({
      id: proofBlockerId(label),
      label,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  if (text === "") {
    blockers.push({
      id: proofBlockerId(label),
      label,
      detail: `${label} proof file is empty: ${displayPath(resolved.path)}`,
    });
  }
  if (proofReportsFailure(text)) {
    blockers.push({
      id: proofBlockerId(label),
      label,
      detail: `${label} proof must not report a failed verification.`,
    });
  }
  if (!proofReportsSuccess(text)) {
    blockers.push({
      id: proofBlockerId(label),
      label,
      detail: `${label} proof must show a successful verification.`,
    });
  }
  for (const artifact of artifacts) {
    const artifactName = basename(artifact.path);
    const artifactSha256 = sha256File(artifact.path);
    if (!text.includes(artifactName) && !text.includes(artifactSha256)) {
      blockers.push({
        id: proofBlockerId(label),
        label,
        detail: `${label} proof must mention the artifact file name or SHA256: ${artifactName}`,
      });
    }
  }

  return {
    blockers,
    path: displayPath(resolved.path),
    sha256: sha256File(resolved.path),
    status: blockers.length === 0 ? "pass" : "fail",
  };
}

function runImporterPreflight() {
  const args = [
    importerPath,
    "--root",
    options.root,
    "--input-dir",
    options.inputDir,
    "--source-authority",
    options.sourceAuthority,
    "--runner-type",
    options.runnerType,
    "--require-platforms",
    options.requiredPlatforms.join(","),
    "--preflight-only",
  ];
  if (options.windowsSignatureFile) {
    args.push("--windows-signature-file", options.windowsSignatureFile);
  }
  if (options.macosSignatureFile) {
    args.push("--macos-signature-file", options.macosSignatureFile);
  }
  if (options.macosNotarizationFile) {
    args.push("--macos-notarization-file", options.macosNotarizationFile);
  }

  const result = spawnSync(process.execPath, args, {
    cwd: options.root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    attempted: true,
    exitCode: result.status ?? null,
    status: result.status === 0 ? "pass" : "fail",
    stderr: result.stderr.trim(),
    stdout: result.stdout.trim(),
  };
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

function findDuplicateBasenames(artifacts) {
  const seen = new Set();
  const duplicates = new Set();
  for (const artifact of artifacts) {
    const name = basename(artifact.path);
    if (seen.has(name)) {
      duplicates.add(name);
    }
    seen.add(name);
  }
  return [...duplicates].sort();
}

function resolveProofFile(files, configuredPath, candidateNames) {
  if (configuredPath) {
    return { path: configuredPath };
  }

  const candidates = new Set(candidateNames.map((name) => name.toLowerCase()));
  const matches = files.filter((file) => candidates.has(basename(file).toLowerCase()));
  if (matches.length === 1) {
    return { path: matches[0] };
  }
  if (matches.length > 1) {
    return {
      error: `Multiple proof files match ${candidateNames.join(" or ")} under ${displayPath(
        options.inputDir,
      )}; pass the exact proof file flag.`,
    };
  }
  return { path: "" };
}

function readTextFile(path) {
  const bytes = readFileSync(path);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    throw new Error(`Unsupported UTF-16BE proof file: ${displayPath(path)}`);
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

function proofReportsFailure(proofText) {
  return /\b(fail(?:ed|ure)?|error|invalid|rejected|denied|cannot|unable)\b|\bnot\s+(?:signed|notarized|valid|accepted)\b/i.test(
    proofText,
  );
}

function proofReportsSuccess(proofText) {
  return /\b(pass(?:ed|es)?|success(?:ful|fully)?|valid|verified|accepted|notarized|stapled)\b/i.test(
    proofText,
  );
}

function proofBlockerId(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseArgs(args) {
  let root = defaultRoot;
  let inputPath = "";
  let outputPath = defaultOutputPath;
  let sourceAuthority = "local";
  let runnerType = "";
  let requiredPlatforms = ["windows", "macos", "linux"];
  let windowsSignatureFile = "";
  let macosSignatureFile = "";
  let macosNotarizationFile = "";
  let noFail = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-fail") {
      noFail = true;
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

  sourceAuthority = sourceAuthority.trim();
  if (!["local", "self-hosted"].includes(sourceAuthority)) {
    fail("--source-authority must be local or self-hosted.");
  }
  runnerType = runnerType.trim();
  if (runnerType === "") {
    runnerType = sourceAuthority === "self-hosted" ? "self-hosted-release-machine" : "local-release-machine";
  }

  return {
    inputDir: inputPath.trim() === "" ? "" : resolve(inputPath),
    macosNotarizationFile,
    macosSignatureFile,
    noFail,
    outputPath: resolve(root, outputPath),
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

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function toRootPath(path) {
  return relative(options.root, path).replace(/\\/g, "/");
}

function displayPath(path) {
  const relativePath = relative(options.root, path);
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
