import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import {
  buildCargoCycloneDx,
  canonicalizeNpmCycloneDx,
  inspectCanonicalCargoCycloneDx,
  inspectCanonicalNpmCycloneDx,
} from "./release-sbom-contract.mjs";

const defaultRoot = resolve(import.meta.dirname, "..");
const { root } = parseArgs(process.argv.slice(2));
const rootPackage = readRootPackage();
const commandTimeoutMs = 15 * 60 * 1000;
const outputBufferBytes = 64 * 1024 * 1024;
const expectedSbomFiles = [
  {
    label: "Desktop npm CycloneDX SBOM",
    path: "reports/release/npm-desktop-sbom.cdx.json",
    validate: validateCycloneDxSbom,
  },
  {
    label: "Web Admin npm CycloneDX SBOM",
    path: "reports/release/npm-web-sbom.cdx.json",
    validate: validateCycloneDxSbom,
  },
  {
    boundary:
      "All non-development packages reachable from the Rust workspace members, including normal and build dependencies.",
    label: "Rust workspace Cargo CycloneDX SBOM",
    packageName: "atlasterm-rust-workspace",
    path: "reports/release/cargo-workspace-sbom.cdx.json",
    validate: validateCargoCycloneDxSbom,
  },
  {
    boundary:
      "All non-development packages reachable from the Tauri shell workspace members, including normal and build dependencies.",
    label: "Tauri shell Cargo CycloneDX SBOM",
    packageName: "atlasterm-tauri-shell",
    path: "reports/release/tauri-cargo-sbom.cdx.json",
    validate: validateCargoCycloneDxSbom,
  },
  {
    label: "Rust workspace cargo metadata",
    path: "reports/internal/release-inputs/cargo-metadata.json",
    privateInput: true,
    validate: validateCargoMetadata,
    requiredPackages: [
      "atlasterm-core",
      "atlasterm-sync",
      "axum",
      "russh",
      "russh-sftp",
      "serde",
      "tokio",
      "uuid",
    ],
  },
  {
    label: "Tauri shell cargo metadata",
    path: "reports/internal/release-inputs/tauri-cargo-metadata.json",
    privateInput: true,
    validate: validateCargoMetadata,
    requiredPackages: [
      "atlasterm-desktop-shell",
      "atlasterm-core",
      "russh",
      "russh-sftp",
      "serde",
      "tauri",
      "tokio",
      "uuid",
    ],
  },
];
const npmSourceBindings = [
  {
    label: "Desktop npm CycloneDX SBOM",
    path: "reports/release/npm-desktop-sbom.cdx.json",
    workspace: "@atlasterm/desktop",
  },
  {
    label: "Web Admin npm CycloneDX SBOM",
    path: "reports/release/npm-web-sbom.cdx.json",
    workspace: "@atlasterm/web",
  },
];
const cargoSourceBindings = [
  {
    boundary:
      "All non-development packages reachable from the Rust workspace members, including normal and build dependencies.",
    label: "Rust workspace Cargo CycloneDX SBOM",
    lockPath: "Cargo.lock",
    metadataLabel: "Rust workspace cargo metadata",
    metadataPath: "reports/internal/release-inputs/cargo-metadata.json",
    packageName: "atlasterm-rust-workspace",
    path: "reports/release/cargo-workspace-sbom.cdx.json",
    workingDirectory: ".",
  },
  {
    boundary:
      "All non-development packages reachable from the Tauri shell workspace members, including normal and build dependencies.",
    label: "Tauri shell Cargo CycloneDX SBOM",
    lockPath: "apps/desktop/src-tauri/Cargo.lock",
    metadataLabel: "Tauri shell cargo metadata",
    metadataPath: "reports/internal/release-inputs/tauri-cargo-metadata.json",
    packageName: "atlasterm-tauri-shell",
    path: "reports/release/tauri-cargo-sbom.cdx.json",
    workingDirectory: "apps/desktop/src-tauri",
  },
];
const checksumManifestPath = "reports/release/SBOM-SHA256SUMS.txt";
const errors = [];

for (const sbomFile of expectedSbomFiles) {
  validateSbomFile(sbomFile);
}
validateChecksumManifest();
validateSourceBindings();

if (errors.length > 0) {
  fail(`Release SBOM verification failed:\n- ${errors.join("\n- ")}`);
}

console.log(`Release SBOM verified for ${expectedSbomFiles.length} file(s).`);

function validateSourceBindings() {
  for (const binding of npmSourceBindings) {
    validateNpmSourceBinding(binding);
  }
  for (const binding of cargoSourceBindings) {
    validateCargoSourceBinding(binding);
  }
}

