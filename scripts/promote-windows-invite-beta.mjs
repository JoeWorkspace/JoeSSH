import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { WINDOWS_AUTHENTICODE_SETUP } from "./windows-powershell.mjs";

const HANDOFF_FILES = [
  "SHA256SUMS.txt",
  "candidate.json",
  "build-attestation.json",
  "signature-verification.txt",
];
const EVIDENCE_FILE = "native-smoke.json";
const APPROVAL_FILE = "invite-ready.json";
const APPROVAL_CHECKSUM_FILE = "INVITE-READY-SHA256SUMS.txt";
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

try {
  main();
} catch (error) {
  console.error(
    `${basename(import.meta.url)}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}

function main() {
  if (process.platform !== "win32") {
    fail("Windows invite promotion must run on Windows.");
  }

  const root = resolve(import.meta.dirname, "..");
  const handoffRoot = resolve(root, "reports/handoff/desktop/windows-invite");
  const options = parseArgs(process.argv.slice(2));
  const reviewedSha = options.reviewedSha.toLowerCase();
  const expectedArtifactSha256 = options.expectedArtifactSha256.toLowerCase();
  const candidateDir = resolve(root, options.candidateDir);
  const approvalPath = resolve(candidateDir, APPROVAL_FILE);
  const approvalChecksumPath = resolve(candidateDir, APPROVAL_CHECKSUM_FILE);

  assertDirectChild(handoffRoot, candidateDir, "Candidate directory");
  assertNoLinkedPath(handoffRoot, candidateDir);
  const candidateDirStat = lstatSync(candidateDir);
  if (!candidateDirStat.isDirectory() || candidateDirStat.isSymbolicLink()) {
    fail("Candidate directory must be a real directory.");
  }
  if (existsSync(approvalPath) || existsSync(approvalChecksumPath)) {
    fail("Refusing to overwrite an existing invite-ready approval.");
  }

  const entryNames = readdirSync(candidateDir, { withFileTypes: true }).map(
    (entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        fail("Candidate handoff may contain only direct, regular files.");
      }
      return entry.name;
    },
  );
  const artifactNames = entryNames.filter((fileName) =>
    /-UNSIGNED-INTERNAL-ONLY\.exe$/i.test(fileName),
  );
  if (artifactNames.length !== 1) {
    fail(
      "Candidate handoff must contain exactly one unsigned Windows installer.",
    );
  }
  const artifactFileName = artifactNames[0];
  const exactInputNames = [
    artifactFileName,
    ...HANDOFF_FILES,
    "HANDOFF-SHA256SUMS.txt",
    EVIDENCE_FILE,
  ].sort();
  if (
    entryNames.length !== exactInputNames.length ||
    [...entryNames]
      .sort()
      .some((name, index) => name !== exactInputNames[index])
  ) {
    fail("Candidate handoff does not match the exact Stage A input allowlist.");
  }

  const snapshots = new Map(
    exactInputNames.map((fileName) => {
      const filePath = resolve(candidateDir, fileName);
      assertDirectChild(candidateDir, filePath, `Candidate input ${fileName}`);
      const snapshot = captureStableSnapshot(filePath, fileName);
      return [fileName, snapshot];
    }),
  );

  const candidate = parseJsonSnapshot(
    getSnapshot(snapshots, "candidate.json"),
    "candidate manifest",
  );
  const artifactSnapshot = getSnapshot(snapshots, artifactFileName);
  const artifactPe = inspectPortableExecutable(artifactSnapshot.data);
  const projectPackage = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  );
  verifyCandidate({
    artifactFileName,
    artifactPe,
    artifactSnapshot,
    candidate,
    expectedArtifactSha256,
    projectVersion: projectPackage.version,
    reviewedSha,
  });

  const gitCommand = resolveTrustedGitCommand();
  const repositoryRoot = requiredCommandOutput(
    gitCommand,
    ["rev-parse", "--show-toplevel"],
    root,
    "Unable to resolve the promotion repository root.",
  );
  const nativeGitRoot = realpathSync.native(repositoryRoot);
  const nativeRoot = realpathSync.native(root);
  if (normalizePath(nativeGitRoot) !== normalizePath(nativeRoot)) {
    fail(
      `Promotion must run from the reviewed JoeSSH repository. Git root: ${repositoryRoot} -> ${nativeGitRoot}; repository root: ${root} -> ${nativeRoot}.`,
    );
  }
  const currentCommit = requiredCommandOutput(
    gitCommand,
    ["rev-parse", "HEAD"],
    root,
    "Unable to resolve the promotion commit.",
  ).toLowerCase();
  if (currentCommit !== reviewedSha) {
    fail(
      "The externally reviewed commit must equal the currently checked-out full commit.",
    );
  }

  const buildAttestation = parseJsonSnapshot(
    getSnapshot(snapshots, "build-attestation.json"),
    "build attestation",
  );
  verifyBuildAttestation({
    artifactFileName,
    artifactPe,
    artifactSnapshot,
    attestation: buildAttestation,
    candidate,
    reviewedSha,
  });

  verifyChecksumSnapshot(
    getSnapshot(snapshots, "SHA256SUMS.txt"),
    new Map([[artifactFileName, expectedArtifactSha256]]),
    "SHA256SUMS.txt",
  );
  verifyChecksumSnapshot(
    getSnapshot(snapshots, "HANDOFF-SHA256SUMS.txt"),
    new Map(
      [artifactFileName, ...HANDOFF_FILES].map((fileName) => [
        fileName,
        getSnapshot(snapshots, fileName).sha256,
      ]),
    ),
    "HANDOFF-SHA256SUMS.txt",
  );

  const signatureEvidence = parseSignatureEvidence(
    getSnapshot(snapshots, "signature-verification.txt"),
  );
  verifyUnsignedAuthenticode(candidate.authenticode, "candidate manifest");
  verifySignatureEvidence(signatureEvidence, candidate.authenticode);

  const evidence = parseJsonSnapshot(
    getSnapshot(snapshots, EVIDENCE_FILE),
    "native smoke evidence",
  );
  verifyNativeSmoke(evidence, candidate, expectedArtifactSha256, reviewedSha);

  assertSnapshotsUnchanged(snapshots);
  const liveAuthenticode = inspectAuthenticode(
    resolve(candidateDir, artifactFileName),
  );
  verifyUnsignedAuthenticode(liveAuthenticode, "live Authenticode inspection");
  assertSnapshotsUnchanged(snapshots);
  if (
    getSnapshot(snapshots, artifactFileName).sha256 !== expectedArtifactSha256
  ) {
    fail("The candidate installer changed during live verification.");
  }

  const evidenceSnapshot = getSnapshot(snapshots, EVIDENCE_FILE);
  const approvedAt = new Date().toISOString();
  const approval = {
    schemaVersion: 1,
    kind: "windows-invite-distribution-approval",
    approvedAt,
    stage: "A",
    distribution: "invite-only",
    allowedAudience: "3-5-trusted-technical-testers",
    inviteDistributionReady: true,
    publicReleaseEvidence: false,
    releaseEligible: false,
    productionUseAllowed: false,
    version: candidate.version,
    commit: reviewedSha,
    externalReviewAnchor: {
      reviewedCommit: reviewedSha,
      expectedArtifactSha256,
    },
    artifact: {
      fileName: artifactFileName,
      sizeBytes: artifactSnapshot.data.byteLength,
      sha256: expectedArtifactSha256,
      peMachine: artifactPe.machine,
      authenticodeStatus: liveAuthenticode.status,
    },
    nativeSmoke: {
      fileName: EVIDENCE_FILE,
      sha256: evidenceSnapshot.sha256,
      testedAt: evidence.testedAt,
      testerId: evidence.testerId,
    },
    boundary:
      "Approval is limited to Stage A private testing on isolated systems. It is not Stage B, a public Beta, production approval, or release evidence.",
  };
  const approvalData = Buffer.from(
    `${JSON.stringify(approval, null, 2)}\n`,
    "utf8",
  );
  const approvalSha256 = sha256Buffer(approvalData);
  const protectedHashes = new Map([
    [artifactFileName, expectedArtifactSha256],
    ["SHA256SUMS.txt", getSnapshot(snapshots, "SHA256SUMS.txt").sha256],
    [
      "HANDOFF-SHA256SUMS.txt",
      getSnapshot(snapshots, "HANDOFF-SHA256SUMS.txt").sha256,
    ],
    ["candidate.json", getSnapshot(snapshots, "candidate.json").sha256],
    [
      "build-attestation.json",
      getSnapshot(snapshots, "build-attestation.json").sha256,
    ],
    [
      "signature-verification.txt",
      getSnapshot(snapshots, "signature-verification.txt").sha256,
    ],
    [EVIDENCE_FILE, evidenceSnapshot.sha256],
    [APPROVAL_FILE, approvalSha256],
  ]);
  const approvalChecksumData = Buffer.from(
    `${[...protectedHashes]
      .map(([fileName, sha256]) => `${sha256}  ${fileName}`)
      .join("\n")}\n`,
    "ascii",
  );

  assertSnapshotsUnchanged(snapshots);
  try {
    writeExclusiveDurable(approvalPath, approvalData);
    writeExclusiveDurable(approvalChecksumPath, approvalChecksumData);
    assertSnapshotsUnchanged(snapshots);
    const approvalSnapshot = captureStableSnapshot(approvalPath, APPROVAL_FILE);
    const approvalChecksumSnapshot = captureStableSnapshot(
      approvalChecksumPath,
      APPROVAL_CHECKSUM_FILE,
    );
    if (
      approvalSnapshot.sha256 !== approvalSha256 ||
      !approvalChecksumSnapshot.data.equals(approvalChecksumData)
    ) {
      fail("Invite approval outputs changed while they were sealed.");
    }
    verifyChecksumSnapshot(
      approvalChecksumSnapshot,
      protectedHashes,
      APPROVAL_CHECKSUM_FILE,
    );
    assertSnapshotsUnchanged(snapshots);
  } catch (error) {
    removeApprovalOutputs(approvalPath, approvalChecksumPath);
    throw error;
  }

  console.log(
    `Stage A invite-only distribution approved for ${artifactFileName}.`,
  );
  console.log(
    "Scope remains 3-5 trusted technical testers on isolated systems; public release is still blocked.",
  );
}

function verifyCandidate({
  artifactFileName,
  artifactPe,
  artifactSnapshot,
  candidate,
  expectedArtifactSha256,
  projectVersion,
  reviewedSha,
}) {
  if (
    candidate.schemaVersion !== 1 ||
    !isIsoDate(candidate.generatedAt) ||
    candidate.stage !== "A" ||
    candidate.state !== "internal-unsigned-staging" ||
    candidate.decision !== "internal-staging-only" ||
    candidate.distribution !== "invite-only" ||
    candidate.publicReleaseEvidence !== false ||
    candidate.releaseEligible !== false ||
    candidate.inviteDistributionReady !== false ||
    candidate.nativeSmokeRequired !== true ||
    candidate.platform !== "windows" ||
    candidate.artifactCommitBinding !== "build-attestation" ||
    candidate.version !== projectVersion ||
    normalizeCommit(candidate.commit) !== reviewedSha ||
    candidate.bundleMetadata?.identifier !== "dev.atlasterm.joessh" ||
    candidate.bundleMetadata?.productName !== "JoeSSH" ||
    candidate.bundleMetadata?.publisher !== "JoeSSH Project" ||
    !isNonEmpty(candidate.verificationTools?.git?.path) ||
    !isNonEmpty(candidate.verificationTools?.git?.version) ||
    !isNonEmpty(candidate.verificationTools?.powershell?.path) ||
    !isNonEmpty(candidate.verificationTools?.powershell?.version) ||
    candidate.artifact?.fileName !== artifactFileName ||
    portableBasename(candidate.artifact?.path) !== artifactFileName ||
    candidate.artifact?.sizeBytes !== artifactSnapshot.data.byteLength ||
    normalizeSha(candidate.artifact?.sha256) !== expectedArtifactSha256 ||
    candidate.artifact?.peMachine !== artifactPe.machine ||
    !fileNameContainsVersion(artifactFileName, candidate.version)
  ) {
    fail(
      "Candidate manifest is incomplete or does not bind the reviewed Stage A installer.",
    );
  }
}

function verifyBuildAttestation({
  artifactFileName,
  artifactPe,
  artifactSnapshot,
  attestation,
  candidate,
  reviewedSha,
}) {
  const sourceFileName = portableBasename(candidate.sourceArtifact);
  const attestedFileName = attestation.artifact?.fileName;
  const sourceExtension = extname(attestedFileName ?? "");
  const expectedCandidateFileName = `${basename(
    attestedFileName ?? "",
    sourceExtension,
  )}-UNSIGNED-INTERNAL-ONLY${sourceExtension}`;
  if (
    attestation.schemaVersion !== 1 ||
    attestation.kind !== "windows-invite-build-attestation" ||
    !isIsoDate(attestation.generatedAt) ||
    !isIsoDate(attestation.startedAt) ||
    attestation.platform !== "windows" ||
    attestation.architecture !== "x64" ||
    attestation.bundleTarget !== "nsis" ||
    attestation.version !== candidate.version ||
    normalizeCommit(attestation.commit) !== reviewedSha ||
    !isNonEmpty(attestation.gitExecutable) ||
    !isNonEmpty(attestation.gitVersion) ||
    attestation.sourceTreeClean !== true ||
    sourceExtension.toLowerCase() !== ".exe" ||
    sourceFileName !== attestedFileName ||
    expectedCandidateFileName !== artifactFileName ||
    !fileNameContainsVersion(attestedFileName, candidate.version) ||
    attestation.artifact?.sizeBytes !== artifactSnapshot.data.byteLength ||
    normalizeSha(attestation.artifact?.sha256) !== artifactSnapshot.sha256 ||
    attestation.artifact?.peMachine !== artifactPe.machine
  ) {
    fail(
      "Build attestation does not fully bind the reviewed installer, version, commit, and PE identity.",
    );
  }
}

function verifyNativeSmoke(value, candidate, artifactSha256, reviewedSha) {
  const requiredChecks = [
    "install",
    "firstLaunch",
    "restart",
    "uninstallOrRollback",
    "settingsPersistence",
    "unknownHostKey",
    "changedHostKeyBlocked",
    "pty",
    "sftp",
    "portForwarding",
  ];
  const allowedScales = new Set([100, 125, 150, 175, 200]);
  if (
    value.schemaVersion !== 1 ||
    value.candidate?.version !== candidate.version ||
    normalizeCommit(value.candidate?.commit) !== reviewedSha ||
    normalizeSha(value.candidate?.artifactSha256) !== artifactSha256 ||
    !isNonEmpty(value.testerId) ||
    !isIsoDate(value.testedAt) ||
    !isNonEmpty(value.windows?.version) ||
    !isNonEmpty(value.windows?.build) ||
    !isNonEmpty(value.windows?.webview2Version) ||
    !allowedScales.has(value.windows?.scalePercent) ||
    value.environment?.isolated !== true ||
    value.environment?.productionCredentialsUsed !== false ||
    value.defender?.status !== "clean" ||
    normalizeSha(value.defender?.artifactSha256) !== artifactSha256 ||
    !isNonEmpty(value.defender?.engineVersion) ||
    !isNonEmpty(value.defender?.definitionVersion) ||
    !isIsoDate(value.defender?.scannedAt) ||
    requiredChecks.some((check) => value.checks?.[check] !== true) ||
    value.openP0 !== 0 ||
    value.openP1 !== 0 ||
    value.redactionConfirmed !== true ||
    value.sensitiveDataIncluded !== false
  ) {
    fail(
      "Native smoke evidence is incomplete, unbound, not clean, or has an open P0/P1.",
    );
  }
}

function parseSignatureEvidence(snapshot) {
  const raw = snapshot.data.toString("utf8");
  const lines = splitExactLines(raw, "signature-verification.txt");
  const entries = new Map();
  for (const line of lines) {
    const match = line.match(/^([^:\r\n]+): (.*)$/);
    if (!match || entries.has(match[1])) {
      fail("signature-verification.txt contains an invalid or duplicate line.");
    }
    entries.set(match[1], match[2]);
  }
  const expectedKeys = [
    "Authenticode status",
    "Status message",
    "Signer subject",
    "Signer thumbprint",
    "Timestamp subject",
    "Timestamp thumbprint",
  ];
  if (
    entries.size !== expectedKeys.length ||
    expectedKeys.some((key) => !entries.has(key))
  ) {
    fail("signature-verification.txt does not contain the exact evidence set.");
  }
  return entries;
}

function verifySignatureEvidence(entries, authenticode) {
  if (
    entries.get("Authenticode status") !== "NotSigned" ||
    entries.get("Signer subject") !== "none" ||
    entries.get("Signer thumbprint") !== "none" ||
    entries.get("Timestamp subject") !== "none" ||
    entries.get("Timestamp thumbprint") !== "none" ||
    authenticode.status !== entries.get("Authenticode status")
  ) {
    fail("Signature evidence does not prove an unsigned Stage A installer.");
  }
}

function verifyUnsignedAuthenticode(value, label) {
  if (
    value?.status !== "NotSigned" ||
    value.signerThumbprint != null ||
    value.signerSubject != null ||
    value.timeStamperThumbprint != null ||
    value.timeStamperSubject != null
  ) {
    fail(`${label} must report NotSigned with no signer or timestamper.`);
  }
}

function inspectAuthenticode(path) {
  const powershell = resolveSystemPowerShell();
  const command = [
    WINDOWS_AUTHENTICODE_SETUP,
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
    fail(
      `Unable to inspect Windows Authenticode signature: ${
        result.error?.message ?? result.stderr?.trim() ?? "unknown error"
      }`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  } catch {
    fail("Unable to parse live Authenticode inspection output.");
  }
  return {
    status: parsed.Status ?? "Unknown",
    statusMessage: parsed.StatusMessage ?? "",
    signerThumbprint: parsed.SignerThumbprint ?? null,
    signerSubject: parsed.SignerSubject ?? null,
    timeStamperThumbprint: parsed.TimeStamperThumbprint ?? null,
    timeStamperSubject: parsed.TimeStamperSubject ?? null,
  };
}

function inspectPortableExecutable(data) {
  if (data.length < 65_536 || data.readUInt16LE(0) !== 0x5a4d) {
    fail("The candidate is not a valid Windows PE installer.");
  }
  const peOffset = data.readUInt32LE(0x3c);
  if (
    peOffset < 0x40 ||
    peOffset + 24 > data.length ||
    data.subarray(peOffset, peOffset + 4).toString("hex") !== "50450000"
  ) {
    fail("The candidate is not a valid Windows PE installer.");
  }
  const machineCode = data.readUInt16LE(peOffset + 4);
  const machineNames = new Map([
    [0x014c, "x86-nsis-bootstrapper"],
    [0x8664, "x64"],
  ]);
  const machine = machineNames.get(machineCode);
  if (!machine) {
    fail(`Unsupported Windows PE machine: 0x${machineCode.toString(16)}.`);
  }
  return { machine, machineCode };
}

function verifyChecksumSnapshot(snapshot, expectedEntries, label) {
  const lines = splitExactLines(snapshot.data.toString("ascii"), label);
  if (lines.length !== expectedEntries.size) {
    fail(`${label} does not cover the exact expected file set.`);
  }
  const seen = new Set();
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64}) {2}([A-Za-z0-9._-]+)$/i);
    if (!match || seen.has(match[2])) {
      fail(`${label} contains an invalid or duplicate line.`);
    }
    seen.add(match[2]);
    if (
      !expectedEntries.has(match[2]) ||
      expectedEntries.get(match[2]) !== match[1].toLowerCase()
    ) {
      fail(`${label} contains an unexpected file or SHA-256.`);
    }
  }
  if ([...expectedEntries.keys()].some((fileName) => !seen.has(fileName))) {
    fail(`${label} does not cover the exact expected file set.`);
  }
}

function splitExactLines(raw, label) {
  if (!raw.endsWith("\n")) {
    fail(`${label} must end with exactly one newline-delimited record set.`);
  }
  const lines = raw.split(/\r?\n/);
  if (lines.pop() !== "" || lines.some((line) => line.length === 0)) {
    fail(`${label} contains an empty or malformed line.`);
  }
  return lines;
}

function captureStableSnapshot(path, label) {
  assertRegularUnlinkedFile(path, label);
  const before = statSync(path);
  const data = readFileSync(path);
  const after = statSync(path);
  if (!sameFileState(before, after) || data.byteLength !== after.size) {
    fail(`${label} changed while it was read.`);
  }
  return {
    data,
    fileName: basename(path),
    path,
    sha256: sha256Buffer(data),
    state: after,
  };
}

function assertSnapshotsUnchanged(snapshots) {
  for (const snapshot of snapshots.values()) {
    assertRegularUnlinkedFile(snapshot.path, snapshot.fileName);
    const currentState = statSync(snapshot.path);
    const currentData = readFileSync(snapshot.path);
    const finalState = statSync(snapshot.path);
    if (
      !sameFileState(currentState, finalState) ||
      !sameFileState(snapshot.state, finalState) ||
      sha256Buffer(currentData) !== snapshot.sha256
    ) {
      fail(`Candidate input changed after validation: ${snapshot.fileName}`);
    }
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

function assertRegularUnlinkedFile(path, label) {
  if (!existsSync(path)) {
    fail(`Missing ${label}.`);
  }
  const linkStat = lstatSync(path);
  if (
    !linkStat.isFile() ||
    linkStat.isSymbolicLink() ||
    linkStat.nlink !== 1 ||
    normalizePath(realpathSync(path)) !== normalizePath(path)
  ) {
    fail(`${label} must be a direct, regular, single-link file.`);
  }
}

function parseJsonSnapshot(snapshot, label) {
  try {
    return JSON.parse(snapshot.data.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    fail(`Unable to parse ${label} as JSON.`);
  }
}

function getSnapshot(snapshots, fileName) {
  const snapshot = snapshots.get(fileName);
  if (!snapshot) {
    fail(`Missing validated snapshot: ${fileName}`);
  }
  return snapshot;
}

function writeExclusiveDurable(path, data) {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, data);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function removeApprovalOutputs(approvalPath, approvalChecksumPath) {
  for (const path of [approvalChecksumPath, approvalPath]) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}

function parseArgs(args) {
  let candidateDir = "";
  let reviewedSha = "";
  let expectedArtifactSha256 = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--candidate-dir") {
      candidateDir = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--candidate-dir=")) {
      candidateDir = arg.slice("--candidate-dir=".length);
      continue;
    }
    if (arg === "--reviewed-sha") {
      reviewedSha = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--reviewed-sha=")) {
      reviewedSha = arg.slice("--reviewed-sha=".length);
      continue;
    }
    if (arg === "--expected-artifact-sha256") {
      expectedArtifactSha256 = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--expected-artifact-sha256=")) {
      expectedArtifactSha256 = arg.slice("--expected-artifact-sha256=".length);
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }
  if (!candidateDir) {
    fail("--candidate-dir is required.");
  }
  if (!COMMIT_PATTERN.test(reviewedSha)) {
    fail("--reviewed-sha must be a full 40- or 64-character commit SHA.");
  }
  if (!SHA256_PATTERN.test(expectedArtifactSha256)) {
    fail("--expected-artifact-sha256 must be a full SHA-256 digest.");
  }
  return { candidateDir, expectedArtifactSha256, reviewedSha };
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value.`);
  }
  return value;
}

