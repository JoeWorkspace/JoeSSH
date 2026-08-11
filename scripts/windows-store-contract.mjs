import { readFileSync } from "node:fs";
import sax from "sax";

const PLACEHOLDER_PATTERN =
  /(?:change[-_ ]?me|example|placeholder|todo|tbd|unknown|not[-_ ]?set|<[^>]+>)/i;
const WINDOWS_LEGAL_PUBLISHER_MAX_LENGTH = 160;
const APPX_FOUNDATION_NAMESPACE =
  "http://schemas.microsoft.com/appx/manifest/foundation/windows10";
const APPX_RESTRICTED_CAPABILITIES_NAMESPACE =
  "http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities";
const APPROVED_MSIX_PACKAGING_TOOL_COMMENT =
  "Package created by MSIX Packaging Tool version: ";
const PACKAGE_PUBLISHER_ID_PATTERN = /^[a-hj-km-np-tv-z0-9]{13}$/i;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_XML_DEPTH = 64;
const MAX_XML_NODES = 10_000;
const MAX_XML_ATTRIBUTES = 100;
const WINDOWS_STORE_NSIS_BUILD_PROVENANCE_GENERATOR =
  "scripts/build-windows-store-candidate.mjs";

export const WINDOWS_STORE_FORMATS = Object.freeze({
  EXE: "exe",
  MSIX: "msix",
});

export function assertMicrosoftStoreTauriConfig(config) {
  if (config?.build?.beforeBuildCommand !== "npm run build:microsoft-store") {
    throw new Error(
      "Microsoft Store candidates require the fail-closed build:microsoft-store frontend profile.",
    );
  }
  if (Object.hasOwn(config?.bundle ?? {}, "publisher")) {
    throw new Error(
      "The reviewed Microsoft Store overlay must not set bundle.publisher; the protected legal publisher is applied only through the audited temporary identity override.",
    );
  }
  if (
    config?.bundle?.windows?.webviewInstallMode?.type !== "offlineInstaller"
  ) {
    throw new Error(
      "Microsoft Store EXE candidates require Tauri webviewInstallMode.type=offlineInstaller.",
    );
  }
  if (config?.bundle?.windows?.nsis?.installMode !== "currentUser") {
    throw new Error(
      "Microsoft Store EXE candidates require the reviewed NSIS currentUser install mode.",
    );
  }
  const targets = config?.bundle?.targets;
  if (
    !Array.isArray(targets) ||
    targets.length !== 1 ||
    targets[0] !== "nsis"
  ) {
    throw new Error(
      "Microsoft Store Tauri config must target exactly the NSIS installer.",
    );
  }
}

export function assertProjectReleaseIdentity({
  cargoVersion,
  desktopPackage,
  legalPublisher,
  rootPackage,
  tauriConfig,
}) {
  const versions = [
    rootPackage?.version,
    desktopPackage?.version,
    tauriConfig?.version,
    cargoVersion,
  ];
  if (
    versions.some(
      (version) => typeof version !== "string" || version !== versions[0],
    )
  ) {
    throw new Error(
      `Windows Store version mismatch: root=${versions[0]}, desktop=${versions[1]}, tauri=${versions[2]}, cargo=${versions[3]}.`,
    );
  }
  if (!tauriConfig?.productName || !tauriConfig?.identifier) {
    throw new Error("Tauri product name and identifier are required.");
  }
  const communityPublisher = tauriConfig?.bundle?.publisher?.trim();
  if (!communityPublisher) {
    throw new Error("Base Tauri bundle.publisher is required.");
  }
  const publisher = assertWindowsLegalPublisher(legalPublisher);
  if (
    publisher.localeCompare(tauriConfig.productName, undefined, {
      sensitivity: "accent",
    }) === 0
  ) {
    throw new Error(
      "Microsoft Store publisher must not equal the application product name.",
    );
  }
  return {
    communityPublisher,
    identifier: tauriConfig.identifier,
    productName: tauriConfig.productName,
    publisher,
    version: versions[0],
  };
}

export function assertWindowsLegalPublisher(value) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 2 ||
    value.length > WINDOWS_LEGAL_PUBLISHER_MAX_LENGTH ||
    containsControlCharacters(value) ||
    /[,=]/.test(value) ||
    PLACEHOLDER_PATTERN.test(value) ||
    !/[\p{L}\p{N}]/u.test(value)
  ) {
    throw new Error(
      "ATLASTERM_WINDOWS_LEGAL_PUBLISHER must be the exact non-placeholder legal publisher, 2-160 characters, without surrounding whitespace, controls, commas, or equals signs.",
    );
  }
  return value;
}

