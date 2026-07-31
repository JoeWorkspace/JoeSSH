import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { buildCargoCycloneDx } from "./release-sbom-contract.mjs";
import {
  buildPublishedThirdPartyPackageIdentities,
  buildThirdPartyLicenseInputEvidence,
  renderThirdPartyNotices,
} from "./third-party-license-contract.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const fixtureProductLicense =
  "MIT License\n\nCopyright (c) 2026 JoeSSH contributors\n\nFixture product permission text.\n";
const staticLicenseInputPaths = [
  "scripts/third-party-license-fallbacks.json",
  "scripts/spdx-license-texts/v3.28.0/Apache-2.0.txt",
  "scripts/spdx-license-texts/v3.28.0/BSD-3-Clause.txt",
  "scripts/spdx-license-texts/v3.28.0/MIT.txt",
  "scripts/spdx-license-texts/v3.28.0/MPL-2.0.txt",
];
const rustBoundary =
  "All non-development packages reachable from the Rust workspace members, including normal and build dependencies.";
const tauriBoundary =
  "All non-development packages reachable from the Tauri shell workspace members, including normal and build dependencies.";
const cargoLockFixture = `version = 4

[[package]]
name = "example-dependency"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${"a".repeat(64)}"
`;
const tauriCargoLockFixture = `${cargoLockFixture}
[[package]]
name = "tauri"
version = "2.8.5"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${"b".repeat(64)}"
`;

export function canonicalNpmSbomFixture(name) {
  const dependencyName = `${name}-dependency`;
  const lockEntry = canonicalNpmPackageLockEntryFixture(dependencyName);
  const digest = Buffer.from(
    lockEntry.integrity.slice("sha512-".length),
    "base64",
  );
  return stableJson({
    bomFormat: "CycloneDX",
    components: [
      {
        "bom-ref": `${dependencyName}@${lockEntry.version}`,
        externalReferences: [{ type: "distribution", url: lockEntry.resolved }],
        hashes: [{ alg: "SHA-512", content: digest.toString("hex") }],
        licenses: [{ license: { id: lockEntry.license } }],
        name: dependencyName,
        properties: [
          {
            name: "cdx:npm:package:path",
            value: `node_modules/${dependencyName}`,
          },
        ],
        purl: `pkg:npm/${dependencyName}@${lockEntry.version}`,
        scope: "required",
        type: "library",
        version: lockEntry.version,
      },
    ],
    metadata: { component: { name: "atlasterm" } },
    specVersion: "1.5",
    version: 1,
  });
}

export function canonicalNpmPackageLockEntryFixture(name) {
  return {
    integrity: `sha512-${Buffer.alloc(64, name.length).toString("base64")}`,
    license: "MIT",
    resolved: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
    version: "1.0.0",
  };
}

export function canonicalCargoSbomFixture(
  packageName,
  boundary,
  version = "0.1.0-beta.1",
) {
  const rootReference = `pkg:generic/${packageName}@${version}`;
  const componentReference = "pkg:cargo/example-dependency@1.0.0";
  return stableJson({
    $schema: "http://cyclonedx.org/schema/bom-1.5.schema.json",
    bomFormat: "CycloneDX",
    components: [
      {
        "bom-ref": componentReference,
        hashes: [{ alg: "SHA-256", content: "a".repeat(64) }],
        licenses: [{ expression: "MIT" }],
        name: "example-dependency",
        properties: [
          {
            name: "joessh:cargo:source",
            value: "registry+https://github.com/rust-lang/crates.io-index",
          },
        ],
        purl: componentReference,
        scope: "required",
        type: "library",
        version: "1.0.0",
      },
    ],
    dependencies: [
      { dependsOn: [componentReference], ref: rootReference },
      { dependsOn: [], ref: componentReference },
    ],
    metadata: {
      component: {
        "bom-ref": rootReference,
        name: packageName,
        properties: [
          {
            name: "joessh:cargo:dependency-boundary",
            value: boundary,
          },
        ],
        purl: rootReference,
        type: "application",
        version,
      },
    },
    specVersion: "1.5",
    version: 1,
  });
}

