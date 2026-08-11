import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  WINDOWS_STORE_FORMATS,
  assertCertificateSubjectMatchesLegalPublisher,
  assertExpectedSha256,
  assertMicrosoftStoreTauriConfig,
  assertMsixDesktopFullTrustContract,
  assertMsixIdentityMatches,
  assertMsixManifestLanguages,
  assertPartnerCenterLegalPublisher,
  assertProjectReleaseIdentity,
  assertReviewedCommit,
  assertWindowsLegalPublisher,
  deriveMsixVersion,
  fileNameContainsVersion,
  parseMsixManifestContract,
  readCargoVersion,
  validatePartnerCenterIdentity,
  validateVersionedHttpsUrl,
} from "./windows-store-contract.mjs";
import { readWindowsStoreManifestLanguageContract } from "./windows-store-language-contract.mjs";
import {
  licenseArtifactPaths,
  verifyPublishedThirdPartyLicenseBundle,
} from "./third-party-license-contract.mjs";

const defaultRoot = resolve(import.meta.dirname, "..");
const PE_EXTENSIONS = new Set([".cpl", ".dll", ".exe", ".ocx", ".scr", ".sys"]);
const RELEASE_TOOL_VERSION = 3;
const PROTECTED_RELEASE_ENVIRONMENT = "windows-release-stage-b";
const BUNDLED_THIRD_PARTY_NOTICES_PATH = "legal/THIRD-PARTY-NOTICES.txt";
const THIRD_PARTY_NOTICES_MAX_BYTES = 8 * 1024 * 1024;
const RELEASE_EVIDENCE_MAX_BYTES = 32 * 1024 * 1024;
export const WINDOWS_STORE_PUBLIC_SBOM_PATHS = Object.freeze([
  "reports/release/cargo-workspace-sbom.cdx.json",
  "reports/release/npm-desktop-sbom.cdx.json",
  "reports/release/npm-web-sbom.cdx.json",
  "reports/release/tauri-cargo-sbom.cdx.json",
]);
export const WINDOWS_STORE_SBOM_CHECKSUM_MANIFEST_PATH =
  "reports/release/SBOM-SHA256SUMS.txt";

export async function prepareWindowsStoreCandidate(
  rawArgs = process.argv.slice(2),
) {
  if (process.platform !== "win32") {
    throw new Error(
      "Windows Store candidate verification requires a Windows runner.",
    );
  }

  const options = parseArgs(rawArgs);
  const root = options.root;
  const reviewedSha = assertReviewedCommit(options.reviewedSha);
  const artifactSourceCommit = assertReviewedCommit(options.artifactSourceSha);
  const expectedSha256 = assertExpectedSha256(options.expectedSha256);
  const repository = readRepositoryContract(root);
  const identity = assertProjectReleaseIdentity({
    ...repository,
    legalPublisher: options.legalPublisher,
  });
  assertMicrosoftStoreTauriConfig(repository.storeConfig);
  assertGitBinding(root, reviewedSha);
  const executionIdentity = collectExecutionIdentity(root, reviewedSha);
  const legalNotices = collectBundledThirdPartyNoticesEvidence(root);

  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "joessh-windows-store-candidate-"),
  );
  try {
    const source = await resolveCandidateSource({
      ...options,
      expectedSha256,
      identity,
      temporaryRoot,
    });
    const artifactSnapshot = capturePrivateSnapshot(
      source.path,
      "candidate artifact",
      temporaryRoot,
      `candidate-snapshot${extname(source.path).toLowerCase()}`,
    );
    if (artifactSnapshot.sha256 !== expectedSha256) {
      throw new Error(
        `Candidate SHA-256 mismatch: expected ${expectedSha256}, received ${artifactSnapshot.sha256}.`,
      );
    }

    const verification =
      options.format === WINDOWS_STORE_FORMATS.EXE
        ? verifyExeCandidate({
            artifactSnapshot,
            architecture: options.architecture,
            expectedSigner: options.expectedSigner,
            identity,
            legalNotices,
            temporaryRoot,
          })
        : verifyMsixCandidate({
            artifactSnapshot,
            identity,
            legalNotices,
            options,
            temporaryRoot,
          });

    assertSnapshotUnchanged(artifactSnapshot);
    assertFileEvidenceUnchanged(legalNotices);
    const sourceIntegrity = await revalidateCandidateSource({
      artifactSnapshot,
      expectedSha256,
      source,
      temporaryRoot,
    });
    const outputDir = resolveOutputDir({
      format: options.format,
      outputDir: options.outputDir,
      reviewedSha,
      root,
      version: identity.version,
    });
    writeCandidateEvidence({
      artifactSnapshot,
      artifactSourceCommit,
      executionIdentity,
      identity,
      legalNotices,
      outputDir,
      reviewedSha,
      source,
      sourceIntegrity,
      verification,
    });
    console.log(
      `Windows Store candidate evidence: ${displayPath(root, outputDir)}`,
    );
    console.log(
      "Boundary: candidate only; Partner Center submission, certification, Store signing, and publication are not claimed.",
    );
    return outputDir;
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

export function collectBundledThirdPartyNoticesEvidence(inputRoot) {
  const root = resolve(inputRoot);
  const verified = verifyPublishedThirdPartyLicenseBundle(root);
  const sourcePath = licenseArtifactPaths.notices;
  const sourceFile = resolve(root, sourcePath);
  const metadata = lstatSync(sourceFile);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size <= 0 ||
    metadata.size > THIRD_PARTY_NOTICES_MAX_BYTES
  ) {
    throw new Error(
      "Bundled third-party notices must be a non-empty regular file within the release size limit.",
    );
  }
  const tauriConfigPath = resolve(
    root,
    "apps/desktop/src-tauri/tauri.conf.json",
  );
  const tauriConfig = readJson(tauriConfigPath, "Tauri config");
  const resources = tauriConfig?.bundle?.resources;
  if (
    resources === null ||
    typeof resources !== "object" ||
    Array.isArray(resources)
  ) {
    throw new Error(
      "Tauri bundle resources must map the generated third-party notices into the installed app.",
    );
  }
  const matchingSources = Object.entries(resources).filter(
    ([configuredSource, bundledPath]) =>
      bundledPath === BUNDLED_THIRD_PARTY_NOTICES_PATH &&
      resolve(root, "apps/desktop/src-tauri", configuredSource) === sourceFile,
  );
  if (matchingSources.length !== 1) {
    throw new Error(
      "Tauri must have exactly one reviewed third-party notices resource mapping.",
    );
  }
  const noticeEvidence = captureReleaseEvidenceFile(
    root,
    sourcePath,
    "bundled third-party notices",
    THIRD_PARTY_NOTICES_MAX_BYTES,
  );
  const licenseManifestEvidence = captureReleaseEvidenceFile(
    root,
    licenseArtifactPaths.manifest,
    "third-party license manifest",
  );
  const licenseChecksumEvidence = captureReleaseEvidenceFile(
    root,
    licenseArtifactPaths.checksum,
    "third-party license checksum manifest",
  );
  const sbomChecksumEvidence = captureReleaseEvidenceFile(
    root,
    WINDOWS_STORE_SBOM_CHECKSUM_MANIFEST_PATH,
    "public SBOM checksum manifest",
  );
  const sbomChecksums = parseExactChecksumManifest(
    readFileSync(sbomChecksumEvidence.absolutePath),
    WINDOWS_STORE_SBOM_CHECKSUM_MANIFEST_PATH,
    WINDOWS_STORE_PUBLIC_SBOM_PATHS,
  );
  const sbomEvidence = WINDOWS_STORE_PUBLIC_SBOM_PATHS.map((path) => {
    const evidence = captureReleaseEvidenceFile(
      root,
      path,
      `public SBOM ${path}`,
    );
    if (sbomChecksums.get(path) !== evidence.sha256) {
      throw new Error(
        `${WINDOWS_STORE_SBOM_CHECKSUM_MANIFEST_PATH} does not bind the exact bytes of ${path}.`,
      );
    }
    return evidence;
  });
  const licenseManifest = readJson(
    licenseManifestEvidence.absolutePath,
    "third-party license manifest",
  );
  assertLicenseManifestBindsPublicSboms(licenseManifest, sbomEvidence);

  const boundFiles = [
    noticeEvidence,
    licenseManifestEvidence,
    licenseChecksumEvidence,
    sbomChecksumEvidence,
    ...sbomEvidence,
  ];
  assertBoundReleaseEvidenceUnchanged(boundFiles);
  const reverified = verifyPublishedThirdPartyLicenseBundle(root);
  assertBoundReleaseEvidenceUnchanged(boundFiles);
  if (
    verified.packageCount !== reverified.packageCount ||
    verified.textCount !== reverified.textCount
  ) {
    throw new Error(
      "Published third-party license evidence changed during Store candidate verification.",
    );
  }

  return {
    absolutePath: noticeEvidence.absolutePath,
    boundFiles,
    bundleResourcePath: BUNDLED_THIRD_PARTY_NOTICES_PATH,
    checksumManifest: licenseArtifactPaths.checksum,
    checksumManifestSha256: licenseChecksumEvidence.sha256,
    licenseManifest: licenseArtifactPaths.manifest,
    licenseManifestSha256: licenseManifestEvidence.sha256,
    packageCount: verified.packageCount,
    sbomChecksumManifest: WINDOWS_STORE_SBOM_CHECKSUM_MANIFEST_PATH,
    sbomChecksumSha256: sbomChecksumEvidence.sha256,
    sboms: sbomEvidence.map(({ path, sha256 }) => ({ path, sha256 })),
    sha256: noticeEvidence.sha256,
    sizeBytes: noticeEvidence.sizeBytes,
    sourcePath,
    state: noticeEvidence.state,
    textCount: verified.textCount,
  };
}

