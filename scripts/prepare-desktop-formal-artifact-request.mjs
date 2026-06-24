import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { arch, platform, release } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const defaultOutputPath = "reports/handoff/desktop/formal-artifact-request.json";
const defaultChecksumFileName = "formal-artifact-request-SHA256SUMS.txt";
const {
  checksumPath,
  outputPath,
  requiredPlatforms,
  root,
  runnerType,
  sourceAuthority,
} = parseArgs(process.argv.slice(2));
const packageJson = readJson("package.json");
const releaseVersion = packageJson.version;
const releaseTag = `v${releaseVersion}`;
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");

if (!isInsideRoot(outputPath) || !isInsideRoot(checksumPath)) {
  fail("Desktop formal artifact request output paths must stay inside the release root.");
}

const git = verifyReleaseGitCheckout();
const requestId = createRequestId(git);
const request = {
  requestVersion: 1,
  kind: "joessh-desktop-formal-artifact-request",
  requestId,
  generatedAt: new Date().toISOString(),
  product: "JoeSSH",
  version: releaseVersion,
  releaseTag,
  sourceAuthority,
  requiredPlatforms,
  source: {
    cleanTreeExcluding: ["reports/release", "reports/handoff"],
    gitCommit: git.head,
    gitFsckStrict: true,
    releaseTagCommit: git.tagCommit,
    repository: git.repository,
  },
  runner: {
    os: `${platform()} ${release()} ${arch()}`,
    type: runnerType,
  },
  inputDirectory: {
    mustBeOutsideReleaseWorkspace: true,
    fileNameMustInclude: releaseVersion,
    proofFilesMustBePlainText: true,
  },
  artifactContract: createArtifactContract(),
  returnedManifest: {
    fileName: "desktop-formal-artifact-manifest.json",
    required: true,
    requiredFields: [
      "manifestVersion",
      "kind",
      "requestId",
      "product",
      "version",
      "releaseTag",
      "sourceAuthority",
      "source.gitCommit",
      "source.releaseTagCommit",
      "source.gitFsckStrict",
      "artifacts[].fileName",
      "artifacts[].platform",
      "artifacts[].sha256",
      "artifacts[].sizeBytes",
    ],
  },
  commands: createCommands(sourceAuthority),
  clearsRcBlockers: [
    "reports/release/desktop/SHA256SUMS.txt",
    "reports/release/desktop/release-evidence.json",
    "reports/release/desktop/release-evidence-source.json",
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
  ],
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(request, null, 2)}\n`);
mkdirSync(dirname(checksumPath), { recursive: true });
writeFileSync(checksumPath, `${sha256File(outputPath)}  ${toReleasePath(outputPath)}\n`);

console.log(`Wrote Desktop formal artifact request to ${toReleasePath(outputPath)}`);
console.log(`Wrote Desktop formal artifact request checksum to ${toReleasePath(checksumPath)}`);

function createArtifactContract() {
  return {
    proofTextRules: {
      mustMentionAll: ["artifact file name", "artifact SHA256"],
      mustShowSuccessfulVerification: true,
      successWords: ["passed", "passes", "successful", "verified", "valid", "accepted", "notarized", "stapled"],
      failureWordsAreBlockers: ["failed", "failure", "error", "invalid", "rejected", "denied", "not signed", "not notarized"],
    },
    platforms: {
      windows: {
        acceptedExtensions: [".exe", ".msi", ".msix"],
        requiredProofFiles: ["windows-signature-verification.txt"],
        proofExample: "signtool verify /pa <artifact-name> passed",
      },
      macos: {
        acceptedExtensions: [".dmg", ".pkg", ".app.tar.gz"],
        requiredProofFiles: [
          "macos-signature-verification.txt",
          "macos-notarization-verification.txt",
        ],
        proofExamples: [
          "codesign --verify --deep --strict <artifact-name> passed",
          "spctl --assess --type open --context context:primary-signature <artifact-name> accepted",
          "xcrun stapler validate <artifact-name> passed",
        ],
      },
      linux: {
        acceptedExtensions: [".AppImage", ".deb", ".rpm"],
        requiredProofFiles: [],
        packageRequirement: "At least one Linux desktop package is required for Public Beta.",
      },
    },
  };
}

function createRequestId(git) {
  const digest = createHash("sha256")
    .update([releaseTag, git.head, git.repository, sourceAuthority].join("\n"))
    .digest("hex")
    .slice(0, 16);
  return `desktop-formal-${releaseVersion}-${digest}`;
}

function createCommands(authority) {
  const input = "<signed-artifact-dir>";
  return {
    manifest: `npm run release:desktop:formal-artifacts:manifest -- --input-dir ${input} --source-authority ${authority}`,
    intake: `npm run release:desktop:formal-artifacts:intake -- --input-dir ${input} --source-authority ${authority}`,
    preflight: `npm run release:desktop:formal-artifacts:preflight -- --input-dir ${input} --source-authority ${authority}`,
    import: `npm run release:desktop:formal-artifacts:import -- --input-dir ${input} --source-authority ${authority}`,
    verify: "npm run release:desktop:verify-evidence -- --require-source --require-current-git-source",
  };
}

function verifyReleaseGitCheckout() {
  const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"], "Git checkout metadata is required.");
  if (insideWorkTree !== "true") {
    fail("Git checkout metadata is required.");
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
    "Git working tree status is required.",
  );
  if (status.trim() !== "") {
    fail(`Git working tree outside reports/release and reports/handoff must be clean:\n${status}`);
  }

  const head = runGit(["rev-parse", "HEAD"], "Unable to resolve HEAD.");
  const tagCommit = runGit(
    ["rev-parse", "--verify", `${releaseTag}^{}`],
    `Release tag ${releaseTag} must exist.`,
  );
  if (head !== tagCommit) {
    fail(`Release tag ${releaseTag} must point at HEAD.`);
  }

  const repository = runGit(["remote", "get-url", "origin"], "Git remote origin is required.");
  runGit(["fsck", "--strict"], "git fsck --strict must pass.");
  return { head, repository, tagCommit };
}

function runGit(args, message) {
  const result = spawnSync(gitCommand, [...gitCommandPrefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const diagnostic = `${result.stdout}\n${result.stderr}`.trim();
    fail(diagnostic ? `${message}\n${diagnostic}` : message);
  }
  return result.stdout.trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isInsideRoot(path) {
  const relativePath = relative(root, resolve(path));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function toReleasePath(path) {
  return relative(root, resolve(path)).replace(/\\/g, "/");
}

function parseArgs(args) {
  let root = defaultRoot;
  let outputPath = defaultOutputPath;
  let checksumPath = "";
  let requiredPlatforms = ["windows", "macos", "linux"];
  let sourceAuthority = process.env.ATLASTERM_DESKTOP_RELEASE_SOURCE_AUTHORITY ?? "local";
  let runnerType = process.env.ATLASTERM_DESKTOP_RELEASE_RUNNER_TYPE ?? "local-release-machine";

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
    if (arg === "--output") {
      outputPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
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
    if (arg === "--source-authority") {
      sourceAuthority = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--source-authority=")) {
      sourceAuthority = arg.slice("--source-authority=".length);
      continue;
    }
    if (arg === "--runner-type") {
      runnerType = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--runner-type=")) {
      runnerType = arg.slice("--runner-type=".length);
      continue;
    }
    if (arg === "--require-platforms") {
      requiredPlatforms = parsePlatformList(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--require-platforms=")) {
      requiredPlatforms = parsePlatformList(arg.slice("--require-platforms=".length));
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  sourceAuthority = sourceAuthority.trim();
  if (!["local", "self-hosted"].includes(sourceAuthority)) {
    fail("--source-authority must be local or self-hosted.");
  }
  if (runnerType.trim() === "") {
    fail("--runner-type must not be empty.");
  }
  if (requiredPlatforms.length === 0) {
    fail("--require-platforms must include at least one platform.");
  }

  outputPath = resolve(root, outputPath);
  if (!checksumPath) {
    const checksumFileName =
      basename(outputPath) === basename(defaultOutputPath)
        ? defaultChecksumFileName
        : `${basename(outputPath, ".json")}-SHA256SUMS.txt`;
    checksumPath = resolve(dirname(outputPath), checksumFileName);
  } else {
    checksumPath = resolve(root, checksumPath);
  }

  return {
    checksumPath,
    outputPath,
    requiredPlatforms,
    root,
    runnerType: runnerType.trim(),
    sourceAuthority,
  };
}

function parsePlatformList(value) {
  const platforms = value
    .split(",")
    .map((platformName) => platformName.trim())
    .filter(Boolean);
  const invalidPlatforms = platforms.filter((platformName) => !["windows", "macos", "linux"].includes(platformName));
  if (invalidPlatforms.length > 0) {
    fail(`Unsupported platform(s): ${invalidPlatforms.join(", ")}`);
  }
  return [...new Set(platforms)];
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

function readValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    fail(`${name} requires a value.`);
  }
  return value;
}

function fail(message) {
  console.error(`prepare-desktop-formal-artifact-request.mjs: ${message}`);
  process.exit(1);
}
