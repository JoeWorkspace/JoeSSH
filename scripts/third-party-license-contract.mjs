import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import {
  isFirstPartyCargoPackage,
  verifyVendoredRustPackage,
  verifyVendoredRustPackages,
} from "./vendored-rust-contract.mjs";
import {
  buildVendoredCargoComponent,
  buildVendoredRustProvenance,
} from "./release-sbom-contract.mjs";

export const licenseArtifactPaths = Object.freeze({
  checksum: "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
  manifest: "reports/release/third-party-licenses/manifest.json",
  notices: "reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt",
});

const npmSboms = Object.freeze([
  {
    path: "reports/release/npm-desktop-sbom.cdx.json",
    scope: "desktop-npm",
  },
  {
    path: "reports/release/npm-web-sbom.cdx.json",
    scope: "web-npm",
  },
]);
const cargoSboms = Object.freeze([
  "reports/release/cargo-workspace-sbom.cdx.json",
  "reports/release/tauri-cargo-sbom.cdx.json",
]);
const cargoGraphs = Object.freeze([
  {
    lockPath: "Cargo.lock",
    metadataPath: "reports/internal/release-inputs/cargo-metadata.json",
    scope: "rust-workspace",
  },
  {
    lockPath: "apps/desktop/src-tauri/Cargo.lock",
    metadataPath: "reports/internal/release-inputs/tauri-cargo-metadata.json",
    scope: "tauri-shell",
  },
]);

const allowedLicenseIdentifiers = Object.freeze([
  "0BSD",
  "Apache-2.0",
  "BSD-1-Clause",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "LGPL-2.1-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Unicode-3.0",
  "Unlicense",
  "Zlib",
]);
const allowedLicenseIdentifierSet = new Set(allowedLicenseIdentifiers);
const allowedExceptions = new Set(["LLVM-exception"]);
const licenseFilePattern = /^(licen[sc]e|copying)([-_.]|$)/i;
const noticeFilePattern = /^(notice|copyright)([-_.]|$)/i;
const maxEvidenceFileBytes = 1024 * 1024;
const reviewedFallbackPolicyPath = "scripts/third-party-license-fallbacks.json";
const spdxLicenseListVersion = "3.28.0";
const vendoredSpdxTexts = Object.freeze({
  "Apache-2.0": {
    path: "scripts/spdx-license-texts/v3.28.0/Apache-2.0.txt",
    sha256: "074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff",
  },
  "BSD-3-Clause": {
    path: "scripts/spdx-license-texts/v3.28.0/BSD-3-Clause.txt",
    sha256: "5a93d5831e1297ab10fe643e1a631e83be392896da14ee2951285a79012df69d",
  },
  MIT: {
    path: "scripts/spdx-license-texts/v3.28.0/MIT.txt",
    sha256: "b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5",
  },
  "MPL-2.0": {
    path: "scripts/spdx-license-texts/v3.28.0/MPL-2.0.txt",
    sha256: "66a3107d5ad6a058aab753eaac2047ccb2ed0e39465dd0fe5844da3e300d5172",
  },
});

