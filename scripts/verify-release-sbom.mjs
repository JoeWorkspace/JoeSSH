import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { assertReportOutput, validateCargoInventory, validateNpmInventory, validateSbomBinding } from "./release-sbom-lib.mjs";
import { validateLicenseInventory } from "./release-license-lib.mjs";

const defaultRoot = resolve(import.meta.dirname, "..");
const { root, output } = parseArgs(process.argv.slice(2));
const outputDir = assertReportOutput(root, output);
const outputPath = relative(root, outputDir).replaceAll("\\", "/");
const expectedSbomFiles = [
  {
    label: "Desktop npm CycloneDX SBOM",
    path: "reports/release/npm-desktop-sbom.cdx.json",
    validate: validateCycloneDxSbom,
    workspace: "desktop",
  },
  {
    label: "Web Admin npm CycloneDX SBOM",
    path: "reports/release/npm-web-sbom.cdx.json",
    validate: validateCycloneDxSbom,
    workspace: "web",
  },
  {
    label: "Rust workspace cargo metadata",
    path: "reports/release/cargo-metadata.json",
    validate: validateCargoMetadata,
    lockfile: "Cargo.lock",
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
    path: "reports/release/tauri-cargo-metadata.json",
    validate: validateCargoMetadata,
    lockfile: "apps/desktop/src-tauri/Cargo.lock",
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
for (const entry of expectedSbomFiles) entry.path = entry.path.replace("reports/release/", `${outputPath}/`);
const checksumManifestPath = `${outputPath}/SBOM-SHA256SUMS.txt`;
const errors = [];
const documents = {};
let licenseFiles = [];

for (const sbomFile of expectedSbomFiles) {
  validateSbomFile(sbomFile);
}
try {
  if (Object.keys(documents).length === 4) licenseFiles = validateLicenseInventory(root, outputDir, documents);
} catch (error) { errors.push(`Third-party license verification failed: ${error.message}`); }
validateChecksumManifest();

if (errors.length > 0) {
  fail(`Release SBOM verification failed:\n- ${errors.join("\n- ")}`);
}

console.log(`Release SBOM verified for ${expectedSbomFiles.length} file(s).`);

function validateSbomFile({ label, path, validate, requiredPackages, workspace, lockfile }) {
  const fullPath = resolve(root, path);
  try { assertReportOutput(root, fullPath); } catch (error) { errors.push(`${label}: ${error.message}`); return; }
  if (!existsSync(fullPath)) {
    errors.push(`${label} is missing: ${path}`);
    return;
  }
  if (!statSync(fullPath).isFile()) {
    errors.push(`${label} is not a file: ${path}`);
    return;
  }

  let json;
  try {
    json = JSON.parse(readFileSync(fullPath, "utf8"));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  validate(label, json, { requiredPackages });
  documents[basename(path)] = json;
  try {
    validateSbomBinding(json, root, workspace ? "npm" : "cargo");
    if (workspace) validateNpmInventory(json, root, workspace);
    else validateCargoInventory(json, root, lockfile);
  } catch (error) { errors.push(`${label}: ${error.message}`); }
}

function validateCycloneDxSbom(label, json) {
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
  if (json.metadata === null || typeof json.metadata !== "object" || Array.isArray(json.metadata)) {
    errors.push(`${label} must include metadata`);
  }
}

function validateCargoMetadata(label, json, { requiredPackages = [] } = {}) {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    errors.push(`${label} must be a JSON object`);
    return;
  }
  if (!Array.isArray(json.packages) || json.packages.length === 0) {
    errors.push(`${label} must include at least one package`);
  }
  if (!Array.isArray(json.workspace_members) || json.workspace_members.length === 0) {
    errors.push(`${label} must include workspace_members`);
  }
  if (json.version !== 1) {
    errors.push(`${label} must use cargo metadata format version 1`);
  }
  if (Array.isArray(json.packages) && Array.isArray(json.workspace_members)) {
    if (json.packages.length <= json.workspace_members.length) {
      errors.push(`${label} must include third-party dependency packages; rerun cargo metadata without --no-deps`);
    }

    const packageNames = new Set(
      json.packages
        .map((packageEntry) => {
          if (packageEntry !== null && typeof packageEntry === "object" && typeof packageEntry.name === "string") {
            return packageEntry.name;
          }
          return "";
        })
        .filter(Boolean),
    );
    const missingPackages = requiredPackages.filter((packageName) => !packageNames.has(packageName));
    if (missingPackages.length > 0) {
      errors.push(`${label} is missing expected package(s): ${missingPackages.join(", ")}`);
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
    errors.push(`SBOM checksum manifest is not a file: ${checksumManifestPath}`);
    return;
  }

  const manifestEntries = parseChecksumManifest(manifestPath);
  const entryPaths = new Set(manifestEntries.map((entry) => entry.path));
  for (const { path } of expectedSbomFiles) {
    if (!entryPaths.has(path)) {
      errors.push(`SBOM checksum manifest is missing ${path}`);
    }
  }
  for (const name of licenseFiles) {
    if (!entryPaths.has(`${outputPath}/${name}`)) errors.push(`SBOM checksum manifest is missing ${outputPath}/${name}`);
  }

  for (const entry of manifestEntries) {
    const fullPath = resolve(root, entry.path);
    try { assertReportOutput(root, fullPath); } catch (error) { errors.push(`${checksumManifestPath}: ${error.message}`); continue; }
    if (!existsSync(fullPath)) {
      errors.push(`${checksumManifestPath} references missing file ${entry.path}`);
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
      errors.push(`${checksumManifestPath}:${lineNumber} is not '<sha256>  <relative-path>'`);
      return;
    }

    const artifactPath = match[2].replaceAll("\\", "/");
    if (isAbsolute(artifactPath)) {
      errors.push(`${checksumManifestPath}:${lineNumber} uses an absolute path`);
      return;
    }

    const fullPath = resolve(root, artifactPath);
    if (!isInsideRoot(fullPath)) {
      errors.push(`${checksumManifestPath}:${lineNumber} escapes the release root`);
      return;
    }

    entries.push({ hash: match[1], path: relative(root, fullPath).replace(/\\/g, "/") });
  });
  return entries;
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function parseArgs(args) {
  let root = defaultRoot;
  let output = "reports/release";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output-dir") {
      if (!args[index + 1]) fail("--output-dir requires a path.");
      output = args[++index];
      continue;
    }
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

  return { root, output };
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
