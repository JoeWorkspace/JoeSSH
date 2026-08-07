import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assertExpectedSha256,
  assertMicrosoftStoreTauriConfig,
  assertPartnerCenterLegalPublisher,
  assertProjectReleaseIdentity,
  assertReviewedCommit,
  deriveMsixVersion,
  fileNameContainsVersion,
  readCargoVersion,
  validatePartnerCenterIdentity,
  validateWindowsStoreNsisBuildProvenance,
} from "./windows-store-contract.mjs";
import {
  buildWindowsStoreCandidate,
  windowsStoreNsisBuildProvenancePath,
} from "./build-windows-store-candidate.mjs";
import { inspectPortableExecutable } from "./prepare-windows-store-candidate.mjs";

export { windowsStoreNsisBuildProvenancePath };

const root = resolve(import.meta.dirname, "..");
const localStagingParent = "reports/handoff/windows-store/msix-sandbox";
const maximumIdentityBytes = 64 * 1024;
const maximumBuildProvenanceBytes = 16 * 1024;
const sandboxInputPath = "C:\\JoeSSHInput";
const sandboxOutputPath = "C:\\JoeSSHOutput";
const approvedTooling = Object.freeze({
  bundle: Object.freeze({
    fileName: "MSIXPackagingTool.msixbundle",
    sha256: "659ae7d062ce617329842ae25ef19b93551b75a0efe2a9d0702b6f8285888a90",
  }),
  driver: Object.freeze({
    fileName: "MSIXPackagingTool.Driver.cab",
    sha256: "dceed2e0ed2add3b65870d1aba097ae79ac41cabca7347de673da141da123671",
  }),
  license: Object.freeze({
    fileName: "MSIXPackagingTool.License.xml",
    sha256: "101012c1777a869d147ae505ad69624f057a4919cfb52215fd2d181c5cf3e516",
  }),
  version: "1.2024.405.0",
});
const identityFields = Object.freeze([
  "schemaVersion",
  "source",
  "productId",
  "packageIdentityName",
  "publisher",
  "publisherDisplayName",
  "publisherId",
  "packageFamilyName",
  "reservedAt",
]);

