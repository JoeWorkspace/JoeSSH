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
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
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

test("rejects hand-written minimal candidate evidence", (t) => {
  const root = temporaryDirectory(t);
  const evidenceRoot = join(root, "candidate-evidence");
  mkdirSync(evidenceRoot);
  const candidatePath = join(evidenceRoot, "JoeSSH.msix");
  const candidateEvidencePath = join(evidenceRoot, "candidate.json");
  const candidateBytes = Buffer.from("not a real package");
  writeFileSync(candidatePath, candidateBytes);
  writeFileSync(
    candidateEvidencePath,
    `${JSON.stringify(
      {
        schemaVersion: 3,
        kind: "windows-store-candidate",
        format: "msix",
        version: "0.1.0-beta.10",
        artifact: {
          fileName: "JoeSSH.msix",
          sha256: sha256(candidateBytes),
          sizeBytes: candidateBytes.length,
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

  assert.throws(
    () =>
      initializeStoreAssetCaptureSession({
        candidatePath,
        candidateEvidencePath,
        captureDir: join(root, "captures"),
      }),
    /generated evidence schema|complete schema v3/,
  );
});

test("rejects an inconsistent pending Store-signing state", (t) => {
  const root = temporaryDirectory(t);
  const evidenceRoot = join(root, "candidate-evidence");
  mkdirSync(evidenceRoot);
  const candidatePath = join(evidenceRoot, "JoeSSH.msix");
  const candidateEvidencePath = join(evidenceRoot, "candidate.json");
  writeFileSync(candidatePath, Buffer.from("candidate bytes"));
  writeCandidateEvidence(candidatePath, candidateEvidencePath, (evidence) => ({
    ...evidence,
    verification: {
      ...evidence.verification,
      signature: {
        ...evidence.verification.signature,
        status: "Valid",
      },
    },
  }));

  assert.throws(
    () =>
      initializeStoreAssetCaptureSession({
        candidatePath,
        candidateEvidencePath,
        captureDir: join(root, "captures"),
      }),
    /Pending Store-only MSIX signing evidence is inconsistent/,
  );
});

test("rejects incomplete MSIX semantic and Partner Center evidence", (t) => {
  const root = temporaryDirectory(t);
  const evidenceRoot = join(root, "candidate-evidence");
  mkdirSync(evidenceRoot);
  const candidatePath = join(evidenceRoot, "JoeSSH.msix");
  const candidateEvidencePath = join(evidenceRoot, "candidate.json");
  writeFileSync(candidatePath, Buffer.from("candidate bytes"));

  const mutations = [
    (evidence) => ({
      ...evidence,
      verification: {
        ...evidence.verification,
        partnerIdentityCrossCheck: null,
      },
    }),
    (evidence) => ({
      ...evidence,
      verification: {
        ...evidence.verification,
        desktopApplication: null,
      },
    }),
    (evidence) => ({
      ...evidence,
      verification: {
        ...evidence.verification,
        manifest: { ...evidence.verification.manifest, version: "0.1.0.9" },
      },
    }),
  ];

  for (const [index, mutate] of mutations.entries()) {
    writeCandidateEvidence(candidatePath, candidateEvidencePath, mutate);
    assert.throws(
      () =>
        initializeStoreAssetCaptureSession({
          candidatePath,
          candidateEvidencePath,
          captureDir: join(root, `captures-invalid-msix-${index}`),
        }),
      /MSIX .*evidence|MSIX candidate identity or semantic verification is invalid/,
    );
  }
});

test("accepts complete EXE signer evidence and rejects signer drift", (t) => {
  const root = temporaryDirectory(t);
  const evidenceRoot = join(root, "candidate-evidence");
  mkdirSync(evidenceRoot);
  const candidatePath = join(evidenceRoot, "JoeSSH.exe");
  const candidateEvidencePath = join(evidenceRoot, "candidate.json");
  writeFileSync(candidatePath, Buffer.from("candidate bytes"));
  writeCandidateEvidence(candidatePath, candidateEvidencePath, toExeEvidence);

  assert.doesNotThrow(() =>
    initializeStoreAssetCaptureSession({
      candidatePath,
      candidateEvidencePath,
      captureDir: join(root, "captures-valid"),
    }),
  );

  writeCandidateEvidence(candidatePath, candidateEvidencePath, (evidence) => {
    const exe = toExeEvidence(evidence);
    return {
      ...exe,
      verification: {
        ...exe.verification,
        signerPolicy: {
          ...exe.verification.signerPolicy,
          expectedThumbprint: "B".repeat(40),
        },
      },
    };
  });
  assert.throws(
    () =>
      initializeStoreAssetCaptureSession({
        candidatePath,
        candidateEvidencePath,
        captureDir: join(root, "captures-invalid"),
      }),
    /EXE candidate signer or installed-payload evidence is invalid/,
  );
});

test("rejects EXE evidence with a missing signer subject", (t) => {
  const root = temporaryDirectory(t);
  const evidenceRoot = join(root, "candidate-evidence");
  mkdirSync(evidenceRoot);
  const candidatePath = join(evidenceRoot, "JoeSSH.exe");
  const candidateEvidencePath = join(evidenceRoot, "candidate.json");
  writeFileSync(candidatePath, Buffer.from("candidate bytes"));
  writeCandidateEvidence(candidatePath, candidateEvidencePath, (evidence) => {
    const exe = toExeEvidence(evidence);
    const withoutSubject = {
      ...exe.verification.installerSignature,
      signerSubject: null,
    };
    return {
      ...exe,
      attestations: {
        ...exe.attestations,
        protectedEnvironment: {
          ...exe.attestations.protectedEnvironment,
          expectedSigner: {
            ...exe.attestations.protectedEnvironment.expectedSigner,
            subject: null,
          },
        },
      },
      verification: {
        ...exe.verification,
        installerSignature: withoutSubject,
        payload: exe.verification.payload.map((entry) => ({
          ...entry,
          signature: withoutSubject,
        })),
        signerPolicy: {
          ...exe.verification.signerPolicy,
          expectedSubject: null,
        },
      },
    };
  });

  assert.throws(
    () =>
      initializeStoreAssetCaptureSession({
        candidatePath,
        candidateEvidencePath,
        captureDir: join(root, "captures-invalid-exe-subject"),
      }),
    /EXE candidate signer or installed-payload evidence is invalid/,
  );
});

test("accepts candidate evidence from a 64-character Git object format", (t) => {
  const root = temporaryDirectory(t);
  const evidenceRoot = join(root, "candidate-evidence");
  mkdirSync(evidenceRoot);
  const candidatePath = join(evidenceRoot, "JoeSSH.msix");
  const candidateEvidencePath = join(evidenceRoot, "candidate.json");
  const commit = "a".repeat(64);
  writeFileSync(candidatePath, Buffer.from("candidate bytes"));
  writeCandidateEvidence(candidatePath, candidateEvidencePath, (evidence) => ({
    ...evidence,
    commits: {
      ...evidence.commits,
      artifactSourceCommit: commit,
      preflightCommit: commit,
    },
    executionIdentity: {
      ...evidence.executionIdentity,
      tool: {
        ...evidence.executionIdentity.tool,
        preflightCommit: commit,
      },
    },
    attestations: {
      ...evidence.attestations,
      protectedEnvironment: {
        ...evidence.attestations.protectedEnvironment,
        artifactSourceCommit: commit,
        preflightCommit: commit,
      },
    },
  }));

  assert.doesNotThrow(() =>
    initializeStoreAssetCaptureSession({
      candidatePath,
      candidateEvidencePath,
      captureDir: join(root, "captures-sha256-git"),
    }),
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

test("requires the exact generated candidate checksum inventory", (t) => {
  const fixture = createCompleteCaptureFixture(t);
  const evidenceRoot = dirname(fixture.options.candidateEvidencePath);
  writeFileSync(
    join(evidenceRoot, "SHA256SUMS.txt"),
    `${"0".repeat(64)}  candidate.json\n`,
  );

  assert.throws(
    () =>
      prepareStoreAssetBundle({
        ...fixture.options,
        confirmExactCandidate: true,
        outputDir: join(fixture.root, "prepared-stale-candidate-checksums"),
        root: repositoryRoot,
      }),
    /Candidate evidence SHA256SUMS.txt is stale or incomplete/,
  );
});

test("rejects unexpected files in the generated candidate evidence bundle", (t) => {
  const fixture = createCompleteCaptureFixture(t);
  writeFileSync(
    join(dirname(fixture.options.candidateEvidencePath), "unreviewed.txt"),
    "unexpected evidence",
  );

  assert.throws(
    () =>
      prepareStoreAssetBundle({
        ...fixture.options,
        confirmExactCandidate: true,
        outputDir: join(fixture.root, "prepared-extra-candidate-evidence"),
        root: repositoryRoot,
      }),
    /Candidate evidence contains missing, stale, or unexpected files/,
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

test("rejects transparent RGBA screenshots with invisible RGB payloads", (t) => {
  const fixture = createCaptureFixture(t);
  for (let index = 0; index < STORE_SCREENSHOT_SLOTS.length; index += 1) {
    writeFixtureFile(
      fixture.options.captureDir,
      STORE_SCREENSHOT_SLOTS[index].path,
      encodeSolidPng(1920, 1080, [20 + index, 40 + index, 80 + index, 0]),
    );
  }

  assert.throws(
    () =>
      prepareStoreAssetBundle({
        ...fixture.options,
        confirmExactCandidate: true,
        outputDir: join(fixture.root, "prepared-transparent"),
        root: repositoryRoot,
      }),
    /must be fully opaque/,
  );
});

test("rejects oversized screenshot source files before reading them", (t) => {
  const fixture = createCompleteCaptureFixture(t);
  const firstScreenshotPath = join(
    fixture.options.captureDir,
    ...STORE_SCREENSHOT_SLOTS[0].path.split("/"),
  );
  writeFileSync(firstScreenshotPath, Buffer.alloc(16 * 1024 * 1024 + 1));

  assert.throws(
    () =>
      prepareStoreAssetBundle({
        ...fixture.options,
        confirmExactCandidate: true,
        outputDir: join(fixture.root, "prepared-oversized-source"),
        root: repositoryRoot,
      }),
    /source file limit/,
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
    rewriteFirstPngChunk(cleanScreenshot, "IDAT", () =>
      deflateSync(Buffer.alloc((1920 * 4 + 1) * 1080 + 1)),
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
  const candidateEvidenceDir = join(root, "candidate-evidence");
  mkdirSync(candidateEvidenceDir);
  const candidatePath = join(candidateEvidenceDir, "JoeSSH.msix");
  const candidateEvidencePath = join(candidateEvidenceDir, "candidate.json");
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

function writeCandidateEvidence(
  candidatePath,
  evidencePath,
  mutate = (value) => value,
) {
  const candidateBytes = readFileSync(candidatePath);
  const candidateSha256 = sha256(candidateBytes);
  const evidenceRoot = dirname(evidencePath);
  const noticesFileName = "THIRD-PARTY-NOTICES.txt";
  const notices = Buffer.from(
    "Synthetic third-party notices fixture.\n",
    "utf8",
  );
  const noticesSha256 = sha256(notices);
  writeFileSync(join(evidenceRoot, noticesFileName), notices);
  const commit = "a".repeat(40);
  const legalChecksumSha256 = "b".repeat(64);
  const licenseManifestSha256 = "c".repeat(64);
  const sbomChecksumSha256 = "d".repeat(64);
  const partnerIdentity = {
    schemaVersion: 1,
    source: "partner-center",
    productId: "9N1234567890",
    packageIdentityName: "JoeSSH.Store.Assigned",
    publisher: "CN=01234567-89ab-cdef-0123-456789abcdef",
    publisherDisplayName: "Verified Test Individual",
    publisherId: "8wekyb3d8bbwe",
    packageFamilyName: "JoeSSH.Store.Assigned_8wekyb3d8bbwe",
    reservedAt: "2020-01-01T00:00:00.000Z",
  };
  const repository = {
    slug: "JoeWorkspace/JoeSSH",
    source: "sanitized-git-origin",
  };
  const run = {
    attempt: null,
    id: null,
    job: null,
    serverUrl: null,
    status: "local-run-context-not-authenticated",
    workflow: null,
  };
  const evidence = mutate({
    schemaVersion: 3,
    kind: "windows-store-candidate",
    generatedAt: "2020-01-01T00:00:00.000Z",
    format: "msix",
    route: "microsoft-store-msix-external",
    version: "0.1.0-beta.10",
    commits: {
      artifactSourceCommit: commit,
      preflightCommit: commit,
      relationship: "same-commit",
      sourceCommitBinding:
        "operator-supplied input; authenticated provenance not provided",
    },
    executionIdentity: {
      repository,
      run,
      tool: {
        architecture: "x64",
        gitExecutable: "git.exe",
        nodeVersion: process.version,
        platform: process.platform,
        preflightCommit: commit,
        script: "prepare-windows-store-candidate.mjs",
        scriptSha256: "e".repeat(64),
        scriptVersion: 3,
      },
    },
    projectIdentity: {
      communityPublisher: "JoeSSH Project",
      identifier: "com.joeworkspace.joessh",
      productName: "JoeSSH",
      publisher: partnerIdentity.publisherDisplayName,
      version: "0.1.0-beta.10",
    },
    artifact: {
      fileName: basename(candidatePath),
      sha256: candidateSha256,
      sizeBytes: candidateBytes.length,
      source: "local-artifact",
      versionedHttpsUrl: null,
      stagedCopySha256: candidateSha256,
      integrity: {
        expectedSha256: candidateSha256,
        hashPolicy: "verify-every-download-snapshot-and-staged-copy",
        observations: [
          {
            point: "private-snapshot-before-verification",
            sha256: candidateSha256,
          },
          {
            point: "candidate-evidence-staged-copy",
            sha256: candidateSha256,
          },
        ],
        status: "passed",
        urlImmutability: { status: "not-applicable-local-artifact" },
      },
    },
    legalNotices: {
      bundleResourcePath: "legal/THIRD-PARTY-NOTICES.txt",
      checksumManifest: "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
      checksumManifestSha256: legalChecksumSha256,
      evidenceFileName: noticesFileName,
      licenseManifest: "reports/release/third-party-licenses/manifest.json",
      licenseManifestSha256,
      packageCount: 1,
      sbomChecksumManifest: "reports/release/SBOM-SHA256SUMS.txt",
      sbomChecksumSha256,
      sboms: [
        "cargo-workspace-sbom.cdx.json",
        "npm-desktop-sbom.cdx.json",
        "npm-web-sbom.cdx.json",
        "tauri-cargo-sbom.cdx.json",
      ].map((fileName, index) => ({
        path: `reports/release/${fileName}`,
        sha256: String(index + 1).repeat(64),
      })),
      sha256: noticesSha256,
      sizeBytes: notices.length,
      sourcePath:
        "reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt",
      textCount: 1,
      verification:
        "self-contained license bundle verification, exact Tauri resource mapping, exact installed or unpacked candidate payload match, and four checksum-bound public SBOMs",
    },
    attestations: {
      authenticatedProvenance: {
        status: "not-provided",
        requiredBeforePublication: true,
        acceptedEvidence:
          "independently verified signed CI/build provenance bound to repository, source commit, workflow run, tool identity, and artifact SHA-256",
      },
      protectedEnvironment: {
        artifactSha256: candidateSha256,
        artifactSourceCommit: commit,
        environment: "windows-release-stage-b",
        legalPublisher: partnerIdentity.publisherDisplayName,
        sbomChecksumManifestSha256: sbomChecksumSha256,
        thirdPartyLicenseChecksumManifestSha256: legalChecksumSha256,
        thirdPartyNoticesSha256: noticesSha256,
        expectedSigner: "not-applicable-store-signed-msix",
        preflightCommit: commit,
        repository,
        run,
        status: "inputs-enforced-not-cryptographically-authenticated",
      },
      selfGeneratedChecksums: {
        authenticatedProvenance: false,
        classification: "local-integrity-list-only",
        fileName: "SHA256SUMS.txt",
      },
    },
    verification: {
      bundledThirdPartyNotices: {
        path: "legal/THIRD-PARTY-NOTICES.txt",
        sha256: noticesSha256,
        sizeBytes: notices.length,
        status: "exact-match",
      },
      format: "msix",
      makeAppx: {
        executable: "makeappx.exe",
        semanticValidation: "passed",
      },
      manifest: {
        name: partnerIdentity.packageIdentityName,
        publisher: partnerIdentity.publisher,
        publisherDisplayName: partnerIdentity.publisherDisplayName,
        version: "0.1.0.10",
        architecture: "x64",
      },
      desktopApplication: {
        executable: "JoeSSH.exe",
        runtimeBehavior: "packagedClassicApp",
        trustLevel: "mediumIL",
        peMachine: "x64",
        sha256: "f".repeat(64),
      },
      projectVersionMapping: {
        msixVersion: "0.1.0.10",
        projectVersion: "0.1.0-beta.10",
      },
      partnerIdentity,
      partnerIdentityCrossCheck: {
        method: "PackageNameAndPublisherIdFromFamilyName",
        packageIdentityName: partnerIdentity.packageIdentityName,
        publisherId: partnerIdentity.publisherId,
        status: "matched",
      },
      partnerIdentityEvidence:
        "operator-supplied Partner Center values; assignment is not independently verified",
      route: "microsoft-store-msix-external",
      signature: {
        signerSubject: null,
        signerThumbprint: null,
        status: "NotSigned",
        statusMessage: "Not signed",
        timeStamperSubject: null,
        timeStamperThumbprint: null,
      },
      signatureState: "pending-microsoft-store-signing",
      storeSigningExpected: true,
      tauriNativeBundle: false,
    },
    gates: {
      artifactHashBound: true,
      authenticatedProvenance: false,
      candidatePreflightPassed: true,
      hostedUrlImmutability: "not-applicable",
      offlineWebView2Config: "not-applicable",
      publicSbomsBound: true,
      thirdPartyNoticesBundled: true,
      partnerCenterUploadCandidate: false,
      storePublicationReady: false,
      windowsAppCertificationKit: "not-run",
      blockers: [
        "Windows App Certification Kit has not been run.",
        "Partner Center submission, certification, and Microsoft Store signing have not occurred.",
        "Authenticated build provenance has not been supplied or verified.",
      ],
    },
    storeSubmission: {
      certificationStatus: "not-run",
      status: "not-submitted",
      storeSignatureStatus: "not-issued",
    },
    boundary:
      "This file proves only local candidate checks. It is not Partner Center submission, certification, Store signing, listing, or publication evidence.",
  });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  rewriteCandidateEvidenceChecksums(evidenceRoot, evidence);
}

function rewriteCandidateEvidenceChecksums(evidenceRoot, evidence) {
  const paths = [
    evidence.artifact.fileName,
    evidence.legalNotices.evidenceFileName,
    "candidate.json",
  ];
  const lines = paths.map((path) => {
    const absolute = join(evidenceRoot, ...path.split("/"));
    return `${sha256(readFileSync(absolute))}  ${path}`;
  });
  writeFileSync(join(evidenceRoot, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
}

function toExeEvidence(evidence) {
  const subject = "CN=Verified Test Individual";
  const thumbprint = "A".repeat(40);
  const signature = {
    signerSubject: subject,
    signerThumbprint: thumbprint,
    status: "Valid",
    statusMessage: "Valid",
    timeStamperSubject: "CN=Test Timestamp Authority",
    timeStamperThumbprint: "C".repeat(40),
    signToolVerification: "passed",
  };
  return {
    ...evidence,
    format: "exe",
    route: "microsoft-store-exe-msi",
    artifact: {
      ...evidence.artifact,
      fileName: "JoeSSH.exe",
    },
    attestations: {
      ...evidence.attestations,
      protectedEnvironment: {
        ...evidence.attestations.protectedEnvironment,
        expectedSigner: { subject, thumbprint },
      },
    },
    verification: {
      architecture: "x64",
      architectureVerification: {
        installedMainExecutable: "JoeSSH.exe",
        peMachine: "x64",
      },
      bundledThirdPartyNotices: evidence.verification.bundledThirdPartyNotices,
      format: "exe",
      install: {
        arpIdentity: {
          displayName: "JoeSSH",
          displayVersion: evidence.version,
          publisher: evidence.projectIdentity.publisher,
        },
        installedPayloadRoot: "verified-on-disposable-runner-not-recorded",
        silentArgument: "/S",
        silentInstallExitCode: 0,
        uninstall: {
          path: "uninstall.exe",
          sha256: "9".repeat(64),
          silentArgument: "/S",
          silentUninstallExitCode: 0,
        },
      },
      installerSignature: signature,
      payload: [
        {
          path: "JoeSSH.exe",
          sha256: "8".repeat(64),
          signature,
        },
      ],
      route: "microsoft-store-exe-msi",
      signerPolicy: {
        allInstalledPeMatched: true,
        expectedSubject: subject,
        expectedThumbprint: thumbprint,
        inputBoundary: "protected-release-environment",
        legalPublisher: evidence.projectIdentity.publisher,
      },
      storeSigningExpected: false,
      tauriNativeBundle: true,
    },
    gates: {
      ...evidence.gates,
      offlineWebView2Config: true,
    },
    storeSubmission: {
      ...evidence.storeSubmission,
      storeSignatureStatus: "not-applicable-publisher-signature-required",
    },
  };
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
