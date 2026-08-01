import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const repositoryRoot = resolve(import.meta.dirname, "..");
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const STORE_SCREENSHOT_WIDTH = 1920;
const STORE_SCREENSHOT_HEIGHT = 1080;
const BOX_ART_WIDTH = 1024;
const BOX_ART_HEIGHT = 1024;
const POSTER_ART_WIDTH = 1024;
const POSTER_ART_HEIGHT = 1536;
const BRAND_BACKGROUND = Object.freeze([4, 10, 20, 255]);
const MANIFEST_NAME = "manifest.json";
const CHECKSUMS_NAME = "SHA256SUMS.txt";
const CAPTURE_SESSION_NAME = "capture-session.json";
const CANDIDATE_BINDING_NAME = "candidate-binding.json";
const MASTER_ICON_PATH =
  "apps/desktop/src-tauri/icons/joessh-icon-master-1024.png";
const BRAND_ASSET_SPECS = Object.freeze([
  Object.freeze({
    id: "box-art-1x1",
    path: "branding/joessh-box-art-1x1.png",
    width: BOX_ART_WIDTH,
    height: BOX_ART_HEIGHT,
    aspectRatio: "1:1",
  }),
  Object.freeze({
    id: "poster-art-2x3",
    path: "branding/joessh-poster-art-2x3.png",
    width: POSTER_ART_WIDTH,
    height: POSTER_ART_HEIGHT,
    aspectRatio: "2:3",
  }),
]);
const SCENE_SPECS = Object.freeze([
  Object.freeze({
    order: 1,
    scene: "connected-terminal",
    theme: "light",
  }),
  Object.freeze({
    order: 2,
    scene: "host-key-review",
    theme: "dark",
  }),
  Object.freeze({
    order: 3,
    scene: "sftp-transfer",
    theme: "light",
  }),
  Object.freeze({
    order: 4,
    scene: "port-forward-stopped",
    theme: "dark",
  }),
]);
const LOCALES = Object.freeze(["en-US", "zh-CN"]);

export const STORE_SCREENSHOT_SLOTS = Object.freeze(
  LOCALES.flatMap((locale) =>
    SCENE_SPECS.map(({ order, scene, theme }) =>
      Object.freeze({
        id: `${locale}-${scene}-${theme}`,
        locale,
        order,
        scene,
        theme,
        path: `screenshots/${locale}/${String(order).padStart(2, "0")}-${scene}-${theme}.png`,
      }),
    ),
  ),
);

const COMPOSITION_REFERENCES = Object.freeze({
  "en-US":
    "tests/e2e/specs/visual-qa.spec.ts-snapshots/desktop-desktop-visual-wide-en-desktop-visual-wide-win32.png",
  "zh-CN":
    "tests/e2e/specs/visual-qa.spec.ts-snapshots/desktop-desktop-visual-wide-zh-CN-desktop-visual-wide-win32.png",
});

export function generateProvisionalStoreAssetBundle({
  outputDir,
  root = repositoryRoot,
} = {}) {
  const target = requirePath(outputDir, "output directory");
  return createBundleAtomically(target, (temporaryOutput) => {
    const master = captureStableFile(
      resolve(root, MASTER_ICON_PATH),
      "JoeSSH master icon",
    );
    const brandAssets = writeBrandAssets(master, temporaryOutput);
    const screenshots = STORE_SCREENSHOT_SLOTS.map((slot) => {
      const referencePath = COMPOSITION_REFERENCES[slot.locale];
      const reference = captureStableFile(
        resolve(root, referencePath),
        `${slot.locale} layout reference`,
      );
      const metadata = inspectPng(reference.bytes, referencePath);
      return {
        ...slot,
        requiredPath: slot.path,
        path: null,
        status: "provisional-reference-only",
        compositionReference: {
          limitations: [
            "development-build",
            "not-scene-specific",
            "not-candidate-bound",
            "not-uploadable",
          ],
          path: referencePath,
          sha256: reference.sha256,
          width: metadata.width,
          height: metadata.height,
        },
      };
    });
    const manifest = {
      schemaVersion: 1,
      kind: "microsoft-store-listing-assets",
      status: "provisional-not-uploadable",
      submissionAuthorization: "blocked",
      candidateBinding: null,
      screenshotRequirements: screenshotRequirements(),
      screenshots,
      brandingSource: brandingSource(master),
      brandAssets,
      blockers: [
        "Eight final exact-candidate screenshots are missing.",
        "The screenshot set is not bound to a candidate SHA-256.",
        "Partner Center identity verification and final human review are outside this bundle.",
      ],
    };
    writeJson(resolve(temporaryOutput, MANIFEST_NAME), manifest);
    writeChecksumManifest(temporaryOutput, [
      ...brandAssets.map(({ path }) => path),
      MANIFEST_NAME,
    ]);
    verifyStoreAssetBundle({
      bundleDir: temporaryOutput,
      requireFinal: false,
      root,
    });
    return manifest;
  });
}