function assertFileEvidenceUnchanged(evidence) {
  assertBoundReleaseEvidenceUnchanged(
    Array.isArray(evidence.boundFiles)
      ? evidence.boundFiles
      : [
          {
            absolutePath: evidence.absolutePath,
            label: "bundled third-party notices",
            path: evidence.sourcePath,
            sha256: evidence.sha256,
            state: evidence.state,
          },
        ],
  );
}

function captureReleaseEvidenceFile(
  root,
  path,
  label,
  maximumBytes = RELEASE_EVIDENCE_MAX_BYTES,
) {
  const absolutePath = resolve(root, ...path.split("/"));
  assertInside(root, absolutePath, label);
  let link;
  try {
    link = lstatSync(absolutePath);
  } catch {
    throw new Error(`Required ${label} is missing: ${path}.`);
  }
  if (
    link.isSymbolicLink() ||
    !link.isFile() ||
    link.size <= 0 ||
    link.size > maximumBytes
  ) {
    throw new Error(
      `${label} must be a non-empty regular file no larger than ${maximumBytes} bytes: ${path}.`,
    );
  }
  const realPath = realpathSync(absolutePath);
  assertInside(root, realPath, label);
  if (realPath !== realpathSync(root) && realPath !== absolutePath) {
    throw new Error(`${label} must not resolve through an alias: ${path}.`);
  }
  const bytes = readFileSync(absolutePath);
  const state = statSync(absolutePath);
  if (bytes.length !== state.size) {
    throw new Error(`${label} changed while it was being captured: ${path}.`);
  }
  return {
    absolutePath,
    label,
    path,
    sha256: sha256Buffer(bytes),
    sizeBytes: bytes.length,
    state,
  };
}

