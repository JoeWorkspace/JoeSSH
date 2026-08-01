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
import { TextDecoder } from "node:util";
import { deflateSync, inflateSync } from "node:zlib";
import {
  assertCertificateSubjectMatchesLegalPublisher,
  assertReviewedCommit,
  deriveMsixVersion,
  normalizeMsixExecutablePath,
  validatePartnerCenterIdentity,
} from "./windows-store-contract.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const STORE_SCREENSHOT_WIDTH = 1920;
const STORE_SCREENSHOT_HEIGHT = 1080;
const MAX_SCREENSHOT_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_CANDIDATE_EVIDENCE_BYTES = 2 * 1024 * 1024;
const MAX_CHECKSUM_MANIFEST_BYTES = 64 * 1024;
const MAX_LEGAL_NOTICES_BYTES = 64 * 1024 * 1024;
const BOX_ART_WIDTH = 1024;
const BOX_ART_HEIGHT = 1024;
const POSTER_ART_WIDTH = 1024;
const POSTER_ART_HEIGHT = 1536;
const BRAND_BACKGROUND = Object.freeze([4, 10, 20, 255]);
const MANIFEST_NAME = "manifest.json";
const CHECKSUMS_NAME = "SHA256SUMS.txt";
const CAPTURE_SESSION_NAME = "capture-session.json";
const CANDIDATE_BINDING_NAME = "candidate-binding.json";
const CANDIDATE_EVIDENCE_NAME = "candidate.json";
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
      MAX_SCREENSHOT_SOURCE_BYTES,
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
        ...(candidate.evidence.signatureState ===
        "pending-microsoft-store-signing"
          ? [
              "The exact MSIX is pending Microsoft Store signing; this asset bundle is not publication evidence.",
            ]
          : []),
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
  const absoluteEvidencePath = resolve(candidateEvidencePath);
  if (basename(absoluteEvidencePath) !== CANDIDATE_EVIDENCE_NAME) {
    throw new Error(
      `Candidate preflight evidence must be the generated ${CANDIDATE_EVIDENCE_NAME} file.`,
    );
  }
  const evidenceFile = captureStableFile(
    absoluteEvidencePath,
    "candidate preflight evidence",
    MAX_CANDIDATE_EVIDENCE_BYTES,
  );
  const evidence = parseCanonicalGeneratedJson(
    evidenceFile.bytes,
    "candidate preflight evidence",
  );
  assertCandidateEvidenceContract(evidence, artifact);
  if (extension.slice(1) !== evidence.format) {
    throw new Error(
      "Candidate extension does not match candidate evidence format.",
    );
  }
  assertCandidateEvidenceBundle(absoluteEvidencePath, evidence, artifact);
  const signatureState =
    evidence.format === "msix"
      ? evidence.verification.signatureState
      : "valid-authenticode";
  return {
    artifact: {
      fileName: artifact.fileName,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
    },
    evidence: {
      schemaVersion: evidence.schemaVersion,
      format: evidence.format,
      route: evidence.route,
      signatureState,
      storeSignatureStatus: evidence.storeSubmission.storeSignatureStatus,
      version: requireNonEmptyString(evidence.version, "candidate version"),
      sha256: evidenceFile.sha256,
      preflightPassed: true,
    },
  };
}

function assertCandidateEvidenceContract(evidence, artifact) {
  assertExactObjectKeys(
    evidence,
    [
      "schemaVersion",
      "kind",
      "generatedAt",
      "format",
      "route",
      "version",
      "commits",
      "executionIdentity",
      "projectIdentity",
      "artifact",
      "legalNotices",
      "attestations",
      "verification",
      "gates",
      "storeSubmission",
      "boundary",
    ],
    "Candidate evidence",
  );
  if (
    evidence.schemaVersion !== 3 ||
    evidence.kind !== "windows-store-candidate" ||
    !["exe", "msix"].includes(evidence.format)
  ) {
    throw new Error(
      "Candidate evidence must be a complete schema v3 windows-store-candidate document.",
    );
  }
  assertNormalizedPastTimestamp(evidence.generatedAt, "candidate generatedAt");
  requireNonEmptyString(evidence.version, "candidate version");
  assertCandidateCommitEvidence(evidence.commits);
  assertCandidateExecutionIdentity(
    evidence.executionIdentity,
    evidence.commits,
  );
  assertCandidateProjectIdentity(evidence.projectIdentity, evidence.version);
  assertCandidateArtifactEvidence(evidence.artifact, artifact);
  assertCandidateLegalEvidence(evidence.legalNotices);
  assertCandidateAttestations(evidence.attestations, evidence);
  assertCandidateGates(
    evidence.gates,
    evidence.format,
    evidence.artifact.source,
    evidence.artifact.integrity.urlImmutability.status,
  );
  assertCandidateSubmissionState(evidence.storeSubmission, evidence.format);
  assertCandidateVerification(evidence.verification, evidence);
  if (
    evidence.boundary !==
    "This file proves only local candidate checks. It is not Partner Center submission, certification, Store signing, listing, or publication evidence."
  ) {
    throw new Error("Candidate evidence has an invalid verification boundary.");
  }
}

