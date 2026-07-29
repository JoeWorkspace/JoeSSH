import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const WINDOWS_EXTENSIONS = new Set([".exe"]);
const DESKTOP_EXTENSIONS = new Set([
  ".exe",
  ".msi",
  ".msix",
  ".appimage",
  ".deb",
  ".dmg",
  ".pkg",
  ".rpm",
]);

const options = parseArgs(process.argv.slice(2));
const root = options.root;
const packageJson = readJson(resolve(root, "package.json"), "root package");
const tauriConfig = readJson(
  resolve(root, "apps/desktop/src-tauri/tauri.conf.json"),
  "Tauri configuration",
);
const desktopPackageJson = readJson(
  resolve(root, "apps/desktop/package.json"),
  "Desktop package",
);
const cargoVersion = readCargoVersion(
  resolve(root, "apps/desktop/src-tauri/Cargo.toml"),
);
const handoffRoot = resolve(root, "reports/handoff/desktop/windows-invite");
const outputRoot = resolve(root, options.outputRoot);
const expectedBundleDir = resolve(
  root,
  "apps/desktop/src-tauri/target/release/bundle/nsis",
);
const gitCommand = resolveTrustedGitCommand();
const powershellCommand = resolveSystemPowerShell();
const gitVersion = commandOutput(
  gitCommand,
  ["--version"],
  "Unable to read Git version.",
);
const powershellVersion = commandOutput(
  powershellCommand,
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$PSVersionTable.PSVersion.ToString()",
  ],
  "Unable to read Windows PowerShell version.",
);

assertInside(root, options.bundleDir, "Bundle directory");
assertInside(handoffRoot, outputRoot, "Windows invite output");
if (normalizePath(options.bundleDir) !== normalizePath(expectedBundleDir)) {
  fail("Bundle directory must be the exact Tauri NSIS output directory.");
}
assertNoLinkedPath(root, options.bundleDir);
assertNoLinkedPath(root, outputRoot);
assertProjectIdentity();

const commit = requiredGitOutput(
  ["rev-parse", "HEAD"],
  "Unable to resolve the source commit.",
);
if (!/^[a-f0-9]{40,64}$/i.test(commit)) {
  fail("The source commit must be a full Git object id.");
}
const gitTopLevel = requiredGitOutput(
  ["rev-parse", "--show-toplevel"],
  "Unable to resolve the Git worktree root.",
);
if (
  normalizePath(realpathSync(gitTopLevel)) !== normalizePath(realpathSync(root))
) {
  fail("The Git worktree root does not match --root.");
}
assertCleanGit();

const artifacts = collectDesktopArtifacts(options.bundleDir);
if (artifacts.length !== 1) {
  fail(
    `Expected exactly one Desktop installer in ${displayPath(options.bundleDir)}, found ${artifacts.length}.`,
  );
}

const sourceArtifact = artifacts[0];
if (!WINDOWS_EXTENSIONS.has(extname(sourceArtifact).toLowerCase())) {
  fail("The only candidate artifact must be a Windows NSIS .exe installer.");
}
if (!fileNameContainsVersion(basename(sourceArtifact), packageJson.version)) {
  fail(
    `Windows installer file name must contain package version ${packageJson.version}: ${basename(sourceArtifact)}`,
  );
}
const pe = inspectPortableExecutable(sourceArtifact);
const sourceSha256 = sha256File(sourceArtifact);
const buildAttestationPath = resolve(
  options.bundleDir,
  "windows-invite-build-attestation.json",
);
if (!existsSync(buildAttestationPath)) {
  fail(`Missing Windows invite build attestation: ${buildAttestationPath}`);
}
const buildAttestationData = readFileSync(buildAttestationPath);
const buildAttestation = parseJson(
  buildAttestationData.toString("utf8"),
  "Windows invite build attestation",
);
assertBuildAttestation(buildAttestation, sourceArtifact, sourceSha256, pe);

