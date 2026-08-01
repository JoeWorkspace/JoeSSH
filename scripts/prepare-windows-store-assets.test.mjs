import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  STORE_SCREENSHOT_SLOTS,
  encodeSolidPng,
  generateProvisionalStoreAssetBundle,
  initializeStoreAssetCaptureSession,
  prepareStoreAssetBundle,
  verifyStoreAssetBundle,
} from "./prepare-windows-store-assets.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("pins eight localized scene slots with light and dark coverage", () => {
  assert.equal(STORE_SCREENSHOT_SLOTS.length, 8);
  assert.deepEqual(
    STORE_SCREENSHOT_SLOTS.map(({ locale, scene, theme }) => ({
      locale,
      scene,
      theme,
    })),
    [
      { locale: "en-US", scene: "connected-terminal", theme: "light" },
      { locale: "en-US", scene: "host-key-review", theme: "dark" },
      { locale: "en-US", scene: "sftp-transfer", theme: "light" },
      { locale: "en-US", scene: "port-forward-stopped", theme: "dark" },
      { locale: "zh-CN", scene: "connected-terminal", theme: "light" },
      { locale: "zh-CN", scene: "host-key-review", theme: "dark" },
      { locale: "zh-CN", scene: "sftp-transfer", theme: "light" },
      { locale: "zh-CN", scene: "port-forward-stopped", theme: "dark" },
    ],
  );
  assert.equal(new Set(STORE_SCREENSHOT_SLOTS.map(({ path }) => path)).size, 8);
});

test("provisional references remain fail-closed while brand art is reproducible", (t) => {
  const root = temporaryDirectory(t);
  const firstOutput = join(root, "provisional-a");
  const secondOutput = join(root, "provisional-b");
  const first = generateProvisionalStoreAssetBundle({
    outputDir: firstOutput,
    root: repositoryRoot,
  });
  const second = generateProvisionalStoreAssetBundle({
    outputDir: secondOutput,
    root: repositoryRoot,
  });

  assert.equal(first.status, "provisional-not-uploadable");
  assert.equal(first.submissionAuthorization, "blocked");
  assert.equal(first.candidateBinding, null);
  assert.equal(first.screenshots.length, 8);
  assert.equal(
    first.screenshots.every(({ path }) => path === null),
    true,
  );
  assert.equal(
    first.screenshots.every(({ compositionReference }) =>
      compositionReference.limitations.includes("not-uploadable"),
    ),
    true,
  );
  assert.deepEqual(
    first.brandAssets.map(({ aspectRatio, sha256 }) => ({
      aspectRatio,
      sha256,
    })),
    second.brandAssets.map(({ aspectRatio, sha256 }) => ({
      aspectRatio,
      sha256,
    })),
  );
  assert.throws(
    () =>
      verifyStoreAssetBundle({
        bundleDir: firstOutput,
        root: repositoryRoot,
      }),
    /provisional-not-uploadable/,
  );
});

test("prepares and verifies a candidate-bound final asset bundle", (t) => {
  const fixture = createCompleteCaptureFixture(t);
  const outputDir = join(fixture.root, "prepared");
  const manifest = prepareStoreAssetBundle({
    ...fixture.options,
    confirmExactCandidate: true,
    outputDir,
    root: repositoryRoot,
  });

  assert.equal(manifest.status, "candidate-bound-final");
  assert.equal(manifest.submissionAuthorization, "requires-final-human-review");
  assert.equal(manifest.screenshots.length, 8);
  assert.equal(
    new Set(manifest.screenshots.map(({ sha256 }) => sha256)).size,
    8,
  );
  assert.deepEqual(
    manifest.brandAssets.map(({ aspectRatio, height, width }) => ({
      aspectRatio,
      height,
      width,
    })),
    [
      { aspectRatio: "1:1", height: 1024, width: 1024 },
      { aspectRatio: "2:3", height: 1536, width: 1024 },
    ],
  );
  assert.equal(
    verifyStoreAssetBundle({
      bundleDir: outputDir,
      candidatePath: fixture.options.candidatePath,
      candidateEvidencePath: fixture.options.candidateEvidencePath,
      root: repositoryRoot,
    }).status,
    "candidate-bound-final",
  );

  const checksums = readFileSync(join(outputDir, "SHA256SUMS.txt"), "ascii");
  assert.match(checksums, /candidate-binding\.json/);
  for (const slot of STORE_SCREENSHOT_SLOTS)
    assert.match(checksums, new RegExp(escapeRegExp(slot.path)));
});