function assertCandidateCommitEvidence(commits) {
  assertExactObjectKeys(
    commits,
    [
      "artifactSourceCommit",
      "preflightCommit",
      "relationship",
      "sourceCommitBinding",
    ],
    "Candidate commit evidence",
  );
  if (
    !isCommitSha(commits.artifactSourceCommit) ||
    !isCommitSha(commits.preflightCommit) ||
    commits.relationship !==
      (commits.artifactSourceCommit === commits.preflightCommit
        ? "same-commit"
        : "distinct-commits") ||
    commits.sourceCommitBinding !==
      "operator-supplied input; authenticated provenance not provided"
  ) {
    throw new Error("Candidate commit evidence is incomplete or inconsistent.");
  }
}

function assertCandidateExecutionIdentity(executionIdentity, commits) {
  assertExactObjectKeys(
    executionIdentity,
    ["repository", "run", "tool"],
    "Candidate execution identity",
  );
  assertExactObjectKeys(
    executionIdentity.repository,
    ["slug", "source"],
    "Candidate repository identity",
  );
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(
      executionIdentity.repository.slug ?? "",
    ) ||
    !["github-actions-context", "sanitized-git-origin"].includes(
      executionIdentity.repository.source,
    )
  ) {
    throw new Error("Candidate repository identity is unavailable or invalid.");
  }
  assertExactObjectKeys(
    executionIdentity.run,
    ["attempt", "id", "job", "serverUrl", "status", "workflow"],
    "Candidate run identity",
  );
  if (
    ![
      "github-actions-context-recorded",
      "local-run-context-not-authenticated",
    ].includes(executionIdentity.run.status)
  ) {
    throw new Error("Candidate run identity has an invalid status.");
  }
  assertExactObjectKeys(
    executionIdentity.tool,
    [
      "architecture",
      "gitExecutable",
      "nodeVersion",
      "platform",
      "preflightCommit",
      "script",
      "scriptSha256",
      "scriptVersion",
    ],
    "Candidate tool identity",
  );
  if (
    !requireNonEmptyString(
      executionIdentity.tool.architecture,
      "candidate tool architecture",
    ) ||
    !/^git(?:\.exe)?$/i.test(executionIdentity.tool.gitExecutable ?? "") ||
    !/^v\d+\.\d+\.\d+/.test(executionIdentity.tool.nodeVersion ?? "") ||
    !requireNonEmptyString(
      executionIdentity.tool.platform,
      "candidate tool platform",
    ) ||
    executionIdentity.tool.preflightCommit !== commits.preflightCommit ||
    executionIdentity.tool.script !== "prepare-windows-store-candidate.mjs" ||
    !isSha256(executionIdentity.tool.scriptSha256) ||
    executionIdentity.tool.scriptVersion !== 3
  ) {
    throw new Error("Candidate tool identity is incomplete or inconsistent.");
  }
}

function assertCandidateProjectIdentity(projectIdentity, version) {
  assertExactObjectKeys(
    projectIdentity,
    ["communityPublisher", "identifier", "productName", "publisher", "version"],
    "Candidate project identity",
  );
  for (const [field, value] of Object.entries(projectIdentity)) {
    requireNonEmptyString(value, `candidate project ${field}`);
  }
  if (
    projectIdentity.version !== version ||
    projectIdentity.publisher === projectIdentity.productName
  ) {
    throw new Error("Candidate project identity is inconsistent.");
  }
}