const candidateName = [
  sanitizePathSegment(packageJson.version),
  sanitizePathSegment(commit.slice(0, 12)),
  "stage-a",
].join("-");
const candidateDir = resolve(outputRoot, candidateName);
assertInside(handoffRoot, candidateDir, "Windows invite candidate");
if (existsSync(candidateDir)) {
  fail(
    `Refusing to overwrite an existing Windows invite candidate: ${displayPath(candidateDir)}`,
  );
}

const sourceExtension = extname(sourceArtifact);
const sourceStem = basename(sourceArtifact, sourceExtension);
const distributionLabel = "UNSIGNED-INTERNAL-ONLY";
const candidateFileName = `${sourceStem}-${distributionLabel}${sourceExtension}`;
const candidateArtifact = resolve(candidateDir, candidateFileName);

mkdirSync(candidateDir, { recursive: true });
copyFileSync(sourceArtifact, candidateArtifact);
const artifactSha256 = sha256File(candidateArtifact);
if (artifactSha256 !== sourceSha256) {
  fail("The installer changed while it was copied into the handoff directory.");
}
const authenticode = inspectAuthenticode(candidateArtifact);
if (authenticode.status !== "NotSigned") {
  fail(
    `Stage A requires an unsigned installer; Authenticode status is ${authenticode.status}.`,
  );
}
if (sha256File(candidateArtifact) !== artifactSha256) {
  fail("The final handoff installer changed during Authenticode verification.");
}
const signatureEvidencePath = resolve(
  candidateDir,
  "signature-verification.txt",
);
const checksumPath = resolve(candidateDir, "SHA256SUMS.txt");
const candidatePath = resolve(candidateDir, "candidate.json");
const copiedBuildAttestationPath = resolve(
  candidateDir,
  "build-attestation.json",
);
const handoffChecksumPath = resolve(candidateDir, "HANDOFF-SHA256SUMS.txt");

writeFileSync(copiedBuildAttestationPath, buildAttestationData);
writeFileSync(
  signatureEvidencePath,
  formatSignatureEvidence(authenticode),
  "utf8",
);
writeFileSync(
  checksumPath,
  `${artifactSha256}  ${candidateFileName}\n`,
  "ascii",
);

const candidate = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  stage: "A",
  state: "internal-unsigned-staging",
  decision: "internal-staging-only",
  distribution: "invite-only",
  publicReleaseEvidence: false,
  releaseEligible: false,
  inviteDistributionReady: false,
  nativeSmokeRequired: true,
  platform: "windows",
  version: packageJson.version,
  commit,
  artifactCommitBinding: "build-attestation",
  bundleMetadata: {
    identifier: tauriConfig.identifier ?? null,
    productName: tauriConfig.productName ?? null,
    publisher: tauriConfig.bundle?.publisher ?? null,
  },
  verificationTools: {
    git: {
      path: gitCommand,
      version: gitVersion,
    },
    powershell: {
      path: powershellCommand,
      version: powershellVersion,
    },
  },
  sourceArtifact: displayPath(sourceArtifact),
  artifact: {
    fileName: candidateFileName,
    path: displayPath(candidateArtifact),
    sizeBytes: statSync(candidateArtifact).size,
    sha256: artifactSha256,
    peMachine: pe.machine,
  },
  authenticode,
  evidence: {
    checksum: displayPath(checksumPath),
    handoffChecksum: displayPath(handoffChecksumPath),
    buildAttestation: displayPath(copiedBuildAttestationPath),
    signatureVerification: displayPath(signatureEvidencePath),
    nativeSmoke: null,
  },
  boundary:
    "This is private Windows invite handoff evidence, never public release evidence. Native clean-VM smoke is still required before any tester distribution.",
};

writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
writeFileSync(
  handoffChecksumPath,
  [
    candidateArtifact,
    checksumPath,
    candidatePath,
    copiedBuildAttestationPath,
    signatureEvidencePath,
  ]
    .map((path) => `${sha256File(path)}  ${basename(path)}`)
    .join("\n")
    .concat("\n"),
  "ascii",
);
console.log(
  `Packaged Windows invite stage-a candidate at ${displayPath(candidateDir)}.`,
);
console.log(
  "Candidate state: awaiting native clean-VM smoke; do not distribute yet.",
);