test("rejects capture and final output paths inside the repository", (t) => {
  const insideRepository = join(
    repositoryRoot,
    "reports",
    "store-assets-private-boundary-test",
  );
  assert.throws(
    () =>
      initializeStoreAssetCaptureSession({
        candidatePath: join(insideRepository, "missing.msix"),
        candidateEvidencePath: join(insideRepository, "missing.json"),
        captureDir: insideRepository,
      }),
    /must stay outside the repository/,
  );

  const fixture = createCompleteCaptureFixture(t);
  assert.throws(
    () =>
      prepareStoreAssetBundle({
        ...fixture.options,
        confirmExactCandidate: true,
        outputDir: insideRepository,
        root: repositoryRoot,
      }),
    /must stay outside the repository/,
  );
});

test("requires explicit exact-candidate confirmation", (t) => {
  const fixture = createCompleteCaptureFixture(t);
  assert.throws(
    () =>
      prepareStoreAssetBundle({
        ...fixture.options,
        outputDir: join(fixture.root, "prepared"),
        root: repositoryRoot,
      }),
    /confirm-exact-candidate-captures/,
  );
});

test("rejects duplicate screenshots instead of promoting repeated references", (t) => {
  const fixture = createCaptureFixture(t);
  const duplicate = encodeSolidPng(1920, 1080, [20, 30, 40, 255]);
  for (const slot of STORE_SCREENSHOT_SLOTS) {
    writeFixtureFile(fixture.options.captureDir, slot.path, duplicate);
  }
  assert.throws(
    () =>
      prepareStoreAssetBundle({
        ...fixture.options,
        confirmExactCandidate: true,
        outputDir: join(fixture.root, "prepared"),
        root: repositoryRoot,
      }),
    /eight distinct image files/,
  );
});

test("rejects screenshots with dimensions outside the pinned capture contract", (t) => {
  const fixture = createCaptureFixture(t);
  for (let index = 0; index < STORE_SCREENSHOT_SLOTS.length; index += 1) {
    const slot = STORE_SCREENSHOT_SLOTS[index];
    const width = index === 0 ? 1366 : 1920;
    writeFixtureFile(
      fixture.options.captureDir,
      slot.path,
      encodeSolidPng(width, 1080, [index * 20, 40, 80, 255]),
    );
  }
  assert.throws(
    () =>
      prepareStoreAssetBundle({
        ...fixture.options,
        confirmExactCandidate: true,
        outputDir: join(fixture.root, "prepared"),
        root: repositoryRoot,
      }),
    /must be exactly 1920x1080/,
  );
});

test("rejects PNG metadata, ancillary payloads, APNG, and unknown chunks", (t) => {
  const fixture = createCompleteCaptureFixture(t);
  const firstScreenshotPath = join(
    fixture.options.captureDir,
    ...STORE_SCREENSHOT_SLOTS[0].path.split("/"),
  );
  const cleanScreenshot = readFileSync(firstScreenshotPath);
  const disallowedChunks = [
    "tEXt",
    "zTXt",
    "iTXt",
    "eXIf",
    "iCCP",
    "tIME",
    "pHYs",
    "acTL",
    "raNd",
    "ABCD",
  ];

  for (const chunkType of disallowedChunks) {
    writeFileSync(
      firstScreenshotPath,
      insertPngChunk(
        cleanScreenshot,
        chunkType,
        Buffer.from("fixture-key\0sensitive-value", "utf8"),
      ),
    );
    assert.throws(
      () =>
        prepareStoreAssetBundle({
          ...fixture.options,
          confirmExactCandidate: true,
          outputDir: join(fixture.root, `prepared-${chunkType}`),
          root: repositoryRoot,
        }),
      new RegExp(`disallowed PNG chunk ${chunkType}`),
    );
  }
});