export function prepareWindowsStoreMsixSandbox(
  rawArgs = process.argv.slice(2),
  {
    build = buildWindowsStoreCandidate,
    log = console.log,
    platform = process.platform,
    spawn = spawnSync,
  } = {},
) {
  if (platform !== "win32") {
    throw new Error("Windows Sandbox staging requires Windows.");
  }

  const options = parseArgs(rawArgs);
  if (options.help) {
    printHelp(log);
    return null;
  }

  const reviewedSha = assertReviewedCommit(options.reviewedSha);
  assertCleanReviewedHead(reviewedSha, spawn);

  assertInputFile(
    options.partnerIdentity,
    ".json",
    "canonical Partner Center identity",
  );
  const partnerIdentity = readPartnerIdentity(options.partnerIdentity);
  const repository = readRepositoryContract();
  const projectIdentity = assertProjectReleaseIdentity({
    ...repository,
    legalPublisher: partnerIdentity.publisherDisplayName,
  });
  assertPartnerCenterLegalPublisher(partnerIdentity, projectIdentity.publisher);
  assertMicrosoftStoreTauriConfig(repository.storeConfig);
  const msixVersion = deriveMsixVersion(projectIdentity.version);
  assertInputFile(
    options.toolBundle,
    ".msixbundle",
    "MSIX Packaging Tool bundle",
  );
  assertInputFile(options.toolLicense, ".xml", "MSIX Packaging Tool license");
  assertInputFile(options.driverCab, ".cab", "MSIX Packaging Tool driver");

  const stagingParent = resolve(root, localStagingParent);
  assertIgnoredStagingParent(stagingParent, spawn);
  const stagingName = `${projectIdentity.version}-${reviewedSha.slice(0, 12)}`;
  const stagingRoot = resolve(stagingParent, stagingName);
  assertInside(stagingParent, stagingRoot, "Sandbox staging root");
  if (existsSync(stagingRoot)) {
    throw new Error(
      `Refusing to overwrite existing Sandbox staging at ${displayPath(stagingRoot)}.`,
    );
  }

  const installerPath = build({
    env: {
      ...process.env,
      ATLASTERM_WINDOWS_LEGAL_PUBLISHER: partnerIdentity.publisherDisplayName,
      ATLASTERM_WINDOWS_STORE_SIGNING_CONFIG: "",
      ATLASTERM_WINDOWS_STORE_SANDBOX_SKIP_WEBVIEW: "1",
    },
    platform,
    spawn,
  });
  assertCleanReviewedHead(reviewedSha, spawn);
  assertInputFile(installerPath, ".exe", "fresh NSIS conversion input");
  if (
    !fileNameContainsVersion(basename(installerPath), projectIdentity.version)
  ) {
    throw new Error(
      "The fresh NSIS conversion input name must contain the project version.",
    );
  }
  const buildProvenancePath =
    windowsStoreNsisBuildProvenancePath(installerPath);
  assertInputFile(
    buildProvenancePath,
    ".json",
    "adjacent NSIS build provenance",
  );
  const buildProvenance = readBuildProvenance(buildProvenancePath);
  const installerSha256 = buildProvenance.artifact.sha256;

  let stagingCreated = false;
  try {
    const inputRoot = resolve(stagingRoot, "input");
    const outputRoot = resolve(stagingRoot, "output");
    mkdirSync(inputRoot, { mode: 0o700, recursive: true });
    mkdirSync(outputRoot, { mode: 0o700 });
    assertCanonicalStagingTree(stagingParent, [
      stagingRoot,
      inputRoot,
      outputRoot,
    ]);
    stagingCreated = true;

    const installer = snapshotInput({
      destination: resolve(inputRoot, "JoeSSH-setup.exe"),
      expectedSha256: installerSha256,
      label: "NSIS conversion input",
      source: installerPath,
    });
    const installerPe = inspectPortableExecutable(readFileSync(installer.path));
    const payloadPath = resolve(
      root,
      "apps/desktop/src-tauri/target/release",
      buildProvenance.payload.fileName,
    );
    const payload = inspectLocalExecutableEvidence(
      payloadPath,
      "fresh Tauri payload",
    );
    assertBuildProvenanceBinding({
      buildProvenance,
      installer: {
        bootstrapMachine: installerPe.machine,
        fileName: basename(installerPath),
        sha256: installer.sha256,
        sizeBytes: installer.sizeBytes,
      },
      payload,
      projectVersion: projectIdentity.version,
      reviewedSha,
    });
    const toolBundle = snapshotInput({
      destination: resolve(inputRoot, approvedTooling.bundle.fileName),
      expectedSha256: approvedTooling.bundle.sha256,
      label: "approved MSIX Packaging Tool bundle",
      source: options.toolBundle,
    });
    const toolLicense = snapshotInput({
      destination: resolve(inputRoot, approvedTooling.license.fileName),
      expectedSha256: approvedTooling.license.sha256,
      label: "approved MSIX Packaging Tool license",
      source: options.toolLicense,
    });
    const driver = snapshotInput({
      destination: resolve(inputRoot, approvedTooling.driver.fileName),
      expectedSha256: approvedTooling.driver.sha256,
      label: "approved MSIX Packaging Tool driver",
      source: options.driverCab,
    });
    const bootstrap = snapshotInput({
      destination: resolve(inputRoot, "bootstrap.ps1"),
      label: "reviewed Sandbox bootstrap",
      source: resolve(root, "scripts/windows-store-msix-sandbox-bootstrap.ps1"),
    });

    const packageFileName = `JoeSSH_${msixVersion}_x64.msix`;
    const conversionTemplate = createConversionTemplate({
      msixVersion,
      packageFileName,
      partnerIdentity,
      productName: projectIdentity.productName,
    });
    const conversionTemplatePath = resolve(
      inputRoot,
      "conversion-template.xml",
    );
    writePrivateFile(conversionTemplatePath, conversionTemplate);
    const conversionTemplateEvidence = inspectSnapshot(
      conversionTemplatePath,
      "conversion-template.xml",
    );
    const inputEvidence = [
      installer,
      toolBundle,
      toolLicense,
      driver,
      bootstrap,
      conversionTemplateEvidence,
    ];
    writePrivateFile(
      resolve(inputRoot, "input-manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          files: inputEvidence.map(({ fileName, sha256, sizeBytes }) => ({
            fileName,
            sha256,
            sizeBytes,
          })),
        },
        null,
        2,
      )}\n`,
    );

    const sandboxConfig = createSandboxConfig({
      inputRoot,
      memoryInMb: options.memoryInMb,
      outputRoot,
    });
    const sandboxConfigPath = resolve(stagingRoot, "JoeSSH-MSIX.wsb");
    writePrivateFile(sandboxConfigPath, sandboxConfig);

    const plan = {
      schemaVersion: 1,
      state: "prepared",
      reviewedSha,
      artifactSourceSha: buildProvenance.sourceCommit,
      buildProvenance: {
        fileName: basename(buildProvenancePath),
        sha256: sha256File(buildProvenancePath),
      },
      projectVersion: projectIdentity.version,
      msixVersion,
      architecture: payload.architecture,
      installerBootstrapMachine: installerPe.machine,
      packageFileName,
      sandbox: {
        clipboard: "disabled",
        inputMapping: "read-only",
        networking: "disabled",
        outputMapping: "write-only-purpose",
      },
      toolingVersion: approvedTooling.version,
      inputs: inputEvidence.map(({ fileName, sha256, sizeBytes }) => ({
        fileName,
        sha256,
        sizeBytes,
      })),
    };
    writePrivateFile(
      resolve(stagingRoot, "plan.json"),
      `${JSON.stringify(plan, null, 2)}\n`,
    );
    assertCanonicalStagingTree(stagingParent, [
      stagingRoot,
      inputRoot,
      outputRoot,
    ]);

    log(
      `Prepared private MSIX Sandbox staging at ${displayPath(stagingRoot)}.`,
    );
    log(
      `Launch ${displayPath(sandboxConfigPath)}; no identity value was printed.`,
    );
    return { outputRoot, sandboxConfigPath, stagingRoot };
  } catch (error) {
    if (stagingCreated) {
      try {
        assertCanonicalStagingTree(stagingParent, [stagingRoot]);
        rmSync(stagingRoot, { force: true, recursive: true });
      } catch (cleanupError) {
        throw new Error(
          "Sandbox staging failed and automatic cleanup was refused because its canonical path boundary could not be revalidated.",
          { cause: cleanupError },
        );
      }
    }
    throw error;
  }
}

export function createConversionTemplate({
  msixVersion,
  packageFileName,
  partnerIdentity,
  productName,
}) {
  const values = {
    msixVersion,
    packageFileName,
    packageIdentityName: partnerIdentity.packageIdentityName,
    productName,
    publisher: partnerIdentity.publisher,
    publisherDisplayName: partnerIdentity.publisherDisplayName,
  };
  for (const [label, value] of Object.entries(values)) {
    assertSafeXmlValue(value, label);
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<MsixPackagingToolTemplate
  xmlns="http://schemas.microsoft.com/appx/msixpackagingtool/template/2018"
  xmlns:V7="http://schemas.microsoft.com/msix/msixpackagingtool/template/2007">
  <Settings
    AllowTelemetry="false"
    ApplyAllPrepareComputerFixes="true"
    GenerateCommandLineFile="false"
    AllowPromptForPassword="false"
    V7:EnforceMicrosoftStoreRequirements="true" />
  <SaveLocation
    PackagePath="${escapeXmlAttribute(`${sandboxOutputPath}\\${packageFileName}`)}" />
  <Installer
    Path="${escapeXmlAttribute(`${sandboxInputPath}\\JoeSSH-setup.exe`)}"
    Arguments="/S" />
  <PackageInformation
    PackageName="${escapeXmlAttribute(partnerIdentity.packageIdentityName)}"
    PackageDisplayName="${escapeXmlAttribute(productName)}"
    PublisherName="${escapeXmlAttribute(partnerIdentity.publisher)}"
    PublisherDisplayName="${escapeXmlAttribute(partnerIdentity.publisherDisplayName)}"
    Version="${escapeXmlAttribute(msixVersion)}">
    <Applications>
      <Application
        Id="JoeSSH"
        Description="${escapeXmlAttribute(productName)}"
        DisplayName="${escapeXmlAttribute(productName)}"
        ExecutableName="JoeSSH.exe" />
    </Applications>
  </PackageInformation>
</MsixPackagingToolTemplate>
`;
}