function parseExactChecksumManifest(bytes, path, expectedPaths) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${path} must be strict UTF-8.`);
  }
  if (
    !text.endsWith("\n") ||
    text.includes("\r") ||
    text.startsWith("\uFEFF")
  ) {
    throw new Error(`${path} must use canonical UTF-8 LF text.`);
  }
  const entries = new Map();
  const actualPaths = [];
  for (const line of text.slice(0, -1).split("\n")) {
    const match = line.match(
      /^([0-9a-f]{64}) {2}([A-Za-z0-9][A-Za-z0-9._/-]*)$/,
    );
    if (!match || entries.has(match[2])) {
      throw new Error(`${path} contains a malformed or duplicate entry.`);
    }
    entries.set(match[2], match[1]);
    actualPaths.push(match[2]);
  }
  if (actualPaths.join("\0") !== expectedPaths.join("\0")) {
    throw new Error(
      `${path} must exactly cover the four reviewed public SBOM artifacts in canonical path order.`,
    );
  }
  return entries;
}

function assertLicenseManifestBindsPublicSboms(manifest, sbomEvidence) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    !Array.isArray(manifest.inputs)
  ) {
    throw new Error(
      "Third-party license manifest must declare its release inputs.",
    );
  }
  const inputs = new Map();
  for (const input of manifest.inputs) {
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      typeof input.path !== "string" ||
      !/^[0-9a-f]{64}$/.test(input.sha256) ||
      inputs.has(input.path)
    ) {
      throw new Error(
        "Third-party license manifest contains a malformed or duplicate release input.",
      );
    }
    inputs.set(input.path, input.sha256);
  }
  for (const sbom of sbomEvidence) {
    if (inputs.get(sbom.path) !== sbom.sha256) {
      throw new Error(
        `Third-party license manifest does not bind the exact public SBOM bytes: ${sbom.path}.`,
      );
    }
  }
}

function assertBoundReleaseEvidenceUnchanged(boundFiles) {
  for (const evidence of boundFiles) {
    let current;
    let link;
    try {
      link = lstatSync(evidence.absolutePath);
      current = statSync(evidence.absolutePath);
    } catch {
      throw new Error(
        `${evidence.label} disappeared after release verification: ${evidence.path}.`,
      );
    }
    if (
      link.isSymbolicLink() ||
      !link.isFile() ||
      !sameFileState(evidence.state, current) ||
      sha256File(evidence.absolutePath) !== evidence.sha256
    ) {
      throw new Error(
        `${evidence.label} changed after release verification: ${evidence.path}.`,
      );
    }
  }
}

export function parseArgs(args, environment = process.env) {
  let root = defaultRoot;
  let format = "";
  let artifact = "";
  let downloadUrl = "";
  let expectedSha256 = "";
  let reviewedSha = "";
  let artifactSourceSha = "";
  let architecture = "";
  let partnerIdentity = "";
  let hostedRetentionAttestation = "";
  let outputDir = "";
  let allowSilentInstall = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--allow-silent-install") {
      allowSilentInstall = true;
      continue;
    }
    const [flag, inlineValue] = splitFlag(arg);
    if (
      ![
        "--architecture",
        "--artifact",
        "--artifact-source-sha",
        "--download-url",
        "--expected-sha256",
        "--format",
        "--output-dir",
        "--partner-identity",
        "--hosted-retention-attestation",
        "--reviewed-sha",
        "--root",
      ].includes(flag)
    ) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = inlineValue ?? readArgumentValue(args, index, flag);
    if (inlineValue === undefined) {
      index += 1;
    }
    if (flag === "--architecture") architecture = value;
    if (flag === "--artifact") artifact = value;
    if (flag === "--artifact-source-sha") artifactSourceSha = value;
    if (flag === "--download-url") downloadUrl = value;
    if (flag === "--expected-sha256") expectedSha256 = value;
    if (flag === "--format") format = value.toLowerCase();
    if (flag === "--output-dir") outputDir = value;
    if (flag === "--partner-identity") partnerIdentity = value;
    if (flag === "--hosted-retention-attestation") {
      hostedRetentionAttestation = value;
    }
    if (flag === "--reviewed-sha") reviewedSha = value;
    if (flag === "--root") root = resolve(value);
  }

  if (!Object.values(WINDOWS_STORE_FORMATS).includes(format)) {
    throw new Error("--format must be exactly exe or msix.");
  }
  if (Boolean(artifact) === Boolean(downloadUrl)) {
    throw new Error("Provide exactly one of --artifact or --download-url.");
  }
  if (!reviewedSha || !artifactSourceSha || !expectedSha256) {
    throw new Error(
      "--reviewed-sha, --artifact-source-sha, and --expected-sha256 are required.",
    );
  }
  if (
    environment.JOESSH_WINDOWS_RELEASE_ENVIRONMENT?.trim() !==
    PROTECTED_RELEASE_ENVIRONMENT
  ) {
    throw new Error(
      `JOESSH_WINDOWS_RELEASE_ENVIRONMENT must be ${PROTECTED_RELEASE_ENVIRONMENT}; provision it only through the protected release environment.`,
    );
  }
  if (artifact && hostedRetentionAttestation) {
    throw new Error(
      "--hosted-retention-attestation is valid only with --download-url.",
    );
  }
  const legalPublisher = assertWindowsLegalPublisher(
    environment.ATLASTERM_WINDOWS_LEGAL_PUBLISHER,
  );
  let expectedSigner = null;
  if (format === WINDOWS_STORE_FORMATS.EXE) {
    if (!allowSilentInstall) {
      throw new Error(
        "EXE preflight requires --allow-silent-install on a disposable Windows runner.",
      );
    }
    if (!["x86", "x64", "arm64"].includes(architecture)) {
      throw new Error(
        "EXE preflight requires a verifiable --architecture x86, x64, or arm64; neutral is rejected.",
      );
    }
    if (partnerIdentity) {
      throw new Error(
        "Partner Center MSIX identity must not be supplied for the EXE path.",
      );
    }
    expectedSigner = validateExpectedSigner(environment);
  } else {
    if (!partnerIdentity) {
      throw new Error(
        "MSIX preflight requires --partner-identity copied from Partner Center.",
      );
    }
    if (allowSilentInstall || architecture) {
      throw new Error(
        "MSIX architecture comes from the package manifest and is not an EXE silent-install input.",
      );
    }
  }

  return {
    allowSilentInstall,
    architecture,
    artifact: artifact ? resolve(root, artifact) : "",
    artifactSourceSha,
    downloadUrl,
    expectedSigner,
    expectedSha256,
    format,
    hostedRetentionAttestation: hostedRetentionAttestation
      ? resolve(root, hostedRetentionAttestation)
      : "",
    legalPublisher,
    outputDir,
    partnerIdentity: partnerIdentity ? resolve(root, partnerIdentity) : "",
    reviewedSha,
    root,
  };
}

export function validateExpectedSigner(environment) {
  const legalPublisher = assertWindowsLegalPublisher(
    environment.ATLASTERM_WINDOWS_LEGAL_PUBLISHER,
  );
  const subject = environment.ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT ?? "";
  const thumbprint = normalizeThumbprint(
    environment.ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT,
  );
  if (
    !subject ||
    /(?:change[-_ ]?me|example|placeholder|todo|tbd)/i.test(subject)
  ) {
    throw new Error(
      "ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT must be the exact protected-environment X.509 subject.",
    );
  }
  assertCertificateSubjectMatchesLegalPublisher(subject, legalPublisher);
  if (!/^[A-F0-9]{40}$/.test(thumbprint)) {
    throw new Error(
      "ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT must be the exact 40-hex protected-environment certificate thumbprint.",
    );
  }
  return { legalPublisher, subject, thumbprint };
}

export function assertSignerMatchesExpected(signature, expectedSigner, label) {
  if (
    signature?.signerSubject !== expectedSigner?.subject ||
    normalizeThumbprint(signature?.signerThumbprint) !==
      expectedSigner?.thumbprint
  ) {
    throw new Error(
      `${label} Authenticode signer does not exactly match the protected expected subject and thumbprint.`,
    );
  }
}

export function inspectPortableExecutable(data) {
  if (data.length < 1024 || data.readUInt16LE(0) !== 0x5a4d) {
    throw new Error("The EXE candidate is not a valid Windows PE file.");
  }
  const peOffset = data.readUInt32LE(0x3c);
  if (
    peOffset < 0x40 ||
    peOffset + 24 > data.length ||
    data.subarray(peOffset, peOffset + 4).toString("hex") !== "50450000"
  ) {
    throw new Error("The EXE candidate is not a valid Windows PE file.");
  }
  const machineCode = data.readUInt16LE(peOffset + 4);
  const machine = new Map([
    [0x014c, "x86"],
    [0x8664, "x64"],
    [0xaa64, "arm64"],
  ]).get(machineCode);
  if (!machine) {
    throw new Error(
      `The PE file has an unsupported machine type: 0x${machineCode.toString(16)}.`,
    );
  }
  return { machine, machineCode };
}

async function resolveCandidateSource({
  artifact,
  downloadUrl,
  expectedSha256,
  format,
  hostedRetentionAttestation,
  identity,
  temporaryRoot,
}) {
  const expectedExtension =
    format === WINDOWS_STORE_FORMATS.EXE ? ".exe" : ".msix";
  if (artifact) {
    if (extname(artifact).toLowerCase() !== expectedExtension) {
      throw new Error(
        `${format.toUpperCase()} preflight requires a ${expectedExtension} artifact.`,
      );
    }
    if (
      format === WINDOWS_STORE_FORMATS.EXE &&
      !fileNameContainsVersion(basename(artifact), identity.version)
    ) {
      throw new Error(
        "The EXE artifact file name must contain the release version.",
      );
    }
    return {
      architecture: null,
      expectedSha256,
      kind: "local-artifact",
      path: artifact,
      retentionAttestation: null,
      url: null,
    };
  }

  const url = new URL(downloadUrl);
  const fileName = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  if (
    !fileName ||
    basename(fileName) !== fileName ||
    extname(fileName).toLowerCase() !== expectedExtension
  ) {
    throw new Error(
      `Hosted ${format.toUpperCase()} URL must end in one ${expectedExtension} file name.`,
    );
  }
  const validatedUrl =
    format === WINDOWS_STORE_FORMATS.EXE
      ? validateVersionedHttpsUrl(downloadUrl, fileName, identity.version)
      : validateHttpsArtifactUrl(downloadUrl);
  const destination = resolve(temporaryRoot, fileName);
  await downloadWithoutRedirect(validatedUrl, destination);
  const retentionAttestation = hostedRetentionAttestation
    ? validateHostedRetentionAttestation(
        readJson(
          hostedRetentionAttestation,
          "hosted object retention attestation",
        ),
        {
          artifactUrl: validatedUrl,
          expectedSha256,
        },
      )
    : null;
  return {
    architecture: null,
    expectedSha256,
    kind: "hosted-download",
    path: destination,
    retentionAttestation,
    url: validatedUrl,
  };
}

function verifyExeCandidate({
  architecture,
  artifactSnapshot,
  expectedSigner,
  identity,
  legalNotices,
  temporaryRoot,
}) {
  inspectPortableExecutable(artifactSnapshot.data);
  const installerSignature = verifyAuthenticode(artifactSnapshot.path, {
    requireTimestamp: true,
  });
  assertSignerMatchesExpected(
    installerSignature,
    expectedSigner,
    "NSIS installer",
  );
  const beforeInstall = findInstalledProduct(identity.productName);
  if (beforeInstall.length > 0) {
    throw new Error(
      "Refusing silent-install preflight because JoeSSH is already installed on this runner.",
    );
  }

  const installResult = spawnSync(artifactSnapshot.path, ["/S"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10 * 60_000,
    windowsHide: true,
  });
  if (installResult.error || installResult.status !== 0) {
    throw new Error(
      commandDiagnostic("NSIS silent install with /S failed.", installResult),
    );
  }
  const installations = waitForInstalledProduct(identity.productName);
  if (installations.length !== 1) {
    throw new Error(
      `Expected exactly one JoeSSH installation after /S, found ${installations.length}.`,
    );
  }
  const installedProduct = installations[0];
  assertInstalledProductIdentity(installedProduct, identity);
  const installRoot = installedProduct.installLocation;
  let trustedUninstaller;
  try {
    trustedUninstaller = findTrustedUninstaller(
      installRoot,
      installerSignature,
      expectedSigner,
    );
  } catch (error) {
    throw new Error(
      `Cleanup was not attempted because no trusted uninstaller was available: ${error.message}`,
      { cause: error },
    );
  }

  let bundledThirdPartyNotices;
  let payload;
  let mainExecutableMachine;
  let verificationError = null;
  try {
    bundledThirdPartyNotices = verifyInstalledThirdPartyNotices(
      installRoot,
      legalNotices,
      temporaryRoot,
    );
    const payloadFiles = collectPortableExecutables(installRoot);
    const payloadSnapshots = payloadFiles.map((path, index) => ({
      relativePath: relative(installRoot, path).replaceAll("\\", "/"),
      snapshot: capturePrivateSnapshot(
        path,
        `installed PE ${relative(installRoot, path)}`,
        temporaryRoot,
        `installed-pe-${index}${extname(path).toLowerCase()}`,
      ),
    }));
    const mainExecutables = payloadSnapshots.filter(
      (entry) => basename(entry.relativePath).toLowerCase() === "joessh.exe",
    );
    if (mainExecutables.length !== 1) {
      throw new Error(
        `Silent install must produce exactly one JoeSSH.exe; found ${mainExecutables.length}.`,
      );
    }
    mainExecutableMachine = inspectPortableExecutable(
      mainExecutables[0].snapshot.data,
    ).machine;
    if (mainExecutableMachine !== architecture) {
      throw new Error(
        `Installed JoeSSH.exe PE machine ${mainExecutableMachine} does not match requested architecture ${architecture}.`,
      );
    }
    payload = payloadSnapshots.map(({ relativePath, snapshot }) => {
      const signature = verifyAuthenticode(snapshot.path, {
        requireTimestamp: true,
      });
      assertSignerMatchesExpected(
        signature,
        expectedSigner,
        `installed PE ${relativePath}`,
      );
      return {
        path: relativePath,
        sha256: snapshot.sha256,
        signature,
      };
    });
    const mainExecutable = payload.find(
      (entry) => basename(entry.path).toLowerCase() === "joessh.exe",
    );
    if (
      mainExecutable?.signature?.signerThumbprint !==
        installerSignature.signerThumbprint ||
      mainExecutable?.signature?.signerSubject !==
        installerSignature.signerSubject
    ) {
      throw new Error(
        "Installed JoeSSH.exe signer does not match the NSIS installer signer.",
      );
    }
  } catch (error) {
    verificationError = error;
  }

  let uninstall = null;
  let cleanupError = null;
  try {
    uninstall = verifySilentUninstall({
      installRoot,
      productName: identity.productName,
      expectedSha256: trustedUninstaller.sha256,
      expectedSigner,
      uninstallerPath: trustedUninstaller.path,
    });
  } catch (error) {
    cleanupError = error;
  }
  const combinedError = combineVerificationErrors(
    verificationError,
    cleanupError,
  );
  if (combinedError) {
    throw combinedError;
  }

  return {
    architecture,
    architectureVerification: {
      installedMainExecutable: "JoeSSH.exe",
      peMachine: mainExecutableMachine,
    },
    bundledThirdPartyNotices,
    format: WINDOWS_STORE_FORMATS.EXE,
    install: {
      arpIdentity: {
        displayName: installedProduct.displayName,
        displayVersion: installedProduct.displayVersion,
        publisher: installedProduct.publisher,
      },
      installedPayloadRoot: "verified-on-disposable-runner-not-recorded",
      silentArgument: "/S",
      silentInstallExitCode: 0,
      uninstall,
    },
    installerSignature,
    payload,
    route: "microsoft-store-exe-msi",
    signerPolicy: {
      allInstalledPeMatched: true,
      expectedSubject: expectedSigner.subject,
      expectedThumbprint: expectedSigner.thumbprint,
      inputBoundary: "protected-release-environment",
      legalPublisher: expectedSigner.legalPublisher,
    },
    storeSigningExpected: false,
    tauriNativeBundle: true,
  };
}

export function combineVerificationErrors(verificationError, cleanupError) {
  if (verificationError && cleanupError) {
    return new AggregateError(
      [verificationError, cleanupError],
      `EXE payload verification failed: ${verificationError.message}\nSilent cleanup also failed: ${cleanupError.message}`,
    );
  }
  return verificationError ?? cleanupError ?? null;
}

const defaultMsixCandidateRuntime = Object.freeze({
  crossCheckPartnerCenterPackageFamily,
  inspectAuthenticode,
  resolveWindowsSdkTool,
  runRequiredCommand,
  verifyUnpackedThirdPartyNotices,
});

export function verifyMsixCandidate(
  { artifactSnapshot, identity, legalNotices, options, temporaryRoot },
  runtime = defaultMsixCandidateRuntime,
) {
  const {
    crossCheckPartnerCenterPackageFamily:
      crossCheckPartnerCenterPackageFamilyForCandidate,
    inspectAuthenticode: inspectAuthenticodeForCandidate,
    resolveWindowsSdkTool: resolveWindowsSdkToolForCandidate,
    runRequiredCommand: runRequiredCommandForCandidate,
    verifyUnpackedThirdPartyNotices:
      verifyUnpackedThirdPartyNoticesForCandidate,
  } = runtime;
  const partnerIdentity = validatePartnerCenterIdentity(
    readJson(options.partnerIdentity, "Partner Center identity"),
  );
  assertPartnerCenterLegalPublisher(partnerIdentity, identity.publisher);
  const unpackRoot = resolve(temporaryRoot, "msix-unpacked");
  mkdirSync(unpackRoot);
  const makeAppx = resolveWindowsSdkToolForCandidate("makeappx.exe");
  runRequiredCommandForCandidate(
    makeAppx,
    ["unpack", "/p", artifactSnapshot.path, "/d", unpackRoot, "/o", "/v"],
    "MakeAppx semantic validation and unpack failed.",
  );
  validateUnpackedTree(unpackRoot);
  const manifestPath = resolveUnpackedPackageFile(
    unpackRoot,
    "AppxManifest.xml",
    "MSIX AppxManifest.xml",
  );
  const manifestXml = readFileSync(manifestPath, "utf8");
  const manifestContract = parseMsixManifestContract(manifestXml);
  assertMsixDesktopFullTrustContract(manifestXml);
  const manifestLanguageContract = readWindowsStoreManifestLanguageContract(
    resolve(
      options.root ?? defaultRoot,
      "packages/i18n/src/windows-store-manifest-languages.json",
    ),
  );
  assertMsixManifestLanguages(
    manifestContract.languages,
    manifestLanguageContract.manifestLanguages,
  );
  const manifest = manifestContract.identity;
  assertMsixIdentityMatches(manifest, partnerIdentity);
  const partnerIdentityCrossCheck =
    crossCheckPartnerCenterPackageFamilyForCandidate(partnerIdentity);
  const expectedVersion = deriveMsixVersion(identity.version);
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `MSIX manifest version ${manifest.version} does not match deterministic project mapping ${expectedVersion}.`,
    );
  }
  if (!["x86", "x64", "arm64"].includes(manifest.architecture)) {
    throw new Error(
      `JoeSSH desktop MSIX must declare a concrete x86, x64, or arm64 architecture; received ${manifest.architecture}.`,
    );
  }
  const applicationExecutable = resolveUnpackedPackageFile(
    unpackRoot,
    manifestContract.desktopApplication.executable,
    "MSIX Application.Executable",
  );
  const bundledThirdPartyNotices = verifyUnpackedThirdPartyNoticesForCandidate(
    unpackRoot,
    applicationExecutable,
    legalNotices,
    temporaryRoot,
  );
  const applicationSnapshot = capturePrivateSnapshot(
    applicationExecutable,
    "MSIX Application.Executable",
    temporaryRoot,
    ".msix-application.exe",
  );
  const applicationMachine = inspectPortableExecutable(
    applicationSnapshot.data,
  ).machine;
  if (applicationMachine !== manifest.architecture) {
    throw new Error(
      `MSIX Application.Executable PE machine ${applicationMachine} does not match manifest architecture ${manifest.architecture}.`,
    );
  }

  const signature = inspectAuthenticodeForCandidate(artifactSnapshot.path);
  let signatureState;
  if (signature.status === "Valid") {
    verifyWithSignTool(artifactSnapshot.path);
    if (signature.signerSubject !== manifest.publisher) {
      throw new Error(
        "Signed MSIX certificate subject does not exactly match manifest Identity.Publisher.",
      );
    }
    signatureState = "valid-pre-store-signature";
  } else if (signature.status === "NotSigned") {
    signatureState = "pending-microsoft-store-signing";
  } else {
    throw new Error(
      `MSIX has an invalid Authenticode state: ${signature.status}.`,
    );
  }
  return {
    bundledThirdPartyNotices,
    format: WINDOWS_STORE_FORMATS.MSIX,
    makeAppx: {
      executable: basename(makeAppx),
      semanticValidation: "passed",
    },
    manifest,
    manifestLanguages: {
      ...manifestLanguageContract,
      status: "exact-match",
    },
    desktopApplication: {
      ...manifestContract.desktopApplication,
      peMachine: applicationMachine,
      sha256: applicationSnapshot.sha256,
    },
    projectVersionMapping: {
      msixVersion: expectedVersion,
      projectVersion: identity.version,
    },
    partnerIdentity,
    partnerIdentityCrossCheck,
    partnerIdentityEvidence:
      "operator-supplied Partner Center values; assignment is not independently verified",
    route: "microsoft-store-msix-external",
    signature,
    signatureState,
    storeSigningExpected: true,
    tauriNativeBundle: false,
  };
}

export function assertBundledThirdPartyNoticesMatch(
  verification,
  expectedEvidence,
) {
  const bundledNotices = verification?.bundledThirdPartyNotices;
  if (
    bundledNotices?.status !== "exact-match" ||
    bundledNotices.path !== expectedEvidence?.bundleResourcePath ||
    bundledNotices.sizeBytes !== expectedEvidence?.sizeBytes ||
    bundledNotices.sha256 !== expectedEvidence?.sha256
  ) {
    throw new Error(
      "Candidate verification must prove an exact match for the bundled third-party notices.",
    );
  }
  return {
    ...bundledNotices,
    thirdPartyNoticesBundled: true,
  };
}

function writeCandidateEvidence({
  artifactSnapshot,
  artifactSourceCommit,
  executionIdentity,
  identity,
  legalNotices,
  outputDir,
  reviewedSha,
  source,
  sourceIntegrity,
  verification,
}) {
  const verifiedBundledNotices = assertBundledThirdPartyNoticesMatch(
    verification,
    legalNotices,
  );
  if (existsSync(outputDir)) {
    throw new Error(`Refusing to overwrite candidate evidence: ${outputDir}`);
  }
  mkdirSync(outputDir, { recursive: true });
  const artifactPath = resolve(outputDir, artifactSnapshot.fileName);
  copyFileSync(artifactSnapshot.path, artifactPath, constants.COPYFILE_EXCL);
  if (sha256File(artifactPath) !== artifactSnapshot.sha256) {
    throw new Error("Staged candidate artifact changed during copy.");
  }
  assertFileEvidenceUnchanged(legalNotices);
  const legalNoticesPath = resolve(
    outputDir,
    basename(legalNotices.sourcePath),
  );
  copyFileSync(
    legalNotices.absolutePath,
    legalNoticesPath,
    constants.COPYFILE_EXCL,
  );
  if (sha256File(legalNoticesPath) !== legalNotices.sha256) {
    throw new Error(
      "Staged third-party notices changed during candidate evidence copy.",
    );
  }
  const finalizedSourceIntegrity = {
    ...sourceIntegrity,
    observations: [
      ...sourceIntegrity.observations,
      {
        point: "candidate-evidence-staged-copy",
        sha256: artifactSnapshot.sha256,
      },
    ],
  };

  const generatedAt = new Date().toISOString();
  const hosted = source.kind === "hosted-download";
  const isExe = verification.format === WINDOWS_STORE_FORMATS.EXE;
  const immutableHostedUrl =
    sourceIntegrity.urlImmutability.status ===
    "human-attested-object-retention";
  const blockers = isExe
    ? [
        ...(hosted
          ? immutableHostedUrl
            ? []
            : [
                "Hosted URL immutability is unverified without explicit object-lock or retention proof.",
              ]
          : [
              "Publish the exact SHA-256-bound artifact at an immutable versioned HTTPS URL.",
            ]),
        "Automatic-update behavior has not been verified by this candidate preflight.",
        "Windows App Certification Kit has not been run.",
        "Partner Center certification has not been run.",
        "Authenticated build provenance has not been supplied or verified.",
      ]
    : [
        "Windows App Certification Kit has not been run.",
        "Partner Center submission, certification, and Microsoft Store signing have not occurred.",
        "Authenticated build provenance has not been supplied or verified.",
      ];
  const candidate = {
    schemaVersion: 3,
    kind: "windows-store-candidate",
    generatedAt,
    format: verification.format,
    route: verification.route,
    version: identity.version,
    commits: {
      artifactSourceCommit,
      preflightCommit: reviewedSha,
      relationship:
        artifactSourceCommit === reviewedSha
          ? "same-commit"
          : "distinct-commits",
      sourceCommitBinding:
        "operator-supplied input; authenticated provenance not provided",
    },
    executionIdentity,
    projectIdentity: identity,
    artifact: {
      fileName: artifactSnapshot.fileName,
      sha256: artifactSnapshot.sha256,
      sizeBytes: artifactSnapshot.size,
      source: source.kind,
      versionedHttpsUrl: source.url,
      stagedCopySha256: artifactSnapshot.sha256,
      integrity: finalizedSourceIntegrity,
    },
    legalNotices: {
      bundleResourcePath: legalNotices.bundleResourcePath,
      checksumManifest: legalNotices.checksumManifest,
      checksumManifestSha256: legalNotices.checksumManifestSha256,
      evidenceFileName: basename(legalNoticesPath),
      licenseManifest: legalNotices.licenseManifest,
      licenseManifestSha256: legalNotices.licenseManifestSha256,
      packageCount: legalNotices.packageCount,
      sbomChecksumManifest: legalNotices.sbomChecksumManifest,
      sbomChecksumSha256: legalNotices.sbomChecksumSha256,
      sboms: legalNotices.sboms,
      sha256: legalNotices.sha256,
      sizeBytes: legalNotices.sizeBytes,
      sourcePath: legalNotices.sourcePath,
      textCount: legalNotices.textCount,
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
        artifactSha256: artifactSnapshot.sha256,
        artifactSourceCommit,
        environment: PROTECTED_RELEASE_ENVIRONMENT,
        legalPublisher: identity.publisher,
        sbomChecksumManifestSha256: legalNotices.sbomChecksumSha256,
        thirdPartyLicenseChecksumManifestSha256:
          legalNotices.checksumManifestSha256,
        thirdPartyNoticesSha256: legalNotices.sha256,
        expectedSigner: isExe
          ? {
              subject: verification.signerPolicy.expectedSubject,
              thumbprint: verification.signerPolicy.expectedThumbprint,
            }
          : "not-applicable-store-signed-msix",
        preflightCommit: reviewedSha,
        repository: executionIdentity.repository,
        run: executionIdentity.run,
        status: "inputs-enforced-not-cryptographically-authenticated",
      },
      selfGeneratedChecksums: {
        authenticatedProvenance: false,
        classification: "local-integrity-list-only",
        fileName: "SHA256SUMS.txt",
      },
    },
    verification,
    gates: {
      artifactHashBound: true,
      authenticatedProvenance: false,
      candidatePreflightPassed: true,
      hostedUrlImmutability: hosted
        ? immutableHostedUrl
          ? "human-attested"
          : "unverified"
        : "not-applicable",
      offlineWebView2Config: isExe ? true : "not-applicable",
      publicSbomsBound: true,
      thirdPartyNoticesBundled: verifiedBundledNotices.thirdPartyNoticesBundled,
      partnerCenterUploadCandidate: false,
      storePublicationReady: false,
      windowsAppCertificationKit: "not-run",
      blockers,
    },
    storeSubmission: {
      certificationStatus: "not-run",
      status: "not-submitted",
      storeSignatureStatus: isExe
        ? "not-applicable-publisher-signature-required"
        : "not-issued",
    },
    boundary:
      "This file proves only local candidate checks. It is not Partner Center submission, certification, Store signing, listing, or publication evidence.",
  };
  const candidatePath = resolve(outputDir, "candidate.json");
  writeFileSync(
    candidatePath,
    `${JSON.stringify(candidate, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    resolve(outputDir, "SHA256SUMS.txt"),
    [
      `${sha256File(artifactPath)}  ${basename(artifactPath)}`,
      `${sha256File(legalNoticesPath)}  ${basename(legalNoticesPath)}`,
      `${sha256File(candidatePath)}  candidate.json`,
    ].join("\n") + "\n",
    "ascii",
  );
}

