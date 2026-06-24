import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

const scriptName = "verify-desktop-formal-artifact-kit.mjs";
const defaultRoot = resolve(import.meta.dirname, "..");
const defaultRequestPath = "reports/handoff/desktop/formal-artifact-request.json";
const defaultRequestChecksumFileName = "formal-artifact-request-SHA256SUMS.txt";

const options = parseArgs(process.argv.slice(2));
const errors = [];
const packageJson = readJsonFile(resolve(options.root, "package.json"), "Root package.json");
if (!packageJson || typeof packageJson.version !== "string" || packageJson.version.trim() === "") {
  fail("Root package.json must include a version.");
}
const releaseVersion = packageJson.version;
const releaseTag = `v${releaseVersion}`;
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");

if (!isInsideRoot(options.kitPath) || !isInsideRoot(options.checksumPath)) {
  fail("Desktop formal artifact kit paths must stay inside the release root.");
}
if (!isInsideRoot(options.requestPath) || !isInsideRoot(options.requestChecksumPath)) {
  fail("Desktop formal artifact request paths must stay inside the release root.");
}

const gitSource = verifyReleaseGitCheckoutForKit();
const currentRequest = readCurrentFormalArtifactRequest(gitSource);
verifyKitChecksum();
const entries = readZipEntries(options.kitPath);
verifyRequiredEntries(entries);
verifyEmbeddedRequest(entries);
verifyEmbeddedKitManifest(entries, gitSource, currentRequest.request);
verifyOperatorCommandFiles(entries, currentRequest.request);
verifyReadme(entries, currentRequest.request);

if (errors.length > 0) {
  fail(`Desktop formal artifact handoff kit verification failed:\n- ${errors.join("\n- ")}`);
}

console.log(`Desktop formal artifact handoff kit verified for ${releaseTag}.`);