export function initializeStoreAssetCaptureSession({
  candidateEvidencePath,
  candidatePath,
  captureDir,
} = {}) {
  const target = requirePath(captureDir, "capture directory");
  assertOutsideRepository(target, repositoryRoot, "capture directory");
  const candidate = collectCandidateBinding(
    requirePath(candidatePath, "candidate path"),
    requirePath(candidateEvidencePath, "candidate evidence path"),
  );
  return createBundleAtomically(target, (temporaryOutput) => {
    for (const locale of LOCALES) {
      mkdirSync(resolve(temporaryOutput, "screenshots", locale), {
        recursive: true,
      });
    }
    const session = {
      schemaVersion: 1,
      kind: "microsoft-store-asset-capture-session",
      state: "awaiting-final-candidate-captures",
      bindingScope:
        "candidate file SHA-256 and candidate-preflight evidence SHA-256",
      candidate: candidate.artifact,
      candidatePreflightEvidence: candidate.evidence,
      exactCandidateConfirmationRequired: true,
      screenshotRequirements: screenshotRequirements(),
      slots: STORE_SCREENSHOT_SLOTS,
    };
    writeJson(resolve(temporaryOutput, CAPTURE_SESSION_NAME), session);
    return session;
  });
}

export function prepareStoreAssetBundle({
  candidateEvidencePath,
  candidatePath,
  captureDir,
  confirmExactCandidate = false,
  outputDir,
  root = repositoryRoot,
} = {}) {
  if (!confirmExactCandidate) {
    throw new Error(
      "Refusing to prepare final Store assets without --confirm-exact-candidate-captures.",
    );
  }
  const captureRoot = requireExistingDirectory(
    requirePath(captureDir, "capture directory"),
    "capture directory",
  );
  const target = requirePath(outputDir, "output directory");
  assertOutsideRepository(captureRoot, root, "capture directory");
  assertOutsideRepository(target, root, "final Store asset output");
  const candidate = collectCandidateBinding(
    requirePath(candidatePath, "candidate path"),
    requirePath(candidateEvidencePath, "candidate evidence path"),
  );
  const sessionEvidence = captureStableFile(
    resolve(captureRoot, CAPTURE_SESSION_NAME),
    "capture session",
  );
  const session = parseJson(sessionEvidence.bytes, "capture session");
  assertCaptureSession(session, candidate);
  assertExactCaptureInventory(captureRoot);

  const screenshotCaptures = STORE_SCREENSHOT_SLOTS.map((slot) => {
    const evidence = captureStableFile(
      resolveBundlePath(captureRoot, slot.path),
      `Store screenshot ${slot.id}`,
    );
    const metadata = inspectPng(evidence.bytes, slot.path, true);
    if (
      metadata.width !== STORE_SCREENSHOT_WIDTH ||
      metadata.height !== STORE_SCREENSHOT_HEIGHT
    ) {
      throw new Error(
        `${slot.path} must be exactly ${STORE_SCREENSHOT_WIDTH}x${STORE_SCREENSHOT_HEIGHT}; received ${metadata.width}x${metadata.height}.`,
      );
    }
    assertStoreScreenshotPng(metadata, slot.path);
    return {
      ...slot,
      status: "final-candidate-capture",
      sha256: evidence.sha256,
      sizeBytes: evidence.sizeBytes,
      width: metadata.width,
      height: metadata.height,
      bytes: evidence.bytes,
    };
  });
  assertUniqueScreenshotHashes(screenshotCaptures);

  return createBundleAtomically(target, (temporaryOutput) => {
    const master = captureStableFile(
      resolve(root, MASTER_ICON_PATH),
      "JoeSSH master icon",
    );
    const brandAssets = writeBrandAssets(master, temporaryOutput);
    for (const screenshot of screenshotCaptures) {
      const destination = resolveBundlePath(temporaryOutput, screenshot.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, screenshot.bytes, {
        flag: "wx",
        mode: 0o600,
      });
      if (sha256File(destination) !== screenshot.sha256) {
        throw new Error(`${screenshot.path} changed during private copy.`);
      }
    }

    const publicScreenshots = screenshotCaptures.map((screenshot) => ({
      id: screenshot.id,
      locale: screenshot.locale,
      order: screenshot.order,
      scene: screenshot.scene,
      theme: screenshot.theme,
      path: screenshot.path,
      status: screenshot.status,
      sha256: screenshot.sha256,
      sizeBytes: screenshot.sizeBytes,
      width: screenshot.width,
      height: screenshot.height,
    }));
    const candidateBinding = {
      schemaVersion: 1,
      kind: "microsoft-store-asset-candidate-binding",
      state: "final-candidate-captures-confirmed",
      confirmation:
        "operator-confirmed capture from the exact candidate represented by this digest",
      verificationBoundary:
        "This file binds bytes by digest; it does not verify Authenticode, Microsoft Store signing, Partner Center identity, certification, or publication.",
      candidate: candidate.artifact,
      candidatePreflightEvidence: candidate.evidence,
      captureSessionSha256: sessionEvidence.sha256,
      screenshots: publicScreenshots.map(({ id, path, sha256 }) => ({
        id,
        path,
        sha256,
      })),
    };
    writeJson(
      resolve(temporaryOutput, CANDIDATE_BINDING_NAME),
      candidateBinding,
    );
    const bindingSha256 = sha256File(
      resolve(temporaryOutput, CANDIDATE_BINDING_NAME),
    );
    const manifest = {
      schemaVersion: 1,
      kind: "microsoft-store-listing-assets",
      status: "candidate-bound-final",
      submissionAuthorization: "requires-final-human-review",
      candidateBinding: {
        path: CANDIDATE_BINDING_NAME,
        sha256: bindingSha256,
        candidateSha256: candidate.artifact.sha256,
        candidatePreflightEvidenceSha256: candidate.evidence.sha256,
      },
      screenshotRequirements: screenshotRequirements(),
      screenshots: publicScreenshots,
      brandingSource: brandingSource(master),
      brandAssets,
      blockers: [
        "Final 100% zoom privacy, localization, and visual review is not automated.",
        "Partner Center identity, listing choices, certification, and submission remain separate gates.",
      ],
    };
    writeJson(resolve(temporaryOutput, MANIFEST_NAME), manifest);
    writeChecksumManifest(temporaryOutput, [
      CANDIDATE_BINDING_NAME,
      ...brandAssets.map(({ path }) => path),
      ...publicScreenshots.map(({ path }) => path),
      MANIFEST_NAME,
    ]);

    const currentCandidate = collectCandidateBinding(
      candidatePath,
      candidateEvidencePath,
    );
    assertSameCandidate(
      candidate,
      currentCandidate,
      "during asset preparation",
    );
    verifyStoreAssetBundle({
      bundleDir: temporaryOutput,
      candidateEvidencePath,
      candidatePath,
      requireFinal: true,
      root,
    });
    return manifest;
  });
}