function readRepositoryContract(root) {
  return {
    cargoVersion: readCargoVersion(
      resolve(root, "apps/desktop/src-tauri/Cargo.toml"),
    ),
    desktopPackage: readJson(
      resolve(root, "apps/desktop/package.json"),
      "Desktop package",
    ),
    rootPackage: readJson(resolve(root, "package.json"), "root package"),
    storeConfig: readJson(
      resolve(root, "apps/desktop/src-tauri/tauri.microsoftstore.conf.json"),
      "Microsoft Store Tauri config",
    ),
    tauriConfig: readJson(
      resolve(root, "apps/desktop/src-tauri/tauri.conf.json"),
      "Tauri config",
    ),
  };
}

function assertGitBinding(root, reviewedSha) {
  const git = resolveTrustedGit();
  const result = runGit(git, root, ["rev-parse", "HEAD"]);
  if (
    result.error ||
    result.status !== 0 ||
    result.stdout.trim().toLowerCase() !== reviewedSha
  ) {
    throw new Error(
      "The checked-out Git commit does not match --reviewed-sha.",
    );
  }
  const tracked = runGit(git, root, ["diff", "--quiet", "HEAD", "--"]);
  if (tracked.status !== 0) {
    throw new Error(
      "Windows Store candidates require no tracked changes from the reviewed commit.",
    );
  }
  const untracked = runGit(git, root, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  if (untracked.status !== 0 || untracked.stdout.trim()) {
    throw new Error(
      "Windows Store candidates require no untracked, non-ignored files.",
    );
  }
}

function collectExecutionIdentity(root, reviewedSha) {
  const git = resolveTrustedGit();
  const remoteResult = runGit(git, root, [
    "config",
    "--get",
    "remote.origin.url",
  ]);
  const repository = canonicalRepositoryIdentity(
    process.env.GITHUB_REPOSITORY,
    remoteResult.status === 0 ? remoteResult.stdout.trim() : "",
  );
  const serverUrl = sanitizeGithubServerUrl(process.env.GITHUB_SERVER_URL);
  return {
    repository,
    run: {
      attempt: normalizePositiveInteger(process.env.GITHUB_RUN_ATTEMPT),
      id: normalizePositiveInteger(process.env.GITHUB_RUN_ID),
      job: normalizeBoundedIdentifier(process.env.GITHUB_JOB),
      serverUrl,
      status:
        process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
          ? "github-actions-context-recorded"
          : "local-run-context-not-authenticated",
      workflow: normalizeBoundedText(process.env.GITHUB_WORKFLOW),
    },
    tool: {
      architecture: process.arch,
      gitExecutable: basename(git),
      nodeVersion: process.version,
      platform: process.platform,
      preflightCommit: reviewedSha,
      script: basename(fileURLToPath(import.meta.url)),
      scriptSha256: sha256File(fileURLToPath(import.meta.url)),
      scriptVersion: RELEASE_TOOL_VERSION,
    },
  };
}

function canonicalRepositoryIdentity(githubRepository, remoteUrl) {
  const environmentSlug = githubRepository?.trim();
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(environmentSlug ?? "")) {
    return {
      slug: environmentSlug,
      source: "github-actions-context",
    };
  }
  const patterns = [
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/i,
    /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/i,
  ];
  for (const pattern of patterns) {
    const match = remoteUrl.match(pattern);
    if (match) {
      return {
        slug: match[1],
        source: "sanitized-git-origin",
      };
    }
  }
  return {
    slug: null,
    source: "unavailable-or-non-github-origin",
  };
}