function inspectAuthenticode(path) {
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
  const result = runCommand(
    powershellCommand,
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { input: path },
  );
  if (result.status !== 0) {
    fail(
      commandDiagnostic(
        "Unable to inspect Windows Authenticode signature.",
        result,
      ),
    );
  }

  const parsed = parseJson(result.stdout, "PowerShell Authenticode output");
  return {
    status: parsed.Status ?? "Unknown",
    statusMessage: parsed.StatusMessage ?? "",
    signerThumbprint: parsed.SignerThumbprint ?? null,
    signerSubject: parsed.SignerSubject ?? null,
    timeStamperThumbprint: parsed.TimeStamperThumbprint ?? null,
    timeStamperSubject: parsed.TimeStamperSubject ?? null,
  };
}

function formatSignatureEvidence(authenticodeValue) {
  const lines = [
    `Authenticode status: ${authenticodeValue.status}`,
    `Status message: ${authenticodeValue.statusMessage}`,
    `Signer subject: ${authenticodeValue.signerSubject ?? "none"}`,
    `Signer thumbprint: ${authenticodeValue.signerThumbprint ?? "none"}`,
    `Timestamp subject: ${authenticodeValue.timeStamperSubject ?? "none"}`,
    `Timestamp thumbprint: ${authenticodeValue.timeStamperThumbprint ?? "none"}`,
  ];
  return `${lines.join("\n")}\n`;
}

function requiredGitOutput(args, errorMessage) {
  const result = runCommand(gitCommand, args);
  if (result.status !== 0) {
    fail(commandDiagnostic(errorMessage, result));
  }
  return result.stdout.trim();
}

function commandOutput(command, args, errorMessage) {
  const result = runCommand(command, args);
  if (result.status !== 0 || !result.stdout.trim()) {
    fail(commandDiagnostic(errorMessage, result));
  }
  return result.stdout.trim();
}

function assertCleanGit() {
  const diff = runCommand(gitCommand, ["diff", "--quiet", "HEAD", "--"]);
  if (diff.status === 1) {
    fail("Windows invite candidates require a clean Git worktree.");
  }
  if (diff.status !== 0) {
    fail(
      commandDiagnostic(
        "Unable to compare the source worktree with HEAD.",
        diff,
      ),
    );
  }

  const untracked = runCommand(gitCommand, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  if (untracked.status !== 0) {
    fail(
      commandDiagnostic("Unable to inspect untracked source files.", untracked),
    );
  }
  if (untracked.stdout.trim()) {
    fail("Windows invite candidates require a clean Git worktree.");
  }
}

function runCommand(command, args, optionsValue = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    input: optionsValue.input,
    stdio: optionsValue.input
      ? ["pipe", "pipe", "pipe"]
      : ["ignore", "pipe", "pipe"],
  });
}