export function buildThirdPartyLicenseBundle(inputRoot) {
  const root = resolve(inputRoot);
  const packageJson = readJsonFile(root, "package.json");
  requireNonEmptyString(packageJson.name, "package.json name");
  requireNonEmptyString(packageJson.version, "package.json version");

  const inputs = buildThirdPartyLicenseInputEvidence(root);
  const { content: productLicenseContent, sha256: productLicenseSha256 } =
    readProductLicenseEvidence(root);
  const texts = new Map([[productLicenseSha256, productLicenseContent]]);
  const fallbackPolicy = loadReviewedFallbackPolicy(root);
  const packages = [
    ...collectNpmPackages(root, texts),
    ...collectCargoPackages(root, texts),
  ];
  const mergedPackages = mergePackages(packages);
  applyReviewedFallbacks(mergedPackages, texts, fallbackPolicy);

  const manifest = {
    schemaVersion: 1,
    product: "JoeSSH",
    version: packageJson.version,
    dependencyBoundary: {
      npm: "All non-optional components emitted by the verified Desktop and Web Admin CycloneDX SBOMs. The graph can include development or build tooling and does not assert that every listed package is linked into a runtime binary.",
      rust: "All packages reachable through normal or build dependency edges from the Rust workspace members in the verified Cargo metadata graphs; purely dev-only edges are excluded. Graph coverage does not assert that every listed package is linked into every runtime binary.",
      platform:
        "Platform redistributables and non-npm/Cargo payloads, including an offline WebView2 runtime when bundled, are outside this inventory and require separate distribution-term and candidate review.",
    },
    licensePolicy: {
      allowedSpdxLicenseIdentifiers: [...allowedLicenseIdentifiers],
      allowedSpdxExceptions: [...allowedExceptions].sort(),
      missingDeclaredLicense: "reject",
      unapprovedLicense: "reject",
      missingLicenseText: "reject",
      canonicalFallback: `Only exact package/version/license/checksum entries in ${reviewedFallbackPolicyPath} may use SHA-256-pinned official SPDX license-list-data v${spdxLicenseListVersion} text.`,
      inputHashNormalization:
        "Controlled repository text inputs are strict UTF-8 with an optional leading BOM removed and CRLF or CR normalized to LF before SHA-256; all other content is preserved.",
      noticeFiles:
        "Every top-level NOTICE or COPYRIGHT file shipped in an installed dependency source package is embedded.",
      npmTrustBoundary:
        "Each npm cache archive must match its package-lock sha512 integrity, and installed package.json plus every embedded npm license/notice file must byte-match that archive. An npm reviewed-fallback checksum is the same 64-byte SHA-512 digest decoded from that canonical integrity and rendered as 128 lowercase hexadecimal characters.",
      cargoTrustBoundary:
        "Each registry Cargo source archive must match its Cargo.lock SHA-256 checksum, and every embedded license or notice file must byte-match that archive. Registered vendored crates instead require the complete hash-verified source tree and patch manifest; their original archive checksum, patch provenance, tree checksum, and unchanged upstream license/notice files remain recorded.",
    },
    inputs,
    productLicense: {
      declaredLicense: "MIT",
      licenseText: {
        kind: "product",
        sha256: productLicenseSha256,
        sourceFile: "LICENSE",
      },
    },
    packages: mergedPackages.map(toManifestPackage),
    texts: [...texts.entries()]
      .map(([hash, content]) => ({ sha256: hash, content }))
      .sort(compareByHash),
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const noticesText = renderThirdPartyNotices(manifest);
  const checksumText = renderChecksumManifest({
    [licenseArtifactPaths.manifest]: manifestText,
    [licenseArtifactPaths.notices]: noticesText,
  });

  assertNoAbsolutePaths(manifestText, root);
  return { checksumText, manifest, manifestText, noticesText };
}

export function verifyPublishedThirdPartyLicenseBundle(inputRoot) {
  const root = resolve(inputRoot);
  const packageJson = readJsonFile(root, "package.json");
  const manifestBytes = readRequiredFile(root, licenseArtifactPaths.manifest);
  const noticesBytes = readRequiredFile(root, licenseArtifactPaths.notices);
  const checksumBytes = readRequiredFile(root, licenseArtifactPaths.checksum);
  const manifestText = normalizeText(
    manifestBytes,
    licenseArtifactPaths.manifest,
  );
  const noticesText = normalizeText(noticesBytes, licenseArtifactPaths.notices);
  const checksumText = normalizeText(
    checksumBytes,
    licenseArtifactPaths.checksum,
  );
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    fail(
      `${licenseArtifactPaths.manifest} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    );
  }
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.product !== "JoeSSH" ||
    manifest.version !== packageJson.version ||
    !Array.isArray(manifest.packages) ||
    manifest.packages.length === 0 ||
    !Array.isArray(manifest.texts) ||
    manifest.texts.length === 0
  ) {
    fail(
      "Published third-party license manifest structure/version is invalid.",
    );
  }
  assertExactObjectKeys(
    manifest,
    [
      "dependencyBoundary",
      "inputs",
      "licensePolicy",
      "packages",
      "product",
      "productLicense",
      "schemaVersion",
      "texts",
      "version",
    ],
    "Published third-party license manifest",
  );
  if (`${JSON.stringify(manifest, null, 2)}\n` !== manifestText) {
    fail("Published third-party license manifest is not canonical JSON.");
  }
  assertPublishedInputEvidence(
    manifest.inputs,
    buildThirdPartyLicenseInputEvidence(root),
  );
  const productLicense = readProductLicenseEvidence(root);
  const textHashes = new Set();
  for (let index = 0; index < manifest.texts.length; index += 1) {
    const text = manifest.texts[index];
    assertExactObjectKeys(
      text,
      ["content", "sha256"],
      `Published third-party license manifest text ${index + 1}`,
    );
    if (
      typeof text.content !== "string" ||
      typeof text.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(text.sha256) ||
      sha256(text.content) !== text.sha256 ||
      textHashes.has(text.sha256) ||
      (index > 0 && manifest.texts[index - 1].sha256 >= text.sha256)
    ) {
      fail("Published third-party license manifest has invalid embedded text.");
    }
    textHashes.add(text.sha256);
  }
  assertExactObjectKeys(
    manifest.productLicense,
    ["declaredLicense", "licenseText"],
    "Published third-party license productLicense",
  );
  assertExactObjectKeys(
    manifest.productLicense.licenseText,
    ["kind", "sha256", "sourceFile"],
    "Published third-party license product licenseText",
  );
  if (
    !isRecord(manifest.productLicense) ||
    manifest.productLicense.declaredLicense !== "MIT" ||
    !isRecord(manifest.productLicense.licenseText) ||
    manifest.productLicense.licenseText.kind !== "product" ||
    manifest.productLicense.licenseText.sourceFile !== "LICENSE" ||
    manifest.productLicense.licenseText.sha256 !== productLicense.sha256 ||
    !textHashes.has(productLicense.sha256)
  ) {
    fail(
      "Published third-party license bundle must embed the complete JoeSSH MIT LICENSE.",
    );
  }
  const referencedTextHashes = assertPublishedPackageInventory({
    actualPackages: manifest.packages,
    expectedPackages: buildPublishedThirdPartyPackageIdentities(root),
    root,
    textHashes,
  });
  referencedTextHashes.add(productLicense.sha256);
  if (
    referencedTextHashes.size !== textHashes.size ||
    [...textHashes].some((hash) => !referencedTextHashes.has(hash))
  ) {
    fail(
      "Published third-party license manifest texts must be exactly the product and package evidence closure.",
    );
  }
  if (noticesText.trim() === "") {
    fail("Published THIRD-PARTY-NOTICES.txt must not be empty.");
  }
  if (noticesText !== renderThirdPartyNotices(manifest)) {
    fail(
      "Published THIRD-PARTY-NOTICES.txt does not exactly render the embedded product and dependency license evidence.",
    );
  }
  const expectedChecksum = renderChecksumManifest({
    [licenseArtifactPaths.manifest]: manifestText,
    [licenseArtifactPaths.notices]: noticesText,
  });
  if (checksumText !== expectedChecksum) {
    fail(
      `${licenseArtifactPaths.checksum} must exactly cover the published manifest and notices.`,
    );
  }
  assertNoAbsolutePaths(manifestText, root);
  assertNoAbsolutePaths(noticesText, root);
  return {
    packageCount: manifest.packages.length,
    textCount: manifest.texts.length,
  };
}

export function buildThirdPartyLicenseInputEvidence(inputRoot) {
  const root = resolve(inputRoot);
  const vendoredInputs = existsSync(resolve(root, "vendor"))
    ? verifyVendoredRustPackages(root).map(
        (record) => `${record.metadata.path}/JOESSH-PATCH.json`,
      )
    : [];
  return [
    "LICENSE",
    "package.json",
    "package-lock.json",
    reviewedFallbackPolicyPath,
    ...Object.values(vendoredSpdxTexts).map(({ path }) => path),
    ...npmSboms.map(({ path }) => path),
    ...cargoSboms,
    ...cargoGraphs.map(({ lockPath }) => lockPath),
    ...vendoredInputs,
  ]
    .map((path) => ({
      path,
      sha256: sha256CanonicalTextInput(root, path),
    }))
    .sort(compareByPath);
}

export function buildPublishedThirdPartyPackageIdentities(inputRoot) {
  const root = resolve(inputRoot);
  return mergePackageIdentities([
    ...collectPublishedNpmPackageIdentities(root),
    ...collectPublishedCargoPackageIdentities(root),
  ]);
}

function assertPublishedInputEvidence(actualInputs, expectedInputs) {
  if (!Array.isArray(actualInputs)) {
    fail("Published third-party license manifest inputs must be an array.");
  }
  if (actualInputs.length !== expectedInputs.length) {
    fail(
      `Published third-party license manifest inputs must contain exactly ${expectedInputs.length} current release source files.`,
    );
  }
  for (let index = 0; index < expectedInputs.length; index += 1) {
    const actual = actualInputs[index];
    const expected = expectedInputs[index];
    assertExactObjectKeys(
      actual,
      ["path", "sha256"],
      `Published third-party license manifest input ${index + 1}`,
    );
    if (actual.path !== expected.path) {
      fail(
        `Published third-party license manifest inputs must use the exact sorted source path set; expected ${expected.path} at entry ${index + 1}.`,
      );
    }
    if (actual.sha256 !== expected.sha256) {
      fail(
        `Published third-party license manifest input hash does not match current ${expected.path}.`,
      );
    }
  }
}

function readProductLicenseEvidence(root) {
  const content = normalizeText(readRequiredFile(root, "LICENSE"), "LICENSE");
  return { content, sha256: sha256(content) };
}

function collectPublishedNpmPackageIdentities(root) {
  const lock = readJsonFile(root, "package-lock.json");
  if (lock.lockfileVersion !== 3 || !isRecord(lock.packages)) {
    fail("package-lock.json must be a lockfileVersion 3 lock with packages.");
  }

  const packages = [];
  for (const { path: sbomPath, scope } of npmSboms) {
    const sbom = readJsonFile(root, sbomPath);
    if (
      sbom.bomFormat !== "CycloneDX" ||
      !Array.isArray(sbom.components) ||
      sbom.components.length === 0
    ) {
      fail(`${sbomPath} must be a non-empty CycloneDX SBOM.`);
    }
    const seenPackagePaths = new Set();
    const seenReferences = new Set();
    for (const component of sbom.components) {
      if (!isRecord(component)) {
        fail(`${sbomPath} contains a malformed component.`);
      }
      if (component.scope === "optional") {
        continue;
      }
      const packagePath = readNpmPackagePath(component, sbomPath);
      const reference = requireNonEmptyString(
        component["bom-ref"],
        `${sbomPath} npm component bom-ref`,
      );
      if (seenPackagePaths.has(packagePath) || seenReferences.has(reference)) {
        fail(
          `${sbomPath} contains a duplicate npm package path or bom-ref: ${packagePath}.`,
        );
      }
      seenPackagePaths.add(packagePath);
      seenReferences.add(reference);
      if (!packagePath.split("/").includes("node_modules")) {
        assertPublishedNpmWorkspaceComponent({
          component,
          lock,
          packagePath,
          sbomPath,
        });
        continue;
      }
      const lockEntry = lock.packages[packagePath];
      if (!isRecord(lockEntry)) {
        fail(
          `${sbomPath} component ${displayComponent(component)} is not bound to package-lock.json path ${packagePath}.`,
        );
      }
      const name = requireNonEmptyString(
        component.name,
        `${sbomPath} component name`,
      );
      const version = requireNonEmptyString(
        component.version,
        `${name} npm version`,
      );
      const declaredLicense = readCycloneDxLicense(component, sbomPath);
      validateLicenseExpression(declaredLicense, `${name}@${version}`);
      if (
        component.type !== "library" ||
        component.scope !== "required" ||
        component["bom-ref"] !== `${name}@${version}` ||
        component.purl !== npmPackageUrl(name, version) ||
        lockEntry.version !== version ||
        lockEntry.license !== declaredLicense
      ) {
        fail(
          `${name}@${version} identity does not exactly match ${sbomPath} and package-lock.json.`,
        );
      }
      const source = validateHttpsSourceUrl(
        lockEntry.resolved,
        `${name}@${version} resolved source`,
      );
      const integrity = requireNonEmptyString(
        lockEntry.integrity,
        `${name}@${version} package-lock integrity`,
      );
      if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) {
        fail(`${name}@${version} must use a sha512 package-lock integrity.`);
      }
      const digest = Buffer.from(integrity.slice("sha512-".length), "base64");
      if (
        digest.length !== 64 ||
        `sha512-${digest.toString("base64")}` !== integrity ||
        !Array.isArray(component.hashes) ||
        component.hashes.length !== 1 ||
        !isRecord(component.hashes[0]) ||
        component.hashes[0].alg !== "SHA-512" ||
        component.hashes[0].content !== digest.toString("hex") ||
        !Array.isArray(component.externalReferences) ||
        component.externalReferences.length !== 1 ||
        !isRecord(component.externalReferences[0]) ||
        component.externalReferences[0].type !== "distribution" ||
        component.externalReferences[0].url !== source
      ) {
        fail(
          `${name}@${version} integrity and distribution evidence do not exactly match package-lock.json.`,
        );
      }
      packages.push({
        declaredLicense,
        ecosystem: "npm",
        integrity,
        name,
        scopes: [scope],
        source,
        version,
      });
    }
  }
  return packages;
}

function collectPublishedCargoPackageIdentities(root) {
  const packages = [];
  for (let index = 0; index < cargoSboms.length; index += 1) {
    const sbomPath = cargoSboms[index];
    const { lockPath, scope } = cargoGraphs[index];
    const lockEntries = parseCargoLock(root, lockPath);
    const sbom = readJsonFile(root, sbomPath);
    if (
      sbom.bomFormat !== "CycloneDX" ||
      !Array.isArray(sbom.components) ||
      sbom.components.length === 0
    ) {
      fail(`${sbomPath} must be a non-empty CycloneDX SBOM.`);
    }
    const seenReferences = new Set();
    for (const component of sbom.components) {
      if (!isRecord(component)) {
        fail(`${sbomPath} contains a malformed Cargo component.`);
      }
      const reference = requireNonEmptyString(
        component["bom-ref"],
        `${sbomPath} Cargo component bom-ref`,
      );
      if (seenReferences.has(reference)) {
        fail(`${sbomPath} contains duplicate Cargo component ${reference}.`);
      }
      seenReferences.add(reference);
      const source = readCycloneDxProperty(
        component,
        "joessh:cargo:source",
        sbomPath,
      );
      const name = requireNonEmptyString(
        component.name,
        `${sbomPath} Cargo component name`,
      );
      const version = requireNonEmptyString(
        component.version,
        `${name} Cargo version`,
      );
      if (source === "workspace") {
        assertPublishedCargoWorkspaceComponent({
          component,
          name,
          sbomPath,
          version,
        });
        continue;
      }
      if (source === "vendored") {
        const record = verifyVendoredRustPackage(root, { name, version });
        const expectedComponent = buildVendoredCargoComponent(
          component,
          record,
        );
        if (!isDeepStrictEqual(component, expectedComponent)) {
          fail(
            `${name}@${version} Cargo SBOM does not match its verified vendored patch provenance.`,
          );
        }
        const lockEntry = lockEntries.get(
          cargoPackageKey({ name, version, source: "" }),
        );
        if (!lockEntry || lockEntry.source || lockEntry.checksum) {
          fail(
            `${name}@${version} vendored identity is not bound to ${lockPath}.`,
          );
        }
        packages.push({
          checksum: record.metadata.upstream.sha256,
          declaredLicense: record.declaredLicense,
          ecosystem: "cargo",
          name,
          scopes: [scope],
          source: `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}/download`,
          vendored: buildVendoredRustProvenance(record),
          version,
        });
        continue;
      }
      if (
        component.type !== "library" ||
        component.scope !== "required" ||
        source !== "registry+https://github.com/rust-lang/crates.io-index"
      ) {
        fail(
          `${name}@${version} has unsupported Cargo SBOM identity metadata.`,
        );
      }
      const declaredLicense = readCycloneDxLicense(component, sbomPath);
      validateLicenseExpression(declaredLicense, `${name}@${version}`);
      const packageUrl = `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
      if (
        component["bom-ref"] !== packageUrl ||
        component.purl !== packageUrl
      ) {
        fail(`${name}@${version} has invalid Cargo package URL identity.`);
      }
      if (!Array.isArray(component.hashes) || component.hashes.length !== 1) {
        fail(
          `${name}@${version} must have exactly one Cargo.lock hash in ${sbomPath}.`,
        );
      }
      const [hash] = component.hashes;
      if (
        !isRecord(hash) ||
        hash.alg !== "SHA-256" ||
        typeof hash.content !== "string" ||
        !/^[a-f0-9]{64}$/.test(hash.content)
      ) {
        fail(`${name}@${version} has invalid Cargo.lock hash evidence.`);
      }
      const lockEntry = lockEntries.get(
        cargoPackageKey({ name, source, version }),
      );
      if (!lockEntry || lockEntry.checksum !== hash.content) {
        fail(
          `${name}@${version} identity does not exactly match ${sbomPath} and ${lockPath}.`,
        );
      }
      packages.push({
        checksum: hash.content,
        declaredLicense,
        ecosystem: "cargo",
        name,
        scopes: [scope],
        source: `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}/download`,
        version,
      });
    }
  }
  return packages;
}