export function createSandboxConfig({ inputRoot, memoryInMb, outputRoot }) {
  const hostInput = escapeXmlText(resolveHostFolderPath(inputRoot));
  const hostOutput = escapeXmlText(resolveHostFolderPath(outputRoot));
  return `<Configuration>
  <vGPU>Disable</vGPU>
  <Networking>Disable</Networking>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <ProtectedClient>Disable</ProtectedClient>
  <PrinterRedirection>Disable</PrinterRedirection>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MemoryInMB>${memoryInMb}</MemoryInMB>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>${hostInput}</HostFolder>
      <SandboxFolder>${escapeXmlText(sandboxInputPath)}</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>${hostOutput}</HostFolder>
      <SandboxFolder>${escapeXmlText(sandboxOutputPath)}</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File C:\\JoeSSHInput\\bootstrap.ps1 -SkipWebViewPrewarm</Command>
  </LogonCommand>
</Configuration>
`;
}

function resolveHostFolderPath(value) {
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
    return value;
  }
  return resolve(value);
}

export function assertBuildProvenanceBinding({
  buildProvenance,
  installer,
  payload,
  projectVersion,
  reviewedSha,
}) {
  const provenance = validateWindowsStoreNsisBuildProvenance(buildProvenance);
  const expectedCommit = assertReviewedCommit(reviewedSha);
  if (
    provenance.sourceCommit !== expectedCommit ||
    provenance.projectVersion !== projectVersion ||
    provenance.artifact.bootstrapMachine !== installer.bootstrapMachine ||
    provenance.artifact.fileName !== installer.fileName ||
    provenance.artifact.sha256 !== assertExpectedSha256(installer.sha256) ||
    provenance.artifact.sizeBytes !== installer.sizeBytes ||
    provenance.payload.architecture !== payload.architecture ||
    provenance.payload.fileName !== payload.fileName ||
    provenance.payload.sha256 !== assertExpectedSha256(payload.sha256) ||
    provenance.payload.sizeBytes !== payload.sizeBytes
  ) {
    throw new Error(
      "Adjacent NSIS build provenance does not bind the exact reviewed HEAD, project version, NSIS bootstrap, and x64 payload.",
    );
  }
  return provenance;
}

