import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const {
  bundleDir,
  checksumPath,
  evidencePath,
  macosNotarizationVerification,
  macosSignatureVerification,
  outputDir,
  requiredPlatforms,
  root,
  windowsSignatureVerification,
} = parseArgs(process.argv.slice(2));

if (!isInsideRoot(outputDir) || !isInsideRoot(checksumPath) || !isInsideRoot(evidencePath)) {
  fail("Desktop release output paths must stay inside the release root.");
}

const sourceArtifacts = collectFiles(bundleDir)
  .map((path) => ({ path, classification: classifyArtifact(path) }))
  .filter((artifact) => artifact.classification !== null);

if (sourceArtifacts.length === 0) {
  fail(`No Desktop bundle artifacts found in ${displayPath(bundleDir)}. Run npm run release:desktop:build first.`);
}

mkdirSync(outputDir, { recursive: true });
removeStaleDesktopArtifacts(outputDir);

const destinationNames = new Set();
const releaseArtifacts = sourceArtifacts
  .sort((left, right) => left.path.localeCompare(right.path))
  .map(({ path, classification }) => {
    const destination = resolve(outputDir, basename(path));
    if (destinationNames.has(destination)) {
      fail(`Desktop bundle artifacts contain duplicate file names: ${basename(path)}`);
    }
    destinationNames.add(destination);

    if (path !== destination) {
      copyFileSync(path, destination);
    }

    return {
      path: destination,
      classification,
      artifactSha256: sha256(destination),
    };
  });

validateRequiredPlatforms(releaseArtifacts);

const evidence = {
  artifacts: releaseArtifacts.map(({ path, classification, artifactSha256 }) =>
    createEvidenceEntry(path, classification, artifactSha256),
  ),
};
const checksumLines = releaseArtifacts.map(({ path, artifactSha256 }) => `${artifactSha256}  ${toReleasePath(path)}`);
const evidenceChecksumPath = resolve(outputDir, "release-evidence-SHA256SUMS.txt");

mkdirSync(dirname(checksumPath), { recursive: true });
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(checksumPath, `${checksumLines.join("\n")}\n`);
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
writeFileSync(evidenceChecksumPath, `${sha256(evidencePath)}  ${toReleasePath(evidencePath)}\n`);

console.log(`Packaged ${releaseArtifacts.length} Desktop release artifact(s) into ${toReleasePath(outputDir)}.`);
console.log(`Wrote ${toReleasePath(checksumPath)}`);
console.log(`Wrote ${toReleasePath(evidencePath)}`);
console.log(`Wrote ${toReleasePath(evidenceChecksumPath)}`);

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
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(child);
    }
    return entry.isFile() ? [child] : [];
  });
}

function removeStaleDesktopArtifacts(path) {
  for (const file of collectFiles(path)) {
    if (classifyArtifact(file) !== null) {
      rmSync(file);
    }
  }
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

function createEvidenceEntry(path, classification, artifactSha256) {
  const entry = {
    path: toReleasePath(path),
    platform: classification.platform,
    sha256: artifactSha256,
  };

  if (classification.platform === "windows") {
    if (!windowsSignatureVerification) {
      fail(
        "Windows Desktop artifacts require --windows-signature-verification or ATLASTERM_DESKTOP_WINDOWS_SIGNATURE_VERIFICATION.",
      );
    }
    return {
      ...entry,
      signed: true,
      signatureVerification: windowsSignatureVerification,
    };
  }

  if (classification.platform === "macos") {
    if (!macosSignatureVerification || !macosNotarizationVerification) {
      fail(
        "macOS Desktop artifacts require --macos-signature-verification and --macos-notarization-verification.",
      );
    }
    return {
      ...entry,
      signed: true,
      notarized: true,
      signatureVerification: macosSignatureVerification,
      notarizationVerification: macosNotarizationVerification,
    };
  }

  return {
    ...entry,
    packageType: classification.packageType,
  };
}

function validateRequiredPlatforms(artifacts) {
  if (requiredPlatforms.length === 0) {
    return;
  }

  const platforms = new Set(artifacts.map(({ classification }) => classification.platform));
  const missingPlatforms = requiredPlatforms.filter((platform) => !platforms.has(platform));
  if (missingPlatforms.length > 0) {
    fail(`Desktop release artifacts are missing required platform(s): ${missingPlatforms.join(", ")}`);
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function parseArgs(args) {
  let root = defaultRoot;
  let bundlePath = "apps/desktop/src-tauri/target/release/bundle";
  let outputPath = "reports/release/desktop";
  let checksumPath = "reports/release/desktop/SHA256SUMS.txt";
  let evidencePath = "reports/release/desktop/release-evidence.json";
  let windowsSignatureVerification = process.env.ATLASTERM_DESKTOP_WINDOWS_SIGNATURE_VERIFICATION ?? "";
  let macosSignatureVerification = process.env.ATLASTERM_DESKTOP_MACOS_SIGNATURE_VERIFICATION ?? "";
  let macosNotarizationVerification = process.env.ATLASTERM_DESKTOP_MACOS_NOTARIZATION_VERIFICATION ?? "";
  let requiredPlatforms = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      root = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
      continue;
    }
    if (arg === "--bundle-dir") {
      bundlePath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--bundle-dir=")) {
      bundlePath = arg.slice("--bundle-dir=".length);
      continue;
    }
    if (arg === "--output-dir") {
      outputPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      outputPath = arg.slice("--output-dir=".length);
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
    if (arg === "--evidence") {
      evidencePath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--evidence=")) {
      evidencePath = arg.slice("--evidence=".length);
      continue;
    }
    if (arg === "--windows-signature-verification") {
      windowsSignatureVerification = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--windows-signature-verification=")) {
      windowsSignatureVerification = arg.slice("--windows-signature-verification=".length);
      continue;
    }
    if (arg === "--macos-signature-verification") {
      macosSignatureVerification = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--macos-signature-verification=")) {
      macosSignatureVerification = arg.slice("--macos-signature-verification=".length);
      continue;
    }
    if (arg === "--macos-notarization-verification") {
      macosNotarizationVerification = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--macos-notarization-verification=")) {
      macosNotarizationVerification = arg.slice("--macos-notarization-verification=".length);
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

  return {
    bundleDir: resolve(root, bundlePath),
    checksumPath: resolve(root, checksumPath),
    evidencePath: resolve(root, evidencePath),
    macosNotarizationVerification: macosNotarizationVerification.trim(),
    macosSignatureVerification: macosSignatureVerification.trim(),
    outputDir: resolve(root, outputPath),
    requiredPlatforms,
    root,
    windowsSignatureVerification: windowsSignatureVerification.trim(),
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

function toReleasePath(path) {
  return relative(root, path).replace(/\\/g, "/");
}

function displayPath(path) {
  return relative(root, path).replace(/\\/g, "/") || basename(path);
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
