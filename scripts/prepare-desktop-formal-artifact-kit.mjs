import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

const scriptName = "prepare-desktop-formal-artifact-kit.mjs";
const defaultRoot = resolve(import.meta.dirname, "..");
const defaultRequestPath = "reports/handoff/desktop/formal-artifact-request.json";
const defaultRequestChecksumFileName = "formal-artifact-request-SHA256SUMS.txt";
const crcTable = buildCrcTable();

const options = parseArgs(process.argv.slice(2));
const packageJson = readJsonFile(resolve(options.root, "package.json"), "Root package.json");
const releaseVersion = packageJson.version;
const releaseTag = `v${releaseVersion}`;
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");

if (!isInsideRoot(options.outputPath) || !isInsideRoot(options.checksumPath)) {
  fail("Desktop formal artifact kit output paths must stay inside the release root.");
}
if (!isInsideRoot(options.requestPath) || !isInsideRoot(options.requestChecksumPath)) {
  fail("Desktop formal artifact request paths must stay inside the release root.");
}

const gitSource = verifyReleaseGitCheckoutForKit();
const { request, requestText, requestChecksumText } = readCurrentFormalArtifactRequest(gitSource);
const kit = createKitManifest(gitSource, request);
const readme = createReadme(request, kit);
const commandFiles = createCommandFiles(request);
const entries = [
  ["README.md", readme],
  ["formal-artifact-handoff-kit.json", `${JSON.stringify(kit, null, 2)}\n`],
  ["formal-artifact-request.json", requestText],
  ["formal-artifact-request-SHA256SUMS.txt", requestChecksumText],
  ["commands/windows-powershell.ps1", commandFiles.powershell],
  ["commands/unix.sh", commandFiles.shell],
  ...collectOptionalHandoffFiles(),
];

mkdirSync(dirname(options.outputPath), { recursive: true });
writeFileSync(options.outputPath, createZipBuffer(entries));
writeFileSync(
  options.checksumPath,
  `${sha256File(options.outputPath)}  ${toReleasePath(options.outputPath)}\n`,
);

console.log(`Wrote Desktop formal artifact handoff kit to ${toReleasePath(options.outputPath)}.`);
console.log(`Wrote Desktop formal artifact handoff kit checksum to ${toReleasePath(options.checksumPath)}.`);

function createKitManifest(gitSource, request) {
  return {
    artifactContract: request.artifactContract,
    commands: request.commands,
    generatedAt: new Date().toISOString(),
    includedFiles: [
      describeIncludedFile(options.requestPath),
      describeIncludedFile(options.requestChecksumPath),
      ...collectOptionalHandoffFilePaths().map((path) => describeIncludedFile(path)),
    ],
    inputDirectory: request.inputDirectory,
    kitVersion: 1,
    kind: "joessh-desktop-formal-artifact-handoff-kit",
    product: "JoeSSH",
    releaseTag,
    requestId: request.requestId,
    returnedManifest: request.returnedManifest,
    requiredPlatforms: request.requiredPlatforms,
    source: {
      gitCommit: gitSource.head,
      gitFsckStrict: true,
      releaseTagCommit: gitSource.tagCommit,
      repository: gitSource.repository,
    },
    sourceAuthority: options.sourceAuthority,
    version: releaseVersion,
  };
}