export function writeSourceBoundReleaseSbomFixture(root) {
  const resolvedRoot = resolve(root);
  const packageJson = JSON.parse(
    readFileSync(resolve(resolvedRoot, "package.json"), "utf8"),
  );
  const packageName = packageJson.name ?? "atlasterm";
  const version = packageJson.version;
  const rustMetadata = cargoMetadataFixture({
    packageNames: [
      "atlasterm-core",
      "atlasterm-sync",
      "example-dependency",
      "axum",
      "russh",
      "russh-sftp",
      "serde",
      "tokio",
      "uuid",
    ],
    version,
    workspacePackageNames: ["atlasterm-core", "atlasterm-sync"],
  });
  const tauriMetadata = cargoMetadataFixture({
    packageNames: [
      "atlasterm-desktop-shell",
      "atlasterm-core",
      "example-dependency",
      "russh",
      "russh-sftp",
      "serde",
      "tauri",
      "tokio",
      "uuid",
    ],
    version,
    workspacePackageNames: ["atlasterm-desktop-shell"],
  });
  const publicSboms = [
    [
      "reports/release/npm-desktop-sbom.cdx.json",
      canonicalNpmSbomFixture("desktop"),
    ],
    ["reports/release/npm-web-sbom.cdx.json", canonicalNpmSbomFixture("web")],
    [
      "reports/release/cargo-workspace-sbom.cdx.json",
      buildCargoCycloneDx(rustMetadata, cargoLockFixture, {
        boundary: rustBoundary,
        packageName: "atlasterm-rust-workspace",
        packageVersion: version,
        rootPath: resolvedRoot,
      }),
    ],
    [
      "reports/release/tauri-cargo-sbom.cdx.json",
      buildCargoCycloneDx(tauriMetadata, cargoLockFixture, {
        boundary: tauriBoundary,
        packageName: "atlasterm-tauri-shell",
        packageVersion: version,
        rootPath: resolvedRoot,
      }),
    ],
  ];

  writeFixtureFile(
    resolvedRoot,
    "package-lock.json",
    `${JSON.stringify(
      {
        lockfileVersion: 3,
        name: packageName,
        packages: {
          "": { name: packageName, version },
          "node_modules/@tauri-apps/api": { version: "2.5.0" },
          "node_modules/@tauri-apps/cli": { version: "2.11.3" },
          "node_modules/desktop-dependency":
            canonicalNpmPackageLockEntryFixture("desktop-dependency"),
          "node_modules/web-dependency":
            canonicalNpmPackageLockEntryFixture("web-dependency"),
        },
        requires: true,
        version,
      },
      null,
      2,
    )}\n`,
  );
  writeFixtureFile(resolvedRoot, "Cargo.lock", cargoLockFixture);
  writeFixtureFile(
    resolvedRoot,
    "apps/desktop/src-tauri/Cargo.lock",
    tauriCargoLockFixture,
  );
  writeFixtureFile(
    resolvedRoot,
    "reports/internal/release-inputs/cargo-metadata.json",
    rustMetadata,
  );
  writeFixtureFile(
    resolvedRoot,
    "reports/internal/release-inputs/tauri-cargo-metadata.json",
    tauriMetadata,
  );
  for (const [path, content] of publicSboms) {
    writeFixtureFile(resolvedRoot, path, content);
  }
  writeFixtureFile(
    resolvedRoot,
    "reports/release/SBOM-SHA256SUMS.txt",
    `${publicSboms
      .map(([path, content]) => `${sha256(content)}  ${path}`)
      .join("\n")}\n`,
  );
  writeSourceBoundSbomCommands(resolvedRoot);
}

export function sourceBoundReleaseSbomEnvironment(root, baseEnv = process.env) {
  const env = { ...baseEnv };
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  env[pathKey] =
    `${resolve(root, ".test-sbom-bin")}${delimiter}${env[pathKey] ?? ""}`;
  env.JOESSH_SBOM_TEST_ROOT = resolve(root);
  return env;
}