function assertCandidateArtifactEvidence(candidateArtifact, artifact) {
  assertExactObjectKeys(
    candidateArtifact,
    [
      "fileName",
      "sha256",
      "sizeBytes",
      "source",
      "versionedHttpsUrl",
      "stagedCopySha256",
      "integrity",
    ],
    "Candidate artifact evidence",
  );
  if (
    candidateArtifact.fileName !== artifact.fileName ||
    candidateArtifact.sha256 !== artifact.sha256 ||
    candidateArtifact.stagedCopySha256 !== artifact.sha256 ||
    candidateArtifact.sizeBytes !== artifact.sizeBytes ||
    !["local-artifact", "hosted-download"].includes(candidateArtifact.source)
  ) {
    throw new Error(
      "Candidate file does not match the artifact recorded by candidate preflight evidence.",
    );
  }
  if (
    basename(candidateArtifact.fileName) !== candidateArtifact.fileName ||
    candidateArtifact.fileName === CANDIDATE_EVIDENCE_NAME ||
    candidateArtifact.fileName === CHECKSUMS_NAME
  ) {
    throw new Error(
      "Candidate evidence contains an unsafe artifact file name.",
    );
  }
  if (candidateArtifact.source === "hosted-download") {
    assertPublicEvidenceHttpsUrl(candidateArtifact.versionedHttpsUrl);
  } else if (candidateArtifact.versionedHttpsUrl !== null) {
    throw new Error("Local candidate evidence must not claim a hosted URL.");
  }
  const integrity = candidateArtifact.integrity;
  assertExactObjectKeys(
    integrity,
    [
      "expectedSha256",
      "hashPolicy",
      "observations",
      "status",
      "urlImmutability",
    ],
    "Candidate artifact integrity",
  );
  if (
    integrity.expectedSha256 !== artifact.sha256 ||
    integrity.hashPolicy !== "verify-every-download-snapshot-and-staged-copy" ||
    integrity.status !== "passed" ||
    !Array.isArray(integrity.observations) ||
    integrity.observations.length < 2 ||
    integrity.observations[0]?.point !==
      "private-snapshot-before-verification" ||
    integrity.observations.at(-1)?.point !== "candidate-evidence-staged-copy" ||
    integrity.observations.some(
      (observation) =>
        !hasExactObjectKeys(observation, ["point", "sha256"]) ||
        observation.sha256 !== artifact.sha256,
    )
  ) {
    throw new Error("Candidate artifact integrity evidence is incomplete.");
  }
  const expectedImmutability =
    candidateArtifact.source === "local-artifact"
      ? "not-applicable-local-artifact"
      : null;
  if (
    !integrity.urlImmutability ||
    (expectedImmutability &&
      integrity.urlImmutability.status !== expectedImmutability) ||
    (!expectedImmutability &&
      ![
        "human-attested-object-retention",
        "unverified-no-object-retention-proof",
      ].includes(integrity.urlImmutability.status))
  ) {
    throw new Error("Candidate URL immutability evidence is inconsistent.");
  }
}

function assertCandidateLegalEvidence(legalNotices) {
  assertExactObjectKeys(
    legalNotices,
    [
      "bundleResourcePath",
      "checksumManifest",
      "checksumManifestSha256",
      "evidenceFileName",
      "licenseManifest",
      "licenseManifestSha256",
      "packageCount",
      "sbomChecksumManifest",
      "sbomChecksumSha256",
      "sboms",
      "sha256",
      "sizeBytes",
      "sourcePath",
      "textCount",
      "verification",
    ],
    "Candidate legal-notices evidence",
  );
  if (
    legalNotices.bundleResourcePath !== "legal/THIRD-PARTY-NOTICES.txt" ||
    basename(legalNotices.evidenceFileName ?? "") !==
      legalNotices.evidenceFileName ||
    !isSha256(legalNotices.sha256) ||
    !isSha256(legalNotices.checksumManifestSha256) ||
    !isSha256(legalNotices.licenseManifestSha256) ||
    !isSha256(legalNotices.sbomChecksumSha256) ||
    !Number.isSafeInteger(legalNotices.sizeBytes) ||
    legalNotices.sizeBytes <= 0 ||
    !Number.isSafeInteger(legalNotices.packageCount) ||
    legalNotices.packageCount <= 0 ||
    !Number.isSafeInteger(legalNotices.textCount) ||
    legalNotices.textCount <= 0 ||
    !Array.isArray(legalNotices.sboms) ||
    legalNotices.sboms.length !== 4 ||
    legalNotices.sboms.some(
      (sbom) =>
        !hasExactObjectKeys(sbom, ["path", "sha256"]) ||
        !requireNonEmptyString(sbom.path, "candidate SBOM path") ||
        !isSha256(sbom.sha256),
    ) ||
    new Set(legalNotices.sboms.map(({ path }) => path)).size !== 4 ||
    legalNotices.verification !==
      "self-contained license bundle verification, exact Tauri resource mapping, exact installed or unpacked candidate payload match, and four checksum-bound public SBOMs"
  ) {
    throw new Error("Candidate legal-notices evidence is incomplete.");
  }
}