function assertPublishedNpmWorkspaceComponent({
  component,
  lock,
  packagePath,
  sbomPath,
}) {
  const lockEntry = lock.packages[packagePath];
  if (!isRecord(lockEntry)) {
    fail(
      `${sbomPath} local component ${displayComponent(component)} is not bound to package-lock.json path ${packagePath}.`,
    );
  }
  const name = requireNonEmptyString(
    lockEntry.name,
    `${packagePath} workspace package name`,
  );
  const version = requireNonEmptyString(
    lockEntry.version,
    `${name} workspace package version`,
  );
  const shortName = name.includes("/")
    ? name.slice(name.lastIndexOf("/") + 1)
    : name;
  if (
    !/^(apps|packages)\/[A-Za-z0-9._-]+$/.test(packagePath) ||
    !name.startsWith("@atlasterm/") ||
    component.name !== shortName ||
    component.version !== version ||
    component.type !== "library" ||
    component.scope !== "required" ||
    component["bom-ref"] !== `${name}@${version}` ||
    component.purl !== npmPackageUrl(name, version) ||
    readCycloneDxProperty(component, "cdx:npm:package:private", sbomPath) !==
      "true"
  ) {
    fail(
      `${sbomPath} non-node_modules component ${packagePath} is not a recognized private JoeSSH workspace package.`,
    );
  }
}

function assertPublishedCargoWorkspaceComponent({
  component,
  name,
  sbomPath,
  version,
}) {
  const packageUrl = `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
  if (
    !["atlasterm-core", "atlasterm-sync", "atlasterm-desktop-shell"].includes(
      name,
    ) ||
    component.type !== "library" ||
    component.scope !== "required" ||
    component["bom-ref"] !== packageUrl ||
    component.purl !== packageUrl ||
    Object.hasOwn(component, "hashes")
  ) {
    fail(
      `${sbomPath} workspace component ${name}@${version} is not a recognized JoeSSH workspace package.`,
    );
  }
}

function mergePackageIdentities(packages) {
  const merged = new Map();
  for (const packageEntry of packages) {
    const key = `${packageEntry.ecosystem}:${packageEntry.name}@${packageEntry.version}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...packageEntry,
        scopes: [...packageEntry.scopes],
      });
      continue;
    }
    const identityFields = [
      "declaredLicense",
      "source",
      packageEntry.ecosystem === "npm" ? "integrity" : "checksum",
    ];
    for (const field of identityFields) {
      if (existing[field] !== packageEntry[field]) {
        fail(`${key} has conflicting published ${field} metadata.`);
      }
    }
    if (!isDeepStrictEqual(existing.vendored, packageEntry.vendored)) {
      fail(`${key} has conflicting published vendored patch provenance.`);
    }
    existing.scopes = [
      ...new Set([...existing.scopes, ...packageEntry.scopes]),
    ].sort(compareText);
  }
  return [...merged.values()].sort(comparePackages);
}

function assertPublishedPackageInventory({
  actualPackages,
  expectedPackages,
  root,
  textHashes,
}) {
  if (actualPackages.length !== expectedPackages.length) {
    fail(
      `Published third-party license manifest packages must contain exactly ${expectedPackages.length} current SBOM/lockfile dependencies.`,
    );
  }
  const fallbackPolicy = loadReviewedFallbackPolicy(root);
  const usedFallbacks = new Set();
  const referencedTextHashes = new Set();
  for (let index = 0; index < expectedPackages.length; index += 1) {
    const actual = actualPackages[index];
    const expected = expectedPackages[index];
    const label = `Published third-party license package ${index + 1}`;
    const expectedKeys =
      expected.ecosystem === "npm"
        ? [
            "declaredLicense",
            "ecosystem",
            "integrity",
            "licenseTexts",
            "name",
            "notices",
            "scopes",
            "source",
            "version",
          ]
        : [
            "attribution",
            "checksum",
            "declaredLicense",
            "ecosystem",
            "licenseTexts",
            "name",
            "notices",
            "scopes",
            "source",
            "version",
          ];
    if (expected.vendored) {
      expectedKeys.push("vendored");
    }
    assertExactObjectKeys(actual, expectedKeys, label);
    if (!isDeepStrictEqual(actual.vendored, expected.vendored)) {
      fail(
        `${label} vendored patch provenance does not match its verified source.`,
      );
    }
    for (const field of [
      "ecosystem",
      "name",
      "version",
      "declaredLicense",
      "source",
      expected.ecosystem === "npm" ? "integrity" : "checksum",
    ]) {
      if (actual[field] !== expected[field]) {
        fail(
          `${label} ${field} does not match the current SBOM and lockfile inventory.`,
        );
      }
    }
    if (
      !Array.isArray(actual.scopes) ||
      JSON.stringify(actual.scopes) !== JSON.stringify(expected.scopes)
    ) {
      fail(
        `${label} scopes do not match the exact current SBOM coverage: ${expected.scopes.join(", ")}.`,
      );
    }
    if (expected.ecosystem === "cargo") {
      assertPublishedCargoAttribution(actual.attribution, label);
    }
    if (expected.vendored) {
      const record = verifyVendoredRustPackage(root, expected);
      const evidence = collectPackageTextEvidence({
        declaredLicense: record.declaredLicense,
        directory: record.directory,
        ecosystem: "cargo",
        name: record.name,
        texts: new Map(),
        version: record.version,
      });
      const attribution = {
        authors: [...new Set(record.authors)].sort(compareText),
        repository: record.repository,
      };
      if (
        !isDeepStrictEqual(actual.attribution, attribution) ||
        !isDeepStrictEqual(
          actual.licenseTexts,
          evidence.licenseTexts.sort(compareEvidence),
        ) ||
        !isDeepStrictEqual(
          actual.notices,
          evidence.notices.sort(compareEvidence),
        )
      ) {
        fail(
          `${label} vendored license/notice evidence or attribution does not match its verified source.`,
        );
      }
    }
    const fallbackKey = reviewedFallbackKey(expected);
    const fallback = fallbackPolicy.entries.get(fallbackKey);
    const packageTextHashes = assertPublishedEvidenceList({
      allowCanonicalFallback: Boolean(fallback),
      evidence: actual.licenseTexts,
      fallback,
      label: `${label} licenseTexts`,
      requireNonEmpty: true,
      textHashes,
    });
    if (fallback) {
      usedFallbacks.add(fallbackKey);
    }
    const noticeTextHashes = assertPublishedEvidenceList({
      allowCanonicalFallback: false,
      evidence: actual.notices,
      fallback: null,
      label: `${label} notices`,
      requireNonEmpty: false,
      textHashes,
    });
    for (const hash of [...packageTextHashes, ...noticeTextHashes]) {
      referencedTextHashes.add(hash);
    }
  }
  const unusedFallbacks = [...fallbackPolicy.entries.keys()].filter(
    (key) => !usedFallbacks.has(key),
  );
  if (unusedFallbacks.length > 0) {
    fail(
      `Published third-party license manifest omits reviewed fallback packages:\n- ${unusedFallbacks.join("\n- ")}`,
    );
  }
  return referencedTextHashes;
}

function assertPublishedCargoAttribution(attribution, label) {
  assertExactObjectKeys(
    attribution,
    ["authors", "repository"],
    `${label} attribution`,
  );
  if (
    !Array.isArray(attribution.authors) ||
    attribution.authors.some(
      (author) => typeof author !== "string" || author.trim() === "",
    ) ||
    JSON.stringify(attribution.authors) !==
      JSON.stringify([...new Set(attribution.authors)].sort(compareText))
  ) {
    fail(`${label} attribution authors must be sorted unique strings.`);
  }
  if (attribution.repository !== null) {
    const repository = validateHttpsSourceUrl(
      attribution.repository,
      `${label} attribution repository`,
      { allowFragment: true },
    );
    if (repository !== attribution.repository) {
      fail(`${label} attribution repository must use its canonical HTTPS URL.`);
    }
  }
}