function createReadme(request, kit) {
  const requiredProofs = Object.entries(request.artifactContract?.platforms ?? {})
    .flatMap(([platformName, platform]) =>
      (platform.requiredProofFiles ?? []).map((fileName) => `- ${platformName}: ${fileName}`),
    )
    .join("\n");
  const requiredProofText = requiredProofs || "- linux: no signing proof file required";
  return `# JoeSSH Desktop Formal Artifact Handoff Kit

This kit is bound to ${kit.releaseTag} at ${kit.source.gitCommit}.

Request ID: ${request.requestId}

Do not edit the request JSON or checksum manifest. Build, sign, notarize, and verify the Desktop artifacts on the release machine, then place the returned artifacts and proof files in one directory outside the JoeSSH release workspace.

Required returned files:
- Windows: .exe, .msi, or .msix artifact whose file name includes ${kit.version}
- macOS: .dmg, .pkg, or .app.tar.gz artifact whose file name includes ${kit.version}
- Linux: .AppImage, .deb, or .rpm artifact whose file name includes ${kit.version}
${requiredProofText}
- desktop-formal-artifact-manifest.json

Run these commands from the healthy release checkout after the signed directory is ready:

\`\`\`bash
${request.commands.kitVerify}
${request.commands.manifest}
${request.commands.intake}
${request.commands.preflight}
${request.commands.validate}
${request.commands.import}
${request.commands.verify}
\`\`\`

Proof text must mention both the artifact file name and the artifact SHA256. The importer rejects stale request IDs, stale Git commits, missing platforms, stale artifact versions, and input directories inside the release workspace.
`;
}

function createCommandFiles(request) {
  const commands = [
    request.commands.kitVerify,
    request.commands.manifest,
    request.commands.intake,
    request.commands.preflight,
    request.commands.validate,
    request.commands.import,
    request.commands.verify,
  ];
  return {
    powershell: [
      "$ErrorActionPreference = 'Stop'",
      "# Run from the healthy JoeSSH release checkout.",
      "# Replace <signed-artifact-dir> with the returned signed artifact directory.",
      ...commands.map((command) => `${command}\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`),
      "",
    ].join("\n"),
    shell: [
      "#!/usr/bin/env sh",
      "set -eu",
      "# Run from the healthy JoeSSH release checkout.",
      "# Replace <signed-artifact-dir> with the returned signed artifact directory.",
      ...commands,
      "",
    ].join("\n"),
  };
}

function collectOptionalHandoffFiles() {
  return collectOptionalHandoffFilePaths().map((path) => [
    `context/${basename(path)}`,
    readFileSync(path, "utf8"),
  ]);
}

function collectOptionalHandoffFilePaths() {
  return [
    resolve(options.root, "reports", "handoff", "desktop", "formal-evidence-unblock-report.json"),
    resolve(options.root, "reports", "handoff", "desktop", "formal-artifact-input-report.json"),
    resolve(options.root, "reports", "handoff", "desktop", "unsigned-staging-report.json"),
  ].filter((path) => existsSync(path) && statSync(path).isFile());
}

function describeIncludedFile(path) {
  return {
    path: toReleasePath(path),
    sha256: sha256File(path),
    sizeBytes: statSync(path).size,
  };
}