function validateNpmSourceBinding({ label, path, workspace }) {
  const published = readSourceFile(path, label);
  if (!published) {
    return;
  }
  if (!readSourceFile("package-lock.json", "Root package-lock.json")) {
    return;
  }

  const current = runSourceCommand({
    args: [
      "sbom",
      "--workspace",
      workspace,
      "--sbom-format",
      "cyclonedx",
      "--package-lock-only",
      "--json",
    ],
    command: "npm",
    label: `${label} package-lock regeneration`,
    workingDirectory: root,
  });
  if (!current) {
    return;
  }

  let expected;
  try {
    expected = canonicalizeNpmCycloneDx(current, {
      label,
      packageName: rootPackage.name,
      rootPath: root,
    });
  } catch (error) {
    errors.push(
      `${label} could not be regenerated from the current package-lock.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  if (!published.equals(Buffer.from(expected, "utf8"))) {
    errors.push(
      `${label} dependency graph does not match the current package-lock.json; rerun npm run release:sbom`,
    );
  }
}

function validateCargoSourceBinding({
  boundary,
  label,
  lockPath,
  metadataLabel,
  metadataPath,
  packageName,
  path,
  workingDirectory,
}) {
  const published = readSourceFile(path, label);
  const storedMetadata = readSourceFile(metadataPath, metadataLabel);
  const lock = readSourceFile(lockPath, `${label} Cargo.lock`);
  if (!published || !storedMetadata || !lock) {
    return;
  }

  const currentMetadata = runSourceCommand({
    args: ["metadata", "--format-version", "1", "--locked"],
    command: "cargo",
    label: `${metadataLabel} regeneration`,
    workingDirectory: resolve(root, workingDirectory),
  });
  if (!currentMetadata) {
    return;
  }

  let currentMetadataComparison;
  let storedMetadataComparison;
  try {
    currentMetadataComparison = comparableJson(
      currentMetadata,
      `${metadataLabel} regenerated output`,
    );
    storedMetadataComparison = comparableJson(storedMetadata, metadataLabel);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return;
  }
  if (currentMetadataComparison !== storedMetadataComparison) {
    errors.push(
      `${metadataLabel} is stale relative to the current Cargo manifests and lockfile; rerun npm run release:sbom`,
    );
  }

  let expected;
  try {
    expected = buildCargoCycloneDx(currentMetadata, lock, {
      boundary,
      label,
      packageName,
      packageVersion: rootPackage.version,
      rootPath: root,
    });
  } catch (error) {
    errors.push(
      `${label} could not be regenerated from the current Cargo metadata and lockfile: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  if (!published.equals(Buffer.from(expected, "utf8"))) {
    errors.push(
      `${label} dependency graph does not match the current Cargo metadata and lockfile; rerun npm run release:sbom`,
    );
  }
}

function readSourceFile(relativePath, label) {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    errors.push(`${label} source input is missing: ${relativePath}`);
    return null;
  }
  if (!statSync(path).isFile()) {
    errors.push(`${label} source input is not a file: ${relativePath}`);
    return null;
  }
  return readFileSync(path);
}

function runSourceCommand({ args, command, label, workingDirectory }) {
  const result = spawnSync(command, args, {
    cwd: workingDirectory,
    maxBuffer: outputBufferBytes,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  if (result.status === 0 && !result.error) {
    return result.stdout;
  }

  const diagnostic = [
    result.error?.message,
    result.stderr?.toString("utf8").trim(),
  ]
    .filter(Boolean)
    .join("\n");
  errors.push(
    `${label} failed${diagnostic ? `: ${diagnostic.slice(-4_000)}` : ""}`,
  );
  return null;
}

function comparableJson(input, label) {
  let json;
  try {
    json = JSON.parse(input.toString("utf8"));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  return JSON.stringify(sortJsonValue(json));
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

function validateSbomFile({
  boundary,
  label,
  packageName,
  path,
  validate,
  requiredPackages,
}) {
  const fullPath = resolve(root, path);
  if (!existsSync(fullPath)) {
    errors.push(`${label} is missing: ${path}`);
    return;
  }
  if (!statSync(fullPath).isFile()) {
    errors.push(`${label} is not a file: ${path}`);
    return;
  }

  const bytes = readFileSync(fullPath);
  let json;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    errors.push(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  validate(label, json, {
    boundary,
    bytes,
    packageName,
    requiredPackages,
  });
}

function validateCycloneDxSbom(label, json, { bytes }) {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    errors.push(`${label} must be a JSON object`);
    return;
  }
  if (json.bomFormat !== "CycloneDX") {
    errors.push(`${label} must use CycloneDX format`);
  }
  if (typeof json.specVersion !== "string" || json.specVersion.trim() === "") {
    errors.push(`${label} must include a CycloneDX specVersion`);
  }
  if (!Array.isArray(json.components) || json.components.length === 0) {
    errors.push(`${label} must include at least one component`);
  }
  if (
    json.metadata === null ||
    typeof json.metadata !== "object" ||
    Array.isArray(json.metadata)
  ) {
    errors.push(`${label} must include metadata`);
  }
  errors.push(
    ...inspectCanonicalNpmCycloneDx(bytes, {
      label,
      packageName: rootPackage.name,
      rootPath: root,
    }),
  );
}

function validateCargoMetadata(label, json, { requiredPackages = [] } = {}) {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    errors.push(`${label} must be a JSON object`);
    return;
  }
  if (!Array.isArray(json.packages) || json.packages.length === 0) {
    errors.push(`${label} must include at least one package`);
  }
  if (
    !Array.isArray(json.workspace_members) ||
    json.workspace_members.length === 0
  ) {
    errors.push(`${label} must include workspace_members`);
  }
  if (json.version !== 1) {
    errors.push(`${label} must use cargo metadata format version 1`);
  }
  if (Array.isArray(json.packages) && Array.isArray(json.workspace_members)) {
    if (json.packages.length <= json.workspace_members.length) {
      errors.push(
        `${label} must include third-party dependency packages; rerun cargo metadata without --no-deps`,
      );
    }

    const packageNames = new Set(
      json.packages
        .map((packageEntry) => {
          if (
            packageEntry !== null &&
            typeof packageEntry === "object" &&
            typeof packageEntry.name === "string"
          ) {
            return packageEntry.name;
          }
          return "";
        })
        .filter(Boolean),
    );
    const missingPackages = requiredPackages.filter(
      (packageName) => !packageNames.has(packageName),
    );
    if (missingPackages.length > 0) {
      errors.push(
        `${label} is missing expected package(s): ${missingPackages.join(", ")}`,
      );
    }
  }
}

function validateChecksumManifest() {
  const manifestPath = resolve(root, checksumManifestPath);
  if (!existsSync(manifestPath)) {
    errors.push(`SBOM checksum manifest is missing: ${checksumManifestPath}`);
    return;
  }
  if (!statSync(manifestPath).isFile()) {
    errors.push(
      `SBOM checksum manifest is not a file: ${checksumManifestPath}`,
    );
    return;
  }

  const manifestEntries = parseChecksumManifest(manifestPath);
  const entryPaths = new Set(manifestEntries.map((entry) => entry.path));
  const publicSbomPaths = expectedSbomFiles
    .filter(({ privateInput }) => !privateInput)
    .map(({ path }) => path);
  const allowedPublicPaths = new Set(publicSbomPaths);
  const extraPaths = [...entryPaths].filter(
    (path) => !allowedPublicPaths.has(path),
  );
  if (extraPaths.length > 0) {
    errors.push(
      `SBOM checksum manifest contains non-public or unexpected artifact(s): ${extraPaths.join(", ")}`,
    );
  }
  for (const { path, privateInput } of expectedSbomFiles) {
    if (privateInput) {
      continue;
    }
    if (!entryPaths.has(path)) {
      errors.push(`SBOM checksum manifest is missing ${path}`);
    }
  }

  for (const entry of manifestEntries) {
    const fullPath = resolve(root, entry.path);
    if (!existsSync(fullPath)) {
      errors.push(
        `${checksumManifestPath} references missing file ${entry.path}`,
      );
      continue;
    }
    const actualHash = sha256(fullPath);
    if (actualHash.toLowerCase() !== entry.hash.toLowerCase()) {
      errors.push(`${checksumManifestPath} hash mismatch for ${entry.path}`);
    }
  }
}

function parseChecksumManifest(path) {
  const entries = [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      return;
    }

    const match = line.match(/^([a-fA-F0-9]{64})\s\s(.+)$/);
    if (!match) {
      errors.push(
        `${checksumManifestPath}:${lineNumber} is not '<sha256>  <relative-path>'`,
      );
      return;
    }

    const artifactPath = match[2].replaceAll("\\", "/");
    if (isAbsolute(artifactPath)) {
      errors.push(
        `${checksumManifestPath}:${lineNumber} uses an absolute path`,
      );
      return;
    }

    const fullPath = resolve(root, artifactPath);
    if (!isInsideRoot(fullPath)) {
      errors.push(
        `${checksumManifestPath}:${lineNumber} escapes the release root`,
      );
      return;
    }

    entries.push({
      hash: match[1],
      path: relative(root, fullPath).replace(/\\/g, "/"),
    });
  });
  return entries;
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function validateCargoCycloneDxSbom(
  label,
  _json,
  { boundary, bytes, packageName },
) {
  errors.push(
    ...inspectCanonicalCargoCycloneDx(bytes, {
      boundary,
      label,
      packageName,
      packageVersion: rootPackage.version,
      rootPath: root,
    }),
  );
}

function readRootPackage() {
  const path = resolve(root, "package.json");
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail("Root package.json is missing.");
  }
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(
      `Root package.json is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    packageJson === null ||
    typeof packageJson !== "object" ||
    Array.isArray(packageJson) ||
    typeof packageJson.name !== "string" ||
    packageJson.name.trim() === "" ||
    typeof packageJson.version !== "string" ||
    packageJson.version.trim() === ""
  ) {
    fail("Root package.json name/version must be non-empty strings.");
  }
  return packageJson;
}

function parseArgs(args) {
  let root = defaultRoot;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      const value = args[index + 1];
      if (!value) {
        fail("--root requires a path.");
      }
      root = resolve(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return { root };
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