function sanitizeGithubServerUrl(value) {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function normalizePositiveInteger(value) {
  const normalized = value?.trim();
  return /^[1-9]\d{0,19}$/.test(normalized ?? "") ? normalized : null;
}

function normalizeBoundedIdentifier(value) {
  const normalized = value?.trim();
  return /^[A-Za-z0-9_.-]{1,128}$/.test(normalized ?? "") ? normalized : null;
}

function normalizeBoundedText(value) {
  const normalized = value?.trim();
  return normalized &&
    normalized.length <= 256 &&
    !containsControlCharacters(normalized)
    ? normalized
    : null;
}

function runGit(git, root, args) {
  return spawnSync(git, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function verifyAuthenticode(path, { requireTimestamp = false } = {}) {
  const signature = inspectAuthenticode(path);
  if (signature.status !== "Valid") {
    throw new Error(
      `Authenticode validation failed for ${basename(path)}: ${signature.status}.`,
    );
  }
  if (!signature.signerThumbprint || !signature.signerSubject) {
    throw new Error(
      `Authenticode signer identity is missing for ${basename(path)}.`,
    );
  }
  if (
    requireTimestamp &&
    (!signature.timeStamperThumbprint || !signature.timeStamperSubject)
  ) {
    throw new Error(`A trusted timestamp is required for ${basename(path)}.`);
  }
  verifyWithSignTool(path);
  return { ...signature, signToolVerification: "passed" };
}

function inspectAuthenticode(path) {
  const powershell = resolveSystemPowerShell();
  const command = [
    "$path = [Console]::In.ReadToEnd();",
    "$signature = Get-AuthenticodeSignature -LiteralPath $path;",
    "[PSCustomObject]@{",
    "Status = $signature.Status.ToString();",
    "StatusMessage = $signature.StatusMessage;",
    "SignerThumbprint = $signature.SignerCertificate.Thumbprint;",
    "SignerSubject = $signature.SignerCertificate.Subject;",
    "TimeStamperThumbprint = $signature.TimeStamperCertificate.Thumbprint;",
    "TimeStamperSubject = $signature.TimeStamperCertificate.Subject",
    "} | ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      input: path,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      commandDiagnostic("Unable to inspect Authenticode signature.", result),
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Unable to parse Authenticode inspection output.");
  }
  return {
    signerSubject: parsed.SignerSubject ?? null,
    signerThumbprint: normalizeThumbprint(parsed.SignerThumbprint) || null,
    status: parsed.Status ?? "Unknown",
    statusMessage: parsed.StatusMessage ?? "",
    timeStamperSubject: parsed.TimeStamperSubject ?? null,
    timeStamperThumbprint:
      normalizeThumbprint(parsed.TimeStamperThumbprint) || null,
  };
}

function verifyWithSignTool(path) {
  runRequiredCommand(
    resolveWindowsSdkTool("signtool.exe"),
    ["verify", "/pa", "/all", "/v", path],
    `SignTool verification failed for ${basename(path)}.`,
  );
  return "passed";
}

function findInstalledProduct(productName) {
  const powershell = resolveSystemPowerShell();
  const command = [
    "$request = [Console]::In.ReadToEnd() | ConvertFrom-Json;",
    "$name = $request.ProductName;",
    "$roots = @(",
    "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
    ");",
    "$items = foreach ($root in $roots) {",
    "Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |",
    "Where-Object { $_.DisplayName -eq $name }",
    "};",
    "$records = foreach ($item in $items) {",
    "$path = $item.InstallLocation;",
    'if ([string]::IsNullOrWhiteSpace($path) -and $item.UninstallString -match \'^"([^"]+)"\') {',
    "$path = Split-Path -Parent $Matches[1]",
    "}",
    "if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path -PathType Container)) {",
    "[PSCustomObject]@{",
    "DisplayName = [string]$item.DisplayName;",
    "DisplayVersion = [string]$item.DisplayVersion;",
    "InstallLocation = (Resolve-Path -LiteralPath $path).Path;",
    "Publisher = [string]$item.Publisher",
    "}",
    "}",
    "};",
    "ConvertTo-Json -InputObject @($records) -Compress",
  ].join(" ");
  const result = spawnSync(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      input: JSON.stringify({ ProductName: productName }),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      commandDiagnostic("Unable to inspect installed products.", result),
    );
  }
  const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, "") || "[]");
  const records = Array.isArray(parsed) ? parsed : [parsed];
  return records.map((record) => ({
    displayName: record.DisplayName ?? "",
    displayVersion: record.DisplayVersion ?? "",
    installLocation: record.InstallLocation ?? "",
    publisher: record.Publisher ?? "",
  }));
}

