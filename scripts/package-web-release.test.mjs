import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import test from "node:test";

const PACKAGER_PATH = fileURLToPath(new URL("./package-web-release.mjs", import.meta.url));

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "web-release-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  writeFile(root, "apps/web/dist/index.html", "<!doctype html><div id=\"root\"></div>");
  writeFile(root, "apps/web/dist/_headers", "/*\n  X-Frame-Options: DENY\n");
  writeFile(root, "apps/web/dist/.well-known/security.txt", "Contact: mailto:security@example.com\n");
  writeFile(root, "reports/release/web/joessh-web-admin-0.0.0-old.zip", "stale");

  return root;
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function runPackager(root, extraArgs = []) {
  return spawnSync(process.execPath, [PACKAGER_PATH, "--root", root, ...extraArgs], {
    encoding: "utf8",
  });
}

function readZipEntries(path) {
  const archive = readFileSync(path);
  const endOfCentralDirectoryOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(endOfCentralDirectoryOffset, -1);

  const entryCount = archive.readUInt16LE(endOfCentralDirectoryOffset + 10);
  let offset = archive.readUInt32LE(endOfCentralDirectoryOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    assert.equal(archive.readUInt32LE(localHeaderOffset), 0x04034b50);
    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, compressionMethod === 8 ? inflateRawSync(compressed).toString("utf8") : compressed.toString("utf8"));

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("packages Web Admin dist into a checksum-covered zip", (t) => {
  const root = createFixture(t);
  const result = runPackager(root);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Packaged Web Admin release artifact/);

  const archivePath = join(root, "reports", "release", "web", "joessh-web-admin-0.1.0-beta.1.zip");
  const entries = readZipEntries(archivePath);
  assert.equal(entries.get("index.html"), "<!doctype html><div id=\"root\"></div>");
  assert.equal(entries.get("_headers"), "/*\n  X-Frame-Options: DENY\n");
  assert.equal(entries.get(".well-known/security.txt"), "Contact: mailto:security@example.com\n");

  const manifest = readFileSync(join(root, "reports", "release", "web", "SHA256SUMS.txt"), "utf8");
  assert.equal(manifest, `${sha256File(archivePath)}  reports/release/web/joessh-web-admin-0.1.0-beta.1.zip\n`);
  assert.throws(() => readFileSync(join(root, "reports", "release", "web", "joessh-web-admin-0.0.0-old.zip")));
});

test("rejects missing Web Admin dist", (t) => {
  const root = mkdtempSync(join(tmpdir(), "web-release-missing-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));

  const result = runPackager(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No Web Admin dist files found/);
});

test("rejects release output paths outside the repository root", (t) => {
  const root = createFixture(t);
  const outputResult = runPackager(root, ["--output", join(root, "..", "joessh-web-admin-outside.zip")]);
  const checksumResult = runPackager(root, ["--checksum", join(root, "..", "SHA256SUMS.txt")]);

  assert.equal(outputResult.status, 1);
  assert.match(outputResult.stderr, /Web Admin release output paths must stay inside the release root/);
  assert.equal(checksumResult.status, 1);
  assert.match(checksumResult.stderr, /Web Admin release output paths must stay inside the release root/);
});