export function assertCertificateSubjectMatchesLegalPublisher(
  subject,
  legalPublisher,
) {
  const publisher = assertWindowsLegalPublisher(legalPublisher);
  if (
    typeof subject !== "string" ||
    subject !== subject.trim() ||
    !subject ||
    subject.length > 512 ||
    containsControlCharacters(subject)
  ) {
    throw new Error(
      "The protected X.509 certificate subject must be normalized single-line text no longer than 512 characters.",
    );
  }
  const commonNames = [...subject.matchAll(/(?:^|,\s*)CN=([^,]*)(?=,|$)/g)].map(
    (match) => match[1].trim(),
  );
  if (commonNames.length !== 1 || commonNames[0] !== publisher) {
    throw new Error(
      "The protected X.509 certificate subject must contain exactly one CN that exactly equals ATLASTERM_WINDOWS_LEGAL_PUBLISHER.",
    );
  }
  return publisher;
}

export function assertPartnerCenterLegalPublisher(
  partnerIdentity,
  legalPublisher,
) {
  const publisher = assertWindowsLegalPublisher(legalPublisher);
  if (partnerIdentity?.publisherDisplayName !== publisher) {
    throw new Error(
      "Partner Center publisherDisplayName must exactly equal ATLASTERM_WINDOWS_LEGAL_PUBLISHER.",
    );
  }
  return publisher;
}

export function assertExpectedSha256(value) {
  const normalized = value?.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized ?? "")) {
    throw new Error("A full lowercase or uppercase SHA-256 is required.");
  }
  return normalized;
}

export function assertReviewedCommit(value) {
  const normalized = value?.trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(normalized ?? "")) {
    throw new Error("A full reviewed Git commit id is required.");
  }
  return normalized;
}

export function createWindowsStoreNsisBuildProvenance({
  artifactFileName,
  artifactMachine,
  artifactSha256,
  artifactSizeBytes,
  payloadFileName,
  payloadMachine,
  payloadSha256,
  payloadSizeBytes,
  projectVersion,
  sourceCommit,
}) {
  return validateWindowsStoreNsisBuildProvenance({
    schemaVersion: 1,
    format: "nsis-exe",
    generator: WINDOWS_STORE_NSIS_BUILD_PROVENANCE_GENERATOR,
    sourceCommit,
    projectVersion,
    artifact: {
      bootstrapMachine: artifactMachine,
      fileName: artifactFileName,
      sha256: artifactSha256,
      sizeBytes: artifactSizeBytes,
    },
    payload: {
      architecture: payloadMachine,
      fileName: payloadFileName,
      sha256: payloadSha256,
      sizeBytes: payloadSizeBytes,
    },
  });
}

export function validateWindowsStoreNsisBuildProvenance(value) {
  assertExactObjectFields(
    value,
    [
      "schemaVersion",
      "format",
      "generator",
      "sourceCommit",
      "projectVersion",
      "artifact",
      "payload",
    ],
    "Windows Store NSIS build provenance",
  );
  assertExactObjectFields(
    value.artifact,
    ["bootstrapMachine", "fileName", "sha256", "sizeBytes"],
    "Windows Store NSIS build provenance artifact",
  );
  assertExactObjectFields(
    value.payload,
    ["architecture", "fileName", "sha256", "sizeBytes"],
    "Windows Store NSIS build provenance payload",
  );
  if (
    value.schemaVersion !== 1 ||
    value.format !== "nsis-exe" ||
    value.generator !== WINDOWS_STORE_NSIS_BUILD_PROVENANCE_GENERATOR
  ) {
    throw new Error(
      "Windows Store NSIS build provenance has an unsupported contract.",
    );
  }
  const sourceCommit = assertReviewedCommit(value.sourceCommit);
  if (value.sourceCommit !== sourceCommit) {
    throw new Error(
      "Windows Store NSIS build provenance sourceCommit must already be canonical lowercase.",
    );
  }
  if (
    typeof value.projectVersion !== "string" ||
    !value.projectVersion ||
    value.projectVersion.trim() !== value.projectVersion
  ) {
    throw new Error(
      "Windows Store NSIS build provenance projectVersion must be canonical.",
    );
  }
  deriveMsixVersion(value.projectVersion);
  const artifact = validateBuildProvenanceExecutable(
    value.artifact,
    "artifact",
  );
  const payload = validateBuildProvenanceExecutable(value.payload, "payload");
  if (!["x86", "x64"].includes(value.artifact.bootstrapMachine)) {
    throw new Error(
      "Windows Store NSIS build provenance artifact bootstrapMachine is unsupported.",
    );
  }
  if (value.payload.architecture !== "x64") {
    throw new Error(
      "Windows Store NSIS build provenance payload architecture must be x64.",
    );
  }
  if (payload.fileName !== "atlasterm-desktop-shell.exe") {
    throw new Error(
      "Windows Store NSIS build provenance payload fileName is not the reviewed Tauri executable.",
    );
  }
  return {
    schemaVersion: 1,
    format: "nsis-exe",
    generator: WINDOWS_STORE_NSIS_BUILD_PROVENANCE_GENERATOR,
    sourceCommit,
    projectVersion: value.projectVersion,
    artifact: {
      bootstrapMachine: value.artifact.bootstrapMachine,
      ...artifact,
    },
    payload: {
      architecture: value.payload.architecture,
      ...payload,
    },
  };
}

