import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const { checksumPath, notesFile, outputPath, root } = parseArgs(
  process.argv.slice(2),
);
const packageJson = readJson("package.json");
const releaseTag = `v${packageJson.version}`;
const releaseNotesPath = resolve(
  root,
  notesFile ?? `docs/release-notes/${packageJson.version}.md`,
);
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_RELEASE_GIT_ARGS",
);
const npmCommand =
  process.env.ATLASTERM_RELEASE_NPM_COMMAND ?? defaultNpmCommand();
const npmCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_RELEASE_NPM_ARGS",
);
const cargoCommand = process.env.ATLASTERM_RELEASE_CARGO_COMMAND ?? "cargo";
const cargoCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_RELEASE_CARGO_ARGS",
);
const rustcCommand = process.env.ATLASTERM_RELEASE_RUSTC_COMMAND ?? "rustc";
const rustcCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_RELEASE_RUSTC_ARGS",
);
const requiredLockfiles = [
  "package-lock.json",
  "Cargo.lock",
  "apps/desktop/src-tauri/Cargo.lock",
];
const requiredChecksumManifests = [
  "reports/release/SBOM-SHA256SUMS.txt",
  "reports/release/desktop/SHA256SUMS.txt",
  "reports/release/desktop/release-evidence-SHA256SUMS.txt",
  "reports/release/sync/SHA256SUMS.txt",
  "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt",
  "reports/release/web/SHA256SUMS.txt",
];

if (!existsSync(releaseNotesPath) || !statSync(releaseNotesPath).isFile()) {
  fail(
    `Release notes file is required to generate release provenance: ${toReleasePath(releaseNotesPath)}`,
  );
}

const git = verifyReleaseGitCheckout();
const provenance = {
  provenanceVersion: 1,
  product: "JoeSSH",
  version: packageJson.version,
  releaseTag,
  generatedAt: new Date().toISOString(),
  source: {
    repository: git.repository,
    gitCommit: git.head,
    releaseTagCommit: git.tagCommit,
    gitFsckStrict: true,
    cleanTreeExcluding: "reports/release",
  },
  releaseNotes: {
    path: toReleasePath(releaseNotesPath),
    sha256: sha256File(releaseNotesPath),
  },
  toolchain: collectToolchain(),
  lockfiles: collectLockfiles(),
  checksumManifests: collectChecksumManifestEvidence(),
  verifiers: [
    "verify-artifact-checksums.mjs --all-release",
    "verify-web-release-package.mjs",
    "verify-sync-release-evidence.mjs",
    "verify-desktop-release-evidence.mjs",
    "verify-release-sbom.mjs",
    "verify-release-provenance.mjs",
  ],
};