export function verifyStoreAssetBundle({
  bundleDir,
  candidateEvidencePath,
  candidatePath,
  requireFinal = true,
  root = repositoryRoot,
} = {}) {
  const bundleRoot = requireExistingDirectory(
    requirePath(bundleDir, "bundle directory"),
    "bundle directory",
  );
  const manifestPath = resolve(bundleRoot, MANIFEST_NAME);
  const manifest = parseJson(
    captureStableFile(manifestPath, "Store asset manifest").bytes,
    "Store asset manifest",
  );
  assertManifestEnvelope(manifest);
  const master = captureStableFile(
    resolve(root, MASTER_ICON_PATH),
    "JoeSSH master icon",
  );
  assertBrandingSource(manifest.brandingSource, master);
  assertBrandAssets(bundleRoot, manifest.brandAssets, master);
  assertScreenshotShape(manifest.screenshots);

  const finalBundle = manifest.status === "candidate-bound-final";
  if (!finalBundle) {
    assertProvisionalManifest(manifest, root);
    assertChecksumManifest(bundleRoot, [
      ...manifest.brandAssets.map(({ path }) => path),
      MANIFEST_NAME,
    ]);
    assertExactBundleInventory(bundleRoot, [
      ...manifest.brandAssets.map(({ path }) => path),
      CHECKSUMS_NAME,
      MANIFEST_NAME,
    ]);
    if (requireFinal) {
      throw new Error(
        "Store asset bundle is provisional-not-uploadable; final exact-candidate captures and candidate binding are required.",
      );
    }
    return manifest;
  }

  assertOutsideRepository(bundleRoot, root, "final Store asset bundle");

  if (!candidatePath || !candidateEvidencePath) {
    throw new Error(
      "Final Store asset verification requires --candidate and --candidate-evidence.",
    );
  }
  const candidate = collectCandidateBinding(
    candidatePath,
    candidateEvidencePath,
  );
  assertFinalManifest(bundleRoot, manifest, candidate);
  const expectedFiles = [
    CANDIDATE_BINDING_NAME,
    ...manifest.brandAssets.map(({ path }) => path),
    ...manifest.screenshots.map(({ path }) => path),
    CHECKSUMS_NAME,
    MANIFEST_NAME,
  ];
  assertChecksumManifest(
    bundleRoot,
    expectedFiles.filter((path) => path !== CHECKSUMS_NAME),
  );
  assertExactBundleInventory(bundleRoot, expectedFiles);
  return manifest;
}

export function encodeSolidPng(width, height, rgba) {
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    throw new Error("PNG dimensions must be positive integers.");
  }
  if (
    !Array.isArray(rgba) ||
    rgba.length !== 4 ||
    rgba.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    throw new Error("PNG color must contain four byte values.");
  }
  const row = Buffer.alloc(width * 4 + 1);
  for (let offset = 1; offset < row.length; offset += 4) {
    row.set(rgba, offset);
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) {
    row.copy(raw, y * row.length);
  }
  return encodeRgbaPng(width, height, rawRowsToPixels(raw, width, height));
}

function screenshotRequirements() {
  return {
    count: STORE_SCREENSHOT_SLOTS.length,
    format: "png",
    width: STORE_SCREENSHOT_WIDTH,
    height: STORE_SCREENSHOT_HEIGHT,
    aspectRatio: "16:9",
    locales: LOCALES,
    themesPerLocale: ["light", "dark"],
    sourceRequirement: "exact-candidate-capture",
  };
}

