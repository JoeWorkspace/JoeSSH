import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const { bundleDir, outputDir, platform, root, sourceCommit } = parseArgs(
  process.argv.slice(2),
);

assertInsideRoot(bundleDir, "Desktop bundle directory");
assertInsideRoot(outputDir, "Candidate output directory");
if (bundleDir === root) {
  fail("Desktop bundle directory cannot be the repository root.");
}
if (outputDir === root) {
  fail("Candidate output directory cannot be the repository root.");
}
if (
  isInsideOrEqual(bundleDir, outputDir) ||
  isInsideOrEqual(outputDir, bundleDir)
) {
  fail("Desktop bundle and candidate output directories cannot overlap.");
}

const version = readAlignedVersion();
const sourceArtifacts = collectFiles(bundleDir)
  .map((path) => ({ path, platform: classifyPlatform(path) }))
  .filter((artifact) => artifact.platform === platform)
  .sort((left, right) => left.path.localeCompare(right.path));

if (sourceArtifacts.length === 0) {
  fail(
    `No ${platform} Desktop bundle artifacts found in ${displayPath(bundleDir)}.`,
  );
}
for (const artifact of sourceArtifacts) {
  if (statSync(artifact.path).size === 0) {
    fail(`Desktop candidate artifact is empty: ${displayPath(artifact.path)}.`);
  }
}

rmSync(outputDir, { force: true, recursive: true });
mkdirSync(outputDir, { recursive: true });

const destinationNames = new Set();
const artifacts = sourceArtifacts.map(({ path }) => {
  const name = basename(path);
  if (destinationNames.has(name)) {
    fail(`Desktop candidate bundle contains duplicate file name: ${name}`);
  }
  destinationNames.add(name);
  const destination = resolve(outputDir, name);
  copyFileSync(path, destination);
  return {
    bytes: statSync(destination).size,
    name,
    sha256: sha256(destination),
  };
});

const metadataPath = resolve(outputDir, "candidate-metadata.json");
const metadata = {
  artifacts,
  generatedAt: new Date().toISOString(),
  platform,
  product: "JoeSSH Community",
  releaseEligible: false,
  schemaVersion: 1,
  signingStatus: "unverified",
  sourceCommit,
  version,
};
writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

const checksumEntries = [
  ...artifacts.map(({ name, sha256: digest }) => ({ name, sha256: digest })),
  { name: basename(metadataPath), sha256: sha256(metadataPath) },
].sort((left, right) => left.name.localeCompare(right.name));
writeFileSync(
  resolve(outputDir, "SHA256SUMS.txt"),
  `${checksumEntries.map((entry) => `${entry.sha256}  ${entry.name}`).join("\n")}\n`,
);

console.log(
  `Staged ${artifacts.length} unsigned ${platform} Desktop candidate artifact(s) in ${displayPath(outputDir)}.`,
);
console.log(
  "These artifacts are not eligible for a public release until formal signing evidence is imported and verified.",
);

function readAlignedVersion() {
  const packagePath = resolve(root, "package.json");
  const tauriPath = resolve(root, "apps/desktop/src-tauri/tauri.conf.json");
  const packageVersion = readJson(packagePath).version;
  const tauriVersion = readJson(tauriPath).version;
  if (typeof packageVersion !== "string" || !packageVersion) {
    fail("package.json must contain a non-empty version.");
  }
  if (tauriVersion !== packageVersion) {
    fail(
      `Desktop candidate version mismatch: package.json=${String(packageVersion)}, tauri.conf.json=${String(tauriVersion)}.`,
    );
  }
  return packageVersion;
}

function readJson(path) {
  if (!existsSync(path)) {
    fail(`Missing required metadata file: ${displayPath(path)}.`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(
      `Unable to parse ${displayPath(path)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function collectFiles(path) {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return collectFiles(child);
    return entry.isFile() ? [child] : [];
  });
}

function classifyPlatform(path) {
  const lower = path.toLowerCase();
  if (/\.(exe|msi|msix)$/.test(lower)) return "windows";
  if (
    lower.endsWith(".dmg") ||
    lower.endsWith(".pkg") ||
    lower.endsWith(".app.tar.gz")
  )
    return "macos";
  if (
    lower.endsWith(".appimage") ||
    lower.endsWith(".deb") ||
    lower.endsWith(".rpm")
  )
    return "linux";
  return null;
}

function parseArgs(args) {
  let root = defaultRoot;
  let bundlePath = "apps/desktop/src-tauri/target/release/bundle";
  let outputPath;
  let platform;
  let sourceCommit;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      root = resolve(readValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
    } else if (arg === "--bundle-dir") {
      bundlePath = readValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--bundle-dir=")) {
      bundlePath = arg.slice("--bundle-dir=".length);
    } else if (arg === "--output-dir") {
      outputPath = readValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--output-dir=")) {
      outputPath = arg.slice("--output-dir=".length);
    } else if (arg === "--platform") {
      platform = readValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--platform=")) {
      platform = arg.slice("--platform=".length);
    } else if (arg === "--source-commit") {
      sourceCommit = readValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--source-commit=")) {
      sourceCommit = arg.slice("--source-commit=".length);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (!["windows", "macos", "linux"].includes(platform)) {
    fail("--platform must be one of windows, macos, or linux.");
  }
  if (sourceCommit !== undefined && !/^[a-f0-9]{40}$/i.test(sourceCommit)) {
    fail("--source-commit must be a 40-character Git commit SHA.");
  }
  sourceCommit = sourceCommit?.toLowerCase() ?? null;
  outputPath ??= `reports/candidates/desktop/${platform}-unsigned`;
  return {
    bundleDir: resolve(root, bundlePath),
    outputDir: resolve(root, outputPath),
    platform,
    root,
    sourceCommit,
  };
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${flag} requires a value.`);
  return value;
}

function assertInsideRoot(path, label) {
  const relativePath = relative(root, path);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    fail(`${label} must stay inside the repository root.`);
  }
}

function isInsideOrEqual(parent, child) {
  const relativePath = relative(parent, child);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function displayPath(path) {
  return relative(root, path).replace(/\\/g, "/") || basename(path);
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
