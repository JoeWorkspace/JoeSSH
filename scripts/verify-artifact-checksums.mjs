import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const { allReleaseManifests, manifestPaths, root } = parseArgs(process.argv.slice(2));
const releaseManifestPaths = allReleaseManifests ? collectReleaseChecksumManifests() : [];
const pathsToVerify = [...new Set([...manifestPaths, ...releaseManifestPaths])];

if (pathsToVerify.length === 0) {
  fail("Usage: node scripts/verify-artifact-checksums.mjs [--root <path>] [--all-release] <SHA256SUMS.txt> [...]");
}

const errors = [];
let verifiedCount = 0;
const seenArtifacts = new Set();

for (const manifestPath of pathsToVerify) {
  verifyManifest(resolve(root, manifestPath));
}

if (errors.length > 0) {
  fail(`SHA256 checksum verification failed:\n- ${errors.join("\n- ")}`);
}

if (verifiedCount === 0) {
  fail("No SHA256 checksum entries were found.");
}

console.log(`Verified ${verifiedCount} SHA256 checksum(s) from ${pathsToVerify.length} manifest(s).`);

function collectReleaseChecksumManifests() {
  const releaseDir = resolve(root, "reports", "release");
  return collectFiles(releaseDir)
    .filter((path) => path.endsWith("SHA256SUMS.txt"))
    .map((path) => relative(root, path).replace(/\\/g, "/"))
    .sort();
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

function verifyManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    errors.push(`missing manifest ${displayPath(manifestPath)}`);
    return;
  }

  const stat = statSync(manifestPath);
  if (!stat.isFile()) {
    errors.push(`manifest is not a file ${displayPath(manifestPath)}`);
    return;
  }

  const lines = readFileSync(manifestPath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      return;
    }

    const match = line.match(/^([a-fA-F0-9]{64})\s\s(.+)$/);
    if (!match) {
      errors.push(`${displayPath(manifestPath)}:${lineNumber} is not '<sha256>  <relative-path>'`);
      return;
    }

    const [, expectedHash, artifactRelativePath] = match;
    const normalizedArtifactPath = artifactRelativePath.replaceAll("\\", "/");
    if (isAbsolute(normalizedArtifactPath)) {
      errors.push(`${displayPath(manifestPath)}:${lineNumber} uses an absolute artifact path`);
      return;
    }

    const artifactPath = resolve(root, normalizedArtifactPath);
    if (!isInsideRoot(artifactPath)) {
      errors.push(`${displayPath(manifestPath)}:${lineNumber} escapes the release root`);
      return;
    }

    const artifactKey = relative(root, artifactPath).replace(/\\/g, "/");
    if (seenArtifacts.has(artifactKey)) {
      errors.push(`${displayPath(manifestPath)}:${lineNumber} duplicates artifact ${artifactKey}`);
      return;
    }
    seenArtifacts.add(artifactKey);

    if (!existsSync(artifactPath)) {
      errors.push(`${displayPath(manifestPath)}:${lineNumber} references missing artifact ${artifactKey}`);
      return;
    }

    if (!statSync(artifactPath).isFile()) {
      errors.push(`${displayPath(manifestPath)}:${lineNumber} references non-file artifact ${artifactKey}`);
      return;
    }

    const actualHash = sha256(artifactPath);
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      errors.push(`${displayPath(manifestPath)}:${lineNumber} hash mismatch for ${artifactKey}`);
      return;
    }

    verifiedCount += 1;
  });
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function parseArgs(args) {
  const manifestPaths = [];
  let allReleaseManifests = false;
  let root = defaultRoot;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
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

    if (arg === "--all-release") {
      allReleaseManifests = true;
      continue;
    }

    manifestPaths.push(arg);
  }

  return { allReleaseManifests, manifestPaths, root };
}

function displayPath(path) {
  return relative(root, path).replace(/\\/g, "/") || basename(path);
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