function collectCandidateBinding(candidatePath, candidateEvidencePath) {
  const artifact = captureStableFile(candidatePath, "Store candidate");
  const extension = extname(artifact.fileName).toLowerCase();
  if (!new Set([".exe", ".msix"]).has(extension)) {
    throw new Error("Store candidate must be an .exe or .msix file.");
  }
  const evidenceFile = captureStableFile(
    candidateEvidencePath,
    "candidate preflight evidence",
  );
  const evidence = parseJson(
    evidenceFile.bytes,
    "candidate preflight evidence",
  );
  if (
    evidence.schemaVersion !== 3 ||
    evidence.kind !== "windows-store-candidate" ||
    !["exe", "msix"].includes(evidence.format)
  ) {
    throw new Error(
      "Candidate evidence must be a schema v3 windows-store-candidate document.",
    );
  }
  if (
    evidence.gates?.artifactHashBound !== true ||
    evidence.gates?.candidatePreflightPassed !== true ||
    evidence.gates?.storePublicationReady !== false
  ) {
    throw new Error(
      "Candidate evidence must record hash binding, a passed preflight, and storePublicationReady=false.",
    );
  }
  if (
    evidence.storeSubmission?.status !== "not-submitted" ||
    evidence.storeSubmission?.certificationStatus !== "not-run"
  ) {
    throw new Error(
      "Candidate evidence must remain pre-submission and pre-certification.",
    );
  }
  if (
    evidence.artifact?.fileName !== artifact.fileName ||
    evidence.artifact?.sha256 !== artifact.sha256 ||
    evidence.artifact?.sizeBytes !== artifact.sizeBytes
  ) {
    throw new Error(
      "Candidate file does not match the artifact recorded by candidate preflight evidence.",
    );
  }
  if (extension.slice(1) !== evidence.format) {
    throw new Error(
      "Candidate extension does not match candidate evidence format.",
    );
  }
  return {
    artifact: {
      fileName: artifact.fileName,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
    },
    evidence: {
      schemaVersion: evidence.schemaVersion,
      format: evidence.format,
      version: requireNonEmptyString(evidence.version, "candidate version"),
      sha256: evidenceFile.sha256,
      preflightPassed: true,
    },
  };
}

function assertCaptureSession(session, candidate) {
  if (
    session.schemaVersion !== 1 ||
    session.kind !== "microsoft-store-asset-capture-session" ||
    session.state !== "awaiting-final-candidate-captures" ||
    session.exactCandidateConfirmationRequired !== true
  ) {
    throw new Error(
      "Capture session is not an awaiting-final-candidate-captures session.",
    );
  }
  assertSameCandidate(
    {
      artifact: session.candidate,
      evidence: session.candidatePreflightEvidence,
    },
    candidate,
    "since capture-session initialization",
  );
  assertSlotsMatch(session.slots, "capture session");
  assertScreenshotRequirements(session.screenshotRequirements);
}

function assertSameCandidate(expected, actual, context) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`Candidate or preflight evidence changed ${context}.`);
  }
}

function assertExactCaptureInventory(captureRoot) {
  const expected = [
    CAPTURE_SESSION_NAME,
    ...STORE_SCREENSHOT_SLOTS.map(({ path }) => path),
  ];
  const actual = listRelativeFiles(captureRoot);
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(
      `Capture directory must contain only the capture session and eight required screenshots. Expected: ${expected.sort().join(", ")}.`,
    );
  }
}

function assertManifestEnvelope(manifest) {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "microsoft-store-listing-assets" ||
    !["provisional-not-uploadable", "candidate-bound-final"].includes(
      manifest.status,
    )
  ) {
    throw new Error("Store asset manifest envelope is invalid.");
  }
  assertScreenshotRequirements(manifest.screenshotRequirements);
}

function assertScreenshotRequirements(requirements) {
  const expected = screenshotRequirements();
  if (JSON.stringify(requirements) !== JSON.stringify(expected)) {
    throw new Error(
      "Store screenshot requirements do not match the pinned contract.",
    );
  }
}

function assertScreenshotShape(screenshots) {
  if (
    !Array.isArray(screenshots) ||
    screenshots.length !== STORE_SCREENSHOT_SLOTS.length
  ) {
    throw new Error(
      "Store asset manifest must contain exactly eight screenshot slots.",
    );
  }
  assertSlotsMatch(
    screenshots.map(
      ({ id, locale, order, path, requiredPath, scene, theme }) => ({
        id,
        locale,
        order,
        scene,
        theme,
        path: requiredPath ?? path,
      }),
    ),
    "Store asset manifest",
  );
}

function assertSlotsMatch(actual, label) {
  if (JSON.stringify(actual) !== JSON.stringify(STORE_SCREENSHOT_SLOTS)) {
    throw new Error(
      `${label} screenshot slots do not match the pinned eight-slot contract.`,
    );
  }
  for (const locale of LOCALES) {
    const localeThemes = new Set(
      actual.filter((slot) => slot.locale === locale).map((slot) => slot.theme),
    );
    if (!localeThemes.has("light") || !localeThemes.has("dark")) {
      throw new Error(
        `${label} must cover light and dark themes for ${locale}.`,
      );
    }
  }
}

function assertProvisionalManifest(manifest, root) {
  if (
    manifest.status !== "provisional-not-uploadable" ||
    manifest.submissionAuthorization !== "blocked" ||
    manifest.candidateBinding !== null
  ) {
    throw new Error(
      "Provisional Store assets must remain blocked and unbound.",
    );
  }
  for (const screenshot of manifest.screenshots) {
    if (
      screenshot.status !== "provisional-reference-only" ||
      screenshot.path !== null ||
      screenshot.requiredPath !==
        STORE_SCREENSHOT_SLOTS.find(({ id }) => id === screenshot.id)?.path ||
      screenshot.compositionReference?.limitations?.includes(
        "not-uploadable",
      ) !== true
    ) {
      throw new Error(
        "Provisional screenshots must be null-path, non-uploadable references.",
      );
    }
    const reference = captureStableFile(
      resolve(root, screenshot.compositionReference.path),
      `${screenshot.id} composition reference`,
    );
    if (reference.sha256 !== screenshot.compositionReference.sha256) {
      throw new Error(`${screenshot.id} composition reference hash changed.`);
    }
  }
}

