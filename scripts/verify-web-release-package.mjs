import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

import { scanWebAdminTextForTokenLeaks } from "./check-web-admin-bundle-token-scan.mjs";

const defaultRoot = resolve(import.meta.dirname, "..");
const { artifactPath, manifestPath, root } = parseArgs(process.argv.slice(2));
const artifactReleasePath = toReleasePath(artifactPath);
const errors = [];

if (!existsSync(artifactPath)) {
  fail(`Missing Web Admin release package: ${artifactReleasePath}`);
}
if (!existsSync(manifestPath)) {
  fail(`Missing Web Admin checksum manifest: ${toReleasePath(manifestPath)}`);
}

verifyChecksumManifest();
const entries = readZipEntries(artifactPath);
verifyRequiredEntries(entries);
verifyDeploymentHeaders(entries.get("_headers")?.toString("utf8") ?? "");
verifyManifest(entries.get("manifest.json")?.toString("utf8") ?? "");
verifyTextAssetsForTokenLeaks(entries);

if (errors.length > 0) {
  fail(`Web Admin release package verification failed:\n- ${errors.join("\n- ")}`);
}

console.log(`Verified Web Admin release package ${artifactReleasePath} (${entries.size} file(s)).`);

function verifyChecksumManifest() {
  const expectedHash = readChecksumManifestArtifactHashes(manifestPath).get(artifactReleasePath);
  if (!expectedHash) {
    errors.push(`checksum manifest does not list ${artifactReleasePath}`);
    return;
  }

  const actualHash = sha256(artifactPath);
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    errors.push(`checksum manifest hash mismatch for ${artifactReleasePath}`);
  }
}

function verifyRequiredEntries(entries) {
  const requiredEntries = [
    ".well-known/security.txt",
    "_headers",
    "404.html",
    "favicon.svg",
    "humans.txt",
    "index.html",
    "manifest.json",
    "offline.html",
    "robots.txt",
    "sw.js",
  ];

  for (const entry of requiredEntries) {
    if (!entries.has(entry)) {
      errors.push(`missing required zip entry ${entry}`);
    }
  }

  if (![...entries.keys()].some((entry) => /^assets\/.+\.js$/i.test(entry))) {
    errors.push("missing built JavaScript assets under assets/");
  }
  if (![...entries.keys()].some((entry) => /^assets\/.+\.css$/i.test(entry))) {
    errors.push("missing built CSS assets under assets/");
  }
}

function verifyDeploymentHeaders(headers) {
  const requiredHeaders = [
    ["deployment Content-Security-Policy frame-ancestors", /^\s*Content-Security-Policy:\s*frame-ancestors\s+'none'\s*$/im],
    ["deployment X-Frame-Options", /^\s*X-Frame-Options:\s*DENY\s*$/im],
    ["deployment X-Content-Type-Options", /^\s*X-Content-Type-Options:\s*nosniff\s*$/im],
    ["deployment Referrer-Policy", /^\s*Referrer-Policy:\s*strict-origin-when-cross-origin\s*$/im],
    [
      "deployment Permissions-Policy",
      /^\s*Permissions-Policy:.*camera=\(\).*microphone=\(\).*geolocation=\(\).*payment=\(\).*usb=\(\).*magnetometer=\(\).*gyroscope=\(\).*accelerometer=\(\)/im,
    ],
  ];

  for (const [label, pattern] of requiredHeaders) {
    if (!pattern.test(headers)) {
      errors.push(`_headers missing ${label}`);
    }
  }
}

function verifyManifest(manifestText) {
  try {
    const manifest = JSON.parse(manifestText);
    if (manifest.name !== "JoeSSH Admin") {
      errors.push("manifest.json name must be JoeSSH Admin");
    }
    if (manifest.start_url !== "/" || manifest.scope !== "/") {
      errors.push("manifest.json start_url and scope must target the Web Admin root");
    }
    if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
      errors.push("manifest.json must include at least one icon");
    }
  } catch (error) {
    errors.push(`manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function verifyTextAssetsForTokenLeaks(entries) {
  const leaks = [];
  for (const [entryName, contents] of entries) {
    if (isTextLikeWebAsset(entryName)) {
      leaks.push(...scanWebAdminTextForTokenLeaks(contents.toString("utf8"), entryName));
    }
  }

  for (const leak of leaks) {
    errors.push(`${leak.filePath}: ${leak.label}`);
  }
}

function readZipEntries(path) {
  const archive = readFileSync(path);
  const endOfCentralDirectoryOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOfCentralDirectoryOffset === -1) {
    fail(`${toReleasePath(path)} is not a ZIP archive`);
  }

  const entryCount = archive.readUInt16LE(endOfCentralDirectoryOffset + 10);
  let offset = archive.readUInt32LE(endOfCentralDirectoryOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      fail(`${toReleasePath(path)} has an invalid ZIP central directory`);
    }

    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const entryName = archive.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    const normalizedEntryName = normalizeZipEntryName(entryName);

    if (archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      fail(`${toReleasePath(path)} has an invalid ZIP local file header for ${entryName}`);
    }
    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    entries.set(normalizedEntryName, inflateZipEntry(compressed, compressionMethod, normalizedEntryName));

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function inflateZipEntry(compressed, compressionMethod, entryName) {
  if (compressionMethod === 0) {
    return Buffer.from(compressed);
  }
  if (compressionMethod === 8) {
    return inflateRawSync(compressed);
  }
  fail(`Unsupported ZIP compression method ${compressionMethod} for ${entryName}`);
}

function normalizeZipEntryName(entryName) {
  const normalized = entryName.replaceAll("\\", "/");
  if (
    normalized === "" ||
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    isAbsolute(normalized)
  ) {
    fail(`Unsafe ZIP entry path: ${entryName}`);
  }
  return normalized;
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

function isTextLikeWebAsset(entryName) {
  return (
    entryName === "_headers" ||
    entryName.endsWith("security.txt") ||
    /\.(?:css|html|js|json|map|mjs|svg|txt|webmanifest|xml)$/i.test(entryName)
  );
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArgs(args) {
  let root = defaultRoot;
  let artifactPath = null;
  let manifestPath = "reports/release/web/SHA256SUMS.txt";

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
    if (arg === "--artifact") {
      artifactPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      artifactPath = arg.slice("--artifact=".length);
      continue;
    }
    if (arg === "--manifest") {
      manifestPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--manifest=")) {
      manifestPath = arg.slice("--manifest=".length);
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
  return {
    artifactPath: resolve(root, artifactPath ?? `reports/release/web/joessh-web-admin-${version}.zip`),
    manifestPath: resolve(root, manifestPath),
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
