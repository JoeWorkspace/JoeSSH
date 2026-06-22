import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const { evidenceChecksumPath, evidencePath, manifestPath, root } = parseArgs(process.argv.slice(2));
const errors = [];

const manifestEntries = readChecksumManifest(resolve(root, manifestPath));
verifyEvidenceChecksum(resolve(root, evidencePath), resolve(root, evidenceChecksumPath));
const evidence = readEvidence(resolve(root, evidencePath));
validateEvidence(evidence, manifestEntries);

if (errors.length > 0) {
  fail(`Desktop release evidence verification failed:\n- ${errors.join("\n- ")}`);
}

console.log(`Desktop release evidence verified for ${manifestEntries.length} artifact(s).`);

function readChecksumManifest(path) {
  if (!existsSync(path)) {
    fail(`Missing desktop checksum manifest: ${displayPath(path)}`);
  }

  const entries = [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      return;
    }

    const match = line.match(/^([a-fA-F0-9]{64})\s\s(.+)$/);
    if (!match) {
      errors.push(`${displayPath(path)}:${lineNumber} is not '<sha256>  <relative-path>'`);
      return;
    }

    const manifestSha256 = match[1].toLowerCase();
    const artifactPath = normalizeReleasePath(match[2]);
    if (isAbsolute(artifactPath)) {
      errors.push(`${displayPath(path)}:${lineNumber} uses an absolute artifact path`);
      return;
    }

    const fullPath = resolve(root, artifactPath);
    if (!isInsideRoot(fullPath)) {
      errors.push(`${displayPath(path)}:${lineNumber} escapes the release root`);
      return;
    }
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      errors.push(`${displayPath(path)}:${lineNumber} references missing artifact ${artifactPath}`);
      return;
    }

    const actualSha256 = sha256File(fullPath);
    if (actualSha256 !== manifestSha256) {
      errors.push(
        `${displayPath(path)}:${lineNumber} hash mismatch for ${artifactPath}: expected ${manifestSha256}, got ${actualSha256}`,
      );
    }

    entries.push({
      path: relative(root, fullPath).replace(/\\/g, "/"),
      platform: classifyPlatform(artifactPath),
      sha256: manifestSha256,
    });
  });

  if (entries.length === 0) {
    errors.push(`${displayPath(path)} contains no desktop artifacts`);
  }

  return entries;
}

function readEvidence(path) {
  if (!existsSync(path)) {
    fail(`Missing desktop release evidence: ${displayPath(path)}`);
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Unable to parse desktop release evidence: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function verifyEvidenceChecksum(evidenceFullPath, checksumFullPath) {
  if (!existsSync(checksumFullPath)) {
    errors.push(`missing desktop evidence checksum manifest ${displayPath(checksumFullPath)}`);
    return;
  }
  if (!statSync(checksumFullPath).isFile()) {
    errors.push(`desktop evidence checksum manifest is not a file ${displayPath(checksumFullPath)}`);
    return;
  }

  const evidenceReleasePath = displayPath(evidenceFullPath);
  const expectedHash = readChecksumManifestArtifactHashes(checksumFullPath).get(evidenceReleasePath);
  if (!expectedHash) {
    errors.push(`desktop evidence checksum manifest does not list ${evidenceReleasePath}`);
    return;
  }

  if (!existsSync(evidenceFullPath) || !statSync(evidenceFullPath).isFile()) {
    return;
  }

  const actualHash = sha256File(evidenceFullPath);
  if (actualHash !== expectedHash) {
    errors.push(`desktop evidence checksum manifest hash mismatch for ${evidenceReleasePath}`);
  }
}

function readChecksumManifestArtifactHashes(path) {
  const hashes = new Map();
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      return;
    }

    const match = line.match(/^([a-fA-F0-9]{64})\s\s(.+)$/);
    if (!match) {
      errors.push(`${displayPath(path)}:${index + 1} is not '<sha256>  <relative-path>'`);
      return;
    }

    const artifactPath = normalizeReleasePath(match[2]);
    if (isAbsolute(artifactPath)) {
      errors.push(`${displayPath(path)}:${index + 1} uses an absolute artifact path`);
      return;
    }

    const fullPath = resolve(root, artifactPath);
    if (!isInsideRoot(fullPath)) {
      errors.push(`${displayPath(path)}:${index + 1} escapes the release root`);
      return;
    }

    hashes.set(relative(root, fullPath).replace(/\\/g, "/"), match[1].toLowerCase());
  });
  return hashes;
}