function assertFinalManifest(bundleRoot, manifest, candidate) {
  if (
    manifest.submissionAuthorization !== "requires-final-human-review" ||
    !manifest.candidateBinding
  ) {
    throw new Error(
      "Final Store assets must remain subject to final human review.",
    );
  }
  const bindingPath = resolveBundlePath(
    bundleRoot,
    manifest.candidateBinding.path,
  );
  const bindingEvidence = captureStableFile(
    bindingPath,
    "Store asset candidate binding",
  );
  if (bindingEvidence.sha256 !== manifest.candidateBinding.sha256) {
    throw new Error("Store asset candidate-binding SHA-256 mismatch.");
  }
  if (
    manifest.candidateBinding.candidateSha256 !== candidate.artifact.sha256 ||
    manifest.candidateBinding.candidatePreflightEvidenceSha256 !==
      candidate.evidence.sha256
  ) {
    throw new Error("Store asset manifest is bound to a different candidate.");
  }
  const binding = parseJson(
    bindingEvidence.bytes,
    "Store asset candidate binding",
  );
  if (
    binding.schemaVersion !== 1 ||
    binding.kind !== "microsoft-store-asset-candidate-binding" ||
    binding.state !== "final-candidate-captures-confirmed" ||
    !binding.verificationBoundary?.includes("does not verify Authenticode")
  ) {
    throw new Error("Store asset candidate binding envelope is invalid.");
  }
  assertSameCandidate(
    {
      artifact: binding.candidate,
      evidence: binding.candidatePreflightEvidence,
    },
    candidate,
    "since final asset binding",
  );

  const seenHashes = new Set();
  for (const screenshot of manifest.screenshots) {
    if (
      screenshot.status !== "final-candidate-capture" ||
      screenshot.width !== STORE_SCREENSHOT_WIDTH ||
      screenshot.height !== STORE_SCREENSHOT_HEIGHT ||
      !isSha256(screenshot.sha256) ||
      !Number.isSafeInteger(screenshot.sizeBytes) ||
      screenshot.sizeBytes <= 0
    ) {
      throw new Error(
        `${screenshot.id} is not a valid final Store screenshot record.`,
      );
    }
    const file = captureStableFile(
      resolveBundlePath(bundleRoot, screenshot.path),
      screenshot.id,
    );
    const metadata = inspectPng(file.bytes, screenshot.path, true);
    if (
      metadata.width !== STORE_SCREENSHOT_WIDTH ||
      metadata.height !== STORE_SCREENSHOT_HEIGHT
    ) {
      throw new Error(
        `${screenshot.path} must be exactly ${STORE_SCREENSHOT_WIDTH}x${STORE_SCREENSHOT_HEIGHT}; received ${metadata.width}x${metadata.height}.`,
      );
    }
    assertStoreScreenshotPng(metadata, screenshot.path);
    if (
      file.sha256 !== screenshot.sha256 ||
      file.sizeBytes !== screenshot.sizeBytes ||
      metadata.width !== screenshot.width ||
      metadata.height !== screenshot.height
    ) {
      throw new Error(`${screenshot.id} does not match its manifest evidence.`);
    }
    if (seenHashes.has(screenshot.sha256)) {
      throw new Error(
        "Final Store screenshots must be eight distinct image files.",
      );
    }
    seenHashes.add(screenshot.sha256);
  }
  const expectedBindingScreenshots = manifest.screenshots.map(
    ({ id, path, sha256 }) => ({ id, path, sha256 }),
  );
  if (
    JSON.stringify(binding.screenshots) !==
    JSON.stringify(expectedBindingScreenshots)
  ) {
    throw new Error(
      "Candidate binding screenshot hashes do not match the manifest.",
    );
  }
}

function assertBrandingSource(source, master) {
  const metadata = inspectPng(master.bytes, MASTER_ICON_PATH);
  if (
    source?.path !== MASTER_ICON_PATH ||
    source.sha256 !== master.sha256 ||
    source.width !== metadata.width ||
    source.height !== metadata.height
  ) {
    throw new Error(
      "Store branding source does not match the JoeSSH master icon.",
    );
  }
}