export function publishedLicenseBundleFixture(options = {}) {
  const normalizedOptions =
    typeof options === "string" ? { version: options } : options;
  const root = normalizedOptions.root
    ? resolve(normalizedOptions.root)
    : undefined;
  const version =
    normalizedOptions.version ??
    (root
      ? JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version
      : "0.1.0-beta.1");
  const productText = root
    ? normalizeText(readFileSync(resolve(root, "LICENSE"), "utf8"))
    : fixtureProductLicense;
  const dependencyText =
    "MIT License\n\nCopyright (c) Fixture Dependency\n\nFixture dependency permission text.\n";
  const productHash = sha256(productText);
  const dependencyHash = sha256(dependencyText);
  const packageIdentities = root
    ? buildPublishedThirdPartyPackageIdentities(root)
    : [
        {
          declaredLicense: "MIT",
          ecosystem: "npm",
          integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
          name: "fixture-dependency",
          scopes: ["desktop-npm"],
          source:
            "https://registry.npmjs.org/fixture-dependency/-/fixture-dependency-1.0.0.tgz",
          version: "1.0.0",
        },
      ];
  const manifest = {
    schemaVersion: 1,
    product: "JoeSSH",
    version,
    dependencyBoundary: {},
    licensePolicy: {},
    inputs: root ? buildThirdPartyLicenseInputEvidence(root) : [],
    productLicense: {
      declaredLicense: "MIT",
      licenseText: {
        kind: "product",
        sha256: productHash,
        sourceFile: "LICENSE",
      },
    },
    packages: packageIdentities.map((identity) => ({
      ...identity,
      ...(identity.ecosystem === "cargo"
        ? { attribution: { authors: [], repository: null } }
        : {}),
      licenseTexts: [
        {
          kind: "upstream",
          sha256: dependencyHash,
          sourceFile: "LICENSE",
        },
      ],
      notices: [],
    })),
    texts: [
      { sha256: dependencyHash, content: dependencyText },
      { sha256: productHash, content: productText },
    ].sort((left, right) => left.sha256.localeCompare(right.sha256)),
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const noticesText = renderThirdPartyNotices(manifest);
  return { manifestText, noticesText };
}

export function writePublishedLicenseSourceInputFixture(root) {
  const resolvedRoot = resolve(root);
  writeFixtureFile(resolvedRoot, "LICENSE", fixtureProductLicense);
  for (const path of staticLicenseInputPaths.slice(1)) {
    const destination = resolve(resolvedRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(repositoryRoot, path), destination);
  }
  const fallbackPolicy = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, "scripts/third-party-license-fallbacks.json"),
      "utf8",
    ),
  );
  fallbackPolicy.reviewedFallbacks = [];
  writeFixtureFile(
    resolvedRoot,
    "scripts/third-party-license-fallbacks.json",
    stableJson(fallbackPolicy),
  );
}

function stableJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function cargoMetadataFixture({
  packageNames,
  version,
  workspacePackageNames,
}) {
  const registrySource =
    "registry+https://github.com/rust-lang/crates.io-index";
  const localPackageNames = new Set([
    ...workspacePackageNames,
    "atlasterm-core",
  ]);
  const packageIds = new Map(
    packageNames.map((name) => {
      const packageVersion = localPackageNames.has(name) ? version : "1.0.0";
      const id = localPackageNames.has(name)
        ? `path+file:///fixture/${name}#${name}@${packageVersion}`
        : `${registrySource}#${name}@${packageVersion}`;
      return [name, id];
    }),
  );
  const dependenciesFor = (name) => {
    const dependencyNames = [];
    if (
      name === "atlasterm-desktop-shell" &&
      packageIds.has("atlasterm-core")
    ) {
      dependencyNames.push("atlasterm-core");
    }
    if (
      (name === "atlasterm-core" || name === "atlasterm-sync") &&
      packageIds.has("example-dependency")
    ) {
      dependencyNames.push("example-dependency");
    }
    return dependencyNames.map((dependencyName) => ({
      dep_kinds: [{ kind: null }],
      pkg: packageIds.get(dependencyName),
    }));
  };
  return `${JSON.stringify({
    packages: packageNames.map((name) => ({
      id: packageIds.get(name),
      license: "MIT",
      name,
      source: localPackageNames.has(name) ? null : registrySource,
      version: localPackageNames.has(name) ? version : "1.0.0",
    })),
    resolve: {
      nodes: packageNames.map((name) => ({
        deps: dependenciesFor(name),
        id: packageIds.get(name),
      })),
    },
    version: 1,
    workspace_members: workspacePackageNames.map((name) =>
      packageIds.get(name),
    ),
  })}\n`;
}