function assertCandidateAttestations(attestations, evidence) {
  assertExactObjectKeys(
    attestations,
    [
      "authenticatedProvenance",
      "protectedEnvironment",
      "selfGeneratedChecksums",
    ],
    "Candidate attestations",
  );
  assertExactObjectKeys(
    attestations.authenticatedProvenance,
    ["status", "requiredBeforePublication", "acceptedEvidence"],
    "Candidate provenance attestation",
  );
  if (
    attestations.authenticatedProvenance.status !== "not-provided" ||
    attestations.authenticatedProvenance.requiredBeforePublication !== true ||
    !requireNonEmptyString(
      attestations.authenticatedProvenance.acceptedEvidence,
      "candidate accepted provenance",
    )
  ) {
    throw new Error("Candidate provenance boundary is invalid.");
  }
  assertExactObjectKeys(
    attestations.protectedEnvironment,
    [
      "artifactSha256",
      "artifactSourceCommit",
      "environment",
      "legalPublisher",
      "sbomChecksumManifestSha256",
      "thirdPartyLicenseChecksumManifestSha256",
      "thirdPartyNoticesSha256",
      "expectedSigner",
      "preflightCommit",
      "repository",
      "run",
      "status",
    ],
    "Candidate protected-environment attestation",
  );
  const protectedEnvironment = attestations.protectedEnvironment;
  if (
    protectedEnvironment.artifactSha256 !== evidence.artifact.sha256 ||
    protectedEnvironment.artifactSourceCommit !==
      evidence.commits.artifactSourceCommit ||
    protectedEnvironment.environment !== "windows-release-stage-b" ||
    protectedEnvironment.legalPublisher !==
      evidence.projectIdentity.publisher ||
    protectedEnvironment.preflightCommit !== evidence.commits.preflightCommit ||
    protectedEnvironment.thirdPartyNoticesSha256 !==
      evidence.legalNotices.sha256 ||
    protectedEnvironment.thirdPartyLicenseChecksumManifestSha256 !==
      evidence.legalNotices.checksumManifestSha256 ||
    protectedEnvironment.sbomChecksumManifestSha256 !==
      evidence.legalNotices.sbomChecksumSha256 ||
    JSON.stringify(protectedEnvironment.repository) !==
      JSON.stringify(evidence.executionIdentity.repository) ||
    JSON.stringify(protectedEnvironment.run) !==
      JSON.stringify(evidence.executionIdentity.run) ||
    protectedEnvironment.status !==
      "inputs-enforced-not-cryptographically-authenticated"
  ) {
    throw new Error(
      "Candidate protected-environment evidence is inconsistent.",
    );
  }
  assertExactObjectKeys(
    attestations.selfGeneratedChecksums,
    ["authenticatedProvenance", "classification", "fileName"],
    "Candidate checksum attestation",
  );
  if (
    attestations.selfGeneratedChecksums.authenticatedProvenance !== false ||
    attestations.selfGeneratedChecksums.classification !==
      "local-integrity-list-only" ||
    attestations.selfGeneratedChecksums.fileName !== CHECKSUMS_NAME
  ) {
    throw new Error(
      "Candidate checksum evidence has an invalid trust boundary.",
    );
  }
}

function assertCandidateGates(
  gates,
  format,
  artifactSource,
  urlImmutabilityStatus,
) {
  assertExactObjectKeys(
    gates,
    [
      "artifactHashBound",
      "authenticatedProvenance",
      "candidatePreflightPassed",
      "hostedUrlImmutability",
      "offlineWebView2Config",
      "publicSbomsBound",
      "thirdPartyNoticesBundled",
      "partnerCenterUploadCandidate",
      "storePublicationReady",
      "windowsAppCertificationKit",
      "blockers",
    ],
    "Candidate gates",
  );
  const expectedHostedUrlImmutability =
    artifactSource !== "hosted-download"
      ? "not-applicable"
      : urlImmutabilityStatus === "human-attested-object-retention"
        ? "human-attested"
        : "unverified";
  if (
    gates.artifactHashBound !== true ||
    gates.authenticatedProvenance !== false ||
    gates.candidatePreflightPassed !== true ||
    gates.publicSbomsBound !== true ||
    gates.thirdPartyNoticesBundled !== true ||
    gates.partnerCenterUploadCandidate !== false ||
    gates.storePublicationReady !== false ||
    gates.windowsAppCertificationKit !== "not-run" ||
    gates.hostedUrlImmutability !== expectedHostedUrlImmutability ||
    gates.offlineWebView2Config !==
      (format === "exe" ? true : "not-applicable") ||
    !Array.isArray(gates.blockers) ||
    gates.blockers.length === 0 ||
    gates.blockers.some(
      (blocker) => !requireNonEmptyString(blocker, "candidate blocker"),
    )
  ) {
    throw new Error(
      "Candidate preflight gates are incomplete or inconsistent.",
    );
  }
}