function assertBrandAssets(bundleRoot, assets, master) {
  if (!Array.isArray(assets) || assets.length !== BRAND_ASSET_SPECS.length) {
    throw new Error(
      "Store asset manifest must contain the 1:1 and 2:3 brand art.",
    );
  }
  const expectedBytes = renderBrandAssetBytes(master);
  for (let index = 0; index < BRAND_ASSET_SPECS.length; index += 1) {
    const expected = BRAND_ASSET_SPECS[index];
    const actual = assets[index];
    if (
      actual.id !== expected.id ||
      actual.path !== expected.path ||
      actual.width !== expected.width ||
      actual.height !== expected.height ||
      actual.aspectRatio !== expected.aspectRatio ||
      actual.status !== "generated-from-master" ||
      !isSha256(actual.sha256) ||
      !Number.isSafeInteger(actual.sizeBytes) ||
      actual.sizeBytes <= 0
    ) {
      throw new Error(`${expected.id} manifest record is invalid.`);
    }
    const file = captureStableFile(
      resolveBundlePath(bundleRoot, actual.path),
      expected.id,
    );
    const metadata = inspectPng(file.bytes, actual.path);
    if (
      file.sha256 !== actual.sha256 ||
      file.sizeBytes !== actual.sizeBytes ||
      metadata.width !== expected.width ||
      metadata.height !== expected.height
    ) {
      throw new Error(`${expected.id} does not match its manifest evidence.`);
    }
    if (!file.bytes.equals(expectedBytes[index])) {
      throw new Error(
        `${expected.id} was not deterministically generated from the reviewed JoeSSH master icon.`,
      );
    }
  }
}

function writeBrandAssets(master, outputRoot) {
  const outputs = renderBrandAssetBytes(master);
  return BRAND_ASSET_SPECS.map((spec, index) => {
    const destination = resolveBundlePath(outputRoot, spec.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, outputs[index], { flag: "wx", mode: 0o600 });
    return {
      ...spec,
      status: "generated-from-master",
      sha256: sha256Buffer(outputs[index]),
      sizeBytes: outputs[index].length,
    };
  });
}

function renderBrandAssetBytes(master) {
  const decoded = decodeRgbaPng(master.bytes, MASTER_ICON_PATH);
  if (decoded.width !== BOX_ART_WIDTH || decoded.height !== BOX_ART_HEIGHT) {
    throw new Error(
      `JoeSSH master icon must be ${BOX_ART_WIDTH}x${BOX_ART_HEIGHT}.`,
    );
  }
  const boxPixels = compositeOnBackground(
    decoded,
    BOX_ART_WIDTH,
    BOX_ART_HEIGHT,
    0,
    0,
  );
  const posterPixels = compositeOnBackground(
    decoded,
    POSTER_ART_WIDTH,
    POSTER_ART_HEIGHT,
    0,
    (POSTER_ART_HEIGHT - decoded.height) / 2,
  );
  const outputs = [
    encodeRgbaPng(BOX_ART_WIDTH, BOX_ART_HEIGHT, boxPixels),
    encodeRgbaPng(POSTER_ART_WIDTH, POSTER_ART_HEIGHT, posterPixels),
  ];
  return outputs;
}

function brandingSource(master) {
  const metadata = inspectPng(master.bytes, MASTER_ICON_PATH);
  return {
    path: MASTER_ICON_PATH,
    sha256: master.sha256,
    width: metadata.width,
    height: metadata.height,
  };
}

function compositeOnBackground(source, width, height, offsetX, offsetY) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set(BRAND_BACKGROUND, offset);
  }
  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
      const targetX = sourceX + offsetX;
      const targetY = sourceY + offsetY;
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const targetOffset = (targetY * width + targetX) * 4;
      const alpha = source.pixels[sourceOffset + 3];
      const inverse = 255 - alpha;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[targetOffset + channel] = Math.round(
          (source.pixels[sourceOffset + channel] * alpha +
            pixels[targetOffset + channel] * inverse) /
            255,
        );
      }
      pixels[targetOffset + 3] = 255;
    }
  }
  return pixels;
}

function decodeRgbaPng(bytes, label) {
  const parsed = inspectPng(bytes, label, true);
  if (
    parsed.bitDepth !== 8 ||
    parsed.colorType !== 6 ||
    parsed.compression !== 0 ||
    parsed.filter !== 0 ||
    parsed.interlace !== 0
  ) {
    throw new Error(`${label} must be a non-interlaced 8-bit RGBA PNG.`);
  }
  const compressed = Buffer.concat(parsed.idatChunks);
  const raw = inflateSync(compressed);
  const rowBytes = parsed.width * 4;
  const expectedLength = (rowBytes + 1) * parsed.height;
  if (raw.length !== expectedLength) {
    throw new Error(`${label} has an unexpected decompressed PNG length.`);
  }
  const pixels = Buffer.alloc(rowBytes * parsed.height);
  for (let y = 0; y < parsed.height; y += 1) {
    const rawOffset = y * (rowBytes + 1);
    const filterType = raw[rawOffset];
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = raw[rawOffset + 1 + x];
      const left = x >= 4 ? pixels[y * rowBytes + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * rowBytes + x] : 0;
      const upperLeft =
        y > 0 && x >= 4 ? pixels[(y - 1) * rowBytes + x - 4] : 0;
      let value;
      if (filterType === 0) value = encoded;
      else if (filterType === 1) value = encoded + left;
      else if (filterType === 2) value = encoded + up;
      else if (filterType === 3) value = encoded + Math.floor((left + up) / 2);
      else if (filterType === 4) value = encoded + paeth(left, up, upperLeft);
      else
        throw new Error(`${label} uses unsupported PNG filter ${filterType}.`);
      pixels[y * rowBytes + x] = value & 0xff;
    }
  }
  return { width: parsed.width, height: parsed.height, pixels };
}