function writeSourceBoundSbomCommands(root) {
  const binDirectory = resolve(root, ".test-sbom-bin");
  const runnerPath = resolve(binDirectory, "source-command.mjs");
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(
    runnerPath,
    `import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [kind, ...args] = process.argv.slice(2);
const root = process.env.JOESSH_SBOM_TEST_ROOT;
if (!root) {
  throw new Error("JOESSH_SBOM_TEST_ROOT is required.");
}

if (kind === "npm") {
  const workspaceIndex = args.indexOf("--workspace");
  const workspace = workspaceIndex >= 0 ? args[workspaceIndex + 1] : "";
  const target = workspace.endsWith("/desktop")
    ? "desktop"
    : workspace.endsWith("/web")
      ? "web"
      : "";
  if (!target) {
    throw new Error("Unexpected npm SBOM workspace: " + workspace);
  }
  const dependencyName = target + "-dependency";
  const packageLock = JSON.parse(
    readFileSync(resolve(root, "package-lock.json"), "utf8"),
  );
  const dependency = packageLock.packages["node_modules/" + dependencyName];
  if (!dependency || typeof dependency.version !== "string") {
    throw new Error("Fixture package-lock is missing " + dependencyName);
  }
  const digest = Buffer.from(
    dependency.integrity.slice("sha512-".length),
    "base64",
  );
  process.stdout.write(
    JSON.stringify({
      bomFormat: "CycloneDX",
      components: [
        {
          "bom-ref": dependencyName + "@" + dependency.version,
          externalReferences: [
            { type: "distribution", url: dependency.resolved },
          ],
          hashes: [{ alg: "SHA-512", content: digest.toString("hex") }],
          licenses: [{ license: { id: dependency.license } }],
          name: dependencyName,
          properties: [
            {
              name: "cdx:npm:package:path",
              value: "node_modules/" + dependencyName,
            },
          ],
          purl: "pkg:npm/" + dependencyName + "@" + dependency.version,
          scope: "required",
          type: "library",
          version: dependency.version,
        },
      ],
      metadata: { component: { name: packageLock.name } },
      specVersion: "1.5",
      version: 1,
    }),
  );
} else if (kind === "cargo") {
  const normalizedCwd = process.cwd().replaceAll("\\\\", "/");
  const metadataPath = normalizedCwd.endsWith("/apps/desktop/src-tauri")
    ? "reports/internal/release-inputs/tauri-cargo-metadata.json"
    : "reports/internal/release-inputs/cargo-metadata.json";
  process.stdout.write(readFileSync(resolve(root, metadataPath)));
} else {
  throw new Error("Unexpected fixture command: " + kind);
}
`,
    "utf8",
  );

  for (const command of ["npm", "cargo"]) {
    if (process.platform === "win32") {
      writeFileSync(
        resolve(binDirectory, `${command}.cmd`),
        `@echo off\r\n"${process.execPath}" "${runnerPath}" ${command} %*\r\n`,
        "utf8",
      );
      continue;
    }
    const commandPath = resolve(binDirectory, command);
    writeFileSync(
      commandPath,
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(runnerPath)} ${command} "$@"\n`,
      "utf8",
    );
    chmodSync(commandPath, 0o755);
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeText(value) {
  return `${value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trimEnd()}\n`;
}

function writeFixtureFile(root, path, content) {
  const destination = resolve(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}