export function validateVersionedHttpsUrl(rawUrl, artifactFileName, version) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("The hosted installer URL must be a valid URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search
  ) {
    throw new Error(
      "The hosted installer URL must use HTTPS without credentials, a query, or a fragment.",
    );
  }
  const segments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (!segments.includes(version)) {
    throw new Error(
      "The hosted installer URL path must contain the immutable release version as its own segment.",
    );
  }
  if (segments.at(-1)?.toLowerCase() !== artifactFileName.toLowerCase()) {
    throw new Error(
      "The hosted installer URL file name must exactly match the verified artifact.",
    );
  }
  return parsed.toString();
}

export function validatePartnerCenterIdentity(identity) {
  if (identity?.schemaVersion !== 1) {
    throw new Error("Partner Center identity schemaVersion must be 1.");
  }
  if (identity?.source !== "partner-center") {
    throw new Error("MSIX identity source must explicitly be partner-center.");
  }
  const required = [
    "productId",
    "packageIdentityName",
    "publisher",
    "publisherDisplayName",
    "publisherId",
    "packageFamilyName",
  ];
  for (const field of required) {
    const value = identity?.[field];
    if (
      typeof value !== "string" ||
      value.trim().length < 3 ||
      PLACEHOLDER_PATTERN.test(value)
    ) {
      throw new Error(
        `Partner Center identity field ${field} is missing or still a placeholder.`,
      );
    }
  }
  const reservedAt = Date.parse(identity?.reservedAt);
  if (
    !Number.isFinite(reservedAt) ||
    new Date(reservedAt).toISOString() !== identity.reservedAt
  ) {
    throw new Error(
      "Partner Center identity reservedAt must be a normalized UTC ISO timestamp.",
    );
  }
  if (reservedAt > Date.now() + 5 * 60_000) {
    throw new Error(
      "Partner Center identity reservedAt cannot be in the future.",
    );
  }
  if (!/^CN=/i.test(identity.publisher.trim())) {
    throw new Error(
      "Partner Center publisher must be the exact Publisher value beginning with CN=.",
    );
  }
  const normalized = {
    packageFamilyName: identity.packageFamilyName.trim(),
    packageIdentityName: identity.packageIdentityName.trim(),
    productId: identity.productId.trim(),
    publisher: identity.publisher.trim(),
    publisherDisplayName: identity.publisherDisplayName.trim(),
    publisherId: identity.publisherId.trim(),
    reservedAt: new Date(reservedAt).toISOString(),
    schemaVersion: 1,
    source: "partner-center",
  };
  if (!PACKAGE_PUBLISHER_ID_PATTERN.test(normalized.publisherId)) {
    throw new Error(
      "Partner Center publisherId must be the exact 13-character Windows package PublisherId.",
    );
  }
  const expectedFamilyName = `${normalized.packageIdentityName}_${normalized.publisherId}`;
  if (
    normalized.packageFamilyName.localeCompare(expectedFamilyName, undefined, {
      sensitivity: "accent",
    }) !== 0
  ) {
    throw new Error(
      "Partner Center packageFamilyName must exactly bind packageIdentityName and publisherId.",
    );
  }
  return normalized;
}