function assertCandidateSubmissionState(storeSubmission, format) {
  assertExactObjectKeys(
    storeSubmission,
    ["certificationStatus", "status", "storeSignatureStatus"],
    "Candidate Store submission state",
  );
  if (
    storeSubmission.status !== "not-submitted" ||
    storeSubmission.certificationStatus !== "not-run" ||
    storeSubmission.storeSignatureStatus !==
      (format === "exe"
        ? "not-applicable-publisher-signature-required"
        : "not-issued")
  ) {
    throw new Error(
      "Candidate evidence must remain pre-submission and pre-certification with the route-specific signing state.",
    );
  }
}

function assertCandidateVerification(verification, evidence) {
  const notices = verification?.bundledThirdPartyNotices;
  if (
    notices?.status !== "exact-match" ||
    notices.path !== evidence.legalNotices.bundleResourcePath ||
    notices.sha256 !== evidence.legalNotices.sha256 ||
    notices.sizeBytes !== evidence.legalNotices.sizeBytes
  ) {
    throw new Error("Candidate payload legal-notices verification is invalid.");
  }
  if (evidence.format === "msix") {
    assertMsixCandidateVerification(verification, evidence);
  } else {
    assertExeCandidateVerification(verification, evidence);
  }
}

function assertMsixCandidateVerification(verification, evidence) {
  assertExactObjectKeys(
    verification,
    [
      "bundledThirdPartyNotices",
      "format",
      "makeAppx",
      "manifest",
      "desktopApplication",
      "projectVersionMapping",
      "partnerIdentity",
      "partnerIdentityCrossCheck",
      "partnerIdentityEvidence",
      "route",
      "signature",
      "signatureState",
      "storeSigningExpected",
      "tauriNativeBundle",
    ],
    "MSIX candidate verification",
  );
  assertExactObjectKeys(
    verification.partnerIdentity,
    [
      "packageFamilyName",
      "packageIdentityName",
      "productId",
      "publisher",
      "publisherDisplayName",
      "publisherId",
      "reservedAt",
      "schemaVersion",
      "source",
    ],
    "MSIX Partner Center identity",
  );
  const partnerIdentity = validatePartnerCenterIdentity(
    verification.partnerIdentity,
  );
  assertExactObjectKeys(
    verification.makeAppx,
    ["executable", "semanticValidation"],
    "MSIX MakeAppx evidence",
  );
  assertExactObjectKeys(
    verification.manifest,
    ["architecture", "name", "publisher", "publisherDisplayName", "version"],
    "MSIX manifest evidence",
  );
  assertExactObjectKeys(
    verification.desktopApplication,
    ["executable", "runtimeBehavior", "trustLevel", "peMachine", "sha256"],
    "MSIX desktop application evidence",
  );
  assertExactObjectKeys(
    verification.projectVersionMapping,
    ["msixVersion", "projectVersion"],
    "MSIX project-version mapping",
  );
  assertExactObjectKeys(
    verification.partnerIdentityCrossCheck,
    ["method", "packageIdentityName", "publisherId", "status"],
    "MSIX Partner Center package-family cross-check",
  );
  assertExactObjectKeys(
    verification.signature,
    [
      "signerSubject",
      "signerThumbprint",
      "status",
      "statusMessage",
      "timeStamperSubject",
      "timeStamperThumbprint",
    ],
    "MSIX Authenticode evidence",
  );
  const manifest = verification.manifest;
  const desktopApplication = verification.desktopApplication;
  const versionMapping = verification.projectVersionMapping;
  const crossCheck = verification.partnerIdentityCrossCheck;
  const expectedMsixVersion = deriveMsixVersion(evidence.version);
  const canonicalPartnerIdentity = Object.entries(partnerIdentity).every(
    ([key, value]) => verification.partnerIdentity[key] === value,
  );
  let normalizedExecutable;
  try {
    normalizedExecutable = normalizeMsixExecutablePath(
      desktopApplication.executable,
    );
  } catch {
    normalizedExecutable = null;
  }
  if (
    evidence.route !== "microsoft-store-msix-external" ||
    verification.route !== evidence.route ||
    verification.format !== "msix" ||
    !canonicalPartnerIdentity ||
    typeof verification.makeAppx.executable !== "string" ||
    verification.makeAppx.executable.toLowerCase() !== "makeappx.exe" ||
    verification.makeAppx.semanticValidation !== "passed" ||
    verification.storeSigningExpected !== true ||
    verification.tauriNativeBundle !== false ||
    partnerIdentity.publisherDisplayName !==
      evidence.projectIdentity.publisher ||
    manifest.name !== partnerIdentity.packageIdentityName ||
    manifest.publisher !== partnerIdentity.publisher ||
    manifest.publisherDisplayName !== partnerIdentity.publisherDisplayName ||
    !["x86", "x64", "arm64"].includes(manifest.architecture) ||
    manifest.version !== expectedMsixVersion ||
    normalizedExecutable !== desktopApplication.executable ||
    desktopApplication.runtimeBehavior !== "packagedClassicApp" ||
    desktopApplication.trustLevel !== "mediumIL" ||
    desktopApplication.peMachine !== manifest.architecture ||
    !isSha256(desktopApplication.sha256) ||
    versionMapping.projectVersion !== evidence.version ||
    versionMapping.msixVersion !== expectedMsixVersion ||
    versionMapping.msixVersion !== manifest.version ||
    crossCheck.method !== "PackageNameAndPublisherIdFromFamilyName" ||
    crossCheck.status !== "matched" ||
    typeof crossCheck.packageIdentityName !== "string" ||
    crossCheck.packageIdentityName.localeCompare(
      partnerIdentity.packageIdentityName,
      undefined,
      { sensitivity: "accent" },
    ) !== 0 ||
    typeof crossCheck.publisherId !== "string" ||
    crossCheck.publisherId.localeCompare(
      partnerIdentity.publisherId,
      undefined,
      {
        sensitivity: "accent",
      },
    ) !== 0 ||
    verification.partnerIdentityEvidence !==
      "operator-supplied Partner Center values; assignment is not independently verified" ||
    typeof verification.signature.statusMessage !== "string" ||
    evidence.attestations.protectedEnvironment.expectedSigner !==
      "not-applicable-store-signed-msix" ||
    !["pending-microsoft-store-signing", "valid-pre-store-signature"].includes(
      verification.signatureState,
    )
  ) {
    throw new Error(
      "MSIX candidate identity or semantic verification is invalid.",
    );
  }
  if (
    verification.signatureState === "pending-microsoft-store-signing" &&
    (verification.signature?.status !== "NotSigned" ||
      verification.signature?.signerSubject !== null ||
      verification.signature?.signerThumbprint !== null ||
      verification.signature?.timeStamperSubject !== null ||
      verification.signature?.timeStamperThumbprint !== null)
  ) {
    throw new Error(
      "Pending Store-only MSIX signing evidence is inconsistent.",
    );
  }
  if (
    verification.signatureState === "valid-pre-store-signature" &&
    (verification.signature?.status !== "Valid" ||
      verification.signature?.signerSubject !==
        verification.manifest.publisher ||
      !isCertificateThumbprint(verification.signature?.signerThumbprint) ||
      !hasConsistentOptionalTimestamp(verification.signature))
  ) {
    throw new Error("Pre-signed MSIX signature evidence is inconsistent.");
  }
}