function resolveTrustedGitCommand() {
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const candidate = resolve(programFiles, "Git/cmd/git.exe");
  if (!existsSync(candidate)) {
    fail("Trusted Git executable was not found under Program Files.");
  }
  return realpathSync(candidate);
}

function resolveSystemPowerShell() {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const candidate = resolve(
    systemRoot,
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  if (!existsSync(candidate)) {
    fail("System Windows PowerShell executable was not found.");
  }
  return realpathSync(candidate);
}

function requiredCommandOutput(command, args, cwd, errorMessage) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    fail(
      `${errorMessage} ${
        result.error?.message ?? result.stderr?.trim() ?? "unknown error"
      }`,
    );
  }
  return result.stdout.trim();
}

function assertDirectChild(parent, child, label) {
  assertInside(parent, child, label);
  if (
    normalizePath(dirname(resolve(child))) !== normalizePath(resolve(parent))
  ) {
    fail(`${label} must be a direct child of ${parent}.`);
  }
}

function assertNoLinkedPath(parent, child) {
  let current = resolve(parent);
  for (const segment of relative(parent, child)
    .split(/[\\/]+/)
    .filter(Boolean)) {
    current = resolve(current, segment);
    if (
      existsSync(current) &&
      normalizePath(realpathSync(current)) !== normalizePath(current)
    ) {
      fail(`Linked candidate paths are not allowed: ${current}`);
    }
  }
}

function assertInside(parent, child, label) {
  const relativePath = relative(resolve(parent), resolve(child));
  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  ) {
    return;
  }
  fail(`${label} must stay inside ${parent}.`);
}

function fileNameContainsVersion(fileName, version) {
  if (!isNonEmpty(fileName) || !isNonEmpty(version)) return false;
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[_-])${escapedVersion}(?=[_.-]|$)`, "i").test(
    fileName,
  );
}

function portableBasename(value) {
  return typeof value === "string" ? basename(value.replace(/\\/g, "/")) : "";
}

function normalizeSha(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value)
    ? value.toLowerCase()
    : "";
}

function normalizeCommit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value)
    ? value.toLowerCase()
    : "";
}

function sha256Buffer(data) {
  return createHash("sha256").update(data).digest("hex");
}

function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value) {
  return isNonEmpty(value) && !Number.isNaN(Date.parse(value));
}

function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function fail(message) {
  throw new Error(message);
}