export function parseMsixManifestIdentity(xml) {
  return parseMsixManifestContract(xml).identity;
}

export function assertMsixIdentityMatches(manifest, partnerIdentity) {
  if (manifest.name !== partnerIdentity.packageIdentityName) {
    throw new Error(
      "MSIX manifest Identity.Name does not match Partner Center.",
    );
  }
  if (manifest.publisher !== partnerIdentity.publisher) {
    throw new Error(
      "MSIX manifest Identity.Publisher does not match Partner Center.",
    );
  }
  if (manifest.publisherDisplayName !== partnerIdentity.publisherDisplayName) {
    throw new Error(
      "MSIX manifest PublisherDisplayName does not match Partner Center.",
    );
  }
}

export function assertMsixDesktopFullTrustContract(xml) {
  return parseMsixManifestContract(xml).desktopApplication;
}

export function assertMsixManifestLanguages(
  actualLanguages,
  expectedLanguages,
) {
  const actual = normalizeManifestLanguageList(
    actualLanguages,
    "MSIX manifest languages",
  );
  const expected = normalizeManifestLanguageList(
    expectedLanguages,
    "expected MSIX manifest languages",
  );
  if (
    actual.length !== expected.length ||
    actual.some((language, index) => language !== expected[index])
  ) {
    throw new Error(
      `MSIX manifest languages must exactly match the reviewed app UI language order: ${expected.join(", ")}.`,
    );
  }
  return actual;
}