mkdirSync(resolve(outputPath, ".."), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`);
mkdirSync(resolve(checksumPath, ".."), { recursive: true });
writeFileSync(
  checksumPath,
  `${sha256File(outputPath)}  ${toReleasePath(outputPath)}\n`,
);

console.log(`Wrote release provenance to ${toReleasePath(outputPath)}`);
console.log(
  `Wrote release provenance checksum to ${toReleasePath(checksumPath)}`,
);

function verifyReleaseGitCheckout() {
  const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"], {
    message:
      "Git checkout metadata is required to generate release provenance.",
  });
  if (insideWorkTree !== "true") {
    fail("Git checkout metadata is required to generate release provenance.");
  }

  const status = runGit(
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude)reports/release",
    ],
    {
      message:
        "Git working tree status is required to generate release provenance.",
    },
  );
  if (status.trim() !== "") {
    fail(
      `Git working tree outside reports/release must be clean to generate release provenance:\n${status}`,
    );
  }

  const head = runGit(["rev-parse", "HEAD"], {
    message: "Unable to resolve HEAD while generating release provenance.",
  });
  const tagCommit = runGit(["rev-parse", "--verify", `${releaseTag}^{}`], {
    message: `Release tag ${releaseTag} must exist to generate release provenance.`,
  });
  if (head !== tagCommit) {
    fail(
      `Release tag ${releaseTag} must point at HEAD to generate release provenance.`,
    );
  }

  runGit(["fsck", "--strict"], {
    message: "git fsck --strict must pass to generate release provenance.",
  });

  const repository = runGit(["remote", "get-url", "origin"], {
    message: "Git remote origin is required to generate release provenance.",
  });

  return { head, repository, tagCommit };
}

function collectToolchain() {
  const packageLock = readJson("package-lock.json");
  const desktopCargoLock = readText("apps/desktop/src-tauri/Cargo.lock");

  return {
    node: process.version,
    npm: runTool(
      npmCommand,
      npmCommandPrefixArgs,
      ["--version"],
      "npm --version",
    ),
    cargo: runTool(
      cargoCommand,
      cargoCommandPrefixArgs,
      ["--version"],
      "cargo --version",
    ),
    rustc: runTool(
      rustcCommand,
      rustcCommandPrefixArgs,
      ["--version"],
      "rustc --version",
    ),
    tauri: {
      npmApi: getPackageLockVersion(
        packageLock,
        "node_modules/@tauri-apps/api",
      ),
      npmCli: getPackageLockVersion(
        packageLock,
        "node_modules/@tauri-apps/cli",
      ),
      rustCrate: getCargoLockPackageVersion(desktopCargoLock, "tauri"),
    },
  };
}

function collectLockfiles() {
  return requiredLockfiles.map((path) => {
    const fullPath = resolve(root, path);
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      fail(`Required release lockfile is missing: ${path}`);
    }

    return {
      path,
      sha256: sha256File(fullPath),
    };
  });
}

function collectChecksumManifestEvidence() {
  const stagedManifests = collectReleaseChecksumManifests();
  const missingManifests = requiredChecksumManifests.filter(
    (manifestPath) => !stagedManifests.includes(manifestPath),
  );
  if (missingManifests.length > 0) {
    fail(
      `Required Public Beta checksum manifest(s) missing for release provenance:\n- ${missingManifests.join("\n- ")}`,
    );
  }

  const staleManifests = stagedManifests.filter(
    (manifestPath) => !requiredChecksumManifests.includes(manifestPath),
  );
  if (staleManifests.length > 0) {
    fail(
      `Unexpected checksum manifest(s) staged for Public Beta release provenance:\n- ${staleManifests.join("\n- ")}`,
    );
  }

  return requiredChecksumManifests.map((manifestPath) => {
    const fullPath = resolve(root, manifestPath);
    return {
      path: manifestPath,
      sha256: sha256File(fullPath),
      entries: parseChecksumManifest(fullPath),
    };
  });
}

function collectReleaseChecksumManifests() {
  return collectFiles(resolve(root, "reports", "release"))
    .filter((path) => path.endsWith("SHA256SUMS.txt"))
    .map((path) => toReleasePath(path))
    .filter((path) => path !== toReleasePath(checksumPath))
    .sort();
}

function parseChecksumManifest(manifestPath) {
  return readText(toReleasePath(manifestPath))
    .split(/\r?\n/)
    .flatMap((line, index) => {
      if (line.trim() === "" || line.trimStart().startsWith("#")) {
        return [];
      }

      const match = line.match(/^([a-fA-F0-9]{64})\s\s(.+)$/);
      if (!match) {
        fail(
          `${toReleasePath(manifestPath)}:${index + 1} is not '<sha256>  <relative-path>'`,
        );
      }

      const artifactPath = match[2].replaceAll("\\", "/");
      if (isAbsolute(artifactPath)) {
        fail(
          `${toReleasePath(manifestPath)}:${index + 1} uses an absolute artifact path`,
        );
      }

      const fullArtifactPath = resolve(root, artifactPath);
      if (!isInsideRoot(fullArtifactPath)) {
        fail(
          `${toReleasePath(manifestPath)}:${index + 1} escapes the release root`,
        );
      }
      if (
        !existsSync(fullArtifactPath) ||
        !statSync(fullArtifactPath).isFile()
      ) {
        fail(
          `${toReleasePath(manifestPath)}:${index + 1} references missing artifact ${artifactPath}`,
        );
      }

      return [
        {
          path: toReleasePath(fullArtifactPath),
          sha256: match[1].toLowerCase(),
        },
      ];
    });
}

function collectFiles(path) {
  if (!existsSync(path)) {
    return [];
  }

  const stat = statSync(path);
  if (stat.isFile()) {
    return [path];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(child);
    }
    return entry.isFile() ? [child] : [];
  });
}

function getPackageLockVersion(packageLock, packagePath) {
  const version = packageLock?.packages?.[packagePath]?.version;
  if (typeof version !== "string" || version.trim() === "") {
    fail(
      `package-lock.json is missing ${packagePath} version for release provenance`,
    );
  }
  return version;
}

function getCargoLockPackageVersion(lockText, packageName) {
  const packagePattern = new RegExp(
    String.raw`\[\[package\]\]\s+name = "${escapeRegExp(packageName)}"\s+version = "([^"]+)"`,
    "m",
  );
  const match = lockText.match(packagePattern);
  if (!match) {
    fail(
      `apps/desktop/src-tauri/Cargo.lock is missing ${packageName} version for release provenance`,
    );
  }
  return match[1];
}

function runGit(args, options) {
  return runCommand(gitCommand, [...gitCommandPrefixArgs, ...args], options);
}

function runTool(command, prefixArgs, args, label) {
  return runCommand(command, [...prefixArgs, ...args], {
    message: `Unable to record ${label} for release provenance.`,
  });
}

function runCommand(command, args, { message }) {
  const result = spawnSync(command, args, {
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
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function toReleasePath(path) {
  return relative(root, resolve(path)).replace(/\\/g, "/");
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(args) {
  let root = defaultRoot;
  let outputPath = null;
  let checksumPath = null;
  let notesFile = null;

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
    if (arg === "--output") {
      const value = args[index + 1];
      if (!value) {
        fail("--output requires a path.");
      }
      outputPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
      continue;
    }
    if (arg === "--checksum") {
      const value = args[index + 1];
      if (!value) {
        fail("--checksum requires a path.");
      }
      checksumPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--checksum=")) {
      checksumPath = arg.slice("--checksum=".length);
      continue;
    }
    if (arg === "--notes-file") {
      const value = args[index + 1];
      if (!value) {
        fail("--notes-file requires a path.");
      }
      notesFile = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--notes-file=")) {
      notesFile = arg.slice("--notes-file=".length);
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    checksumPath: resolve(
      root,
      checksumPath ?? "reports/release/release-provenance-SHA256SUMS.txt",
    ),
    notesFile,
    outputPath: resolve(
      root,
      outputPath ?? "reports/release/release-provenance.json",
    ),
    root,
  };
}

function parseCommandPrefixArgs(envName) {
  const raw = process.env[envName];
  if (!raw) {
    return [];
  }

  try {
    const value = JSON.parse(raw);
    if (
      Array.isArray(value) &&
      value.every((entry) => typeof entry === "string")
    ) {
      return value;
    }
  } catch {
    // Fall through to the explicit failure below.
  }

  fail(`${envName} must be a JSON string array when set.`);
}

function defaultNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