function validateEvidence(evidence, manifestEntries) {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) {
    errors.push("release evidence must be a JSON object");
    return;
  }

  if (!Array.isArray(evidence.artifacts)) {
    errors.push("release evidence must include an artifacts array");
    return;
  }

  const manifestByPath = new Map(manifestEntries.map((entry) => [entry.path, entry]));
  const evidenceByPath = new Map();
  const platforms = new Set();

  for (const [index, artifact] of evidence.artifacts.entries()) {
    const label = `artifacts[${index}]`;
    if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) {
      errors.push(`${label} must be an object`);
      continue;
    }

    const path = typeof artifact.path === "string" ? normalizeReleasePath(artifact.path) : "";
    if (!path) {
      errors.push(`${label}.path is required`);
      continue;
    }
    if (evidenceByPath.has(path)) {
      errors.push(`${label}.path duplicates ${path}`);
      continue;
    }
    evidenceByPath.set(path, artifact);

    const manifestEntry = manifestByPath.get(path);
    if (!manifestEntry) {
      errors.push(`${label}.path is not listed in ${manifestPath}: ${path}`);
      continue;
    }

    if (artifact.platform !== manifestEntry.platform) {
      errors.push(`${label}.platform must be ${manifestEntry.platform} for ${path}`);
      continue;
    }

    platforms.add(artifact.platform);
    validateArtifactSha256(label, artifact, manifestEntry);
    validatePlatformEvidence(label, artifact);
  }

  for (const entry of manifestEntries) {
    if (!evidenceByPath.has(entry.path)) {
      errors.push(`missing release evidence for ${entry.path}`);
    }
  }

  for (const requiredPlatform of ["windows", "macos", "linux"]) {
    if (!platforms.has(requiredPlatform)) {
      errors.push(`desktop release evidence must include at least one ${requiredPlatform} artifact`);
    }
  }
}

function validatePlatformEvidence(label, artifact) {
  if (artifact.platform === "windows") {
    requireBoolean(label, artifact, "signed", true);
    requireNonEmptyString(label, artifact, "signatureVerification");
    requireEvidenceBinding(label, artifact, "signatureVerification");
    return;
  }

  if (artifact.platform === "macos") {
    requireBoolean(label, artifact, "signed", true);
    requireBoolean(label, artifact, "notarized", true);
    requireNonEmptyString(label, artifact, "signatureVerification");
    requireNonEmptyString(label, artifact, "notarizationVerification");
    requireEvidenceBinding(label, artifact, "signatureVerification");
    requireEvidenceBinding(label, artifact, "notarizationVerification");
    return;
  }

  if (artifact.platform === "linux") {
    requireNonEmptyString(label, artifact, "packageType");
    return;
  }

  errors.push(`${label}.platform is unsupported: ${String(artifact.platform)}`);
}

function validateArtifactSha256(label, artifact, manifestEntry) {
  if (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
    errors.push(`${label}.sha256 is required and must be a lowercase SHA256 hex digest`);
    return;
  }

  if (artifact.sha256 !== manifestEntry.sha256) {
    errors.push(`${label}.sha256 must match ${manifestPath} for ${artifact.path}`);
  }
}

function requireBoolean(label, artifact, field, expected) {
  if (artifact[field] !== expected) {
    errors.push(`${label}.${field} must be ${expected}`);
  }
}

function requireNonEmptyString(label, artifact, field) {
  if (typeof artifact[field] !== "string" || artifact[field].trim() === "") {
    errors.push(`${label}.${field} must be a non-empty string`);
  }
}

function requireEvidenceBinding(label, artifact, field) {
  const value = typeof artifact[field] === "string" ? artifact[field] : "";
  const artifactName = basename(artifact.path);
  if (!value.includes(artifact.path) && !value.includes(artifactName) && !value.includes(artifact.sha256)) {
    errors.push(`${label}.${field} must mention the artifact path, artifact file name, or artifact sha256`);
  }
}

function classifyPlatform(path) {
  const lower = path.toLowerCase();
  if (/\.(exe|msi|msix)$/.test(lower)) {
    return "windows";
  }
  if (lower.endsWith(".dmg") || lower.endsWith(".pkg") || lower.endsWith(".app.tar.gz")) {
    return "macos";
  }
  if (lower.endsWith(".appimage") || lower.endsWith(".deb") || lower.endsWith(".rpm")) {
    return "linux";
  }
  return "unknown";
}

function normalizeReleasePath(path) {
  return path.replaceAll("\\", "/");
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArgs(args) {
  let root = defaultRoot;
  let manifestPath = "reports/release/desktop/SHA256SUMS.txt";
  let evidencePath = "reports/release/desktop/release-evidence.json";
  let evidenceChecksumPath = "reports/release/desktop/release-evidence-SHA256SUMS.txt";

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
    if (arg === "--manifest") {
      const value = args[index + 1];
      if (!value) {
        fail("--manifest requires a path.");
      }
      manifestPath = value;
      index += 1;
      continue;
    }
    if (arg === "--evidence") {
      const value = args[index + 1];
      if (!value) {
        fail("--evidence requires a path.");
      }
      evidencePath = value;
      index += 1;
      continue;
    }
    if (arg === "--evidence-checksum") {
      const value = args[index + 1];
      if (!value) {
        fail("--evidence-checksum requires a path.");
      }
      evidenceChecksumPath = value;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return { evidenceChecksumPath, evidencePath, manifestPath, root };
}

function displayPath(path) {
  return relative(root, path).replace(/\\/g, "/") || basename(path);
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