function assertPublishedEvidenceList({
  allowCanonicalFallback,
  evidence,
  fallback,
  label,
  requireNonEmpty,
  textHashes,
}) {
  if (!Array.isArray(evidence) || (requireNonEmpty && evidence.length === 0)) {
    fail(`${label} must be ${requireNonEmpty ? "a non-empty" : "an"} array.`);
  }
  const normalized = [];
  const referenced = new Set();
  for (let index = 0; index < evidence.length; index += 1) {
    const entry = evidence[index];
    const entryLabel = `${label} entry ${index + 1}`;
    if (!isRecord(entry)) {
      fail(`${entryLabel} must be an object.`);
    }
    if (entry.kind === "upstream") {
      assertExactObjectKeys(
        entry,
        ["kind", "sha256", "sourceFile"],
        entryLabel,
      );
    } else if (entry.kind === "spdx-canonical" && allowCanonicalFallback) {
      assertExactObjectKeys(
        entry,
        [
          "kind",
          "note",
          "sha256",
          "sourceFile",
          "spdxLicense",
          "spdxListVersion",
        ],
        entryLabel,
      );
      const canonical = vendoredSpdxTexts[fallback.selectedLicense];
      if (
        entry.note !== reviewedFallbackEvidenceNote(fallback.ecosystem) ||
        entry.sha256 !== canonical?.sha256 ||
        entry.sourceFile !== canonical?.path ||
        entry.spdxLicense !== fallback.selectedLicense ||
        entry.spdxListVersion !== spdxLicenseListVersion
      ) {
        fail(`${entryLabel} does not match the reviewed SPDX fallback.`);
      }
    } else {
      fail(`${entryLabel} has an unsupported evidence kind.`);
    }
    if (
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !textHashes.has(entry.sha256)
    ) {
      fail(`${entryLabel} references missing embedded text.`);
    }
    assertSafeRelativePath(entry.sourceFile, `${entryLabel} sourceFile`);
    const key = `${entry.kind}\0${entry.sha256}\0${entry.sourceFile}`;
    if (referenced.has(key)) {
      fail(`${label} contains duplicate evidence.`);
    }
    referenced.add(key);
    normalized.push(entry);
  }
  if (
    JSON.stringify(evidence) !==
    JSON.stringify([...normalized].sort(compareEvidence))
  ) {
    fail(`${label} must use canonical evidence ordering.`);
  }
  if (
    allowCanonicalFallback &&
    (evidence.length !== 1 || evidence[0].kind !== "spdx-canonical")
  ) {
    fail(`${label} must use the exact reviewed SPDX fallback.`);
  }
  return new Set(evidence.map(({ sha256: hash }) => hash));
}

function collectNpmPackages(root, texts) {
  const lock = readJsonFile(root, "package-lock.json");
  if (lock.lockfileVersion !== 3 || !isRecord(lock.packages)) {
    fail("package-lock.json must be a lockfileVersion 3 lock with packages.");
  }

  const packages = [];
  for (const { path: sbomPath, scope } of npmSboms) {
    const sbom = readJsonFile(root, sbomPath);
    if (
      sbom.bomFormat !== "CycloneDX" ||
      !Array.isArray(sbom.components) ||
      sbom.components.length === 0
    ) {
      fail(`${sbomPath} must be a non-empty CycloneDX SBOM.`);
    }

    for (const component of sbom.components) {
      if (!isRecord(component) || component.scope === "optional") {
        continue;
      }
      const packagePath = readNpmPackagePath(component, sbomPath);
      if (!packagePath || !packagePath.split("/").includes("node_modules")) {
        continue;
      }
      const lockEntry = lock.packages[packagePath];
      if (!isRecord(lockEntry)) {
        fail(
          `${sbomPath} component ${displayComponent(component)} is not bound to package-lock.json path ${packagePath}.`,
        );
      }

      const packageDirectory = resolveSafeRepoPath(root, packagePath);
      assertRealDirectoryInside(
        packageDirectory,
        root,
        `${displayComponent(component)} installed package directory`,
      );
      const installed = readJsonFile(root, `${packagePath}/package.json`);
      const name = requireNonEmptyString(
        installed.name,
        `${packagePath}/package.json name`,
      );
      const version = requireNonEmptyString(
        installed.version,
        `${packagePath}/package.json version`,
      );
      const declaredLicense = requireNonEmptyString(
        installed.license,
        `${name}@${version} declared license`,
      );
      validateLicenseExpression(declaredLicense, `${name}@${version}`);

      if (
        component.name !== name ||
        component.version !== version ||
        lockEntry.version !== version ||
        lockEntry.license !== declaredLicense
      ) {
        fail(
          `${name}@${version} metadata does not exactly match ${sbomPath}, package-lock.json, and the installed package.`,
        );
      }
      const sbomLicense = readCycloneDxLicense(component, sbomPath);
      if (sbomLicense !== declaredLicense) {
        fail(
          `${name}@${version} license mismatch: SBOM=${sbomLicense}, installed=${declaredLicense}.`,
        );
      }

      const sourceUrl = validateHttpsSourceUrl(
        lockEntry.resolved,
        `${name}@${version} resolved source`,
      );
      const integrity = requireNonEmptyString(
        lockEntry.integrity,
        `${name}@${version} package-lock integrity`,
      );
      if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) {
        fail(`${name}@${version} must use a sha512 package-lock integrity.`);
      }
      const npmArchive = loadNpmArchive({
        integrity,
        name,
        root,
        version,
      });
      assertMatchesSourceArchive({
        archive: npmArchive,
        bytes: readFileSync(resolve(packageDirectory, "package.json")),
        owner: `npm:${name}@${version}`,
        relativePath: "package.json",
      });

      const evidence = collectPackageTextEvidence({
        declaredLicense,
        directory: packageDirectory,
        ecosystem: "npm",
        name,
        sourceArchive: npmArchive,
        texts,
        version,
      });
      packages.push({
        declaredLicense,
        ecosystem: "npm",
        integrity,
        licenseTexts: evidence.licenseTexts,
        name,
        notices: evidence.notices,
        scopes: [scope],
        source: sourceUrl,
        version,
      });
    }
  }
  return packages;
}

function collectCargoPackages(root, texts) {
  const packages = [];
  for (const { lockPath, metadataPath, scope } of cargoGraphs) {
    const lockEntries = parseCargoLock(root, lockPath);
    const metadata = readJsonFile(root, metadataPath);
    if (
      metadata.version !== 1 ||
      !Array.isArray(metadata.packages) ||
      !Array.isArray(metadata.workspace_members) ||
      !isRecord(metadata.resolve) ||
      !Array.isArray(metadata.resolve.nodes)
    ) {
      fail(`${metadataPath} must contain complete Cargo metadata version 1.`);
    }

    const packageById = new Map(
      metadata.packages
        .filter(isRecord)
        .map((packageEntry) => [packageEntry.id, packageEntry]),
    );
    const nodeById = new Map(
      metadata.resolve.nodes.filter(isRecord).map((node) => [node.id, node]),
    );
    const reachable = collectReachableCargoIds(
      metadata.workspace_members,
      nodeById,
      metadataPath,
    );

    for (const id of reachable) {
      const packageEntry = packageById.get(id);
      if (!isRecord(packageEntry)) {
        fail(`${metadataPath} resolve graph references unknown package ${id}.`);
      }
      if (
        packageEntry.source === null &&
        isFirstPartyCargoPackage(packageEntry, {
          root,
          workspaceMembers: metadata.workspace_members,
        })
      ) {
        continue;
      }
      const name = requireNonEmptyString(
        packageEntry.name,
        `${metadataPath} package name`,
      );
      const version = requireNonEmptyString(
        packageEntry.version,
        `${name} Cargo version`,
      );
      const declaredLicense = requireNonEmptyString(
        packageEntry.license,
        `${name}@${version} declared license`,
      );
      validateLicenseExpression(declaredLicense, `${name}@${version}`);
      const vendored =
        packageEntry.source === null
          ? verifyVendoredRustPackage(root, {
              name,
              version,
              manifestPath: requireNonEmptyString(
                packageEntry.manifest_path,
                `${name}@${version} manifest_path`,
              ),
            })
          : null;
      const source = vendored
        ? ""
        : requireNonEmptyString(
            packageEntry.source,
            `${name}@${version} Cargo source`,
          );
      if (
        !vendored &&
        source !== "registry+https://github.com/rust-lang/crates.io-index"
      ) {
        fail(`${name}@${version} uses unsupported Cargo source ${source}.`);
      }
      const lockEntry = lockEntries.get(
        cargoPackageKey({ name, source, version }),
      );
      if (!lockEntry) {
        fail(
          `${name}@${version} from ${metadataPath} is not bound to ${lockPath}.`,
        );
      }
      if (
        vendored &&
        (lockEntry.source ||
          lockEntry.checksum ||
          declaredLicense !== vendored.declaredLicense)
      ) {
        fail(
          `${name}@${version} vendored Cargo identity/license does not match its verified source.`,
        );
      }
      const checksum = requireNonEmptyString(
        vendored ? vendored.metadata.upstream.sha256 : lockEntry.checksum,
        `${name}@${version} Cargo checksum`,
      );
      if (!/^[a-f0-9]{64}$/.test(checksum)) {
        fail(`${name}@${version} Cargo checksum must be lowercase SHA-256.`);
      }

      const manifestPath = requireNonEmptyString(
        packageEntry.manifest_path,
        `${name}@${version} manifest_path`,
      );
      const packageDirectory =
        vendored?.directory ?? dirname(resolve(manifestPath));
      let cargoArchive = null;
      if (!vendored) {
        assertCargoSourceDirectory(
          packageDirectory,
          root,
          `${name}@${version} Cargo source directory`,
        );
        cargoArchive = loadCargoArchive({
          checksum,
          directory: packageDirectory,
          name,
          version,
        });
        assertMatchesSourceArchive({
          archive: cargoArchive,
          bytes: readFileSync(resolve(packageDirectory, "Cargo.toml")),
          owner: `cargo:${name}@${version}`,
          relativePath: "Cargo.toml",
        });
      }
      const authors = vendored
        ? vendored.authors
        : Array.isArray(packageEntry.authors)
          ? packageEntry.authors.map((author) =>
              requireNonEmptyString(author, `${name}@${version} Cargo author`),
            )
          : [];
      const repository = vendored
        ? vendored.repository
        : packageEntry.repository === null ||
            packageEntry.repository === undefined
          ? null
          : validateHttpsSourceUrl(
              packageEntry.repository,
              `${name}@${version} Cargo repository`,
              { allowFragment: true },
            );
      const evidence = collectPackageTextEvidence({
        declaredLicense,
        directory: packageDirectory,
        ecosystem: "cargo",
        explicitLicenseFile: packageEntry.license_file,
        name,
        sourceArchive: cargoArchive,
        texts,
        version,
      });
      packages.push({
        attribution: {
          authors: [...new Set(authors)].sort(compareText),
          repository,
        },
        checksum,
        declaredLicense,
        ecosystem: "cargo",
        licenseTexts: evidence.licenseTexts,
        name,
        notices: evidence.notices,
        scopes: [scope],
        source: `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}/download`,
        ...(vendored
          ? { vendored: buildVendoredRustProvenance(vendored) }
          : {}),
        version,
      });
    }
  }
  return packages;
}

