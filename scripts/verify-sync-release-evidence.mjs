import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const { evidencePath, root } = parseArgs(process.argv.slice(2));
const evidenceReleasePath = toReleasePath(evidencePath);
const evidenceChecksumPath = resolve(root, "reports", "release", "sync", "backup-restore-smoke-SHA256SUMS.txt");
const errors = [];

if (!existsSync(evidencePath)) {
  fail(`Missing Sync backup/restore release evidence: ${evidenceReleasePath}`);
}

const evidence = readEvidence();
verifyEvidenceChecksum();
verifyPackagedBinaryBinding(evidence);

if (errors.length > 0) {
  fail(`Sync release evidence verification failed:\n- ${errors.join("\n- ")}`);
}

console.log(`Verified Sync release evidence ${evidenceReleasePath}.`);

function readEvidence() {
  try {
    return JSON.parse(readFileSync(evidencePath, "utf8"));
  } catch (error) {
    fail(`Sync backup/restore evidence is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function verifyEvidenceChecksum() {
  if (!existsSync(evidenceChecksumPath)) {
    errors.push(`missing evidence checksum manifest ${toReleasePath(evidenceChecksumPath)}`);
    return;
  }

  const expectedHash = readChecksumManifestArtifactHashes(evidenceChecksumPath).get(evidenceReleasePath);
  if (!expectedHash) {
    errors.push(`evidence checksum manifest does not list ${evidenceReleasePath}`);
    return;
  }

  const actualHash = sha256(evidencePath);
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    errors.push(`evidence checksum manifest hash mismatch for ${evidenceReleasePath}`);
  }
}

function verifyPackagedBinaryBinding(evidence) {
  if (evidence.binaryKind !== "packaged-release") {
    errors.push("backup/restore evidence must be produced from binaryKind packaged-release");
  }

  const binaryPath = evidence.binary;
  if (!isSafeRelativePath(binaryPath) || !binaryPath.startsWith("reports/release/sync/joessh-sync-")) {
    errors.push("backup/restore evidence binary must point at a staged reports/release/sync/joessh-sync artifact");
    return;
  }

  const manifestPath = evidence.binaryManifest;
  if (manifestPath !== "reports/release/sync/SHA256SUMS.txt") {
    errors.push("backup/restore evidence binaryManifest must be reports/release/sync/SHA256SUMS.txt");
    return;
  }

  const fullBinaryPath = resolve(root, binaryPath);
  const fullManifestPath = resolve(root, manifestPath);
  if (!existsSync(fullBinaryPath)) {
    errors.push(`backup/restore evidence binary is missing: ${binaryPath}`);
    return;
  }
  if (!existsSync(fullManifestPath)) {
    errors.push(`backup/restore evidence binary manifest is missing: ${manifestPath}`);
    return;
  }

  const actualBinarySha256 = sha256(fullBinaryPath);
  if (evidence.binarySha256 !== actualBinarySha256) {
    errors.push("backup/restore evidence binarySha256 does not match the staged binary");
  }

  const manifestHash = readChecksumManifestArtifactHashes(fullManifestPath).get(binaryPath);
  if (!manifestHash) {
    errors.push(`sync checksum manifest does not list evidence binary ${binaryPath}`);
  } else if (manifestHash.toLowerCase() !== actualBinarySha256.toLowerCase()) {
    errors.push(`sync checksum manifest hash does not match evidence binary ${binaryPath}`);
  }
}

function readChecksumManifestArtifactHashes(path) {
  const hashes = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }
    const match = line.match(/^([a-fA-F0-9]{64})\s\s(.+)$/);
    if (match) {
      hashes.set(match[2].replaceAll("\\", "/"), match[1]);
    }
  }
  return hashes;
}

function isSafeRelativePath(path) {
  return (
    typeof path === "string" &&
    path !== "" &&
    !path.startsWith("/") &&
    !path.startsWith("../") &&
    !path.includes("/../") &&
    !isAbsolute(path)
  );
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArgs(args) {
  let root = defaultRoot;
  let evidencePath = "reports/release/sync/backup-restore-smoke.json";

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
    if (arg === "--evidence") {
      evidencePath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--evidence=")) {
      evidencePath = arg.slice("--evidence=".length);
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    evidencePath: resolve(root, evidencePath),
    root,
  };
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value.`);
  }
  return value;
}

function toReleasePath(path) {
  return relative(root, path).replace(/\\/g, "/") || basename(path);
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