test("rejects corrupt or trailing PNG compressed image data", (t) => {
  const fixture = createCompleteCaptureFixture(t);
  const firstScreenshotPath = join(
    fixture.options.captureDir,
    ...STORE_SCREENSHOT_SLOTS[0].path.split("/"),
  );
  const cleanScreenshot = readFileSync(firstScreenshotPath);
  const invalidScreenshots = [
    rewriteFirstPngChunk(cleanScreenshot, "IDAT", () =>
      Buffer.from("not-a-zlib-stream", "ascii"),
    ),
    rewriteFirstPngChunk(cleanScreenshot, "IDAT", (data) =>
      Buffer.concat([data, Buffer.from("hidden-trailing-payload", "ascii")]),
    ),
  ];

  for (const [index, screenshot] of invalidScreenshots.entries()) {
    writeFileSync(firstScreenshotPath, screenshot);
    assert.throws(
      () =>
        prepareStoreAssetBundle({
          ...fixture.options,
          confirmExactCandidate: true,
          outputDir: join(fixture.root, `prepared-invalid-idat-${index}`),
          root: repositoryRoot,
        }),
      /invalid compressed PNG image data|does not exactly match its declared dimensions/,
    );
  }
});

test("rejects brand art that was not generated from the reviewed master icon", (t) => {
  const fixture = createCompleteCaptureFixture(t);
  const outputDir = join(fixture.root, "prepared");
  prepareStoreAssetBundle({
    ...fixture.options,
    confirmExactCandidate: true,
    outputDir,
    root: repositoryRoot,
  });

  const manifestPath = join(outputDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const brandPath = join(outputDir, ...manifest.brandAssets[0].path.split("/"));
  const replacement = encodeSolidPng(1024, 1024, [220, 20, 60, 255]);
  writeFileSync(brandPath, replacement);
  manifest.brandAssets[0].sha256 = sha256(replacement);
  manifest.brandAssets[0].sizeBytes = replacement.length;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  rewriteFinalBundleChecksums(outputDir, manifest);

  assert.throws(
    () =>
      verifyStoreAssetBundle({
        bundleDir: outputDir,
        candidatePath: fixture.options.candidatePath,
        candidateEvidencePath: fixture.options.candidateEvidencePath,
        root: repositoryRoot,
      }),
    /not deterministically generated from the reviewed JoeSSH master icon/,
  );
});

test("rejects candidate drift after capture-session initialization", (t) => {
  const fixture = createCompleteCaptureFixture(t);
  writeFileSync(
    fixture.options.candidatePath,
    Buffer.from("replacement candidate"),
  );
  writeCandidateEvidence(
    fixture.options.candidatePath,
    fixture.options.candidateEvidencePath,
  );
  assert.throws(
    () =>
      prepareStoreAssetBundle({
        ...fixture.options,
        confirmExactCandidate: true,
        outputDir: join(fixture.root, "prepared"),
        root: repositoryRoot,
      }),
    /changed since capture-session initialization/,
  );
});

test("rejects tampered final screenshots and stale checksum evidence", (t) => {
  const fixture = createCompleteCaptureFixture(t);
  const outputDir = join(fixture.root, "prepared");
  prepareStoreAssetBundle({
    ...fixture.options,
    confirmExactCandidate: true,
    outputDir,
    root: repositoryRoot,
  });
  const screenshotPath = join(
    outputDir,
    ...STORE_SCREENSHOT_SLOTS[0].path.split("/"),
  );
  const bytes = readFileSync(screenshotPath);
  bytes[bytes.length - 5] ^= 0xff;
  writeFileSync(screenshotPath, bytes);

  assert.throws(
    () =>
      verifyStoreAssetBundle({
        bundleDir: outputDir,
        candidatePath: fixture.options.candidatePath,
        candidateEvidencePath: fixture.options.candidateEvidencePath,
        root: repositoryRoot,
      }),
    /corrupt .* PNG chunk|invalid PNG chunk type|does not match its manifest evidence|stale or incomplete/,
  );
});

function createCompleteCaptureFixture(t) {
  const fixture = createCaptureFixture(t);
  for (let index = 0; index < STORE_SCREENSHOT_SLOTS.length; index += 1) {
    writeFixtureFile(
      fixture.options.captureDir,
      STORE_SCREENSHOT_SLOTS[index].path,
      encodeSolidPng(1920, 1080, [
        20 + index * 20,
        45 + index,
        90 + index * 2,
        255,
      ]),
    );
  }
  return fixture;
}

function createCaptureFixture(t) {
  const root = temporaryDirectory(t);
  const candidatePath = join(root, "JoeSSH.msix");
  const candidateEvidencePath = join(root, "candidate.json");
  const captureDir = join(root, "captures");
  writeFileSync(candidatePath, Buffer.from("candidate bytes"));
  writeCandidateEvidence(candidatePath, candidateEvidencePath);
  initializeStoreAssetCaptureSession({
    candidatePath,
    candidateEvidencePath,
    captureDir,
  });
  return {
    root,
    options: { candidatePath, candidateEvidencePath, captureDir },
  };
}

function writeCandidateEvidence(candidatePath, evidencePath) {
  const bytes = readFileSync(candidatePath);
  writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        schemaVersion: 3,
        kind: "windows-store-candidate",
        format: "msix",
        version: "0.1.0-beta.10",
        artifact: {
          fileName: "JoeSSH.msix",
          sha256: sha256(bytes),
          sizeBytes: bytes.length,
        },
        gates: {
          artifactHashBound: true,
          candidatePreflightPassed: true,
          storePublicationReady: false,
        },
        storeSubmission: {
          certificationStatus: "not-run",
          status: "not-submitted",
        },
      },
      null,
      2,
    )}\n`,
  );
}

function temporaryDirectory(t) {
  const root = mkdtempSync(join(tmpdir(), "joessh-store-assets-test-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

function writeFixtureFile(root, path, contents) {
  const destination = join(root, ...path.split("/"));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function insertPngChunk(png, type, data) {
  const ihdrLength = png.readUInt32BE(8);
  const insertionOffset = 8 + 12 + ihdrLength;
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    testCrc32(Buffer.concat([typeBytes, data])),
    data.length + 8,
  );
  return Buffer.concat([
    png.subarray(0, insertionOffset),
    chunk,
    png.subarray(insertionOffset),
  ]);
}

function rewriteFirstPngChunk(png, requestedType, rewrite) {
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const chunkEnd = offset + length + 12;
    if (type === requestedType) {
      const data = rewrite(png.subarray(offset + 8, offset + 8 + length));
      const typeBytes = Buffer.from(type, "ascii");
      const replacement = Buffer.alloc(data.length + 12);
      replacement.writeUInt32BE(data.length, 0);
      typeBytes.copy(replacement, 4);
      data.copy(replacement, 8);
      replacement.writeUInt32BE(
        testCrc32(Buffer.concat([typeBytes, data])),
        data.length + 8,
      );
      return Buffer.concat([
        png.subarray(0, offset),
        replacement,
        png.subarray(chunkEnd),
      ]);
    }
    offset = chunkEnd;
  }
  throw new Error(`Missing ${requestedType} fixture chunk.`);
}

function rewriteFinalBundleChecksums(outputDir, manifest) {
  const paths = [
    "candidate-binding.json",
    ...manifest.brandAssets.map(({ path }) => path),
    ...manifest.screenshots.map(({ path }) => path),
    "manifest.json",
  ].sort();
  const lines = paths.map((path) => {
    const absolute = join(outputDir, ...path.split("/"));
    return `${sha256(readFileSync(absolute))}  ${path}`;
  });
  writeFileSync(join(outputDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
}

const TEST_CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function testCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = TEST_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