export function parseMsixManifestContract(xml) {
  const packageNode = parseSafeManifestXml(xml);
  if (
    packageNode.local !== "Package" ||
    packageNode.uri !== APPX_FOUNDATION_NAMESPACE
  ) {
    throw new Error(
      "MSIX AppxManifest.xml root must be the Windows 10 foundation Package element.",
    );
  }

  const identityNode = requireExactlyOneChild(
    packageNode,
    "Identity",
    "Package/Identity",
  );
  const identityAttributes = Object.fromEntries(
    ["Name", "Publisher", "Version", "ProcessorArchitecture"].map((name) => [
      name,
      requireAttribute(identityNode, name, `Identity.${name}`),
    ]),
  );
  const versionComponents = identityAttributes.Version.split(".").map(Number);
  if (
    !/^\d{1,5}(?:\.\d{1,5}){3}$/.test(identityAttributes.Version) ||
    versionComponents.some((component) => component > 65_535)
  ) {
    throw new Error(
      "MSIX Identity.Version must use four numeric components from 0 to 65535.",
    );
  }
  if (versionComponents[0] === 0) {
    throw new Error(
      "MSIX Identity.Version first component must be nonzero for Microsoft Store.",
    );
  }
  if (versionComponents[3] !== 0) {
    throw new Error(
      "MSIX Identity.Version revision (fourth component) must be 0 for Microsoft Store.",
    );
  }
  const architecture = identityAttributes.ProcessorArchitecture.toLowerCase();
  if (!["x86", "x64", "arm", "arm64", "neutral"].includes(architecture)) {
    throw new Error(
      "MSIX Identity.ProcessorArchitecture is not a supported Store architecture.",
    );
  }

  const propertiesNode = requireExactlyOneChild(
    packageNode,
    "Properties",
    "Package/Properties",
  );
  const publisherDisplayNameNode = requireExactlyOneChild(
    propertiesNode,
    "PublisherDisplayName",
    "Properties/PublisherDisplayName",
  );
  if (publisherDisplayNameNode.children.length > 0) {
    throw new Error("MSIX PublisherDisplayName must contain text only.");
  }
  const publisherDisplayName = publisherDisplayNameNode.text.trim();
  if (!publisherDisplayName) {
    throw new Error("MSIX PublisherDisplayName must not be empty.");
  }

  const resourcesNode = requireExactlyOneChild(
    packageNode,
    "Resources",
    "Package/Resources",
  );
  const resourceNodes = childElements(resourcesNode, "Resource");
  if (
    resourcesNode.children.length !== resourceNodes.length ||
    resourcesNode.text.trim() !== "" ||
    resourceNodes.length === 0
  ) {
    throw new Error(
      "MSIX Resources must contain one or more language-only Resource elements.",
    );
  }
  const manifestLanguages = normalizeManifestLanguageList(
    resourceNodes.map((resourceNode) => {
      if (
        !hasExactUnnamespacedAttributes(resourceNode, ["Language"]) ||
        resourceNode.children.length !== 0 ||
        resourceNode.text.trim() !== ""
      ) {
        throw new Error(
          "Each MSIX Resource must contain only one unnamespaced Language attribute.",
        );
      }
      return requireAttribute(resourceNode, "Language", "Resource.Language");
    }),
    "MSIX manifest languages",
  );

  const dependenciesNode = requireExactlyOneChild(
    packageNode,
    "Dependencies",
    "Package/Dependencies",
  );
  const desktopTargets = childElements(
    dependenciesNode,
    "TargetDeviceFamily",
  ).filter(
    (node) =>
      optionalAttribute(node, "Name")?.toLowerCase() === "windows.desktop",
  );
  if (desktopTargets.length !== 1) {
    throw new Error(
      `MSIX manifest must contain exactly one Windows.Desktop TargetDeviceFamily; found ${desktopTargets.length}.`,
    );
  }

  const applicationsNode = requireExactlyOneChild(
    packageNode,
    "Applications",
    "Package/Applications",
  );
  const applications = childElements(applicationsNode, "Application");
  if (applications.length !== 1) {
    throw new Error(
      `MSIX manifest must contain exactly one desktop Application; found ${applications.length}.`,
    );
  }
  const application = applications[0];
  const executable = normalizeMsixExecutablePath(
    requireAttribute(application, "Executable", "Application.Executable"),
  );
  requireAttribute(application, "Id", "Application.Id");
  const runtimeBehavior = optionalAttribute(application, "RuntimeBehavior");
  const trustLevel = optionalAttribute(application, "TrustLevel");
  const entryPoint = optionalAttribute(application, "EntryPoint");
  const modernProfile =
    hasExactUnnamespacedAttributes(application, [
      "Executable",
      "Id",
      "RuntimeBehavior",
      "TrustLevel",
    ]) &&
    runtimeBehavior === "packagedClassicApp" &&
    trustLevel === "mediumIL" &&
    entryPoint === undefined;
  const packagingToolProfile =
    hasExactUnnamespacedAttributes(application, [
      "EntryPoint",
      "Executable",
      "Id",
    ]) &&
    entryPoint === "Windows.FullTrustApplication" &&
    runtimeBehavior === undefined &&
    trustLevel === undefined;
  if (!modernProfile && !packagingToolProfile) {
    throw new Error(
      "The unique MSIX desktop Application must use exactly packagedClassicApp/mediumIL or the MSIX Packaging Tool Windows.FullTrustApplication profile without mixed or extra execution attributes.",
    );
  }

  const capabilitiesNode = requireExactlyOneChild(
    packageNode,
    "Capabilities",
    "Package/Capabilities",
  );
  const capability = capabilitiesNode.children[0];
  const capabilityAttributes = capability?.attributes ?? [];
  const hasExactCapabilityAllowlist =
    capabilitiesNode.children.length === 1 &&
    capability?.local === "Capability" &&
    capability.uri === APPX_RESTRICTED_CAPABILITIES_NAMESPACE &&
    capability.children.length === 0 &&
    capability.text.trim() === "" &&
    capabilityAttributes.length === 1 &&
    capabilityAttributes[0].local === "Name" &&
    capabilityAttributes[0].uri === "" &&
    capabilityAttributes[0].value === "runFullTrust";
  if (!hasExactCapabilityAllowlist) {
    throw new Error(
      "MSIX manifest Capabilities must contain exactly one approved restricted runFullTrust Capability with only Name=runFullTrust and no additional base, UAP, or restricted capabilities.",
    );
  }

  return {
    desktopApplication: {
      executable,
      runtimeBehavior: "packagedClassicApp",
      trustLevel: "mediumIL",
    },
    identity: {
      architecture,
      name: identityAttributes.Name,
      publisher: identityAttributes.Publisher,
      publisherDisplayName,
      version: identityAttributes.Version,
    },
    languages: manifestLanguages,
  };
}

export function normalizeMsixExecutablePath(value) {
  const normalized = value?.trim().replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    containsControlCharacters(normalized)
  ) {
    throw new Error(
      "MSIX Application.Executable must be a safe package-relative path.",
    );
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":") ||
        segment.includes("%"),
    )
  ) {
    throw new Error(
      "MSIX Application.Executable must not contain empty, traversal, URI, or encoded path segments.",
    );
  }
  if (segments.at(-1)?.toLowerCase().endsWith(".exe") !== true) {
    throw new Error("MSIX Application.Executable must resolve to an EXE.");
  }
  return segments.join("/");
}