function waitForInstalledProduct(productName) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const products = findInstalledProduct(productName);
    if (products.length > 0) {
      return products;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return [];
}

export function assertInstalledProductIdentity(product, identity) {
  const expected = {
    displayName: identity.productName,
    displayVersion: identity.version,
    publisher: identity.publisher,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (product?.[field] !== value) {
      throw new Error(
        `Installed product ARP ${field} does not match the reviewed release identity.`,
      );
    }
  }
  if (!product.installLocation) {
    throw new Error("Installed product ARP InstallLocation is missing.");
  }
}

function findTrustedUninstaller(
  installRoot,
  installerSignature,
  expectedSigner,
) {
  const uninstallers = readdirSync(installRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /^uninstall(?:er)?(?:[-_.].*)?\.exe$/i.test(entry.name),
    )
    .map((entry) => resolve(installRoot, entry.name));
  if (uninstallers.length !== 1) {
    throw new Error(
      `Expected exactly one top-level NSIS uninstaller, found ${uninstallers.length}.`,
    );
  }
  const uninstallerPath = uninstallers[0];
  const link = lstatSync(uninstallerPath);
  if (!link.isFile() || link.isSymbolicLink() || link.nlink !== 1) {
    throw new Error("NSIS uninstaller must be a direct, single-link file.");
  }
  assertInside(
    realpathSync(installRoot),
    realpathSync(uninstallerPath),
    "NSIS uninstaller",
  );
  const signature = verifyAuthenticode(uninstallerPath, {
    requireTimestamp: true,
  });
  assertSignerMatchesExpected(signature, expectedSigner, "NSIS uninstaller");
  if (
    signature.signerThumbprint !== installerSignature.signerThumbprint ||
    signature.signerSubject !== installerSignature.signerSubject
  ) {
    throw new Error(
      "NSIS uninstaller signer does not match the installer signer.",
    );
  }
  return {
    path: realpathSync(uninstallerPath),
    sha256: sha256File(uninstallerPath),
    signature,
  };
}