export function parseArgs(args) {
  const options = {
    driverCab: "",
    help: false,
    memoryInMb: 6144,
    partnerIdentity: "",
    reviewedSha: "",
    toolBundle: "",
    toolLicense: "",
  };
  const flags = new Map([
    ["--driver-cab", "driverCab"],
    ["--memory-mb", "memoryInMb"],
    ["--partner-identity", "partnerIdentity"],
    ["--reviewed-sha", "reviewedSha"],
    ["--tool-bundle", "toolBundle"],
    ["--tool-license", "toolLicense"],
  ]);
  const pathKeys = new Set([
    "driverCab",
    "partnerIdentity",
    "toolBundle",
    "toolLicense",
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    const key = flags.get(flag);
    if (!key) throw new Error(`Unknown argument: ${argument}`);
    const value =
      separator === -1
        ? readArgumentValue(args, ++index, flag)
        : argument.slice(separator + 1);
    if (!value) throw new Error(`${flag} requires a value.`);
    options[key] =
      key === "memoryInMb"
        ? Number(value)
        : pathKeys.has(key)
          ? resolve(root, value)
          : value;
  }

  if (options.help) {
    if (args.length !== 1) {
      throw new Error("--help cannot be combined with other arguments.");
    }
    return options;
  }
  for (const [flag, key] of flags) {
    if (key !== "memoryInMb" && !options[key]) {
      throw new Error(`${flag} is required.`);
    }
  }
  if (
    !Number.isInteger(options.memoryInMb) ||
    options.memoryInMb < 4096 ||
    options.memoryInMb > 16_384
  ) {
    throw new Error("--memory-mb must be an integer from 4096 to 16384.");
  }
  return options;
}

function readRepositoryContract() {
  return {
    cargoVersion: readCargoVersion(
      resolve(root, "apps/desktop/src-tauri/Cargo.toml"),
    ),
    desktopPackage: readJson(resolve(root, "apps/desktop/package.json")),
    rootPackage: readJson(resolve(root, "package.json")),
    storeConfig: readJson(
      resolve(root, "apps/desktop/src-tauri/tauri.microsoftstore.conf.json"),
    ),
    tauriConfig: readJson(
      resolve(root, "apps/desktop/src-tauri/tauri.conf.json"),
    ),
  };
}

function readPartnerIdentity(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 2 || bytes.length > maximumIdentityBytes) {
    throw new Error("Partner Center identity has an invalid size.");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Partner Center identity must be UTF-8 JSON.");
  }
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Partner Center identity must be UTF-8 JSON.");
  }
  const fields = Object.keys(parsed ?? {});
  if (
    fields.length !== identityFields.length ||
    identityFields.some((field) => !fields.includes(field))
  ) {
    throw new Error(
      "Partner Center identity must contain only the reviewed public identity fields; never add tokens, documents, or signing material.",
    );
  }
  const normalized = validatePartnerCenterIdentity(parsed);
  for (const field of identityFields.filter(
    (identityField) => identityField !== "schemaVersion",
  )) {
    if (parsed[field] !== normalized[field]) {
      throw new Error(
        `Partner Center identity field ${field} must already be canonical and copied exactly.`,
      );
    }
  }
  return normalized;
}