function readCurrentFormalArtifactRequest(gitSource) {
  if (!existsSync(options.requestPath) || !statSync(options.requestPath).isFile()) {
    fail(
      "Current Desktop formal artifact request is required before writing a handoff kit. Run npm run release:desktop:formal-artifacts:request -- --source-authority local.",
    );
  }
  if (!existsSync(options.requestChecksumPath) || !statSync(options.requestChecksumPath).isFile()) {
    fail("Current Desktop formal artifact request checksum manifest is required before writing a handoff kit.");
  }

  const requestText = readFileSync(options.requestPath, "utf8");
  const requestChecksumText = readFileSync(options.requestChecksumPath, "utf8");
  const expectedRequestPath = toReleasePath(options.requestPath);
  const requestEntry = requestChecksumText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.endsWith(`  ${expectedRequestPath}`));
  if (!requestEntry) {
    fail(`Current Desktop formal artifact request checksum manifest must list ${expectedRequestPath}.`);
  }
  const [requestHash] = requestEntry.split(/\s+/);
  if (requestHash !== sha256File(options.requestPath)) {
    fail("Current Desktop formal artifact request checksum does not match the request JSON.");
  }

  const request = parseJsonText(requestText, "Current Desktop formal artifact request");
  const blockers = [];
  if (request.kind !== "joessh-desktop-formal-artifact-request") {
    blockers.push("request.kind must be joessh-desktop-formal-artifact-request");
  }
  if (request.product !== "JoeSSH") {
    blockers.push("request.product must be JoeSSH");
  }
  if (request.version !== releaseVersion) {
    blockers.push(`request.version must be ${releaseVersion}`);
  }
  if (request.releaseTag !== releaseTag) {
    blockers.push(`request.releaseTag must be ${releaseTag}`);
  }
  if (request.sourceAuthority !== options.sourceAuthority) {
    blockers.push(`request.sourceAuthority must be ${options.sourceAuthority}`);
  }
  if (request.source?.repository !== gitSource.repository) {
    blockers.push("request.source.repository must match the current release checkout origin");
  }
  if (request.source?.gitCommit !== gitSource.head) {
    blockers.push("request.source.gitCommit must match current HEAD");
  }
  if (request.source?.releaseTagCommit !== gitSource.tagCommit) {
    blockers.push(`request.source.releaseTagCommit must match ${releaseTag}`);
  }
  if (request.source?.gitFsckStrict !== true) {
    blockers.push("request.source.gitFsckStrict must be true");
  }
  if (typeof request.requestId !== "string" || request.requestId.trim() === "") {
    blockers.push("request.requestId must be a non-empty string");
  }
  const requiredPlatforms = Array.isArray(request.requiredPlatforms) ? request.requiredPlatforms : [];
  for (const platform of ["windows", "macos", "linux"]) {
    if (!requiredPlatforms.includes(platform)) {
      blockers.push(`request.requiredPlatforms must include ${platform}`);
    }
  }
  for (const commandName of ["kit", "kitVerify", "manifest", "intake", "preflight", "validate", "import", "verify"]) {
    if (typeof request.commands?.[commandName] !== "string" || request.commands[commandName].trim() === "") {
      blockers.push(`request.commands.${commandName} must be present`);
    }
  }
  if (request.returnedManifest?.fileName !== "desktop-formal-artifact-manifest.json") {
    blockers.push("request.returnedManifest.fileName must be desktop-formal-artifact-manifest.json");
  }
  if (blockers.length > 0) {
    fail(`Current Desktop formal artifact request failed validation:\n- ${blockers.join("\n- ")}`);
  }

  return { request, requestChecksumText, requestText };
}

function verifyReleaseGitCheckoutForKit() {
  const insideWorkTree = runGit(
    ["rev-parse", "--is-inside-work-tree"],
    "Git checkout metadata is required for Desktop formal artifact handoff kit generation.",
  );
  if (insideWorkTree !== "true") {
    fail("Git checkout metadata is required for Desktop formal artifact handoff kit generation.");
  }
  const status = runGit(
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude)reports/release",
      ":(exclude)reports/handoff",
    ],
    "Git working tree status is required for Desktop formal artifact handoff kit generation.",
  );
  if (status.trim() !== "") {
    fail(`Git working tree outside reports/release and reports/handoff must be clean:\n${status}`);
  }
  const head = runGit(["rev-parse", "HEAD"], "Unable to resolve HEAD for Desktop formal artifact handoff kit generation.");
  const tagCommit = runGit(
    ["rev-parse", "--verify", `${releaseTag}^{}`],
    `Release tag ${releaseTag} must exist for Desktop formal artifact handoff kit generation.`,
  );
  if (head !== tagCommit) {
    fail(`Release tag ${releaseTag} must point at HEAD for Desktop formal artifact handoff kit generation.`);
  }
  const repository = runGit(
    ["remote", "get-url", "origin"],
    "Git remote origin is required for Desktop formal artifact handoff kit generation.",
  );
  runGit(["fsck", "--strict"], "git fsck --strict must pass for Desktop formal artifact handoff kit generation.");
  return { head, repository, tagCommit };
}