function verifySilentUninstall({
  expectedSha256,
  expectedSigner,
  installRoot,
  productName,
  uninstallerPath,
}) {
  if (sha256File(uninstallerPath) !== expectedSha256) {
    throw new Error(
      "NSIS uninstaller changed between payload verification and cleanup.",
    );
  }
  const signature = verifyAuthenticode(uninstallerPath, {
    requireTimestamp: true,
  });
  assertSignerMatchesExpected(
    signature,
    expectedSigner,
    "NSIS uninstaller immediately before cleanup",
  );
  const result = spawnSync(uninstallerPath, ["/S"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10 * 60_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      commandDiagnostic("NSIS silent uninstall with /S failed.", result),
    );
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      findInstalledProduct(productName).length === 0 &&
      !existsSync(installRoot)
    ) {
      return {
        installRootRemoved: true,
        silentArgument: "/S",
        silentUninstallExitCode: 0,
      };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(
    "Silent uninstall did not remove the product registration and install root.",
  );
}

function collectPortableExecutables(root) {
  const rootRealPath = realpathSync(root);
  const files = [];
  const pending = [rootRealPath];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const link = lstatSync(path);
      if (link.isSymbolicLink()) {
        throw new Error(`Installed payload contains a symbolic link: ${path}`);
      }
      const realPath = realpathSync(path);
      assertInside(rootRealPath, realPath, "installed payload");
      if (entry.isDirectory()) {
        pending.push(realPath);
      } else if (
        entry.isFile() &&
        PE_EXTENSIONS.has(extname(entry.name).toLowerCase())
      ) {
        files.push(realPath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function validateUnpackedTree(root) {
  const rootRealPath = realpathSync(root);
  const pending = [rootRealPath];
  let entryCount = 0;
  let totalBytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      entryCount += 1;
      if (entryCount > 100_000) {
        throw new Error("Unpacked MSIX exceeds the safe entry-count limit.");
      }
      const path = resolve(directory, entry.name);
      const link = lstatSync(path);
      if (link.isSymbolicLink()) {
        throw new Error(
          `Unpacked MSIX contains a symbolic link: ${entry.name}`,
        );
      }
      const realPath = realpathSync(path);
      assertInside(rootRealPath, realPath, "unpacked MSIX entry");
      if (entry.isDirectory()) {
        pending.push(realPath);
        continue;
      }
      if (!entry.isFile() || link.nlink !== 1) {
        throw new Error(
          `Unpacked MSIX entry must be a direct, single-link file: ${entry.name}`,
        );
      }
      totalBytes += link.size;
      if (totalBytes > 4 * 1024 * 1024 * 1024) {
        throw new Error("Unpacked MSIX exceeds the 4 GiB safety limit.");
      }
    }
  }
}

export function verifyInstalledThirdPartyNotices(
  installRoot,
  expectedEvidence,
  temporaryRoot,
) {
  return verifyPayloadThirdPartyNotices(
    installRoot,
    expectedEvidence,
    "Installed EXE payload third-party notices",
    temporaryRoot,
    "installed-third-party-notices.txt",
  );
}

export function verifyUnpackedThirdPartyNotices(
  unpackRoot,
  applicationExecutable,
  expectedEvidence,
  temporaryRoot,
) {
  const realUnpackRoot = realpathSync(unpackRoot);
  const realApplicationExecutable = realpathSync(applicationExecutable);
  assertInside(
    realUnpackRoot,
    realApplicationExecutable,
    "MSIX Application.Executable notices root",
  );
  return verifyPayloadThirdPartyNotices(
    dirname(realApplicationExecutable),
    expectedEvidence,
    "Unpacked MSIX third-party notices",
    temporaryRoot,
    "unpacked-third-party-notices.txt",
  );
}

function verifyPayloadThirdPartyNotices(
  payloadRoot,
  expectedEvidence,
  label,
  temporaryRoot,
  snapshotName,
) {
  if (
    expectedEvidence?.bundleResourcePath !== BUNDLED_THIRD_PARTY_NOTICES_PATH ||
    typeof expectedEvidence?.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedEvidence.sha256) ||
    !Number.isSafeInteger(expectedEvidence?.sizeBytes) ||
    expectedEvidence.sizeBytes <= 0 ||
    expectedEvidence.sizeBytes > THIRD_PARTY_NOTICES_MAX_BYTES
  ) {
    throw new Error(
      `${label} requires exact source path, size, and SHA-256 evidence.`,
    );
  }

  const resolvedRoot = resolve(payloadRoot);
  if (!existsSync(resolvedRoot)) {
    throw new Error(`${label} root is missing.`);
  }
  const rootLink = lstatSync(resolvedRoot);
  if (!rootLink.isDirectory() || rootLink.isSymbolicLink()) {
    throw new Error(`${label} root must be a direct directory.`);
  }
  const realRoot = realpathSync(resolvedRoot);
  if (realRoot.toLowerCase() !== resolvedRoot.toLowerCase()) {
    throw new Error(`${label} root must not resolve through an alias.`);
  }

  const expectedPath = resolve(
    realRoot,
    ...BUNDLED_THIRD_PARTY_NOTICES_PATH.split("/"),
  );
  assertInside(realRoot, expectedPath, label);
  if (!existsSync(expectedPath)) {
    throw new Error(
      `${label} is missing at ${BUNDLED_THIRD_PARTY_NOTICES_PATH}.`,
    );
  }
  const link = lstatSync(expectedPath);
  if (
    !link.isFile() ||
    link.isSymbolicLink() ||
    link.nlink !== 1 ||
    link.size <= 0 ||
    link.size > THIRD_PARTY_NOTICES_MAX_BYTES
  ) {
    throw new Error(`${label} must be a direct, regular, single-link file.`);
  }
  const realPath = realpathSync(expectedPath);
  assertInside(realRoot, realPath, label);
  if (realPath.toLowerCase() !== expectedPath.toLowerCase()) {
    throw new Error(`${label} must not resolve through an alias.`);
  }

  const snapshot = capturePrivateSnapshot(
    realPath,
    label,
    temporaryRoot,
    snapshotName,
  );
  if (snapshot.size !== expectedEvidence.sizeBytes) {
    throw new Error(
      `${label} size does not match the verified source notices.`,
    );
  }
  if (snapshot.sha256 !== expectedEvidence.sha256) {
    throw new Error(
      `${label} SHA-256 does not match the verified source notices.`,
    );
  }

  return {
    path: BUNDLED_THIRD_PARTY_NOTICES_PATH,
    sha256: snapshot.sha256,
    sizeBytes: snapshot.size,
    status: "exact-match",
  };
}

function resolveUnpackedPackageFile(root, packageRelativePath, label) {
  const rootRealPath = realpathSync(root);
  const resolved = resolve(rootRealPath, ...packageRelativePath.split("/"));
  assertInside(rootRealPath, resolved, label);
  if (!existsSync(resolved)) {
    throw new Error(`${label} is missing from the unpacked MSIX.`);
  }
  const link = lstatSync(resolved);
  if (!link.isFile() || link.isSymbolicLink() || link.nlink !== 1) {
    throw new Error(`${label} must be a direct, single-link file.`);
  }
  const realPath = realpathSync(resolved);
  assertInside(rootRealPath, realPath, label);
  return realPath;
}

function crossCheckPartnerCenterPackageFamily(partnerIdentity) {
  const powershell = resolveSystemPowerShell();
  const command = `
$source = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class JoeSshPackageIdentityNative {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  public static extern int PackageNameAndPublisherIdFromFamilyName(
    string packageFamilyName,
    ref uint packageNameLength,
    StringBuilder packageName,
    ref uint packagePublisherIdLength,
    StringBuilder packagePublisherId);
}
"@
Add-Type -TypeDefinition $source
$familyName = [Console]::In.ReadToEnd()
[uint32]$nameLength = 65
[uint32]$publisherIdLength = 14
$name = New-Object Text.StringBuilder 65
$publisherId = New-Object Text.StringBuilder 14
$result = [JoeSshPackageIdentityNative]::PackageNameAndPublisherIdFromFamilyName(
  $familyName,
  [ref]$nameLength,
  $name,
  [ref]$publisherIdLength,
  $publisherId
)
if ($result -ne 0) { throw "PackageNameAndPublisherIdFromFamilyName failed: $result" }
[PSCustomObject]@{
  Name = $name.ToString()
  PublisherId = $publisherId.ToString()
} | ConvertTo-Json -Compress
`;
  const result = spawnSync(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      input: partnerIdentity.packageFamilyName,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      commandDiagnostic(
        "Unable to cross-check Partner Center packageFamilyName with the Windows package identity API.",
        result,
      ),
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(
      "Unable to parse the Windows package identity API cross-check.",
    );
  }
  if (
    parsed.Name?.localeCompare(partnerIdentity.packageIdentityName, undefined, {
      sensitivity: "accent",
    }) !== 0 ||
    parsed.PublisherId?.localeCompare(partnerIdentity.publisherId, undefined, {
      sensitivity: "accent",
    }) !== 0
  ) {
    throw new Error(
      "Partner Center packageFamilyName does not cross-check to packageIdentityName and publisherId.",
    );
  }
  return {
    method: "PackageNameAndPublisherIdFromFamilyName",
    packageIdentityName: parsed.Name,
    publisherId: parsed.PublisherId,
    status: "matched",
  };
}

function resolveWindowsSdkTool(fileName) {
  const programFilesX86 =
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const sdkRoot = resolve(programFilesX86, "Windows Kits/10/bin");
  if (!existsSync(sdkRoot)) {
    throw new Error("Windows 10/11 SDK bin directory was not found.");
  }
  const candidates = [];
  for (const version of readdirSync(sdkRoot, { withFileTypes: true })) {
    if (!version.isDirectory() || !/^\d+(?:\.\d+){3}$/.test(version.name)) {
      continue;
    }
    for (const architecture of ["x64", "x86", "arm64"]) {
      const path = resolve(sdkRoot, version.name, architecture, fileName);
      if (existsSync(path)) {
        candidates.push(path);
      }
    }
  }
  candidates.sort((left, right) =>
    right.localeCompare(left, undefined, { numeric: true }),
  );
  if (candidates.length === 0) {
    throw new Error(`${fileName} was not found in the Windows SDK.`);
  }
  const selected = realpathSync(candidates[0]);
  assertInside(realpathSync(sdkRoot), selected, fileName);
  return selected;
}

function resolveTrustedGit() {
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const git = resolve(programFiles, "Git/cmd/git.exe");
  if (!existsSync(git)) {
    throw new Error(
      "Trusted Git executable was not found under Program Files.",
    );
  }
  return realpathSync(git);
}

function resolveSystemPowerShell() {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const powershell = resolve(
    systemRoot,
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  if (!existsSync(powershell)) {
    throw new Error("System Windows PowerShell was not found.");
  }
  return realpathSync(powershell);
}

function runRequiredCommand(command, args, failureMessage) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5 * 60_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(commandDiagnostic(failureMessage, result));
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

async function downloadWithoutRedirect(url, destination) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Artifact download failed with HTTP ${response.status}.`);
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    (contentLength <= 0 || contentLength > 1024 * 1024 * 1024)
  ) {
    throw new Error("Artifact Content-Length is empty or exceeds 1 GiB.");
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
  if (statSync(destination).size === 0) {
    throw new Error("Downloaded artifact is empty.");
  }
}

async function revalidateCandidateSource({
  artifactSnapshot,
  expectedSha256,
  source,
  temporaryRoot,
}) {
  const observations = [
    {
      point: "private-snapshot-before-verification",
      sha256: artifactSnapshot.sha256,
    },
  ];
  if (source.kind === "hosted-download") {
    const revalidationPath = resolve(
      temporaryRoot,
      `hosted-revalidation${extname(source.path).toLowerCase()}`,
    );
    await downloadWithoutRedirect(source.url, revalidationPath);
    const revalidationSnapshot = capturePrivateSnapshot(
      revalidationPath,
      "hosted candidate revalidation",
      temporaryRoot,
      `hosted-revalidation-snapshot${extname(source.path).toLowerCase()}`,
    );
    if (revalidationSnapshot.sha256 !== expectedSha256) {
      throw new Error(
        "Hosted artifact changed between the initial download and final revalidation.",
      );
    }
    observations.push({
      point: "fresh-download-after-verification",
      sha256: revalidationSnapshot.sha256,
    });
  }
  return {
    expectedSha256,
    hashPolicy: "verify-every-download-snapshot-and-staged-copy",
    observations,
    status: "passed",
    urlImmutability:
      source.kind !== "hosted-download"
        ? {
            status: "not-applicable-local-artifact",
          }
        : source.retentionAttestation
          ? {
              attestation: source.retentionAttestation,
              status: "human-attested-object-retention",
            }
          : {
              status: "unverified-no-object-retention-proof",
            },
  };
}

export function validateHostedRetentionAttestation(
  attestation,
  { artifactUrl, expectedSha256 },
) {
  if (
    attestation?.schemaVersion !== 1 ||
    attestation?.source !== "object-storage-retention"
  ) {
    throw new Error(
      "Hosted retention attestation must use schemaVersion 1 and source object-storage-retention.",
    );
  }
  if (attestation.artifactUrl !== artifactUrl) {
    throw new Error(
      "Hosted retention attestation artifactUrl must exactly match the query-free candidate URL.",
    );
  }
  if (assertExpectedSha256(attestation.artifactSha256) !== expectedSha256) {
    throw new Error(
      "Hosted retention attestation SHA-256 does not match the candidate.",
    );
  }
  if (
    !["compliance", "governance", "version-retention"].includes(
      attestation.retentionMode,
    )
  ) {
    throw new Error(
      "Hosted retention attestation requires a recognized object retention mode.",
    );
  }
  const objectVersionId = attestation.objectVersionId?.trim();
  const verifiedBy = attestation.verifiedBy?.trim();
  if (
    !objectVersionId ||
    !verifiedBy ||
    objectVersionId.length > 256 ||
    verifiedBy.length > 128 ||
    /(?:change[-_ ]?me|example|placeholder|todo|tbd|[?#])/i.test(
      `${objectVersionId}\n${verifiedBy}`,
    )
  ) {
    throw new Error(
      "Hosted retention attestation requires bounded non-placeholder objectVersionId and verifiedBy fields.",
    );
  }
  const verifiedAt = parseNormalizedPastTimestamp(
    attestation.verifiedAt,
    "Hosted retention attestation verifiedAt",
  );
  const retainedUntil = parseNormalizedTimestamp(
    attestation.retainedUntil,
    "Hosted retention attestation retainedUntil",
  );
  if (Date.parse(retainedUntil) <= Date.now()) {
    throw new Error(
      "Hosted retention attestation retainedUntil must be in the future.",
    );
  }
  return {
    artifactSha256: expectedSha256,
    objectVersionId,
    retainedUntil,
    retentionMode: attestation.retentionMode,
    schemaVersion: 1,
    source: "object-storage-retention",
    verifiedAt,
    verifiedBy,
  };
}

export function validateHttpsArtifactUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("The MSIX artifact URL must be valid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search
  ) {
    throw new Error(
      "The MSIX artifact URL must use HTTPS without credentials, a query, or a fragment.",
    );
  }
  return parsed.toString();
}

export function capturePrivateSnapshot(path, label, privateRoot, snapshotName) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`);
  }
  const link = lstatSync(path);
  if (
    !link.isFile() ||
    link.isSymbolicLink() ||
    link.nlink !== 1 ||
    realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()
  ) {
    throw new Error(`${label} must be a direct, regular, single-link file.`);
  }
  const before = statSync(path);
  const data = readFileSync(path);
  const after = statSync(path);
  if (!sameFileState(before, after) || data.byteLength !== after.size) {
    throw new Error(`${label} changed while it was read.`);
  }
  if (basename(snapshotName) !== snapshotName) {
    throw new Error("Private snapshot name must be a plain file name.");
  }
  const snapshotRoot = resolve(privateRoot, "private-snapshots");
  mkdirSync(snapshotRoot, { mode: 0o700, recursive: true });
  const snapshotPath = resolve(snapshotRoot, snapshotName);
  assertInside(snapshotRoot, snapshotPath, "private snapshot");
  writeFileSync(snapshotPath, data, {
    flag: "wx",
    mode: 0o600,
  });
  const snapshotLink = lstatSync(snapshotPath);
  if (
    !snapshotLink.isFile() ||
    snapshotLink.isSymbolicLink() ||
    snapshotLink.nlink !== 1
  ) {
    throw new Error(`${label} private snapshot is not a direct file.`);
  }
  const snapshotState = statSync(snapshotPath);
  const sha256 = sha256Buffer(data);
  if (
    snapshotState.size !== data.byteLength ||
    sha256File(snapshotPath) !== sha256
  ) {
    throw new Error(`${label} private snapshot failed byte-for-byte capture.`);
  }
  return {
    data,
    fileName: basename(path),
    path: snapshotPath,
    sha256,
    size: after.size,
    state: snapshotState,
  };
}