function inspectPng(bytes, label, includeIdat = false) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 45 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    throw new Error(`${label} is not a PNG file.`);
  }
  let offset = 8;
  let header = null;
  let sawIdat = false;
  let sawIend = false;
  const idatChunks = [];
  const chunks = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length)
      throw new Error(`${label} has a truncated PNG chunk.`);
    const length = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length)
      throw new Error(`${label} has a truncated PNG chunk body.`);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw new Error(`${label} has an invalid PNG chunk type.`);
    }
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (expectedCrc !== actualCrc)
      throw new Error(`${label} has a corrupt ${type} PNG chunk.`);
    chunks.push({ length, type });
    if (type === "IHDR") {
      if (header || offset !== 8 || length !== 13)
        throw new Error(`${label} has an invalid IHDR chunk.`);
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      sawIdat = true;
      if (includeIdat) idatChunks.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || sawIend)
        throw new Error(`${label} has an invalid IEND chunk.`);
      sawIend = true;
      if (chunkEnd !== bytes.length)
        throw new Error(`${label} contains bytes after IEND.`);
    }
    offset = chunkEnd;
  }
  if (
    !header ||
    !sawIdat ||
    !sawIend ||
    header.width <= 0 ||
    header.height <= 0
  ) {
    throw new Error(`${label} is missing required PNG chunks.`);
  }
  return { ...header, chunks, idatChunks };
}

function assertStoreScreenshotPng(metadata, label) {
  if (
    metadata.bitDepth !== 8 ||
    ![2, 6].includes(metadata.colorType) ||
    metadata.compression !== 0 ||
    metadata.filter !== 0 ||
    metadata.interlace !== 0
  ) {
    throw new Error(`${label} must be a non-interlaced 8-bit RGB or RGBA PNG.`);
  }
  const disallowed = metadata.chunks.find(
    ({ type }) => !["IHDR", "IDAT", "IEND"].includes(type),
  );
  if (disallowed) {
    throw new Error(
      `${label} contains disallowed PNG chunk ${disallowed.type}; final Store screenshots may contain only IHDR, IDAT, and IEND chunks so metadata cannot carry hidden sensitive information.`,
    );
  }

  const compressed = Buffer.concat(metadata.idatChunks);
  let decoded;
  try {
    decoded = inflateSync(compressed, { info: true });
  } catch (error) {
    throw new Error(`${label} contains invalid compressed PNG image data.`, {
      cause: error,
    });
  }
  const channels = metadata.colorType === 6 ? 4 : 3;
  const rowBytes = metadata.width * channels;
  const expectedLength = (rowBytes + 1) * metadata.height;
  if (
    decoded.buffer.length !== expectedLength ||
    decoded.engine.bytesWritten !== compressed.length
  ) {
    throw new Error(
      `${label} compressed PNG image data does not exactly match its declared dimensions.`,
    );
  }
  for (let row = 0; row < metadata.height; row += 1) {
    if (decoded.buffer[row * (rowBytes + 1)] > 4) {
      throw new Error(`${label} uses an invalid PNG scanline filter.`);
    }
  }
}

function encodeRgbaPng(width, height, pixels) {
  if (pixels.length !== width * height * 4) {
    throw new Error("RGBA pixel buffer length does not match PNG dimensions.");
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function rawRowsToPixels(raw, width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    raw.copy(
      pixels,
      y * width * 4,
      y * (width * 4 + 1) + 1,
      (y + 1) * (width * 4 + 1),
    );
  }
  return pixels;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return chunk;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance)
    return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function createBundleAtomically(outputDir, writer) {
  const absoluteOutput = resolve(outputDir);
  if (existsSync(absoluteOutput)) {
    throw new Error(
      `Refusing to overwrite existing directory: ${absoluteOutput}`,
    );
  }
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  const temporaryOutput = mkdtempSync(
    join(dirname(absoluteOutput), ".joessh-store-assets-"),
  );
  try {
    const result = writer(temporaryOutput);
    renameSync(temporaryOutput, absoluteOutput);
    return result;
  } catch (error) {
    rmSync(temporaryOutput, { force: true, recursive: true });
    throw error;
  }
}

function captureStableFile(path, label) {
  const absolutePath = resolve(path);
  let beforeLink;
  let before;
  try {
    beforeLink = lstatSync(absolutePath);
    before = statSync(absolutePath);
  } catch {
    throw new Error(`${label} does not exist: ${absolutePath}`);
  }
  if (beforeLink.isSymbolicLink() || !before.isFile() || before.size <= 0) {
    throw new Error(
      `${label} must be a non-empty regular file: ${absolutePath}`,
    );
  }
  const bytes = readFileSync(absolutePath);
  const after = statSync(absolutePath);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    bytes.length !== before.size
  ) {
    throw new Error(`${label} changed while it was being captured.`);
  }
  return {
    bytes,
    fileName: basename(absolutePath),
    sha256: sha256Buffer(bytes),
    sizeBytes: bytes.length,
  };
}

function assertUniqueScreenshotHashes(screenshots) {
  const hashes = new Set(screenshots.map(({ sha256 }) => sha256));
  if (hashes.size !== screenshots.length) {
    throw new Error(
      "Final Store screenshots must be eight distinct image files.",
    );
  }
}

function writeChecksumManifest(bundleRoot, paths) {
  const normalized = [...paths].sort();
  const lines = normalized.map((path) => {
    assertSafeRelativePath(path);
    return `${sha256File(resolveBundlePath(bundleRoot, path))}  ${path}`;
  });
  writeFileSync(resolve(bundleRoot, CHECKSUMS_NAME), `${lines.join("\n")}\n`, {
    encoding: "ascii",
    flag: "wx",
    mode: 0o600,
  });
}

