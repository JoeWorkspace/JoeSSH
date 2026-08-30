import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

if (process.platform !== "win32") {
  fail("Windows invite candidates must be built on Windows.");
}

const root = resolve(import.meta.dirname, "..");
const bundleDir = resolve(
  root,
  "apps/desktop/src-tauri/target/release/bundle/nsis",
);
assertInside(
  resolve(root, "apps/desktop/src-tauri/target/release/bundle"),
  bundleDir,
  "NSIS bundle directory",
);
assertNoReparsePoint(root, bundleDir);

const packageJson = readJson(resolve(root, "package.json"), "root package");
const desktopPackageJson = readJson(
  resolve(root, "apps/desktop/package.json"),
  "Desktop package",
);
const tauriConfig = readJson(
  resolve(root, "apps/desktop/src-tauri/tauri.conf.json"),
  "Tauri configuration",
);
const cargoVersion = readCargoVersion(
  resolve(root, "apps/desktop/src-tauri/Cargo.toml"),
);
assertProjectIdentity();

const gitCommand = resolveTrustedGitCommand();
const gitTopLevel = gitOutput(["rev-parse", "--show-toplevel"]);
const nativeGitRoot = realpathSync.native(gitTopLevel);
const nativeRoot = realpathSync.native(root);
if (normalizePath(nativeGitRoot) !== normalizePath(nativeRoot)) {
  fail(
    `The Git worktree root does not match the JoeSSH repository root. Git root: ${gitTopLevel} -> ${nativeGitRoot}; repository root: ${root} -> ${nativeRoot}.`,
  );
}
const commit = gitOutput(["rev-parse", "HEAD"]);
const gitVersion = gitOutput(["--version"]);
if (!/^[a-f0-9]{40,64}$/i.test(commit)) {
  fail("The source commit must be a full Git object id.");
}
assertCleanGit();

if (existsSync(bundleDir)) {
  rmSync(bundleDir, { force: true, recursive: true });
}
mkdirSync(bundleDir, { recursive: true });
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();

const npmResult = spawnSync("npm.cmd", ["run", "release:desktop:build"], {
  cwd: root,
  env: {
    ...process.env,
    ATLASTERM_DESKTOP_RELEASE_BUNDLES: "nsis",
  },
  shell: false,
  stdio: "inherit",
});
if (npmResult.error) {
  fail(npmResult.error.message);
}
if (npmResult.status !== 0) {
  fail(`Windows NSIS build failed with exit code ${npmResult.status}.`);
}

const artifacts = readdirSync(bundleDir, { withFileTypes: true })
  .filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"),
  )
  .map((entry) => resolve(bundleDir, entry.name))
  .sort((left, right) => left.localeCompare(right));
if (artifacts.length !== 1) {
  fail(`Expected exactly one fresh NSIS installer, found ${artifacts.length}.`);
}

const artifactPath = artifacts[0];
const artifactStat = statSync(artifactPath);
if (artifactStat.mtimeMs + 2_000 < startedAtMs) {
  fail("The NSIS installer predates the current Windows invite build.");
}
if (!fileNameContainsVersion(basename(artifactPath), packageJson.version)) {
  fail(
    "The fresh NSIS installer file name does not contain the current version.",
  );
}
const pe = inspectPortableExecutable(artifactPath);

const attestation = {
  schemaVersion: 1,
  kind: "windows-invite-build-attestation",
  generatedAt: new Date().toISOString(),
  startedAt,
  platform: "windows",
  architecture: "x64",
  bundleTarget: "nsis",
  version: packageJson.version,
  commit,
  gitExecutable: gitCommand,
  gitVersion,
  sourceTreeClean: true,
  artifact: {
    fileName: basename(artifactPath),
    path: displayPath(artifactPath),
    sizeBytes: artifactStat.size,
    sha256: sha256File(artifactPath),
    peMachine: pe.machine,
  },
};
const attestationPath = resolve(
  bundleDir,
  "windows-invite-build-attestation.json",
);
writeFileSync(
  attestationPath,
  `${JSON.stringify(attestation, null, 2)}\n`,
  "utf8",
);
console.log(
  `Wrote commit-bound Windows invite build attestation to ${displayPath(attestationPath)}.`,
);