function assertExeCandidateVerification(verification, evidence) {
  assertExactObjectKeys(
    verification,
    [
      "architecture",
      "architectureVerification",
      "bundledThirdPartyNotices",
      "format",
      "install",
      "installerSignature",
      "payload",
      "route",
      "signerPolicy",
      "storeSigningExpected",
      "tauriNativeBundle",
    ],
    "EXE candidate verification",
  );
  const signature = verification.installerSignature;
  const signerPolicy = verification.signerPolicy;
  assertExactObjectKeys(
    signature,
    [
      "signerSubject",
      "signerThumbprint",
      "status",
      "statusMessage",
      "timeStamperSubject",
      "timeStamperThumbprint",
      "signToolVerification",
    ],
    "EXE installer Authenticode evidence",
  );
  assertExactObjectKeys(
    signerPolicy,
    [
      "allInstalledPeMatched",
      "expectedSubject",
      "expectedThumbprint",
      "inputBoundary",
      "legalPublisher",
    ],
    "EXE signer policy",
  );
  if (
    evidence.route !== "microsoft-store-exe-msi" ||
    verification.route !== evidence.route ||
    verification.format !== "exe" ||
    verification.storeSigningExpected !== false ||
    verification.tauriNativeBundle !== true ||
    signature?.status !== "Valid" ||
    signature?.signToolVerification !== "passed" ||
    !isCertificateSubjectForPublisher(
      signature?.signerSubject,
      evidence.projectIdentity.publisher,
    ) ||
    !isCertificateThumbprint(signature?.signerThumbprint) ||
    !requireNonEmptyString(
      signature?.timeStamperSubject,
      "EXE timestamp subject",
    ) ||
    !isCertificateThumbprint(signature?.timeStamperThumbprint) ||
    signerPolicy?.allInstalledPeMatched !== true ||
    signerPolicy?.expectedSubject !== signature.signerSubject ||
    signerPolicy?.expectedThumbprint !== signature.signerThumbprint ||
    signerPolicy?.legalPublisher !== evidence.projectIdentity.publisher ||
    !hasExactObjectKeys(
      evidence.attestations.protectedEnvironment.expectedSigner,
      ["subject", "thumbprint"],
    ) ||
    evidence.attestations.protectedEnvironment.expectedSigner?.subject !==
      signature.signerSubject ||
    evidence.attestations.protectedEnvironment.expectedSigner?.thumbprint !==
      signature.signerThumbprint ||
    verification.install?.arpIdentity?.publisher !==
      evidence.projectIdentity.publisher ||
    !Array.isArray(verification.payload) ||
    verification.payload.length === 0 ||
    verification.payload.some(
      (entry) =>
        !isSha256(entry?.sha256) ||
        !hasExactObjectKeys(entry, ["path", "sha256", "signature"]) ||
        !hasExactObjectKeys(entry.signature, [
          "signerSubject",
          "signerThumbprint",
          "status",
          "statusMessage",
          "timeStamperSubject",
          "timeStamperThumbprint",
          "signToolVerification",
        ]) ||
        entry.signature?.status !== "Valid" ||
        entry.signature?.signToolVerification !== "passed" ||
        entry.signature?.signerSubject !== signature.signerSubject ||
        entry.signature?.signerThumbprint !== signature.signerThumbprint ||
        !requireNonEmptyString(
          entry.signature?.timeStamperSubject,
          "installed PE timestamp subject",
        ) ||
        !isCertificateThumbprint(entry.signature?.timeStamperThumbprint),
    )
  ) {
    throw new Error(
      "EXE candidate signer or installed-payload evidence is invalid.",
    );
  }
}