function collectReachableCargoIds(workspaceMembers, nodeById, metadataPath) {
  const queue = [...workspaceMembers];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const id = queue.shift();
    const node = nodeById.get(id);
    if (!isRecord(node) || !Array.isArray(node.deps)) {
      fail(`${metadataPath} resolve graph is missing node ${id}.`);
    }
    for (const dependency of node.deps) {
      if (!isRecord(dependency)) {
        fail(`${metadataPath} contains a malformed dependency edge.`);
      }
      const dependencyKinds = Array.isArray(dependency.dep_kinds)
        ? dependency.dep_kinds
        : [];
      if (
        dependencyKinds.length > 0 &&
        dependencyKinds.every(
          (entry) => isRecord(entry) && entry.kind === "dev",
        )
      ) {
        continue;
      }
      const dependencyId = requireNonEmptyString(
        dependency.pkg,
        `${metadataPath} dependency package id`,
      );
      if (!seen.has(dependencyId)) {
        seen.add(dependencyId);
        queue.push(dependencyId);
      }
    }
  }
  return [...seen];
}

function collectPackageTextEvidence({
  declaredLicense,
  directory,
  ecosystem,
  explicitLicenseFile,
  name,
  sourceArchive,
  texts,
  version,
}) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const licenseFiles = entries
    .filter((entry) => entry.isFile() && licenseFilePattern.test(entry.name))
    .map((entry) => entry.name);
  const noticeFiles = entries
    .filter((entry) => entry.isFile() && noticeFilePattern.test(entry.name))
    .map((entry) => entry.name);

  if (typeof explicitLicenseFile === "string" && explicitLicenseFile !== "") {
    const explicitPath = resolve(explicitLicenseFile);
    const relativePath = relative(directory, explicitPath);
    if (
      relativePath.startsWith("..") ||
      isAbsolute(relativePath) ||
      relativePath === ""
    ) {
      fail(
        `${ecosystem}:${name}@${version} license_file escapes its source package.`,
      );
    }
    licenseFiles.push(relativePath.replace(/\\/g, "/"));
  } else if (
    explicitLicenseFile !== null &&
    explicitLicenseFile !== undefined
  ) {
    fail(
      `${ecosystem}:${name}@${version} has malformed license_file metadata.`,
    );
  }

  const licenseTexts = collectTextFiles({
    directory,
    files: [...new Set(licenseFiles)].sort(),
    kind: "license",
    owner: `${ecosystem}:${name}@${version}`,
    sourceArchive,
    texts,
  });
  const notices = collectTextFiles({
    directory,
    files: [...new Set(noticeFiles)].sort(),
    kind: "notice",
    owner: `${ecosystem}:${name}@${version}`,
    sourceArchive,
    texts,
  });

  return {
    declaredLicense,
    licenseTexts,
    notices,
  };
}

function collectTextFiles({
  directory,
  files,
  kind,
  owner,
  sourceArchive,
  texts,
}) {
  return files.map((file) => {
    const path = resolve(directory, file);
    const relativePath = relative(directory, path);
    if (
      relativePath.startsWith("..") ||
      isAbsolute(relativePath) ||
      relativePath === ""
    ) {
      fail(`${owner} ${kind} file escapes its source package: ${file}.`);
    }
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      fail(`${owner} ${kind} file is missing or not a regular file: ${file}.`);
    }
    if (lstatSync(path).isSymbolicLink()) {
      fail(`${owner} ${kind} file must not be a symbolic link: ${file}.`);
    }
    const bytes = readFileSync(path);
    if (bytes.length === 0 || bytes.length > maxEvidenceFileBytes) {
      fail(
        `${owner} ${kind} file must be 1-${maxEvidenceFileBytes} bytes: ${file}.`,
      );
    }
    if (sourceArchive) {
      assertMatchesSourceArchive({
        archive: sourceArchive,
        bytes,
        owner,
        relativePath: relativePath.replace(/\\/g, "/"),
      });
    }
    const content = normalizeText(bytes, `${owner} ${file}`);
    const hash = sha256(content);
    texts.set(hash, content);
    return {
      kind: "upstream",
      sha256: hash,
      sourceFile: relativePath.replace(/\\/g, "/"),
    };
  });
}