function assertSnapshotUnchanged(snapshot) {
  const current = statSync(snapshot.path);
  if (
    !sameFileState(snapshot.state, current) ||
    sha256File(snapshot.path) !== snapshot.sha256
  ) {
    throw new Error("Candidate artifact changed after validation.");
  }
}

function sameFileState(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function resolveOutputDir({ format, outputDir, reviewedSha, root, version }) {
  const releaseRoot = resolve(root, "reports/release/windows-store");
  const resolved = outputDir
    ? resolve(root, outputDir)
    : resolve(releaseRoot, `${version}-${reviewedSha.slice(0, 12)}-${format}`);
  assertInside(releaseRoot, resolved, "candidate output");
  return resolved;
}

function assertInside(parent, child, label) {
  const relativePath = relative(resolve(parent), resolve(child));
  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  ) {
    return;
  }
  throw new Error(`${label} must stay inside ${parent}.`);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`Unable to read ${label}: ${path}`);
  }
}

function sha256File(path) {
  return sha256Buffer(readFileSync(path));
}

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeThumbprint(value) {
  return typeof value === "string"
    ? value.replace(/\s+/g, "").toUpperCase()
    : "";
}

function containsControlCharacters(value) {
  return [...value].some((character) => character.codePointAt(0) < 0x20);
}

function parseNormalizedTimestamp(value, label) {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new Error(`${label} must be a normalized UTC ISO timestamp.`);
  }
  return value;
}

function parseNormalizedPastTimestamp(value, label) {
  const normalized = parseNormalizedTimestamp(value, label);
  if (Date.parse(normalized) > Date.now() + 5 * 60_000) {
    throw new Error(`${label} cannot be in the future.`);
  }
  return normalized;
}

function splitFlag(value) {
  const separator = value.indexOf("=");
  return separator === -1
    ? [value, undefined]
    : [value.slice(0, separator), value.slice(separator + 1)];
}

function readArgumentValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function commandDiagnostic(message, result) {
  const detail = [
    result.error?.message,
    result.stdout?.trim(),
    result.stderr?.trim(),
  ]
    .filter(Boolean)
    .join("\n");
  return detail ? `${message}\n${detail}` : message;
}

function displayPath(root, path) {
  return relative(root, path).replaceAll("\\", "/") || basename(path);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  prepareWindowsStoreCandidate().catch((error) => {
    console.error(`${basename(import.meta.url)}: ${error.message}`);
    process.exitCode = 1;
  });
}
