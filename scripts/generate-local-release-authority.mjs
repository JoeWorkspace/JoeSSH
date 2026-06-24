import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { arch, platform, release } from "node:os";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

const defaultRoot = resolve(import.meta.dirname, "..");
const {
  authority,
  checksumPath,
  duplicateCheck,
  evidencePath,
  gateCommand,
  gateLogPath,
  operator,
  publicationTarget,
  reuseGateLog,
  root,
  runnerType,
} = parseArgs(process.argv.slice(2));
const packageJson = readJson("package.json");
const releaseTag = `v${packageJson.version}`;
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");
const npmCommand = process.env.ATLASTERM_RELEASE_NPM_COMMAND ?? (process.platform === "win32" ? "npm.cmd" : "npm");
const npmCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_NPM_ARGS");

verifyReleaseGitCheckout();
const gate = reuseGateLog ? verifyReleaseGateLog() : runReleaseGate();
const git = verifyReleaseGitCheckout();
const evidence = {
  authority,
  authorityVersion: 1,
  generatedAt: new Date().toISOString(),
  operator,
  publication: {
    artifactRoot: "reports/release",
    duplicateCheck,
    target: publicationTarget,
  },
  releaseGate: {
    command: gateCommand,
    completedAt: gate.completedAt,
    logPath: toReleasePath(gate.path),
    logSha256: gate.sha256,
    status: "passed",
  },
  releaseTag,
  runner: {
    os: `${platform()} ${release()} ${arch()}`,
    type: runnerType,
  },
  source: {
    cleanTreeExcluding: "reports/release",
    gitCommit: git.head,
    gitFsckStrict: true,
    releaseTagCommit: git.tagCommit,
    repository: git.repository,
  },
  version: packageJson.version,
};

mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
mkdirSync(dirname(checksumPath), { recursive: true });
writeFileSync(checksumPath, `${sha256File(evidencePath)}  ${toReleasePath(evidencePath)}\n`);