export function deriveMsixVersion(projectVersion) {
  const match = projectVersion?.match(
    /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})(?:-beta\.(0|[1-9]\d{0,4}))?$/,
  );
  if (!match) {
    throw new Error(
      "Project version cannot be deterministically mapped to a four-part MSIX version.",
    );
  }
  const [projectMajor, projectMinor, projectPatch] = match
    .slice(1, 4)
    .map(Number);
  const betaNumber = match[4] === undefined ? null : Number(match[4]);
  if (projectMajor >= 65_535 || projectMinor > 65_535 || projectPatch > 654) {
    throw new Error("Project version exceeds the deterministic MSIX mapping.");
  }
  if (betaNumber !== null && (betaNumber < 1 || betaNumber > 98)) {
    throw new Error(
      "Project beta number must be from 1 to 98 for the deterministic MSIX mapping.",
    );
  }
  const channel = betaNumber ?? 99;
  const build = projectPatch * 100 + channel;
  return `${projectMajor + 1}.${projectMinor}.${build}.0`;
}

export function readCargoVersion(path) {
  const content = readFileSync(path, "utf8");
  const packageSection = content.match(
    /\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/,
  );
  if (!packageSection) {
    throw new Error("Unable to read the Desktop Cargo package version.");
  }
  return packageSection[1];
}