function readBuildProvenance(path) {
  const before = statSync(path);
  const bytes = readFileSync(path);
  const after = statSync(path);
  if (
    bytes.length < 2 ||
    bytes.length > maximumBuildProvenanceBytes ||
    !sameFileState(before, after) ||
    bytes.length !== after.size
  ) {
    throw new Error(
      "Adjacent NSIS build provenance has an invalid or unstable size.",
    );
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Adjacent NSIS build provenance must be UTF-8 JSON.");
  }
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Adjacent NSIS build provenance must be UTF-8 JSON.");
  }
  return validateWindowsStoreNsisBuildProvenance(parsed);
}

function assertCleanReviewedHead(reviewedSha, spawn) {
  const head = runGit(["rev-parse", "HEAD"], spawn).trim().toLowerCase();
  if (head !== reviewedSha) {
    throw new Error("--reviewed-sha must exactly equal the current Git HEAD.");
  }
  if (
    runGit(["status", "--porcelain", "--untracked-files=all"], spawn).trim()
  ) {
    throw new Error("Sandbox staging requires a clean reviewed Git worktree.");
  }
}

function assertIgnoredStagingParent(stagingParent, spawn) {
  const relativePath = relative(root, stagingParent);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      "Sandbox staging must remain inside the repository reports directory.",
    );
  }
  assertUnredirectedStagingPath(root, stagingParent);
  const result = spawn("git", ["check-ignore", "--quiet", "--", relativePath], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error("Sandbox staging must be covered by .gitignore.");
  }
}

export function assertUnredirectedStagingPath(repositoryRoot, targetPath) {
  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const resolvedTarget = resolve(targetPath);
  assertInside(
    resolvedRepositoryRoot,
    resolvedTarget,
    "Sandbox canonical staging path",
  );
  const rootMetadata = lstatSync(resolvedRepositoryRoot);
  if (!rootMetadata.isDirectory()) {
    throw new Error("Sandbox repository root must be a directory.");
  }
  const canonicalRepositoryRoot = realpathSync.native(resolvedRepositoryRoot);
  const relativeTarget = relative(resolvedRepositoryRoot, resolvedTarget);
  let current = resolvedRepositoryRoot;
  for (const segment of relativeTarget.split(sep)) {
    current = resolve(current, segment);
    if (!existsSync(current)) continue;
    const metadata = lstatSync(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(
        "Sandbox staging must not traverse a symbolic link, junction, reparse point, or non-directory component.",
      );
    }
    const canonicalCurrent = realpathSync.native(current);
    const expectedCanonicalCurrent = resolve(
      canonicalRepositoryRoot,
      relative(resolvedRepositoryRoot, current),
    );
    if (!samePath(canonicalCurrent, expectedCanonicalCurrent)) {
      throw new Error(
        "Sandbox staging must not traverse a redirected filesystem path.",
      );
    }
  }
  return resolve(canonicalRepositoryRoot, relativeTarget);
}

function assertCanonicalStagingTree(stagingParent, paths) {
  const canonicalParent = assertUnredirectedStagingPath(root, stagingParent);
  if (!existsSync(stagingParent)) {
    throw new Error("Sandbox staging parent was not created.");
  }
  const physicalParent = realpathSync.native(stagingParent);
  if (!samePath(canonicalParent, physicalParent)) {
    throw new Error("Sandbox staging parent has an unexpected physical path.");
  }
  for (const path of paths) {
    const canonicalPath = assertUnredirectedStagingPath(root, path);
    if (!existsSync(path)) {
      throw new Error("Sandbox staging path was not created.");
    }
    const physicalPath = realpathSync.native(path);
    assertInside(physicalParent, physicalPath, "Sandbox physical staging path");
    if (!samePath(canonicalPath, physicalPath)) {
      throw new Error("Sandbox staging path has an unexpected physical path.");
    }
  }
}