function mergePackages(packages) {
  const merged = new Map();
  for (const packageEntry of packages) {
    const key = `${packageEntry.ecosystem}:${packageEntry.name}@${packageEntry.version}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...packageEntry,
        licenseTexts: [...packageEntry.licenseTexts],
        notices: [...packageEntry.notices],
        scopes: [...packageEntry.scopes],
      });
      continue;
    }
    for (const field of [
      "declaredLicense",
      "source",
      packageEntry.ecosystem === "npm" ? "integrity" : "checksum",
    ]) {
      if (existing[field] !== packageEntry[field]) {
        fail(`${key} has conflicting locked ${field} metadata.`);
      }
    }
    if (!isDeepStrictEqual(existing.vendored, packageEntry.vendored)) {
      fail(`${key} has conflicting vendored patch provenance.`);
    }
    if (
      packageEntry.ecosystem === "cargo" &&
      JSON.stringify(existing.attribution) !==
        JSON.stringify(packageEntry.attribution)
    ) {
      fail(`${key} has conflicting Cargo attribution metadata.`);
    }
    existing.scopes = [
      ...new Set([...existing.scopes, ...packageEntry.scopes]),
    ];
    existing.licenseTexts = mergeEvidence(
      existing.licenseTexts,
      packageEntry.licenseTexts,
    );
    existing.notices = mergeEvidence(existing.notices, packageEntry.notices);
  }
  return [...merged.values()].sort(comparePackages);
}

function applyReviewedFallbacks(packages, texts, policy) {
  const usedFallbacks = new Set();
  for (const packageEntry of packages) {
    if (packageEntry.licenseTexts.length > 0) {
      continue;
    }
    const key = reviewedFallbackKey(packageEntry);
    const fallback = policy.entries.get(key);
    if (!fallback) {
      fail(
        `${packageEntry.ecosystem}:${packageEntry.name}@${packageEntry.version} has no embedded license text and no exact reviewed SPDX fallback.`,
      );
    }
    const selected = [fallback.selectedLicense];
    const alternatives = licenseAlternatives(
      packageEntry.declaredLicense,
      `${packageEntry.ecosystem}:${packageEntry.name}@${packageEntry.version}`,
    );
    if (
      !alternatives.some(
        (identifiers) =>
          identifiers.length === selected.length &&
          identifiers.every(
            (identifier, index) => identifier === selected[index],
          ),
      )
    ) {
      fail(
        `${key} reviewed fallback does not satisfy ${packageEntry.declaredLicense}.`,
      );
    }
    const canonical = policy.texts.get(fallback.selectedLicense);
    if (!canonical) {
      fail(`${key} references unavailable official SPDX text.`);
    }
    texts.set(canonical.sha256, canonical.content);
    packageEntry.licenseTexts = [
      {
        kind: "spdx-canonical",
        note: reviewedFallbackEvidenceNote(packageEntry.ecosystem),
        sha256: canonical.sha256,
        sourceFile: canonical.path,
        spdxLicense: fallback.selectedLicense,
        spdxListVersion: spdxLicenseListVersion,
      },
    ];
    usedFallbacks.add(key);
  }

  const unused = [...policy.entries.keys()].filter(
    (key) => !usedFallbacks.has(key),
  );
  if (unused.length > 0) {
    fail(
      `Reviewed SPDX fallback policy contains stale or non-runtime entries:\n- ${unused.join("\n- ")}`,
    );
  }
}

function loadReviewedFallbackPolicy(root) {
  const policy = readJsonFile(root, reviewedFallbackPolicyPath);
  assertExactObjectKeys(
    policy,
    ["reviewedFallbacks", "schemaVersion", "spdxLicenseList"],
    reviewedFallbackPolicyPath,
  );
  if (policy.schemaVersion !== 1) {
    fail(`${reviewedFallbackPolicyPath} schemaVersion must be 1.`);
  }
  if (!isRecord(policy.spdxLicenseList)) {
    fail(`${reviewedFallbackPolicyPath} spdxLicenseList must be an object.`);
  }
  assertExactObjectKeys(
    policy.spdxLicenseList,
    ["source", "texts", "version"],
    `${reviewedFallbackPolicyPath} spdxLicenseList`,
  );
  if (
    policy.spdxLicenseList.version !== spdxLicenseListVersion ||
    policy.spdxLicenseList.source !==
      "https://github.com/spdx/license-list-data/tree/v3.28.0/text" ||
    !isRecord(policy.spdxLicenseList.texts)
  ) {
    fail(
      `${reviewedFallbackPolicyPath} must pin SPDX v${spdxLicenseListVersion}.`,
    );
  }
  const expectedTextIds = Object.keys(vendoredSpdxTexts).sort();
  const actualTextIds = Object.keys(policy.spdxLicenseList.texts).sort();
  if (expectedTextIds.join("\0") !== actualTextIds.join("\0")) {
    fail(`${reviewedFallbackPolicyPath} SPDX text set must remain exact.`);
  }
  const texts = new Map();
  for (const identifier of expectedTextIds) {
    const expected = vendoredSpdxTexts[identifier];
    const declared = policy.spdxLicenseList.texts[identifier];
    if (!isRecord(declared)) {
      fail(
        `${reviewedFallbackPolicyPath} ${identifier} text entry is malformed.`,
      );
    }
    assertExactObjectKeys(
      declared,
      ["path", "sha256"],
      `${reviewedFallbackPolicyPath} ${identifier}`,
    );
    if (
      declared.path !== expected.path ||
      declared.sha256 !== expected.sha256
    ) {
      fail(
        `${reviewedFallbackPolicyPath} ${identifier} path/hash must match the reviewed SPDX pin.`,
      );
    }
    const bytes = readRequiredFile(root, expected.path);
    if (
      sha256(canonicalizeControlledTextInput(bytes, expected.path)) !==
      expected.sha256
    ) {
      fail(`Vendored official SPDX text hash mismatch: ${expected.path}.`);
    }
    const content = normalizeText(bytes, expected.path);
    if (sha256(content) !== expected.sha256) {
      fail(`Vendored SPDX text newline/content mismatch: ${expected.path}.`);
    }
    texts.set(identifier, { ...expected, content });
  }
  if (!Array.isArray(policy.reviewedFallbacks)) {
    fail(`${reviewedFallbackPolicyPath} reviewedFallbacks must be an array.`);
  }
  const entries = new Map();
  for (const entry of policy.reviewedFallbacks) {
    if (!isRecord(entry)) {
      fail(`${reviewedFallbackPolicyPath} fallback entry is malformed.`);
    }
    assertExactObjectKeys(
      entry,
      [
        "checksum",
        "declaredLicense",
        "ecosystem",
        "name",
        "review",
        "selectedLicense",
        "version",
      ],
      `${reviewedFallbackPolicyPath} fallback`,
    );
    if (entry.ecosystem !== "cargo" && entry.ecosystem !== "npm") {
      fail(`${reviewedFallbackPolicyPath} fallback ecosystem is unsupported.`);
    }
    const candidate = {
      checksum: requireNonEmptyString(
        entry.checksum,
        "reviewed fallback checksum",
      ),
      declaredLicense: requireNonEmptyString(
        entry.declaredLicense,
        "reviewed fallback declaredLicense",
      ),
      ecosystem: entry.ecosystem,
      name: requireNonEmptyString(entry.name, "reviewed fallback name"),
      version: requireNonEmptyString(
        entry.version,
        "reviewed fallback version",
      ),
    };
    const checksumPattern =
      candidate.ecosystem === "npm" ? /^[a-f0-9]{128}$/ : /^[a-f0-9]{64}$/;
    if (!checksumPattern.test(candidate.checksum)) {
      fail(
        candidate.ecosystem === "npm"
          ? `${reviewedFallbackPolicyPath} npm fallback checksum must be lowercase SHA-512 hex decoded from package-lock integrity.`
          : `${reviewedFallbackPolicyPath} Cargo fallback checksum must be SHA-256.`,
      );
    }
    validateLicenseExpression(
      candidate.declaredLicense,
      `${candidate.name}@${candidate.version} reviewed fallback`,
    );
    if (
      !Object.hasOwn(vendoredSpdxTexts, entry.selectedLicense) ||
      typeof entry.review !== "string" ||
      !entry.review.includes(
        entry.ecosystem === "npm"
          ? "Exact package-lock.json npm package reviewed"
          : "Exact Cargo.lock package reviewed",
      )
    ) {
      fail(`${reviewedFallbackPolicyPath} fallback review is incomplete.`);
    }
    const key = reviewedFallbackKey(candidate);
    if (entries.has(key)) {
      fail(`${reviewedFallbackPolicyPath} duplicates ${key}.`);
    }
    entries.set(key, { ...candidate, selectedLicense: entry.selectedLicense });
  }
  return { entries, texts };
}

function reviewedFallbackKey(packageEntry) {
  const checksum =
    packageEntry.checksum ??
    (packageEntry.ecosystem === "npm"
      ? npmReviewedFallbackChecksum(
          packageEntry.integrity,
          `${packageEntry.name}@${packageEntry.version}`,
        )
      : "");
  return `${packageEntry.ecosystem}:${packageEntry.name}@${packageEntry.version}\0${packageEntry.declaredLicense}\0${checksum}`;
}

function npmReviewedFallbackChecksum(integrity, owner) {
  if (
    typeof integrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)
  ) {
    fail(`${owner} must use a sha512 package-lock integrity.`);
  }
  const digest = Buffer.from(integrity.slice("sha512-".length), "base64");
  if (
    digest.length !== 64 ||
    `sha512-${digest.toString("base64")}` !== integrity
  ) {
    fail(`${owner} has malformed canonical sha512 package-lock integrity.`);
  }
  return digest.toString("hex");
}

function reviewedFallbackEvidenceNote(ecosystem) {
  return ecosystem === "npm"
    ? "Official SPDX canonical license template; package attribution is recorded separately from lock-bound npm metadata and is not substituted into the template."
    : "Official SPDX canonical license template; package attribution is recorded separately from lock-bound Cargo metadata and is not substituted into the template.";
}

function assertExactObjectKeys(value, expectedKeys, label) {
  if (!isRecord(value)) {
    fail(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.join("\0") !== expected.join("\0")) {
    fail(`${label} fields must be exactly: ${expected.join(", ")}.`);
  }
}

function toManifestPackage(packageEntry) {
  const result = {
    ecosystem: packageEntry.ecosystem,
    name: packageEntry.name,
    version: packageEntry.version,
    scopes: [...packageEntry.scopes].sort(),
    declaredLicense: packageEntry.declaredLicense,
    source: packageEntry.source,
  };
  if (packageEntry.ecosystem === "cargo") {
    result.attribution = packageEntry.attribution;
    if (packageEntry.vendored) {
      result.vendored = packageEntry.vendored;
    }
  }
  if (packageEntry.ecosystem === "npm") {
    result.integrity = packageEntry.integrity;
  } else {
    result.checksum = packageEntry.checksum;
  }
  result.licenseTexts = [...packageEntry.licenseTexts].sort(compareEvidence);
  result.notices = [...packageEntry.notices].sort(compareEvidence);
  return result;
}

function renderVendoredPatchProvenance(vendored) {
  const lines = [
    `Vendored third-party source: ${vendored.upstream.archiveUrl}`,
    `Upstream revision: ${vendored.upstream.gitCommit}`,
    `Patch kind: ${vendored.patch.kind}`,
  ];
  if (vendored.patch.kind === "security-backport") {
    lines.push(
      `Security backport: ${vendored.patch.advisory} (${vendored.patch.url})`,
      `Patch revision: ${vendored.patch.commit}`,
      `Patch merge revision: ${vendored.patch.mergeCommit}`,
    );
  } else if (vendored.patch.kind === "project-compatibility") {
    lines.push(
      `Upstream compatibility issue: ${vendored.patch.upstreamIssue}`,
      `Compatibility rationale: ${vendored.patch.rationale}`,
    );
  } else {
    fail(`Unsupported vendored patch kind ${vendored.patch.kind}.`);
  }
  for (const file of vendored.patch.files) {
    lines.push(
      `Patched file: ${file.path}`,
      `Patched file original SHA-256: ${file.originalSha256}`,
      `Patched file result SHA-256: ${file.patchedSha256}`,
    );
  }
  lines.push(
    `Patch manifest SHA-256: ${vendored.manifestSha256}`,
    `Patched source tree SHA-256: ${vendored.treeSha256}`,
  );
  return lines;
}

export function renderThirdPartyNotices(manifest) {
  const lines = [
    "JoeSSH License and Third-Party Notices",
    "=======================================",
    "",
    `Product version: ${manifest.version}`,
    `Manifest schema: ${manifest.schemaVersion}`,
    "",
    "This installed, build-specific legal resource contains the complete JoeSSH",
    "MIT license and the npm/Cargo dependency license/notice text evidence",
    "bound by the release evidence manifest. Platform redistributables and",
    "other non-npm/Cargo payloads require separate distribution-term review.",
    "A canonical fallback is used only for an exact",
    "reviewed npm or Cargo package/license/checksum when its lock-bound source",
    "archive ships no license file; npm checksums are the decoded package-lock",
    "SHA-512 digest rendered as lowercase hex, while registry Cargo uses its",
    "lockfile SHA-256 checksum. Vendored Cargo entries separately retain the",
    "original archive checksum and verified patch/tree provenance;",
    `fallback bodies are hash-pinned official SPDX v${spdxLicenseListVersion} texts.`,
    "",
    "JoeSSH Product License",
    "----------------------",
    "",
    "Declared license: MIT",
    "Source: LICENSE",
    `SHA-256: ${manifest.productLicense.licenseText.sha256}`,
    "",
    manifest.texts
      .find(
        ({ sha256: hash }) =>
          hash === manifest.productLicense.licenseText.sha256,
      )
      .content.trimEnd(),
    "",
    "------------------------------------------------------------------------",
    "",
    "Third-Party Components",
    "----------------------",
    "",
  ];
  for (const packageEntry of manifest.packages) {
    lines.push(
      `[${packageEntry.ecosystem}] ${packageEntry.name}@${packageEntry.version}`,
      `Scopes: ${packageEntry.scopes.join(", ")}`,
      `Declared license: ${packageEntry.declaredLicense}`,
      `Source: ${packageEntry.source}`,
      ...(packageEntry.ecosystem === "cargo"
        ? [
            `Package attribution (Cargo metadata authors): ${
              packageEntry.attribution.authors.length > 0
                ? packageEntry.attribution.authors.join("; ")
                : "not declared by the source package"
            }`,
            `Package repository: ${
              packageEntry.attribution.repository ??
              "not declared by the source package"
            }`,
          ]
        : []),
      packageEntry.ecosystem === "npm"
        ? `Integrity: ${packageEntry.integrity}`
        : `${packageEntry.vendored ? "Original archive checksum" : "Checksum"}: ${packageEntry.checksum}`,
      ...(packageEntry.vendored
        ? renderVendoredPatchProvenance(packageEntry.vendored)
        : []),
      `License text SHA-256: ${packageEntry.licenseTexts
        .map(({ sha256: hash }) => hash)
        .join(", ")}`,
      `Notice SHA-256: ${
        packageEntry.notices.length > 0
          ? packageEntry.notices.map(({ sha256: hash }) => hash).join(", ")
          : "none supplied by source package"
      }`,
      "",
    );
  }
  lines.push("Embedded Texts", "--------------", "");
  const usersByHash = new Map();
  for (const packageEntry of manifest.packages) {
    for (const evidence of [
      ...packageEntry.licenseTexts,
      ...packageEntry.notices,
    ]) {
      const users = usersByHash.get(evidence.sha256) ?? [];
      users.push(
        `${packageEntry.ecosystem}:${packageEntry.name}@${packageEntry.version}`,
      );
      usersByHash.set(evidence.sha256, users);
    }
  }
  for (const text of manifest.texts) {
    if (text.sha256 === manifest.productLicense.licenseText.sha256) {
      continue;
    }
    lines.push(
      `SHA-256: ${text.sha256}`,
      `Used by: ${[...new Set(usersByHash.get(text.sha256) ?? [])]
        .sort()
        .join(", ")}`,
      "",
      text.content.trimEnd(),
      "",
      "------------------------------------------------------------------------",
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderChecksumManifest(files) {
  return `${Object.entries(files)
    .sort(([leftPath], [rightPath]) => compareText(leftPath, rightPath))
    .map(([path, content]) => `${sha256(content)}  ${path}`)
    .join("\n")}\n`;
}

function npmPackageUrl(name, version) {
  const encodedName = name.split("/").map(encodeURIComponent).join("/");
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function readCycloneDxProperty(component, propertyName, sbomPath) {
  if (!Array.isArray(component.properties)) {
    fail(
      `${sbomPath} component ${displayComponent(component)} has no properties.`,
    );
  }
  const values = component.properties
    .filter(
      (property) =>
        isRecord(property) &&
        property.name === propertyName &&
        typeof property.value === "string",
    )
    .map(({ value }) => value);
  if (values.length !== 1) {
    fail(
      `${sbomPath} component ${displayComponent(component)} must have exactly one ${propertyName} property.`,
    );
  }
  return values[0];
}

function readNpmPackagePath(component, sbomPath) {
  if (!Array.isArray(component.properties)) {
    fail(`${sbomPath} component ${displayComponent(component)} has no path.`);
  }
  const values = component.properties
    .filter(
      (property) =>
        isRecord(property) &&
        property.name === "cdx:npm:package:path" &&
        typeof property.value === "string",
    )
    .map(({ value }) => value.replaceAll("\\", "/"));
  if (values.length !== 1) {
    fail(
      `${sbomPath} component ${displayComponent(component)} must have one package path.`,
    );
  }
  const path = values[0];
  assertSafeRelativePath(path, `${sbomPath} component package path`);
  return path;
}

function readCycloneDxLicense(component, sbomPath) {
  if (!Array.isArray(component.licenses) || component.licenses.length !== 1) {
    fail(
      `${sbomPath} component ${displayComponent(component)} must declare exactly one SPDX license expression.`,
    );
  }
  const entry = component.licenses[0];
  if (!isRecord(entry)) {
    fail(`${displayComponent(component)} has malformed SBOM license metadata.`);
  }
  if (typeof entry.expression === "string") {
    return entry.expression;
  }
  if (isRecord(entry.license)) {
    return requireNonEmptyString(
      entry.license.id ?? entry.license.name,
      `${displayComponent(component)} SBOM license`,
    );
  }
  fail(`${displayComponent(component)} has malformed SBOM license metadata.`);
}

function parseCargoLock(root, path) {
  const text = normalizeText(readRequiredFile(root, path), path);
  const entries = new Map();
  let current = null;
  const flush = () => {
    if (!current) {
      return;
    }
    const name = requireNonEmptyString(current.name, `${path} package name`);
    const version = requireNonEmptyString(
      current.version,
      `${path} ${name} version`,
    );
    const key = cargoPackageKey({
      name,
      source: current.source ?? "",
      version,
    });
    if (entries.has(key)) {
      fail(`${path} contains duplicate package ${name}@${version}.`);
    }
    entries.set(key, current);
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "[[package]]") {
      flush();
      current = {};
      continue;
    }
    if (!current) {
      continue;
    }
    const match = line.match(
      /^(name|version|source|checksum) = ("(?:[^"\\]|\\.)*")$/,
    );
    if (!match) {
      continue;
    }
    try {
      current[match[1]] = JSON.parse(match[2]);
    } catch {
      fail(`${path} contains malformed ${match[1]} metadata.`);
    }
  }
  flush();
  return entries;
}

function cargoPackageKey({ name, source, version }) {
  return `${name}\u0000${version}\u0000${source}`;
}

function validateLicenseExpression(expression, owner) {
  licenseAlternatives(expression, owner);
}

function licenseAlternatives(expression, owner) {
  const tokens = tokenizeLicenseExpression(expression, owner);
  let index = 0;

  const parsePrimary = () => {
    const token = tokens[index];
    if (token === "(") {
      index += 1;
      const value = parseOr();
      if (tokens[index] !== ")") {
        fail(
          `${owner} has unbalanced SPDX license parentheses: ${expression}.`,
        );
      }
      index += 1;
      return value;
    }
    if (!allowedLicenseIdentifierSet.has(token)) {
      fail(`${owner} uses unapproved SPDX license ${token ?? "<missing>"}.`);
    }
    index += 1;
    if (tokens[index] === "WITH") {
      index += 1;
      const exception = tokens[index];
      if (!allowedExceptions.has(exception)) {
        fail(
          `${owner} uses unapproved SPDX exception ${exception ?? "<missing>"}.`,
        );
      }
      index += 1;
      return [[`${token} WITH ${exception}`]];
    }
    return [[token]];
  };
  const parseAnd = () => {
    let alternatives = parsePrimary();
    while (tokens[index] === "AND") {
      index += 1;
      const right = parsePrimary();
      alternatives = alternatives.flatMap((leftEntry) =>
        right.map((rightEntry) => [...new Set([...leftEntry, ...rightEntry])]),
      );
    }
    return alternatives;
  };
  const parseOr = () => {
    let alternatives = parseAnd();
    while (tokens[index] === "OR") {
      index += 1;
      alternatives = [...alternatives, ...parseAnd()];
    }
    return alternatives;
  };

  const alternatives = parseOr();
  if (index !== tokens.length) {
    fail(`${owner} has malformed SPDX license expression: ${expression}.`);
  }
  return alternatives.map((entry) => [...entry].sort());
}

function tokenizeLicenseExpression(expression, owner) {
  const value = requireNonEmptyString(
    expression,
    `${owner} license expression`,
  ).replace(/\s*\/\s*/g, " OR ");
  if (!/^[A-Za-z0-9.+()\-_\s]+$/.test(value)) {
    fail(`${owner} has unsupported SPDX license syntax: ${expression}.`);
  }
  const tokens = value.match(/[()]|[A-Za-z0-9][A-Za-z0-9.+_-]*/g) ?? [];
  if (tokens.length === 0) {
    fail(`${owner} has an empty SPDX license expression.`);
  }
  return tokens;
}

function comparePackages(left, right) {
  return (
    compareText(left.ecosystem, right.ecosystem) ||
    compareText(left.name, right.name) ||
    compareText(left.version, right.version) ||
    compareText(left.source, right.source)
  );
}

function compareEvidence(left, right) {
  return (
    compareText(left.kind, right.kind) ||
    compareText(left.sha256, right.sha256) ||
    compareText(left.sourceFile ?? "", right.sourceFile ?? "")
  );
}

function compareByPath(left, right) {
  return compareText(left.path, right.path);
}

function compareByHash(left, right) {
  return compareText(left.sha256, right.sha256);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function mergeEvidence(left, right) {
  const entries = new Map();
  for (const entry of [...left, ...right]) {
    entries.set(
      `${entry.kind}\0${entry.sha256}\0${entry.sourceFile ?? ""}`,
      entry,
    );
  }
  return [...entries.values()].sort(compareEvidence);
}

function loadCargoArchive({ checksum, directory, name, version }) {
  const registryIndexDirectory = dirname(directory);
  const registryDirectory = dirname(dirname(registryIndexDirectory));
  const registryIdentifier = basename(registryIndexDirectory);
  const archivePath = resolve(
    registryDirectory,
    "cache",
    registryIdentifier,
    `${name}-${version}.crate`,
  );
  if (!existsSync(archivePath) || !statSync(archivePath).isFile()) {
    fail(`Cargo source archive is missing for ${name}@${version}.`);
  }
  if (lstatSync(archivePath).isSymbolicLink()) {
    fail(
      `Cargo source archive must not be a symbolic link for ${name}@${version}.`,
    );
  }
  const compressed = readFileSync(archivePath);
  if (compressed.length === 0 || compressed.length > 128 * 1024 * 1024) {
    fail(`Cargo source archive has an unsafe size for ${name}@${version}.`);
  }
  if (sha256(compressed) !== checksum) {
    fail(
      `Cargo source archive hash does not match Cargo.lock for ${name}@${version}.`,
    );
  }
  return {
    compressed,
    owner: `${name}@${version}`,
    prefix: `${name}-${version}/`,
    tar: null,
  };
}

function loadNpmArchive({ integrity, name, root, version }) {
  const digest = Buffer.from(integrity.slice("sha512-".length), "base64");
  if (digest.length !== 64) {
    fail(`npm:${name}@${version} has malformed sha512 integrity.`);
  }
  const digestHex = digest.toString("hex");
  const cacheRoots = [
    process.env.npm_config_cache,
    process.env.NPM_CONFIG_CACHE,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? resolve(process.env.LOCALAPPDATA, "npm-cache")
      : null,
    resolve(homedir(), ".npm"),
    resolve(root, ".npm-cache"),
  ].filter(
    (value, index, entries) =>
      typeof value === "string" &&
      value !== "" &&
      entries.indexOf(value) === index,
  );
  const relativeCachePath = join(
    "_cacache",
    "content-v2",
    "sha512",
    digestHex.slice(0, 2),
    digestHex.slice(2, 4),
    digestHex.slice(4),
  );
  const matches = cacheRoots
    .map((cacheRoot) => resolve(cacheRoot, relativeCachePath))
    .filter((path) => existsSync(path) && statSync(path).isFile());
  if (matches.length === 0) {
    fail(
      `npm cache archive is missing for ${name}@${version}; run npm ci --ignore-scripts against package-lock.json before license generation.`,
    );
  }
  const archivePath = matches[0];
  if (lstatSync(archivePath).isSymbolicLink()) {
    fail(
      `npm cache archive must not be a symbolic link for ${name}@${version}.`,
    );
  }
  const compressed = readFileSync(archivePath);
  if (compressed.length === 0 || compressed.length > 128 * 1024 * 1024) {
    fail(`npm cache archive has an unsafe size for ${name}@${version}.`);
  }
  const actualIntegrity = `sha512-${createHash("sha512")
    .update(compressed)
    .digest("base64")}`;
  if (actualIntegrity !== integrity) {
    fail(
      `npm cache archive hash does not match package-lock.json for ${name}@${version}.`,
    );
  }
  let tar;
  try {
    tar = gunzipSync(compressed, {
      maxOutputLength: 512 * 1024 * 1024,
    });
  } catch (error) {
    fail(
      `npm cache archive cannot be decoded for ${name}@${version}: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    );
  }
  const packageJsonRoots = [];
  walkTar(tar, `npm:${name}@${version}`, ({ path, type }) => {
    if (
      (type === "0" || type === "\0") &&
      /^[^/]+\/package\.json$/.test(path)
    ) {
      packageJsonRoots.push(path.slice(0, -"package.json".length));
    }
  });
  if (packageJsonRoots.length !== 1) {
    fail(
      `npm cache archive must contain exactly one top-level package.json for ${name}@${version}.`,
    );
  }
  return {
    compressed,
    owner: `${name}@${version}`,
    prefix: packageJsonRoots[0],
    tar,
  };
}

