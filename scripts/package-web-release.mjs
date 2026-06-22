import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

const defaultRoot = resolve(import.meta.dirname, "..");
const { checksumPath, distDir, outputPath, root } = parseArgs(process.argv.slice(2));
const crcTable = buildCrcTable();

if (!isInsideRoot(outputPath) || !isInsideRoot(checksumPath)) {
  fail("Web Admin release output paths must stay inside the release root.");
}

const files = collectFiles(distDir);
if (files.length === 0) {
  fail(`No Web Admin dist files found in ${displayPath(distDir)}. Run npm run build:web first.`);
}

mkdirSync(resolve(outputPath, ".."), { recursive: true });
removeStaleWebArchives(resolve(outputPath, ".."), outputPath);
writeFileSync(outputPath, createZipBuffer(files));
writeFileSync(checksumPath, `${sha256(outputPath)}  ${toReleasePath(outputPath)}\n`);

console.log(`Packaged Web Admin release artifact ${toReleasePath(outputPath)} with ${files.length} file(s).`);
console.log(`Wrote ${toReleasePath(checksumPath)}`);

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

  return readdirSync(path)
    .flatMap((name) => collectFiles(join(path, name)))
    .sort((left, right) => relative(distDir, left).localeCompare(relative(distDir, right)));
}

function removeStaleWebArchives(outputDir, currentOutputPath) {
  if (!existsSync(outputDir)) {
    return;
  }

  for (const entry of readdirSync(outputDir, { withFileTypes: true })) {
    const path = resolve(outputDir, entry.name);
    if (entry.isFile() && /^joessh-web-admin-.+\.zip$/.test(entry.name) && path !== currentOutputPath) {
      rmSync(path);
    }
  }
}

function createZipBuffer(filesToPackage) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;

  for (const file of filesToPackage) {
    const name = zipEntryName(file);
    const nameBuffer = Buffer.from(name, "utf8");
    const contents = readFileSync(file);
    const compressed = deflateRawSync(contents, { level: 9 });
    const crc = crc32(contents);

    const localHeader = createLocalHeader({ compressed, contents, crc, nameBuffer });
    chunks.push(localHeader, nameBuffer, compressed);
    centralDirectory.push(
      createCentralDirectoryHeader({
        compressed,
        contents,
        crc,
        localHeaderOffset: offset,
        nameBuffer,
      }),
      nameBuffer,
    );
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralDirectory.reduce((total, chunk) => total + chunk.length, 0);
  const endOfCentralDirectory = createEndOfCentralDirectory({
    centralDirectoryOffset,
    centralDirectorySize,
    entryCount: filesToPackage.length,
  });

  return Buffer.concat([...chunks, ...centralDirectory, endOfCentralDirectory]);
}

function createLocalHeader({ compressed, contents, crc, nameBuffer }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(contents.length, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function createCentralDirectoryHeader({ compressed, contents, crc, localHeaderOffset, nameBuffer }) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(33, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressed.length, 20);
  header.writeUInt32LE(contents.length, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0o100644 * 0x10000, 38);
  header.writeUInt32LE(localHeaderOffset, 42);
  return header;
}

function createEndOfCentralDirectory({ centralDirectoryOffset, centralDirectorySize, entryCount }) {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entryCount, 8);
  header.writeUInt16LE(entryCount, 10);
  header.writeUInt32LE(centralDirectorySize, 12);
  header.writeUInt32LE(centralDirectoryOffset, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

function zipEntryName(file) {
  const entry = relative(distDir, file).replace(/\\/g, "/");
  if (entry === "" || entry.startsWith("../") || isAbsolute(entry)) {
    fail(`Refusing to package file outside Web Admin dist: ${displayPath(file)}`);
  }
  return entry;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function parseArgs(args) {
  let root = defaultRoot;
  let distPath = "apps/web/dist";
  let outputPath = null;
  let checksumPath = null;

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
    if (arg === "--dist") {
      const value = args[index + 1];
      if (!value) {
        fail("--dist requires a path.");
      }
      distPath = value;
      index += 1;
      continue;
    }
    if (arg === "--output") {
      const value = args[index + 1];
      if (!value) {
        fail("--output requires a path.");
      }
      outputPath = value;
      index += 1;
      continue;
    }
    if (arg === "--checksum") {
      const value = args[index + 1];
      if (!value) {
        fail("--checksum requires a path.");
      }
      checksumPath = value;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  const version = readVersion(root);
  const resolvedOutputPath = resolve(root, outputPath ?? `reports/release/web/joessh-web-admin-${version}.zip`);
  return {
    checksumPath: resolve(root, checksumPath ?? "reports/release/web/SHA256SUMS.txt"),
    distDir: resolve(root, distPath),
    outputPath: resolvedOutputPath,
    root,
  };
}

function readVersion(rootPath) {
  const packageJsonPath = resolve(rootPath, "package.json");
  if (!existsSync(packageJsonPath)) {
    fail(`Missing package.json at ${displayPath(packageJsonPath, rootPath)}`);
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.trim() === "") {
    fail("Root package.json must include a version.");
  }
  return packageJson.version;
}

function toReleasePath(path) {
  return relative(root, path).replace(/\\/g, "/");
}

function displayPath(path, rootPath = defaultRoot) {
  return relative(rootPath, path).replace(/\\/g, "/") || basename(path);
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