function verifyKitChecksum() {
  if (!existsSync(options.kitPath) || !statSync(options.kitPath).isFile()) {
    errors.push(`Desktop formal artifact handoff kit is missing: ${toReleasePath(options.kitPath)}`);
    return;
  }
  if (!existsSync(options.checksumPath) || !statSync(options.checksumPath).isFile()) {
    errors.push(`Desktop formal artifact handoff kit checksum manifest is missing: ${toReleasePath(options.checksumPath)}`);
    return;
  }

  const expectedKitPath = toReleasePath(options.kitPath);
  const lines = readFileSync(options.checksumPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entry = lines.find((line) => line.endsWith(`  ${expectedKitPath}`));
  if (!entry) {
    errors.push(`Desktop formal artifact handoff kit checksum manifest must list ${expectedKitPath}`);
    return;
  }
  const [expectedHash] = entry.split(/\s+/);
  if (expectedHash !== sha256File(options.kitPath)) {
    errors.push("Desktop formal artifact handoff kit checksum does not match the kit zip.");
  }
}

function verifyRequiredEntries(entries) {
  for (const name of [
    "README.md",
    "formal-artifact-handoff-kit.json",
    "formal-artifact-request.json",
    "formal-artifact-request-SHA256SUMS.txt",
    "commands/windows-powershell.ps1",
    "commands/unix.sh",
  ]) {
    if (!entries.has(name)) {
      errors.push(`Desktop formal artifact handoff kit is missing ${name}`);
    }
  }
}

function verifyEmbeddedRequest(entries) {
  const requestText = entries.get("formal-artifact-request.json");
  const requestChecksumText = entries.get("formal-artifact-request-SHA256SUMS.txt");
  if (requestText === undefined || requestChecksumText === undefined) {
    return;
  }

  if (requestText !== currentRequest.requestText) {
    errors.push("Embedded formal-artifact-request.json does not match the current request.");
  }
  if (requestChecksumText !== currentRequest.requestChecksumText) {
    errors.push("Embedded formal-artifact-request-SHA256SUMS.txt does not match the current request checksum manifest.");
  }
}

function verifyEmbeddedKitManifest(entries, gitSource, request) {
  const kit = parseJsonText(entries.get("formal-artifact-handoff-kit.json") ?? "", "Embedded Desktop formal artifact handoff kit manifest");
  if (!kit) {
    return;
  }
  if (kit.kind !== "joessh-desktop-formal-artifact-handoff-kit") {
    errors.push("handoff kit kind must be joessh-desktop-formal-artifact-handoff-kit");
  }
  if (kit.kitVersion !== 1) {
    errors.push("handoff kit kitVersion must be 1");
  }
  if (kit.product !== "JoeSSH") {
    errors.push("handoff kit product must be JoeSSH");
  }
  if (kit.version !== releaseVersion) {
    errors.push(`handoff kit version must be ${releaseVersion}`);
  }
  if (kit.releaseTag !== releaseTag) {
    errors.push(`handoff kit releaseTag must be ${releaseTag}`);
  }
  if (kit.requestId !== request.requestId) {
    errors.push("handoff kit requestId must match the current request");
  }
  if (kit.sourceAuthority !== options.sourceAuthority) {
    errors.push(`handoff kit sourceAuthority must be ${options.sourceAuthority}`);
  }
  if (kit.source?.repository !== gitSource.repository) {
    errors.push("handoff kit source.repository must match the current release checkout origin");
  }
  if (kit.source?.gitCommit !== gitSource.head) {
    errors.push("handoff kit source.gitCommit must match current HEAD");
  }
  if (kit.source?.releaseTagCommit !== gitSource.tagCommit) {
    errors.push(`handoff kit source.releaseTagCommit must match ${releaseTag}`);
  }
  if (kit.source?.gitFsckStrict !== true) {
    errors.push("handoff kit source.gitFsckStrict must be true");
  }
  verifyArrayIncludes("handoff kit requiredPlatforms", kit.requiredPlatforms, ["windows", "macos", "linux"]);
  if (kit.returnedManifest?.fileName !== "desktop-formal-artifact-manifest.json") {
    errors.push("handoff kit returnedManifest.fileName must be desktop-formal-artifact-manifest.json");
  }
  for (const commandName of ["kit", "kitVerify", "manifest", "intake", "preflight", "import", "verify"]) {
    if (kit.commands?.[commandName] !== request.commands?.[commandName]) {
      errors.push(`handoff kit commands.${commandName} must match request.commands.${commandName}`);
    }
  }
  verifyIncludedFile(kit, options.requestPath);
  verifyIncludedFile(kit, options.requestChecksumPath);
}

function verifyOperatorCommandFiles(entries, request) {
  const powershell = entries.get("commands/windows-powershell.ps1") ?? "";
  const shell = entries.get("commands/unix.sh") ?? "";
  for (const commandName of ["kitVerify", "manifest", "intake", "preflight", "import", "verify"]) {
    const command = request.commands?.[commandName];
    if (!command) {
      continue;
    }
    if (!powershell.includes(command)) {
      errors.push(`Windows kit command file must include request.commands.${commandName}`);
    }
    if (!shell.includes(command)) {
      errors.push(`Unix kit command file must include request.commands.${commandName}`);
    }
  }
}

function verifyReadme(entries, request) {
  const readme = entries.get("README.md") ?? "";
  for (const snippet of [
    releaseTag,
    request.requestId,
    "desktop-formal-artifact-manifest.json",
    "Proof text must mention both the artifact file name and the artifact SHA256",
  ]) {
    if (!readme.includes(snippet)) {
      errors.push(`README.md must mention '${snippet}'`);
    }
  }
}

function verifyIncludedFile(kit, path) {
  const releasePath = toReleasePath(path);
  const entry = Array.isArray(kit.includedFiles)
    ? kit.includedFiles.find((candidate) => candidate?.path === releasePath)
    : null;
  if (!entry) {
    errors.push(`handoff kit includedFiles must include ${releasePath}`);
    return;
  }
  if (entry.sha256 !== sha256File(path)) {
    errors.push(`handoff kit includedFiles hash mismatch for ${releasePath}`);
  }
  if (entry.sizeBytes !== statSync(path).size) {
    errors.push(`handoff kit includedFiles size mismatch for ${releasePath}`);
  }
}

function verifyArrayIncludes(label, actual, expectedValues) {
  const values = Array.isArray(actual) ? actual : [];
  for (const expectedValue of expectedValues) {
    if (!values.includes(expectedValue)) {
      errors.push(`${label} must include ${expectedValue}`);
    }
  }
}

function readCurrentFormalArtifactRequest(gitSource) {
  if (!existsSync(options.requestPath) || !statSync(options.requestPath).isFile()) {
    fail(
      "Current Desktop formal artifact request is required before verifying a handoff kit. Run npm run release:desktop:formal-artifacts:request -- --source-authority local.",
    );
  }
  if (!existsSync(options.requestChecksumPath) || !statSync(options.requestChecksumPath).isFile()) {
    fail("Current Desktop formal artifact request checksum manifest is required before verifying a handoff kit.");
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
  if (!request || typeof request !== "object") {
    fail("Current Desktop formal artifact request must be a JSON object.");
  }
  const blockers = [];
  if (request.kind !== "joessh-desktop-formal-artifact-request") {
    blockers.push("request.kind must be joessh-desktop-formal-artifact-request");
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
  verifyRequiredRequestCommand(blockers, request, "kit");
  verifyRequiredRequestCommand(blockers, request, "kitVerify");
  verifyRequiredRequestCommand(blockers, request, "manifest");
  verifyRequiredRequestCommand(blockers, request, "intake");
  verifyRequiredRequestCommand(blockers, request, "preflight");
  verifyRequiredRequestCommand(blockers, request, "import");
  verifyRequiredRequestCommand(blockers, request, "verify");
  if (typeof request.requestId !== "string" || request.requestId.trim() === "") {
    blockers.push("request.requestId must be a non-empty string");
  }
  if (blockers.length > 0) {
    fail(`Current Desktop formal artifact request failed validation:\n- ${blockers.join("\n- ")}`);
  }

  return { request, requestChecksumText, requestText };
}

function verifyRequiredRequestCommand(blockers, request, commandName) {
  const commandLabel = commandName === "kitVerify" ? "request.commands.kitVerify" : `request.commands.${commandName}`;
  if (typeof request.commands?.[commandName] !== "string" || request.commands[commandName].trim() === "") {
    blockers.push(`${commandLabel} must be present`);
  }
}

function verifyReleaseGitCheckoutForKit() {
  const insideWorkTree = runGit(
    ["rev-parse", "--is-inside-work-tree"],
    "Git checkout metadata is required for Desktop formal artifact handoff kit verification.",
  );
  if (insideWorkTree !== "true") {
    fail("Git checkout metadata is required for Desktop formal artifact handoff kit verification.");
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
    "Git working tree status is required for Desktop formal artifact handoff kit verification.",
  );
  if (status.trim() !== "") {
    fail(`Git working tree outside reports/release and reports/handoff must be clean:\n${status}`);
  }
  const head = runGit(["rev-parse", "HEAD"], "Unable to resolve HEAD for Desktop formal artifact handoff kit verification.");
  const tagCommit = runGit(
    ["rev-parse", "--verify", `${releaseTag}^{}`],
    `Release tag ${releaseTag} must exist for Desktop formal artifact handoff kit verification.`,
  );
  if (head !== tagCommit) {
    fail(`Release tag ${releaseTag} must point at HEAD for Desktop formal artifact handoff kit verification.`);
  }
  const repository = runGit(
    ["remote", "get-url", "origin"],
    "Git remote origin is required for Desktop formal artifact handoff kit verification.",
  );
  runGit(["fsck", "--strict"], "git fsck --strict must pass for Desktop formal artifact handoff kit verification.");
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

function readZipEntries(path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    errors.push(`Desktop formal artifact handoff kit is missing: ${toReleasePath(path)}`);
    return new Map();
  }

  const archive = readFileSync(path);
  const endOfCentralDirectoryOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOfCentralDirectoryOffset === -1) {
    errors.push("Desktop formal artifact handoff kit is not a readable zip archive.");
    return new Map();
  }

  const entryCount = archive.readUInt16LE(endOfCentralDirectoryOffset + 10);
  let offset = archive.readUInt32LE(endOfCentralDirectoryOffset + 16);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      errors.push("Desktop formal artifact handoff kit central directory is malformed.");
      return entries;
    }
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    if (entries.has(name)) {
      errors.push(`Desktop formal artifact handoff kit contains duplicate entry ${name}`);
    }
    if (archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      errors.push(`Desktop formal artifact handoff kit local header is malformed for ${name}`);
      return entries;
    }
    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    if (compressionMethod !== 8 && compressionMethod !== 0) {
      errors.push(`Desktop formal artifact handoff kit entry ${name} uses unsupported compression method ${compressionMethod}`);
      offset += 46 + fileNameLength + extraLength + commentLength;
      continue;
    }
    entries.set(name, compressionMethod === 8 ? inflateRawSync(compressed).toString("utf8") : compressed.toString("utf8"));
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
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
    errors.push(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function parseArgs(args) {
  let root = defaultRoot;
  let kitPath = "";
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
    if (arg === "--kit") {
      kitPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--kit=")) {
      kitPath = arg.slice("--kit=".length);
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

  const version = readPackageVersion(root);
  const resolvedKitPath = resolve(
    root,
    kitPath || `reports/handoff/desktop/desktop-formal-artifact-handoff-kit-${version}.zip`,
  );
  const resolvedChecksumPath = checksumPath
    ? resolve(root, checksumPath)
    : resolve(
        dirname(resolvedKitPath),
        `${basename(resolvedKitPath, ".zip")}-SHA256SUMS.txt`,
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
    kitPath: resolvedKitPath,
    requestChecksumPath: resolvedRequestChecksumPath,
    requestPath: resolvedRequestPath,
    root,
    sourceAuthority,
  };
}

function readPackageVersion(rootPath) {
  const packageJsonPath = resolve(rootPath, "package.json");
  if (!existsSync(packageJsonPath)) {
    fail(`Missing package.json at ${packageJsonPath}`);
  }
  const json = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (typeof json.version !== "string" || json.version.trim() === "") {
    fail("Root package.json must include a version.");
  }
  return json.version;
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