function assertCandidateEvidenceBundle(evidencePath, evidence, artifact) {
  const evidenceRoot = requireExistingDirectory(
    dirname(evidencePath),
    "candidate evidence directory",
  );
  const legalFileName = evidence.legalNotices.evidenceFileName;
  const expectedContentPaths = [
    artifact.fileName,
    legalFileName,
    CANDIDATE_EVIDENCE_NAME,
  ];
  if (new Set(expectedContentPaths).size !== expectedContentPaths.length) {
    throw new Error("Candidate evidence file names must be distinct.");
  }
  const stagedArtifact = captureStableFile(
    resolveBundlePath(evidenceRoot, artifact.fileName),
    "staged candidate evidence artifact",
  );
  if (
    stagedArtifact.sha256 !== artifact.sha256 ||
    stagedArtifact.sizeBytes !== artifact.sizeBytes
  ) {
    throw new Error(
      "Candidate evidence staged artifact does not match the candidate.",
    );
  }
  const stagedNotices = captureStableFile(
    resolveBundlePath(evidenceRoot, legalFileName),
    "staged candidate legal notices",
    MAX_LEGAL_NOTICES_BYTES,
  );
  if (
    stagedNotices.sha256 !== evidence.legalNotices.sha256 ||
    stagedNotices.sizeBytes !== evidence.legalNotices.sizeBytes
  ) {
    throw new Error(
      "Candidate evidence staged legal notices do not match candidate.json.",
    );
  }
  assertChecksumManifest(
    evidenceRoot,
    expectedContentPaths,
    "Candidate evidence",
    false,
  );
  assertExactBundleInventory(
    evidenceRoot,
    [...expectedContentPaths, CHECKSUMS_NAME],
    "Candidate evidence",
  );
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
      MAX_SCREENSHOT_SOURCE_BYTES,
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
  const rowBytes = parsed.width * 4;
  const expectedLength = (rowBytes + 1) * parsed.height;
  const raw = inflateSync(compressed, { maxOutputLength: expectedLength });
  if (raw.length !== expectedLength) {
    throw new Error(`${label} has an unexpected decompressed PNG length.`);
  }
  const pixels = unfilterPngRows(raw, parsed.width, parsed.height, 4, label);
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
  const channels = metadata.colorType === 6 ? 4 : 3;
  const rowBytes = metadata.width * channels;
  const expectedLength = (rowBytes + 1) * metadata.height;
  let decoded;
  try {
    decoded = inflateSync(compressed, {
      info: true,
      maxOutputLength: expectedLength,
    });
  } catch (error) {
    throw new Error(`${label} contains invalid compressed PNG image data.`, {
      cause: error,
    });
  }
  if (
    decoded.buffer.length !== expectedLength ||
    decoded.engine.bytesWritten !== compressed.length
  ) {
    throw new Error(
      `${label} compressed PNG image data does not exactly match its declared dimensions.`,
    );
  }
  const pixels = unfilterPngRows(
    decoded.buffer,
    metadata.width,
    metadata.height,
    channels,
    label,
  );
  if (channels === 4) {
    for (let offset = 3; offset < pixels.length; offset += channels) {
      if (pixels[offset] !== 255) {
        throw new Error(
          `${label} must be fully opaque; transparent RGBA pixels can conceal unreviewed RGB data.`,
        );
      }
    }
  }
}