export function fileNameContainsVersion(fileName, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[_-])${escapedVersion}(?=[_.-]|$)`, "i").test(
    fileName,
  );
}

function parseSafeManifestXml(xml) {
  if (
    typeof xml !== "string" ||
    !xml.trim() ||
    Buffer.byteLength(xml, "utf8") > MAX_MANIFEST_BYTES
  ) {
    throw new Error(
      "MSIX AppxManifest.xml must be non-empty UTF-8 text no larger than 1 MiB.",
    );
  }
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) {
    throw new Error(
      "MSIX AppxManifest.xml DTD/entity declarations and CDATA are rejected to prevent decoy contract markers.",
    );
  }

  let root = null;
  let nodeCount = 0;
  let approvedCommentCount = 0;
  const stack = [];
  const parser = sax.parser(true, {
    normalize: false,
    strictEntities: true,
    trim: false,
    xmlns: true,
  });
  parser.onopentag = (tag) => {
    nodeCount += 1;
    if (nodeCount > MAX_XML_NODES || stack.length >= MAX_XML_DEPTH) {
      throw new Error("MSIX AppxManifest.xml exceeds safe structure limits.");
    }
    const attributes = Object.values(tag.attributes)
      .filter((attribute) => attribute.uri !== "http://www.w3.org/2000/xmlns/")
      .map((attribute) => ({
        local: attribute.local,
        name: attribute.name,
        uri: attribute.uri,
        value: attribute.value,
      }));
    if (attributes.length > MAX_XML_ATTRIBUTES) {
      throw new Error(
        "MSIX AppxManifest.xml element exceeds the safe attribute limit.",
      );
    }
    const node = {
      attributes,
      children: [],
      local: tag.local,
      name: tag.name,
      text: "",
      uri: tag.uri,
    };
    if (stack.length === 0) {
      if (root) {
        throw new Error(
          "MSIX AppxManifest.xml must contain exactly one root element.",
        );
      }
      root = node;
    } else {
      stack.at(-1).children.push(node);
    }
    stack.push(node);
  };
  parser.ontext = (text) => {
    if (stack.length === 0) {
      if (text.trim()) {
        throw new Error(
          "MSIX AppxManifest.xml contains text outside the root element.",
        );
      }
      return;
    }
    stack.at(-1).text += text;
  };
  parser.onclosetag = () => {
    stack.pop();
  };
  parser.onprocessinginstruction = (instruction) => {
    if (instruction.name.toLowerCase() !== "xml" || root) {
      throw new Error(
        "MSIX AppxManifest.xml permits only the leading XML declaration.",
      );
    }
  };
  parser.ondoctype = () => {
    throw new Error("MSIX AppxManifest.xml DTD declarations are rejected.");
  };
  parser.oncomment = (comment) => {
    const packageRoot = stack.length === 1 ? stack[0] : null;
    if (
      comment !== APPROVED_MSIX_PACKAGING_TOOL_COMMENT ||
      approvedCommentCount !== 0 ||
      packageRoot !== root ||
      packageRoot?.local !== "Package" ||
      packageRoot?.children.length !== 0 ||
      packageRoot?.text.trim() !== ""
    ) {
      throw new Error(
        "MSIX AppxManifest.xml permits only the exact leading MSIX Packaging Tool comment; other comments are rejected to prevent decoy contract markers.",
      );
    }
    approvedCommentCount += 1;
  };
  parser.oncdata = () => {
    throw new Error("MSIX AppxManifest.xml CDATA is rejected.");
  };
  parser.onerror = (error) => {
    throw new Error(
      `MSIX AppxManifest.xml is not safe strict XML: ${error.message}`,
    );
  };
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("MSIX AppxManifest.xml could not be parsed safely.", {
      cause: error,
    });
  }
  if (!root || stack.length !== 0) {
    throw new Error("MSIX AppxManifest.xml has an incomplete XML structure.");
  }
  return root;
}

function childElements(parent, local) {
  return parent.children.filter(
    (child) => child.local === local && child.uri === APPX_FOUNDATION_NAMESPACE,
  );
}

function requireExactlyOneChild(parent, local, label) {
  const matches = childElements(parent, local);
  if (matches.length !== 1) {
    throw new Error(
      `MSIX AppxManifest.xml must contain exactly one ${label}; found ${matches.length}.`,
    );
  }
  return matches[0];
}

function optionalAttribute(node, local) {
  const matches = node.attributes.filter(
    (attribute) => attribute.local === local,
  );
  if (matches.length > 1) {
    throw new Error(
      `MSIX AppxManifest.xml contains ambiguous duplicate ${node.local}.${local} attributes.`,
    );
  }
  return matches[0]?.value;
}

function requireAttribute(node, local, label) {
  const value = optionalAttribute(node, local)?.trim();
  if (!value) {
    throw new Error(`MSIX AppxManifest.xml is missing ${label}.`);
  }
  return value;
}

function hasExactUnnamespacedAttributes(node, expectedNames) {
  const actual = node.attributes
    .filter((attribute) => attribute.uri === "")
    .map((attribute) => attribute.local)
    .sort();
  const expected = [...expectedNames].sort();
  return (
    actual.length === node.attributes.length &&
    actual.length === expected.length &&
    actual.every((name, index) => name === expected[index])
  );
}

function normalizeManifestLanguageList(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new Error(`${label} must contain from 1 to 200 BCP-47 tags.`);
  }
  const normalized = value.map((language) => {
    if (
      typeof language !== "string" ||
      language.trim() !== language ||
      containsControlCharacters(language)
    ) {
      throw new Error(`${label} must contain canonicalizable BCP-47 tags.`);
    }
    try {
      const canonical = Intl.getCanonicalLocales(language);
      if (canonical.length !== 1) {
        throw new Error("ambiguous language tag");
      }
      return canonical[0];
    } catch {
      throw new Error(`${label} contains an invalid BCP-47 tag.`);
    }
  });
  if (
    new Set(normalized.map((language) => language.toLowerCase())).size !==
    normalized.length
  ) {
    throw new Error(`${label} must not contain duplicate BCP-47 tags.`);
  }
  return normalized;
}

function assertExactObjectFields(value, expectedFields, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} must be a plain object.`);
  }
  const fields = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (
    fields.length !== expected.length ||
    fields.some((field, index) => field !== expected[index])
  ) {
    throw new Error(`${label} must contain only the reviewed fields.`);
  }
}

function validateBuildProvenanceExecutable(value, label) {
  const fileName = value.fileName;
  if (
    typeof fileName !== "string" ||
    !fileName.toLowerCase().endsWith(".exe") ||
    fileName.trim() !== fileName ||
    /[\\/\0\r\n]/.test(fileName)
  ) {
    throw new Error(
      `Windows Store NSIS build provenance ${label} fileName must be a direct EXE file name.`,
    );
  }
  const sha256 = assertExpectedSha256(value.sha256);
  if (value.sha256 !== sha256) {
    throw new Error(
      `Windows Store NSIS build provenance ${label} SHA-256 must already be canonical lowercase.`,
    );
  }
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0) {
    throw new Error(
      `Windows Store NSIS build provenance ${label} sizeBytes must be a positive safe integer.`,
    );
  }
  return { fileName, sha256, sizeBytes: value.sizeBytes };
}

function containsControlCharacters(value) {
  return [...value].some((character) => character.codePointAt(0) < 0x20);
}