function runGit(args, message) {
  const result = spawnSync(gitCommand, [...gitCommandPrefixArgs, ...args], {
    cwd: options.root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const diagnostic = `${result.stdout}\n${result.stderr}`.trim();
    fail(diagnostic ? `${message}\n${diagnostic}` : message);
  }
  return result.stdout.trim();
}

function createZipBuffer(entriesToPackage) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;

  for (const [name, text] of entriesToPackage) {
    const nameBuffer = Buffer.from(validateZipEntryName(name), "utf8");
    const contents = Buffer.from(text, "utf8");
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
    entryCount: entriesToPackage.length,
  });

  return Buffer.concat([...chunks, ...centralDirectory, endOfCentralDirectory]);
}

function validateZipEntryName(name) {
  if (name === "" || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) {
    fail(`Refusing unsafe kit zip entry name: ${name}`);
  }
  return name;
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

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJsonFile(path, label) {
  return parseJsonText(readFileSync(path, "utf8"), label);
}

function parseJsonText(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseArgs(args) {
  let root = defaultRoot;
  let outputPath = "";
  let checksumPath = "";
  let requestPath = defaultRequestPath;
  let requestChecksumPath = "";
  let sourceAuthority = "local";

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
    if (arg === "--output") {
      outputPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
      continue;
    }
    if (arg === "--checksum") {
      checksumPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--checksum=")) {
      checksumPath = arg.slice("--checksum=".length);
      continue;
    }
    if (arg === "--request") {
      requestPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--request=")) {
      requestPath = arg.slice("--request=".length);
      continue;
    }
    if (arg === "--request-checksum") {
      requestChecksumPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--request-checksum=")) {
      requestChecksumPath = arg.slice("--request-checksum=".length);
      continue;
    }
    if (arg === "--source-authority") {
      sourceAuthority = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--source-authority=")) {
      sourceAuthority = arg.slice("--source-authority=".length);
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  sourceAuthority = sourceAuthority.trim();
  if (!["local", "self-hosted"].includes(sourceAuthority)) {
    fail("--source-authority must be local or self-hosted.");
  }

  const packageJsonPath = resolve(root, "package.json");
  const version = existsSync(packageJsonPath)
    ? parseJsonText(readFileSync(packageJsonPath, "utf8"), "Root package.json").version
    : "unknown-version";
  const resolvedOutputPath = resolve(
    root,
    outputPath || `reports/handoff/desktop/desktop-formal-artifact-handoff-kit-${version}.zip`,
  );
  const resolvedChecksumPath = checksumPath
    ? resolve(root, checksumPath)
    : resolve(
        dirname(resolvedOutputPath),
        `${basename(resolvedOutputPath, ".zip")}-SHA256SUMS.txt`,
      );
  const resolvedRequestPath = resolve(root, requestPath);
  const resolvedRequestChecksumPath = requestChecksumPath
    ? resolve(root, requestChecksumPath)
    : resolve(
        dirname(resolvedRequestPath),
        basename(resolvedRequestPath) === basename(defaultRequestPath)
          ? defaultRequestChecksumFileName
          : `${basename(resolvedRequestPath, ".json")}-SHA256SUMS.txt`,
      );

  return {
    checksumPath: resolvedChecksumPath,
    outputPath: resolvedOutputPath,
    requestChecksumPath: resolvedRequestChecksumPath,
    requestPath: resolvedRequestPath,
    root,
    sourceAuthority,
  };
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value.`);
  }
  return value;
}

function parseCommandPrefixArgs(envName) {
  const raw = process.env[envName];
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
      return parsed;
    }
  } catch {
    // Fall through to the actionable error below.
  }
  fail(`${envName} must be a JSON array of strings.`);
}

function toReleasePath(path) {
  return relative(options.root, resolve(path)).replace(/\\/g, "/");
}

function isInsideRoot(path) {
  const relativePath = relative(options.root, resolve(path));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function fail(message) {
  console.error(`${scriptName}: ${message}`);
  process.exit(1);
}