function assertProjectIdentity() {
  const versions = [
    packageJson.version,
    desktopPackageJson.version,
    tauriConfig.version,
    cargoVersion,
  ];
  if (versions.some((version) => version !== versions[0])) {
    fail(
      `Windows invite version mismatch: root=${versions[0]}, desktop=${versions[1]}, tauri=${versions[2]}, cargo=${versions[3]}.`,
    );
  }
  if (
    tauriConfig.productName !== "JoeSSH" ||
    tauriConfig.identifier !== "dev.atlasterm.joessh" ||
    !tauriConfig.bundle?.publisher
  ) {
    fail("Tauri bundle identity is incomplete or does not match JoeSSH.");
  }
}

function inspectPortableExecutable(path) {
  const data = readFileSync(path);
  if (data.length < 65_536 || data.readUInt16LE(0) !== 0x5a4d) {
    fail("The NSIS output is not a valid Windows PE installer.");
  }
  const peOffset = data.readUInt32LE(0x3c);
  if (
    peOffset < 0x40 ||
    peOffset + 24 > data.length ||
    data.subarray(peOffset, peOffset + 4).toString("hex") !== "50450000"
  ) {
    fail("The NSIS output is not a valid Windows PE installer.");
  }
  const machineCode = data.readUInt16LE(peOffset + 4);
  const machineNames = new Map([
    [0x014c, "x86-nsis-bootstrapper"],
    [0x8664, "x64"],
  ]);
  const machine = machineNames.get(machineCode);
  if (!machine) {
    fail(`Unsupported Windows PE machine: 0x${machineCode.toString(16)}.`);
  }
  return { machine };
}

function assertCleanGit() {
  const diff = runGit(["diff", "--quiet", "HEAD", "--"]);
  if (diff.status === 1) {
    fail("Windows invite builds require a clean Git worktree.");
  }
  if (diff.status !== 0) {
    fail(commandDiagnostic("Unable to compare the worktree with HEAD.", diff));
  }
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"]);
  if (untracked.status !== 0) {
    fail(commandDiagnostic("Unable to inspect untracked files.", untracked));
  }
  if (untracked.stdout.trim()) {
    fail("Windows invite builds require a clean Git worktree.");
  }
}

function gitOutput(args) {
  const result = runGit(args);
  if (result.status !== 0) {
    fail(
      commandDiagnostic(`Git command failed: git ${args.join(" ")}`, result),
    );
  }
  return result.stdout.trim();
}

function runGit(args) {
  return spawnSync(gitCommand, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveTrustedGitCommand() {
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const candidate = resolve(programFiles, "Git/cmd/git.exe");
  if (!existsSync(candidate)) {
    fail("Trusted Git executable was not found under Program Files.");
  }
  return realpathSync(candidate);
}

function readJson(path, label) {
  if (!existsSync(path)) {
    fail(`Missing ${label}: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    fail(`Unable to parse ${label} as JSON.`);
  }
}

function readCargoVersion(path) {
  const packageSection = readFileSync(path, "utf8").match(
    /\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/,
  );
  if (!packageSection) {
    fail("Unable to read the Desktop Cargo package version.");
  }
  return packageSection[1];
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fileNameContainsVersion(fileName, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[_-])${escapedVersion}(?=[_.-]|$)`, "i").test(
    fileName,
  );
}

function assertNoReparsePoint(parent, child) {
  const relativePath = relative(parent, child);
  let current = parent;
  for (const segment of relativePath.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, segment);
    if (
      existsSync(current) &&
      normalizePath(realpathSync(current)) !== normalizePath(resolve(current))
    ) {
      fail(`Refusing to use a linked or redirected build path: ${current}`);
    }
  }
}

function assertInside(parent, child, label) {
  const relativePath = relative(resolve(parent), resolve(child));
  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  ) {
    return;
  }
  fail(`${label} must stay inside ${parent}.`);
}

function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function displayPath(path) {
  return relative(root, path).replace(/\\/g, "/") || basename(path);
}

function commandDiagnostic(message, result) {
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return diagnostic ? `${message}\n${diagnostic}` : message;
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