function collectDesktopArtifacts(path) {
  if (!existsSync(path)) {
    return [];
  }
  const stat = statSync(path);
  if (stat.isFile()) {
    return isDesktopArtifact(path) ? [path] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        return collectDesktopArtifacts(child);
      }
      return entry.isFile() && isDesktopArtifact(child) ? [child] : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

function isDesktopArtifact(path) {
  const lower = path.toLowerCase();
  return (
    DESKTOP_EXTENSIONS.has(extname(lower)) || lower.endsWith(".app.tar.gz")
  );
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function inspectPortableExecutable(path) {
  const data = readFileSync(path);
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
  return { machine };
}

function assertProjectIdentity() {
  const versions = [
    packageJson.version,
    desktopPackageJson.version,
    tauriConfig.version,
    cargoVersion,
  ];
  if (versions.some((version) => version !== versions[0])) {
    fail(
      `Windows invite version mismatch: root=${versions[0]}, desktop=${versions[1]}, tauri=${versions[2]}, cargo=${versions[3]}.`,
    );
  }
  if (
    tauriConfig.productName !== "JoeSSH" ||
    tauriConfig.identifier !== "dev.atlasterm.joessh" ||
    !tauriConfig.bundle?.publisher
  ) {
    fail("Tauri bundle identity is incomplete or does not match JoeSSH.");
  }
}

function assertBuildAttestation(
  attestation,
  artifactPath,
  artifactSha256,
  artifactPe,
) {
  const artifactStat = statSync(artifactPath);
  if (
    attestation.schemaVersion !== 1 ||
    attestation.kind !== "windows-invite-build-attestation" ||
    !isIsoDate(attestation.generatedAt) ||
    !isIsoDate(attestation.startedAt) ||
    attestation.platform !== "windows" ||
    attestation.architecture !== "x64" ||
    attestation.bundleTarget !== "nsis" ||
    attestation.version !== packageJson.version ||
    attestation.commit !== commit ||
    !isNonEmpty(attestation.gitExecutable) ||
    !isNonEmpty(attestation.gitVersion) ||
    attestation.sourceTreeClean !== true ||
    attestation.artifact?.fileName !== basename(artifactPath) ||
    attestation.artifact?.sizeBytes !== artifactStat.size ||
    attestation.artifact?.sha256 !== artifactSha256 ||
    attestation.artifact?.peMachine !== artifactPe.machine
  ) {
    fail(
      "Windows invite build attestation does not bind this installer to the current version and commit.",
    );
  }
}

function readJson(path, label) {
  if (!existsSync(path)) {
    fail(`Missing ${label}: ${path}`);
  }
  return parseJson(readFileSync(path, "utf8"), label);
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    fail(`Unable to parse ${label} as JSON.`);
  }
}

function readCargoVersion(path) {
  if (!existsSync(path)) {
    fail(`Missing Desktop Cargo manifest: ${path}`);
  }
  const packageSection = readFileSync(path, "utf8").match(
    /\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/,
  );
  if (!packageSection) {
    fail("Unable to read the Desktop Cargo package version.");
  }
  return packageSection[1];
}

function fileNameContainsVersion(fileName, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[_-])${escapedVersion}(?=[_.-]|$)`, "i").test(
    fileName,
  );
}

function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value) {
  return isNonEmpty(value) && !Number.isNaN(Date.parse(value));
}

function resolveTrustedGitCommand() {
  if (process.platform !== "win32") {
    fail("Windows invite packaging must run on Windows.");
  }
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
    fail("System Windows PowerShell was not found.");
  }
  return realpathSync(candidate);
}

function parseArgs(args) {
  let root = defaultRoot;
  let stage = null;
  let bundlePath = "apps/desktop/src-tauri/target/release/bundle/nsis";
  let outputRoot = "reports/handoff/desktop/windows-invite";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--stage-b") {
      fail(
        "Stage B packaging is blocked until trusted signing and native-smoke promotion are implemented.",
      );
    }
    if (arg === "--stage-a") {
      if (stage) {
        fail("Specify --stage-a exactly once.");
      }
      stage = "stage-a";
      continue;
    }
    if (arg === "--root") {
      root = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
      continue;
    }
    if (arg === "--bundle-dir") {
      bundlePath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--bundle-dir=")) {
      bundlePath = arg.slice("--bundle-dir=".length);
      continue;
    }
    if (arg === "--output-root") {
      outputRoot = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--output-root=")) {
      outputRoot = arg.slice("--output-root=".length);
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  if (!stage) {
    fail("Specify --stage-a.");
  }

  return {
    bundleDir: resolve(root, bundlePath),
    outputRoot,
    root,
    stage,
  };
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value.`);
  }
  return value;
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
      fail(`Refusing to use a linked or redirected path: ${current}`);
    }
  }
}

function displayPath(path) {
  return relative(root, path).replace(/\\/g, "/") || basename(path);
}

function sanitizePathSegment(value) {
  return value.replace(/[^a-z0-9._-]+/gi, "-");
}

function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function commandDiagnostic(message, result) {
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return diagnostic ? `${message}\n${diagnostic}` : message;
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
