import { readFileSync } from "node:fs";
import sax from "sax";

const PLACEHOLDER_PATTERN =
  /(?:change[-_ ]?me|example|placeholder|todo|tbd|unknown|not[-_ ]?set|<[^>]+>)/i;
const WINDOWS_LEGAL_PUBLISHER_MAX_LENGTH = 160;
const APPX_FOUNDATION_NAMESPACE =
  "http://schemas.microsoft.com/appx/manifest/foundation/windows10";
const APPX_RESTRICTED_CAPABILITIES_NAMESPACE =
  "http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities";
const PACKAGE_PUBLISHER_ID_PATTERN = /^[a-hj-km-np-tv-z0-9]{13}$/i;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_XML_DEPTH = 64;
const MAX_XML_NODES = 10_000;
const MAX_XML_ATTRIBUTES = 100;

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
  if (!/^\d{1,5}(?:\.\d{1,5}){3}$/.test(identityAttributes.Version)) {
    throw new Error("MSIX Identity.Version must use four numeric components.");
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
  const runtimeBehavior = requireAttribute(
    application,
    "RuntimeBehavior",
    "Application.RuntimeBehavior",
  );
  const trustLevel = requireAttribute(
    application,
    "TrustLevel",
    "Application.TrustLevel",
  );
  const executable = normalizeMsixExecutablePath(
    requireAttribute(application, "Executable", "Application.Executable"),
  );
  if (runtimeBehavior !== "packagedClassicApp") {
    throw new Error(
      "The unique MSIX desktop Application must use RuntimeBehavior=packagedClassicApp.",
    );
  }
  if (trustLevel !== "mediumIL") {
    throw new Error(
      "The unique MSIX desktop Application must use TrustLevel=mediumIL.",
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
      runtimeBehavior,
      trustLevel,
    },
    identity: {
      architecture,
      name: identityAttributes.Name,
      publisher: identityAttributes.Publisher,
      publisherDisplayName,
      version: identityAttributes.Version,
    },
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
    /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:-beta\.(\d{1,5}))?$/,
  );
  if (!match) {
    throw new Error(
      "Project version cannot be deterministically mapped to a four-part MSIX version.",
    );
  }
  const components = match.slice(1, 4).map(Number);
  const revision = match[4] === undefined ? 65_535 : Number(match[4]);
  if (
    components.some((component) => component > 65_535) ||
    (match[4] !== undefined && revision > 65_534)
  ) {
    throw new Error("Project version exceeds the deterministic MSIX mapping.");
  }
  return [...components, revision].join(".");
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
  if (/<!--|<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) {
    throw new Error(
      "MSIX AppxManifest.xml comments, DTD/entity declarations, and CDATA are rejected to prevent decoy contract markers.",
    );
  }

  let root = null;
  let nodeCount = 0;
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
  parser.oncomment = () => {
    throw new Error("MSIX AppxManifest.xml comments are rejected.");
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

function containsControlCharacters(value) {
  return [...value].some((character) => character.codePointAt(0) < 0x20);
}