function samePath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function runGit(args, spawn) {
  const result = spawn("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Git ${args[0]} failed while binding Sandbox staging.`);
  }
  return result.stdout;
}

function assertInputFile(path, extension, label) {
  if (extname(path).toLowerCase() !== extension || !existsSync(path)) {
    throw new Error(`${label} must be an existing ${extension} file.`);
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
}

function snapshotInput({ destination, expectedSha256, label, source }) {
  assertInputFile(source, extname(source).toLowerCase(), label);
  const before = statSync(source);
  const data = readFileSync(source);
  const after = statSync(source);
  if (!sameFileState(before, after) || data.length !== after.size) {
    throw new Error(`${label} changed while it was read.`);
  }
  writeFileSync(destination, data, { flag: "wx", mode: 0o600 });
  const sourceSha256 = createHash("sha256").update(data).digest("hex");
  const destinationSha256 = sha256File(destination);
  if (sourceSha256 !== destinationSha256) {
    throw new Error(
      `${label} private snapshot is not byte-for-byte identical.`,
    );
  }
  if (expectedSha256 && sourceSha256 !== assertExpectedSha256(expectedSha256)) {
    throw new Error(`${label} SHA-256 does not match the reviewed value.`);
  }
  return inspectSnapshot(destination, basename(destination), label);
}

function inspectLocalExecutableEvidence(path, label) {
  if (extname(path).toLowerCase() !== ".exe" || !existsSync(path)) {
    throw new Error(`${label} must be an existing .exe file.`);
  }
  const link = lstatSync(path);
  if (
    !link.isFile() ||
    link.isSymbolicLink() ||
    realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()
  ) {
    throw new Error(`${label} must be a direct, regular file.`);
  }
  const before = statSync(path);
  const data = readFileSync(path);
  const after = statSync(path);
  if (!sameFileState(before, after) || data.length !== after.size) {
    throw new Error(`${label} changed while it was inspected.`);
  }
  const pe = inspectPortableExecutable(data);
  return {
    architecture: pe.machine,
    fileName: basename(path),
    sha256: createHash("sha256").update(data).digest("hex"),
    sizeBytes: after.size,
  };
}

function inspectSnapshot(path, fileName, label = fileName) {
  const destinationLink = lstatSync(path);
  if (
    !destinationLink.isFile() ||
    destinationLink.isSymbolicLink() ||
    destinationLink.nlink !== 1
  ) {
    throw new Error(
      `${label} snapshot must be a direct, regular, single-link file.`,
    );
  }
  return {
    fileName,
    path,
    sha256: sha256File(path),
    sizeBytes: destinationLink.size,
  };
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

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writePrivateFile(path, content) {
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  writeFileSync(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function assertSafeXmlValue(value, label) {
  const hasDisallowedControl =
    typeof value === "string" &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint <= 0x08 ||
        codePoint === 0x0b ||
        codePoint === 0x0c ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        codePoint === 0x7f
      );
    });
  if (typeof value !== "string" || !value || hasDisallowedControl) {
    throw new Error(`${label} is not safe XML text.`);
  }
}

function escapeXmlAttribute(value) {
  return escapeXmlText(value).replaceAll('"', "&quot;");
}

function escapeXmlText(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function assertInside(parent, child, label) {
  const relativePath = relative(parent, child);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay below its approved parent directory.`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readArgumentValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function displayPath(path) {
  const relativePath = relative(root, path);
  return relativePath && !relativePath.startsWith("..") ? relativePath : path;
}

function printHelp(log) {
  log(`Prepare an offline Windows Sandbox for converting the exact reviewed
JoeSSH NSIS installer into an unsigned Microsoft Store MSIX.

Required:
  --tool-bundle <official 1.2024.405.0 msixbundle>
  --tool-license <official offline license XML>
  --driver-cab <official Windows 11 x64 driver CAB>
  --partner-identity <private canonical Partner Center JSON>
  --reviewed-sha <full clean HEAD>

Optional:
  --memory-mb <4096..16384>  Default: 6144

Private output is written below the gitignored ${localStagingParent} directory.
This command rebuilds the NSIS from clean HEAD and immediately verifies its adjacent provenance.
No Partner Center identity value is printed or copied outside the conversion XML.`);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
  try {
    prepareWindowsStoreMsixSandbox();
  } catch (error) {
    console.error(
      `MSIX Sandbox preparation failed: ${error?.message ?? String(error)}`,
    );
    process.exitCode = 1;
  }
}
