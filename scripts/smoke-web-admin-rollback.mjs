import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const verifierPath = resolve(import.meta.dirname, "verify-web-release-package.mjs");
const {
  currentArtifact,
  currentManifest,
  outputPath,
  previousArtifact,
  previousManifest,
  previousRoot,
  root,
} = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const currentVersion = packageJson.version;

verifyPath("current Web Admin artifact", currentArtifact);
verifyPath("current Web Admin manifest", currentManifest);
verifyPath("previous Web Admin artifact", previousArtifact);
verifyPath("previous Web Admin manifest", previousManifest);

runVerifier("current Web Admin release package", root, currentArtifact, currentManifest);
runVerifier("previous Web Admin release package", previousRoot, previousArtifact, previousManifest);

const currentSha256 = sha256File(currentArtifact);
const previousSha256 = sha256File(previousArtifact);
if (currentSha256 === previousSha256) {
  fail("Current and previous Web Admin rollback artifacts must be different bundles.");
}

const previousVersion = versionFromArtifactName(previousArtifact);
if (!previousVersion || previousVersion === currentVersion) {
  fail("Previous Web Admin rollback artifact file name must contain a version different from the current release.");
}

const evidence = {
  artifact: "web-admin-rollback-smoke",
  assertions: [
    "verified current Web Admin release package",
    "verified previous Web Admin rollback package",
    "verified rollback package keeps deployment headers and manifest",
    "verified rollback package is a different release bundle",
  ],
  current: {
    artifact: toRootRelativePath(root, currentArtifact),
    manifest: toRootRelativePath(root, currentManifest),
    sha256: currentSha256,
    version: currentVersion,
  },
  evidenceVersion: 1,
  previous: {
    artifact: toRootRelativePath(previousRoot, previousArtifact),
    manifest: toRootRelativePath(previousRoot, previousManifest),
    rootLabel: "previous-release-root",
    sha256: previousSha256,
    version: previousVersion,
  },
  rollback: {
    rehearsal: "redeploy previous verified Web Admin release bundle with its _headers file",
    restoreTarget: "previous Web Admin release zip",
  },
  timestamp: new Date().toISOString(),
  version: currentVersion,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
const checksumPath = resolve(dirname(outputPath), "rollback-smoke-SHA256SUMS.txt");
writeFileSync(checksumPath, `${sha256File(outputPath)}  ${toRootRelativePath(root, outputPath)}\n`);

console.log(`Wrote Web Admin rollback smoke evidence to ${toRootRelativePath(root, outputPath)}`);
console.log(`Wrote Web Admin rollback smoke checksum to ${toRootRelativePath(root, checksumPath)}`);

function runVerifier(label, verifierRoot, artifact, manifest) {
  const result = spawnSync(
    process.execPath,
    [
      verifierPath,
      "--root",
      verifierRoot,
      "--artifact",
      toRootRelativePath(verifierRoot, artifact),
      "--manifest",
      toRootRelativePath(verifierRoot, manifest),
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    fail(`${label} verification failed.`);
  }
}

function verifyPath(label, path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail(`${label} is missing: ${path}`);
  }
}

function versionFromArtifactName(path) {
  const match = basename(path).match(/^joessh-web-admin-(.+)\.zip$/);
  return match?.[1] ?? "";
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArgs(args) {
  let root = defaultRoot;
  let currentArtifact = "";
  let currentManifest = "reports/release/web/SHA256SUMS.txt";
  let previousRoot = "";
  let previousArtifact = "";
  let previousManifest = "reports/release/web/SHA256SUMS.txt";
  let outputPath = "reports/release/web/rollback-smoke.json";

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
    if (arg === "--current") {
      currentArtifact = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--current=")) {
      currentArtifact = arg.slice("--current=".length);
      continue;
    }
    if (arg === "--current-manifest") {
      currentManifest = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--current-manifest=")) {
      currentManifest = arg.slice("--current-manifest=".length);
      continue;
    }
    if (arg === "--previous-root") {
      previousRoot = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--previous-root=")) {
      previousRoot = resolve(arg.slice("--previous-root=".length));
      continue;
    }
    if (arg === "--previous") {
      previousArtifact = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--previous=")) {
      previousArtifact = arg.slice("--previous=".length);
      continue;
    }
    if (arg === "--previous-manifest") {
      previousManifest = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--previous-manifest=")) {
      previousManifest = arg.slice("--previous-manifest=".length);
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

    fail(`Unknown argument: ${arg}`);
  }

  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  previousRoot = previousRoot || root;
  currentArtifact = currentArtifact || `reports/release/web/joessh-web-admin-${packageJson.version}.zip`;

  if (!previousArtifact) {
    fail("--previous is required.");
  }

  return {
    currentArtifact: resolve(root, currentArtifact),
    currentManifest: resolve(root, currentManifest),
    outputPath: resolve(root, outputPath),
    previousArtifact: resolve(previousRoot, previousArtifact),
    previousManifest: resolve(previousRoot, previousManifest),
    previousRoot,
    root,
  };
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value.`);
  }
  return value;
}

function toRootRelativePath(baseRoot, path) {
  const relativePath = relative(baseRoot, path);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    fail(`Path must stay inside its release root: ${path}`);
  }
  return relativePath.replace(/\\/g, "/");
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