function assertChecksumManifest(bundleRoot, expectedPaths) {
  const checksumPath = resolve(bundleRoot, CHECKSUMS_NAME);
  const checksumText = captureStableFile(
    checksumPath,
    "Store asset checksums",
  ).bytes.toString("ascii");
  const expected =
    [...expectedPaths]
      .sort()
      .map(
        (path) => `${sha256File(resolveBundlePath(bundleRoot, path))}  ${path}`,
      )
      .join("\n") + "\n";
  if (checksumText !== expected) {
    throw new Error("Store asset SHA256SUMS.txt is stale or incomplete.");
  }
}

function assertExactBundleInventory(bundleRoot, expectedPaths) {
  const expected = [...expectedPaths].sort();
  const actual = listRelativeFiles(bundleRoot);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      "Store asset bundle contains missing, stale, or unexpected files.",
    );
  }
}

function listRelativeFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Symbolic links are not allowed: ${absolute}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile())
        files.push(relative(root, absolute).replaceAll("\\", "/"));
      else throw new Error(`Unsupported filesystem entry: ${absolute}`);
    }
  }
  walk(root);
  return files.sort();
}

function resolveBundlePath(root, path) {
  assertSafeRelativePath(path);
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, ...path.split("/"));
  if (
    !absolute.startsWith(
      `${absoluteRoot}${process.platform === "win32" ? "\\" : "/"}`,
    )
  ) {
    throw new Error(`Unsafe bundle path: ${path}`);
  }
  return absolute;
}

function assertSafeRelativePath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe relative path: ${path}`);
  }
}

function requireExistingDirectory(path, label) {
  const absolute = resolve(path);
  let link;
  let stats;
  try {
    link = lstatSync(absolute);
    stats = statSync(absolute);
  } catch {
    throw new Error(`${label} does not exist: ${absolute}`);
  }
  if (link.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${absolute}`);
  }
  return absolute;
}

function assertOutsideRepository(path, root, label) {
  const physicalRoot = realpathSync.native(resolve(root));
  const physicalPath = resolvePhysicalPath(path);
  if (isWithinPath(physicalRoot, physicalPath)) {
    throw new Error(
      `${label} must stay outside the repository so private captures and candidate-bound evidence cannot enter Git history.`,
    );
  }
}

function resolvePhysicalPath(path) {
  let existing = resolve(path);
  const missingSegments = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missingSegments.unshift(basename(existing));
    existing = parent;
  }
  const physicalExisting = realpathSync.native(existing);
  return resolve(physicalExisting, ...missingSegments);
}

function isWithinPath(parent, child) {
  const pathWithinParent = relative(parent, child);
  return (
    pathWithinParent === "" ||
    (pathWithinParent !== ".." &&
      !pathWithinParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathWithinParent))
  );
}

function requirePath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return resolve(value);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} is required.`);
  return value;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function sha256Buffer(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(path) {
  return sha256Buffer(readFileSync(path));
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function parseCli(args) {
  const command = args.shift() ?? "";
  const options = Object.create(null);
  const booleanFlags = new Set(["--confirm-exact-candidate-captures"]);
  const valueFlags = new Set([
    "--bundle",
    "--candidate",
    "--candidate-evidence",
    "--captures",
    "--output",
  ]);
  while (args.length > 0) {
    const flag = args.shift();
    if (booleanFlags.has(flag)) {
      options[flag] = true;
      continue;
    }
    if (!valueFlags.has(flag)) throw new Error(`Unknown argument: ${flag}`);
    const value = args.shift();
    if (!value || value.startsWith("--"))
      throw new Error(`${flag} requires a value.`);
    options[flag] = value;
  }
  return { command, options };
}

function runCli(args) {
  const { command, options } = parseCli([...args]);
  if (command === "provisional") {
    generateProvisionalStoreAssetBundle({ outputDir: options["--output"] });
    console.log(
      "Provisional Store asset bundle generated. It is not uploadable.",
    );
    return;
  }
  if (command === "init-session") {
    initializeStoreAssetCaptureSession({
      candidatePath: options["--candidate"],
      candidateEvidencePath: options["--candidate-evidence"],
      captureDir: options["--captures"],
    });
    console.log(
      "Store capture session initialized; no placeholder screenshots were created.",
    );
    return;
  }
  if (command === "prepare") {
    prepareStoreAssetBundle({
      candidatePath: options["--candidate"],
      candidateEvidencePath: options["--candidate-evidence"],
      captureDir: options["--captures"],
      confirmExactCandidate:
        options["--confirm-exact-candidate-captures"] === true,
      outputDir: options["--output"],
    });
    console.log(
      "Candidate-bound Store asset bundle prepared; final human review remains required.",
    );
    return;
  }
  if (command === "verify") {
    verifyStoreAssetBundle({
      bundleDir: options["--bundle"],
      candidatePath: options["--candidate"],
      candidateEvidencePath: options["--candidate-evidence"],
    });
    console.log("Candidate-bound Store asset bundle integrity verified.");
    return;
  }
  throw new Error(
    "Usage: node scripts/prepare-windows-store-assets.mjs <provisional|init-session|prepare|verify> [options]",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
