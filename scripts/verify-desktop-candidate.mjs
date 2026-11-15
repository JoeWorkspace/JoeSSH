import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const { candidateDir, expectedSourceCommit, platform, root, standalone } =
  parseArgs(process.argv.slice(2));
const errors = [];

if (!standalone) {
  assertInsideRoot(candidateDir, "Candidate directory");
}
if (!standalone && candidateDir === root) {
  fail("Candidate directory cannot be the repository root.");
}

const files = readCandidateFiles();
const manifestEntries = readManifest(files);
const metadata = readJsonFile(
  resolve(candidateDir, "candidate-metadata.json"),
  "candidate metadata",
);
const version = standalone ? undefined : readAlignedVersion();

if (metadata !== null && version !== null) {
  validateMetadata(metadata, version, files, manifestEntries);
}
validateManifestCoverage(files, manifestEntries);

if (errors.length > 0) {
  fail(`Desktop candidate verification failed:\n- ${errors.join("\n- ")}`);
}

console.log(
  `Verified ${metadata.artifacts.length} unsigned ${platform} Desktop candidate artifact(s) in ${displayPath(candidateDir)}.`,
);
console.log(
  "Candidate remains ineligible for public release until formal platform signing evidence is imported and verified.",
);

function readCandidateFiles() {
  if (!existsSync(candidateDir)) {
    fail(`Missing candidate directory: ${displayPath(candidateDir)}.`);
  }
  if (!statSync(candidateDir).isDirectory()) {
    fail(`Candidate path is not a directory: ${displayPath(candidateDir)}.`);
  }

  const files = new Map();
  for (const entry of readdirSync(candidateDir, { withFileTypes: true })) {
    const path = resolve(candidateDir, entry.name);
    if (!entry.isFile()) {
      errors.push(`candidate directory contains non-file entry ${entry.name}`);
      continue;
    }
    files.set(entry.name, {
      bytes: statSync(path).size,
      path,
      sha256: sha256(path),
    });
  }
  return files;
}

function readManifest(files) {
  const manifestName = "SHA256SUMS.txt";
  const manifest = files.get(manifestName);
  if (!manifest) {
    errors.push(`missing candidate checksum manifest ${manifestName}`);
    return new Map();
  }

  const entries = new Map();
  readFileSync(manifest.path, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (line.trim() === "" || line.trimStart().startsWith("#")) return;
      const match = line.match(/^([a-f0-9]{64}) {2}([^/\\]+)$/);
      if (!match) {
        errors.push(
          `${manifestName}:${index + 1} is not '<lowercase-sha256>  <file-name>'`,
        );
        return;
      }

      const [, expectedHash, name] = match;
      if (entries.has(name)) {
        errors.push(`${manifestName}:${index + 1} duplicates ${name}`);
        return;
      }
      if (name === manifestName) {
        errors.push(`${manifestName}:${index + 1} cannot list itself`);
        return;
      }
      entries.set(name, expectedHash);

      const file = files.get(name);
      if (!file) {
        errors.push(
          `${manifestName}:${index + 1} references missing file ${name}`,
        );
      } else if (file.sha256 !== expectedHash) {
        errors.push(`${manifestName}:${index + 1} hash mismatch for ${name}`);
      }
    });

  if (entries.size === 0) {
    errors.push(`${manifestName} contains no checksum entries`);
  }
  return entries;
}

function readAlignedVersion() {
  const packageJson = readJsonFile(
    resolve(root, "package.json"),
    "package metadata",
  );
  const tauri = readJsonFile(
    resolve(root, "apps/desktop/src-tauri/tauri.conf.json"),
    "Tauri metadata",
  );
  if (packageJson === null || tauri === null) return null;

  if (typeof packageJson.version !== "string" || packageJson.version === "") {
    errors.push("package.json must contain a non-empty version");
    return null;
  }
  if (tauri.version !== packageJson.version) {
    errors.push(
      `Desktop candidate version mismatch: package.json=${packageJson.version}, tauri.conf.json=${String(tauri.version)}`,
    );
  }
  return packageJson.version;
}

function readJsonFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    errors.push(`missing ${label}: ${displayPath(path)}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(
      `unable to parse ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function validateMetadata(metadata, version, files, manifestEntries) {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    errors.push("candidate metadata must be a JSON object");
    return;
  }

  requireEqual(metadata.schemaVersion, 1, "schemaVersion");
  requireEqual(metadata.product, "JoeSSH Community", "product");
  requireEqual(metadata.platform, platform, "platform");
  if (version === undefined) {
    if (
      typeof metadata.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
        metadata.version,
      )
    ) {
      errors.push("candidate metadata version must be a semantic version");
    }
  } else {
    requireEqual(metadata.version, version, "version");
  }
  requireEqual(metadata.releaseEligible, false, "releaseEligible");
  requireEqual(metadata.signingStatus, "unverified", "signingStatus");

  if (!isCanonicalIsoTimestamp(metadata.generatedAt)) {
    errors.push("candidate metadata generatedAt must be an ISO timestamp");
  }

  if (
    metadata.sourceCommit !== null &&
    (typeof metadata.sourceCommit !== "string" ||
      !/^[a-f0-9]{40}$/.test(metadata.sourceCommit))
  ) {
    errors.push(
      "candidate metadata sourceCommit must be null or a lowercase 40-character Git SHA",
    );
  }
  if (
    expectedSourceCommit !== undefined &&
    metadata.sourceCommit !== expectedSourceCommit
  ) {
    errors.push(
      `candidate metadata sourceCommit must match ${expectedSourceCommit}, found ${String(metadata.sourceCommit)}`,
    );
  }

  if (!Array.isArray(metadata.artifacts) || metadata.artifacts.length === 0) {
    errors.push("candidate metadata must include at least one artifact");
    return;
  }

  const metadataNames = new Set();
  for (const [index, artifact] of metadata.artifacts.entries()) {
    const label = `artifacts[${index}]`;
    if (
      artifact === null ||
      typeof artifact !== "object" ||
      Array.isArray(artifact)
    ) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const name = artifact.name;
    if (
      typeof name !== "string" ||
      name === "" ||
      basename(name) !== name ||
      name.includes("\\")
    ) {
      errors.push(`${label}.name must be a file name without path segments`);
      continue;
    }
    if (metadataNames.has(name)) {
      errors.push(`${label}.name duplicates ${name}`);
      continue;
    }
    metadataNames.add(name);

    const artifactPlatform = classifyPlatform(name);
    if (artifactPlatform !== platform) {
      errors.push(
        `${label}.name is not a ${platform} Desktop artifact: ${name}`,
      );
    }

    const file = files.get(name);
    if (!file) {
      errors.push(`${label}.name references missing file ${name}`);
      continue;
    }
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) {
      errors.push(`${label}.bytes must be a positive safe integer`);
    } else if (artifact.bytes !== file.bytes) {
      errors.push(`${label}.bytes does not match ${name}`);
    }
    if (
      typeof artifact.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256)
    ) {
      errors.push(`${label}.sha256 must be a lowercase SHA256 digest`);
    } else {
      if (artifact.sha256 !== file.sha256) {
        errors.push(`${label}.sha256 does not match ${name}`);
      }
      if (manifestEntries.get(name) !== artifact.sha256) {
        errors.push(
          `${label}.sha256 does not match SHA256SUMS.txt for ${name}`,
        );
      }
    }
  }

  const reserved = new Set(["candidate-metadata.json", "SHA256SUMS.txt"]);
  for (const name of files.keys()) {
    if (!reserved.has(name) && !metadataNames.has(name)) {
      errors.push(`candidate metadata does not list file ${name}`);
    }
  }
}

function validateManifestCoverage(files, manifestEntries) {
  for (const name of files.keys()) {
    if (name !== "SHA256SUMS.txt" && !manifestEntries.has(name)) {
      errors.push(`SHA256SUMS.txt does not list candidate file ${name}`);
    }
  }
  for (const name of manifestEntries.keys()) {
    if (!files.has(name)) {
      errors.push(`SHA256SUMS.txt lists missing candidate file ${name}`);
    }
  }
}

function requireEqual(actual, expected, field) {
  if (actual !== expected) {
    errors.push(
      `candidate metadata ${field} must be ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
    );
  }
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function classifyPlatform(path) {
  const lower = path.toLowerCase();
  if (/\.(exe|msi|msix)$/.test(lower)) return "windows";
  if (
    lower.endsWith(".dmg") ||
    lower.endsWith(".pkg") ||
    lower.endsWith(".app.tar.gz")
  )
    return "macos";
  if (
    lower.endsWith(".appimage") ||
    lower.endsWith(".deb") ||
    lower.endsWith(".rpm")
  )
    return "linux";
  return null;
}

function parseArgs(args) {
  let candidatePath;
  let expectedSourceCommit;
  let platform;
  let root = defaultRoot;
  let standalone = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      root = resolve(readValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
    } else if (arg === "--candidate-dir") {
      candidatePath = readValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--candidate-dir=")) {
      candidatePath = arg.slice("--candidate-dir=".length);
    } else if (arg === "--platform") {
      platform = readValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--platform=")) {
      platform = arg.slice("--platform=".length);
    } else if (arg === "--source-commit") {
      expectedSourceCommit = readValue(args, index, arg).toLowerCase();
      index += 1;
    } else if (arg.startsWith("--source-commit=")) {
      expectedSourceCommit = arg.slice("--source-commit=".length).toLowerCase();
    } else if (arg === "--standalone") {
      standalone = true;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (!["windows", "macos", "linux"].includes(platform)) {
    fail("--platform must be one of windows, macos, or linux.");
  }
  if (
    expectedSourceCommit !== undefined &&
    !/^[a-f0-9]{40}$/.test(expectedSourceCommit)
  ) {
    fail("--source-commit must be a 40-character Git commit SHA.");
  }
  candidatePath ??= `reports/candidates/desktop/${platform}-unsigned`;
  return {
    candidateDir: resolve(root, candidatePath),
    expectedSourceCommit,
    platform,
    root,
    standalone,
  };
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${flag} requires a value.`);
  return value;
}

function assertInsideRoot(path, label) {
  const relativePath = relative(root, path);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    fail(`${label} must stay inside the repository root.`);
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function displayPath(path) {
  return relative(root, path).replace(/\\/g, "/") || basename(path);
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