const verified = spawnSync(
  process.execPath,
  [
    resolve(defaultRoot, "scripts", "verify-local-release-authority.mjs"),
    "--root",
    root,
    "--evidence",
    evidencePath,
    "--checksum",
    checksumPath,
  ],
  {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
if (verified.status !== 0) {
  const diagnostic = `${verified.stdout}\n${verified.stderr}`.trim();
  fail(diagnostic ? `Generated local release authority evidence did not verify:\n${diagnostic}` : "Generated local release authority evidence did not verify.");
}

console.log(`Wrote local release authority evidence to ${toReleasePath(evidencePath)}`);
console.log(`Wrote local release authority checksum to ${toReleasePath(checksumPath)}`);
if (verified.stdout) {
  process.stdout.write(verified.stdout);
}

function verifyReleaseGitCheckout() {
  const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"], "Git checkout metadata is required.");
  if (insideWorkTree !== "true") {
    fail("Git checkout metadata is required.");
  }

  const status = runGit(
    ["status", "--porcelain=v1", "--untracked-files=all", "--", ".", ":(exclude)reports/release"],
    "Git working tree status is required.",
  );
  if (status.trim() !== "") {
    fail(`Git working tree outside reports/release must be clean to generate local release authority:\n${status}`);
  }

  const head = runGit(["rev-parse", "HEAD"], "Unable to resolve HEAD.");
  const tagCommit = runGit(
    ["rev-parse", "--verify", `${releaseTag}^{}`],
    `Release tag ${releaseTag} must exist to generate local release authority.`,
  );
  if (head !== tagCommit) {
    fail(`Release tag ${releaseTag} must point at HEAD to generate local release authority.`);
  }

  const repository = runGit(["remote", "get-url", "origin"], "Git remote origin is required.");
  runGit(["fsck", "--strict"], "git fsck --strict must pass to generate local release authority.");

  return { head, repository, tagCommit };
}

function verifyReleaseGateLog(completedAt = new Date().toISOString()) {
  if (!isSafeRelativePath(gateLogPath)) {
    fail("Release gate log path must be a safe relative path inside the release workspace.");
  }
  const path = resolve(root, gateLogPath);
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail(`Release gate log is required: ${toReleasePath(path)}`);
  }
  const text = readTextFile(path);
  if (!text.includes("qa:release:public")) {
    fail("Release gate log must include the public release gate command.");
  }
  if (!text.includes("Public Beta release readiness checks passed")) {
    fail("Release gate log must include the release readiness success marker.");
  }
  return { completedAt, path, sha256: sha256File(path) };
}

function runReleaseGate() {
  const startedAt = new Date().toISOString();
  const gateArgs = createGateCommandArgs(gateCommand);
  const path = resolve(root, gateLogPath);
  mkdirSync(dirname(path), { recursive: true });
  const result = spawnSync(gateArgs.command, gateArgs.args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const completedAt = new Date().toISOString();
  const output = [
    `$ ${gateCommand}`,
    `startedAt=${startedAt}`,
    result.stdout ?? "",
    result.stderr ?? "",
    `completedAt=${completedAt}`,
    `exitCode=${result.status ?? "signal:" + result.signal}`,
    "",
  ].join("\n");
  writeFileSync(path, output);
  if (result.status !== 0) {
    fail(`Release gate command failed; see ${toReleasePath(path)}.`);
  }
  return verifyReleaseGateLog(completedAt);
}

function createGateCommandArgs(command) {
  if (command === "npm run qa:release:public") {
    return { args: [...npmCommandPrefixArgs, "run", "qa:release:public"], command: npmCommand };
  }
  if (command === "npm run qa:release:public:fixture") {
    return { args: [...npmCommandPrefixArgs, "run", "qa:release:public:fixture"], command: npmCommand };
  }
  if (command === "npm run qa:release:public:local") {
    return { args: [...npmCommandPrefixArgs, "run", "qa:release:public:local"], command: npmCommand };
  }
  fail(`Unsupported release gate command: ${command}`);
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.trim() === "" || isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    return false;
  }
  return isInsideRoot(resolve(root, value));
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
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

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readTextFile(path) {
  const bytes = readFileSync(path);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  if (bytes.subarray(0, Math.min(bytes.length, 256)).includes(0)) {
    return bytes.toString("utf16le").replace(/^\uFEFF/, "");
  }
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

function toReleasePath(path) {
  return relative(root, resolve(path)).replace(/\\/g, "/");
}

function parseArgs(args) {
  let authority = process.env.ATLASTERM_RELEASE_AUTHORITY ?? "local";
  let checksumPath = null;
  const duplicateCheck = "operator-confirmed-no-existing-release-for-tag";
  let evidencePath = null;
  let gateCommand = process.env.ATLASTERM_RELEASE_GATE_COMMAND ?? "npm run qa:release:public";
  let gateLogPath = process.env.ATLASTERM_RELEASE_GATE_LOG ?? "reports/release/local-release-authority/qa-release-public.log";
  let operator =
    process.env.ATLASTERM_RELEASE_OPERATOR ??
    process.env.GIT_AUTHOR_NAME ??
    process.env.USERNAME ??
    process.env.USER ??
    "release-operator";
  let publicationTarget =
    process.env.ATLASTERM_RELEASE_PUBLICATION_TARGET ?? "operator-confirmed local/self-hosted distribution target";
  let reuseGateLog = false;
  let root = defaultRoot;
  let runnerType = process.env.ATLASTERM_RELEASE_RUNNER_TYPE ?? "local-release-machine";

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
    if (arg === "--authority" || arg === "--release-authority") {
      authority = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--authority=")) {
      authority = arg.slice("--authority=".length);
      continue;
    }
    if (arg.startsWith("--release-authority=")) {
      authority = arg.slice("--release-authority=".length);
      continue;
    }
    if (arg === "--gate-command") {
      gateCommand = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--gate-command=")) {
      gateCommand = arg.slice("--gate-command=".length);
      continue;
    }
    if (arg === "--gate-log") {
      gateLogPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--gate-log=")) {
      gateLogPath = arg.slice("--gate-log=".length);
      continue;
    }
    if (arg === "--operator") {
      operator = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--operator=")) {
      operator = arg.slice("--operator=".length);
      continue;
    }
    if (arg === "--target") {
      publicationTarget = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--target=")) {
      publicationTarget = arg.slice("--target=".length);
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
    if (arg === "--reuse-gate-log") {
      reuseGateLog = true;
      continue;
    }
    if (arg === "--output") {
      evidencePath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      evidencePath = arg.slice("--output=".length);
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
    fail(`Unknown argument: ${arg}`);
  }

  if (!["local", "self-hosted"].includes(authority)) {
    fail("--release-authority must be local or self-hosted.");
  }
  const allowedGateCommands = [
    "npm run qa:release:public",
    "npm run qa:release:public:fixture",
    "npm run qa:release:public:local",
  ];
  if (!allowedGateCommands.includes(gateCommand)) {
    fail(`--gate-command must be one of: ${allowedGateCommands.join(", ")}.`);
  }
  if (operator.trim() === "") {
    fail("--operator must be non-empty.");
  }
  if (publicationTarget.trim() === "") {
    fail("--target must be non-empty.");
  }
  if (runnerType.trim() === "") {
    fail("--runner-type must be non-empty.");
  }

  return {
    authority,
    checksumPath: resolve(root, checksumPath ?? "reports/release/local-release-authority-SHA256SUMS.txt"),
    duplicateCheck,
    evidencePath: resolve(root, evidencePath ?? "reports/release/local-release-authority.json"),
    gateCommand,
    gateLogPath,
    operator,
    publicationTarget,
    reuseGateLog,
    root,
    runnerType,
  };
}

function readValue(args, index, arg) {
  const value = args[index + 1];
  if (!value) {
    fail(`${arg} requires a value.`);
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

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