function unfilterPngRows(raw, width, height, channels, label) {
  const rowBytes = width * channels;
  const expectedLength = (rowBytes + 1) * height;
  if (raw.length !== expectedLength) {
    throw new Error(`${label} has an unexpected decompressed PNG length.`);
  }
  const pixels = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (rowBytes + 1);
    const filterType = raw[rawOffset];
    if (filterType > 4) {
      throw new Error(`${label} uses an invalid PNG scanline filter.`);
    }
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = raw[rawOffset + 1 + x];
      const left = x >= channels ? pixels[y * rowBytes + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * rowBytes + x] : 0;
      const upperLeft =
        y > 0 && x >= channels ? pixels[(y - 1) * rowBytes + x - channels] : 0;
      let value;
      if (filterType === 0) value = encoded;
      else if (filterType === 1) value = encoded + left;
      else if (filterType === 2) value = encoded + up;
      else if (filterType === 3) value = encoded + Math.floor((left + up) / 2);
      else value = encoded + paeth(left, up, upperLeft);
      pixels[y * rowBytes + x] = value & 0xff;
    }
  }
  return pixels;
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

function captureStableFile(
  path,
  label,
  maximumBytes = Number.POSITIVE_INFINITY,
) {
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
  if (before.size > maximumBytes) {
    throw new Error(
      `${label} exceeds the ${maximumBytes}-byte source file limit.`,
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

function assertChecksumManifest(
  bundleRoot,
  expectedPaths,
  label = "Store asset",
  sortPaths = true,
) {
  const checksumPath = resolve(bundleRoot, CHECKSUMS_NAME);
  const checksumText = captureStableFile(
    checksumPath,
    `${label} checksums`,
    MAX_CHECKSUM_MANIFEST_BYTES,
  ).bytes.toString("ascii");
  const normalizedPaths = sortPaths ? [...expectedPaths].sort() : expectedPaths;
  const expected =
    normalizedPaths
      .map(
        (path) => `${sha256File(resolveBundlePath(bundleRoot, path))}  ${path}`,
      )
      .join("\n") + "\n";
  if (checksumText !== expected) {
    throw new Error(`${label} SHA256SUMS.txt is stale or incomplete.`);
  }
}

function assertExactBundleInventory(
  bundleRoot,
  expectedPaths,
  label = "Store asset bundle",
) {
  const expected = [...expectedPaths].sort();
  const actual = listRelativeFiles(bundleRoot);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} contains missing, stale, or unexpected files.`);
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

function assertExactObjectKeys(value, expectedKeys, label) {
  if (!hasExactObjectKeys(value, expectedKeys)) {
    throw new Error(`${label} does not match the generated evidence schema.`);
  }
}

function hasExactObjectKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function assertNormalizedPastTimestamp(value, label) {
  const timestamp = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value ||
    timestamp > Date.now() + 5 * 60_000
  ) {
    throw new Error(
      `${label} must be a normalized UTC timestamp not in the future.`,
    );
  }
  return value;
}

function isCommitSha(value) {
  try {
    return assertReviewedCommit(value) === value;
  } catch {
    return false;
  }
}

function isCertificateThumbprint(value) {
  return typeof value === "string" && /^[0-9A-F]{40}$/.test(value);
}

function isCertificateSubjectForPublisher(subject, publisher) {
  try {
    assertCertificateSubjectMatchesLegalPublisher(subject, publisher);
    return true;
  } catch {
    return false;
  }
}

function hasConsistentOptionalTimestamp(signature) {
  const hasSubject = typeof signature.timeStamperSubject === "string";
  const hasThumbprint = isCertificateThumbprint(
    signature.timeStamperThumbprint,
  );
  return (
    (signature.timeStamperSubject === null &&
      signature.timeStamperThumbprint === null) ||
    Boolean(hasSubject && signature.timeStamperSubject.trim() && hasThumbprint)
  );
}

function assertPublicEvidenceHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Hosted candidate evidence URL is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "Hosted candidate evidence URL must use HTTPS without credentials, query, or fragment.",
    );
  }
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

function parseCanonicalGeneratedJson(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON.`, { cause: error });
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (text !== `${JSON.stringify(value, null, 2)}\n`) {
    throw new Error(
      `${label} must be the canonical JSON emitted by the candidate generator.`,
    );
  }
  return value;
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