function assertMatchesSourceArchive({ archive, bytes, owner, relativePath }) {
  if (!archive.tar) {
    try {
      archive.tar = gunzipSync(archive.compressed, {
        maxOutputLength: 512 * 1024 * 1024,
      });
    } catch (error) {
      fail(
        `Locked source archive cannot be decoded for ${archive.owner}: ${
          error instanceof Error ? error.message : String(error)
        }.`,
      );
    }
  }
  const expectedPath = `${archive.prefix}${relativePath}`;
  const matches = [];
  walkTar(archive.tar, owner, ({ bytes: entryBytes, path, type }) => {
    if ((type === "0" || type === "\0") && path === expectedPath) {
      matches.push(entryBytes);
    }
  });
  if (matches.length !== 1 || !matches[0].equals(bytes)) {
    fail(
      `${owner} ${relativePath} does not byte-match its lockfile-bound source archive.`,
    );
  }
}

function walkTar(tar, owner, visit) {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      return;
    }
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const rawSize = readTarString(header, 124, 12).trim();
    if (!/^[0-7]+$/.test(rawSize)) {
      fail(`Locked source archive has malformed tar metadata for ${owner}.`);
    }
    const size = Number.parseInt(rawSize, 8);
    if (!Number.isSafeInteger(size) || size < 0) {
      fail(`Locked source archive has unsafe tar size metadata for ${owner}.`);
    }
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      fail(`Locked source archive is truncated for ${owner}.`);
    }
    const type = String.fromCharCode(header[156] || 48);
    visit({ bytes: tar.subarray(dataStart, dataEnd), path, type });
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  fail(`Locked source archive has no terminating tar block for ${owner}.`);
}

