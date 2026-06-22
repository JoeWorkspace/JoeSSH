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
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const {
  bundleDir,
  outputPath,
  root,
} = parseArgs(process.argv.slice(2));
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");
const powershellCommand = process.env.ATLASTERM_RELEASE_POWERSHELL_COMMAND ?? "powershell";
const powershellCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_POWERSHELL_ARGS");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

if (!isInsideRoot(outputPath) || isInsideReleaseReports(outputPath)) {
  fail("Unsigned Desktop staging reports must stay inside the release root and outside reports/release.");
}

const artifacts = collectFiles(bundleDir)
  .map((path) => ({ classification: classifyArtifact(path), path }))
  .filter((artifact) => artifact.classification !== null)
  .sort((left, right) => left.path.localeCompare(right.path));

if (artifacts.length === 0) {
  fail(`No Desktop staging artifacts found in ${displayPath(bundleDir)}.`);
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  version: packageJson.version,
  decision: "internal-staging-only",
  publicReleaseEvidence: false,
  boundary:
    "Unsigned Desktop staging reports are for internal dogfood and handoff only. They must not be copied into reports/release or used as signed Desktop formal release evidence.",
  git: inspectGit(),
  bundleDir: toReleasePath(bundleDir),
  artifacts: artifacts.map(({ classification, path }) => ({
    path: toReleasePath(path),
    fileName: basename(path),
    platform: classification.platform,
    packageType: classification.packageType ?? null,
    sizeBytes: statSync(path).size,
    sha256: sha256File(path),
    versionMatchesPackage: basename(path).includes(packageJson.version),
    authenticode: classification.platform === "windows" ? inspectAuthenticode(path) : null,
  })),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote unsigned Desktop staging report to ${toReleasePath(outputPath)}.`);

function inspectGit() {
  return {
    head: gitOutput(["rev-parse", "HEAD"]),
    statusShort: lines(gitOutput(["status", "--short"])),
    tagsAtHead: lines(gitOutput(["tag", "--points-at", "HEAD"])),
  };
}

function inspectAuthenticode(path) {
  const command = [
    "$path = [Console]::In.ReadToEnd();",
    "$signature = Get-AuthenticodeSignature -LiteralPath $path;",
    "$signature | Select-Object @{Name='Status';Expression={$_.Status.ToString()}},StatusMessage | ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync(
    powershellCommand,
    [...powershellCommandPrefixArgs, "-NoProfile", "-Command", command],
    {
      cwd: root,
      encoding: "utf8",
      input: path,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    return {
      status: "unknown",
      statusMessage: commandDiagnostic("Unable to inspect Windows Authenticode signature.", result),
    };
  }
  const parsed = parseJsonOr({}, result.stdout);
  return {
    status: parsed.Status ?? "unknown",
    statusMessage: parsed.StatusMessage ?? "",
  };
}

function gitOutput(args) {
  const result = spawnSync(gitCommand, [...gitCommandPrefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0 ? result.stdout.trim() : null;
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
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(child);
    }
    return entry.isFile() ? [child] : [];
  });
}

function classifyArtifact(path) {
  const lower = path.toLowerCase();
  if (/\.(exe|msi|msix)$/.test(lower)) {
    return { platform: "windows" };
  }
  if (lower.endsWith(".dmg") || lower.endsWith(".pkg") || lower.endsWith(".app.tar.gz")) {
    return { platform: "macos" };
  }
  if (lower.endsWith(".appimage")) {
    return { packageType: "AppImage", platform: "linux" };
  }
  if (lower.endsWith(".deb")) {
    return { packageType: "deb", platform: "linux" };
  }
  if (lower.endsWith(".rpm")) {
    return { packageType: "rpm", platform: "linux" };
  }
  return null;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function lines(value) {
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

function parseJsonOr(fallback, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function commandDiagnostic(message, result) {
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return diagnostic ? `${message}\n${diagnostic}` : message;
}

function parseArgs(args) {
  let root = defaultRoot;
  let bundlePath = "apps/desktop/src-tauri/target/release/bundle";
  let output = "reports/handoff/desktop/unsigned-staging-report.json";

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
    if (arg === "--bundle-dir") {
      bundlePath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--bundle-dir=")) {
      bundlePath = arg.slice("--bundle-dir=".length);
      continue;
    }
    if (arg === "--output") {
      output = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      output = arg.slice("--output=".length);
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return {
    bundleDir: resolve(root, bundlePath),
    outputPath: resolve(root, output),
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

function parseCommandPrefixArgs(envName) {
  const raw = process.env[envName];
  if (!raw) {
    return [];
  }
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      return value;
    }
  } catch {
    // Fall through to the explicit failure below.
  }
  fail(`${envName} must be a JSON string array when set.`);
}

function toReleasePath(path) {
  return relative(root, path).replace(/\\/g, "/") || basename(path);
}

function displayPath(path) {
  return relative(root, path).replace(/\\/g, "/") || basename(path);
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isInsideReleaseReports(path) {
  const relativePath = relative(root, path).replace(/\\/g, "/");
  return relativePath === "reports/release" || relativePath.startsWith("reports/release/");
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