function readTarString(buffer, offset, length) {
  const field = buffer.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  return field.subarray(0, nul === -1 ? field.length : nul).toString("utf8");
}

function normalizeText(bytes, label) {
  const text = decodeUtf8Text(bytes, label);
  return `${text.replace(/\r\n?/g, "\n").trimEnd()}\n`;
}

function canonicalizeControlledTextInput(bytes, label) {
  const text = decodeUtf8Text(bytes, label);
  return Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
}

function decodeUtf8Text(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${label} must be valid UTF-8 text.`);
  }
  if (text.includes("\0")) {
    fail(`${label} must not contain NUL bytes.`);
  }
  return text.replace(/^\uFEFF/, "");
}

function sha256CanonicalTextInput(root, path) {
  return sha256(
    canonicalizeControlledTextInput(readRequiredFile(root, path), path),
  );
}

function readJsonFile(root, path) {
  const bytes = readRequiredFile(root, path);
  try {
    return JSON.parse(normalizeText(bytes, path));
  } catch (error) {
    fail(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readRequiredFile(root, path) {
  assertSafeRelativePath(path, "input path");
  const fullPath = resolve(root, path);
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    fail(`Required release license input is missing: ${path}.`);
  }
  if (lstatSync(fullPath).isSymbolicLink()) {
    fail(
      `Required release license input must not be a symbolic link: ${path}.`,
    );
  }
  return readFileSync(fullPath);
}

function assertCargoSourceDirectory(path, root, label) {
  const cargoHome = resolve(
    process.env.CARGO_HOME || join(homedir(), ".cargo"),
  );
  const allowedRoots = [
    resolve(cargoHome, "registry", "src"),
    resolve(root, ".cargo", "registry", "src"),
  ];
  assertRealDirectoryInside(path, allowedRoots, label);
}

function assertRealDirectoryInside(path, roots, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    fail(`${label} is missing or not a directory.`);
  }
  if (lstatSync(path).isSymbolicLink()) {
    fail(`${label} must not be a symbolic link.`);
  }
  const realPath = realpathSync(path);
  const rootList = Array.isArray(roots) ? roots : [roots];
  if (
    !rootList.some((candidateRoot) =>
      isInside(realPath, resolve(candidateRoot)),
    )
  ) {
    fail(`${label} is outside the allowed dependency source roots.`);
  }
}

function resolveSafeRepoPath(root, path) {
  assertSafeRelativePath(path, "repository path");
  return resolve(root, path);
}

function assertSafeRelativePath(path, label) {
  const parts =
    typeof path === "string" ? path.replaceAll("\\", "/").split("/") : [];
  if (
    typeof path !== "string" ||
    path === "" ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\0") ||
    parts.some((part) => part === ".." || part === "." || part === "")
  ) {
    fail(`${label} must be a safe repository-relative path.`);
  }
}

function isInside(path, root) {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function validateHttpsSourceUrl(value, label, { allowFragment = false } = {}) {
  const source = requireNonEmptyString(value, label);
  let url;
  try {
    url = new URL(source);
  } catch {
    fail(`${label} must be a valid HTTPS URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    (url.hash && !allowFragment)
  ) {
    fail(`${label} must be a credential-free immutable HTTPS URL.`);
  }
  return url.href;
}

function assertNoAbsolutePaths(text, root) {
  const normalizedRoot = root.replaceAll("\\", "/");
  if (
    text.replaceAll("\\", "/").includes(normalizedRoot) ||
    /"(?:[A-Za-z]:[\\/]|\/(?:home|Users|tmp|var)\/)/.test(text)
  ) {
    fail("Generated license manifest must not contain absolute local paths.");
  }
}

function displayComponent(component) {
  if (!isRecord(component)) {
    return "<malformed>";
  }
  return `${component.name ?? "<unknown>"}@${component.version ?? "<unknown>"}`;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  throw new Error(message);
}

export function formatContractError(error) {
  return error instanceof Error ? error.message : String(error);
}
