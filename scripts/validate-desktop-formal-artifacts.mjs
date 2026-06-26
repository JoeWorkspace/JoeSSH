import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

const scriptName = "validate-desktop-formal-artifacts.mjs";
const scriptDir = import.meta.dirname;
const defaultRoot = resolve(scriptDir, "..");
const manifestScriptPath = resolve(scriptDir, "prepare-desktop-formal-artifact-manifest.mjs");
const intakeScriptPath = resolve(scriptDir, "diagnose-desktop-formal-artifact-input.mjs");
const importerScriptPath = resolve(scriptDir, "import-desktop-formal-artifacts.mjs");
const defaultManifestFileName = "desktop-formal-artifact-manifest.json";
const defaultIntakeReportPath = "reports/handoff/desktop/formal-artifact-input-report.json";

const options = parseArgs(process.argv.slice(2));

if (!existsSync(options.inputDir)) {
  fail(`--input-dir must point to a directory: ${displayPath(options.inputDir)}`);
}

const manifestPath = resolve(options.inputDir, defaultManifestFileName);
let manifestResult = null;
if (!existsSync(manifestPath) || options.forceManifest) {
  const manifestArgs = [
    "--root",
    options.root,
    "--input-dir",
    options.inputDir,
    "--source-authority",
    options.sourceAuthority,
    "--require-platforms",
    options.requiredPlatforms.join(","),
    ...(options.forceManifest ? ["--force"] : []),
  ];
  manifestResult = runNodeScript("Desktop formal artifact manifest generation", manifestScriptPath, manifestArgs, {
    allowFailure: true,
  });
} else {
  console.log(`Using existing ${displayPath(manifestPath)}. Pass --force-manifest to regenerate it.`);
}

const sharedInputArgs = [
  "--root",
  options.root,
  "--input-dir",
  options.inputDir,
  "--source-authority",
  options.sourceAuthority,
  "--runner-type",
  options.runnerType,
  "--require-platforms",
  options.requiredPlatforms.join(","),
  ...proofFileArgs(),
];

runNodeScript("Desktop formal artifact intake diagnostics", intakeScriptPath, [
  "--no-fail",
  ...sharedInputArgs,
]);
const intakeReport = readIntakeReport();
if (intakeReport.decision !== "go") {
  const firstBlocker = Array.isArray(intakeReport.blockers) ? intakeReport.blockers[0] : null;
  const detail = firstBlocker?.detail ? ` First blocker: ${firstBlocker.detail.split(/\r?\n/)[0]}` : "";
  fail(`Desktop formal artifact validation is no-go.${detail}`);
}
if (manifestResult && manifestResult.status !== 0) {
  fail(`Desktop formal artifact manifest generation failed with exit code ${manifestResult.status ?? "unknown"}.`);
}

runNodeScript("Desktop formal artifact import preflight", importerScriptPath, [
  "--preflight-only",
  ...sharedInputArgs,
]);

console.log(
  `Desktop formal artifact validation passed for ${displayPath(options.inputDir)} with ${options.sourceAuthority} source evidence.`,
);
console.log(
  "Next step: npm run release:desktop:formal-artifacts:import -- --input-dir <signed-artifact-dir> --source-authority " +
    options.sourceAuthority,
);

function runNodeScript(label, scriptPath, args, settings = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.root,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (settings.allowFailure) {
    return result;
  }
  if (result.status !== 0) {
    fail(`${label} failed with exit code ${result.status ?? "unknown"}.`);
  }
  return result;
}

function readIntakeReport() {
  const reportPath = resolve(options.root, defaultIntakeReportPath);
  try {
    return JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    fail(`Unable to read Desktop formal artifact intake report: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function proofFileArgs() {
  return [
    ...optionalArg("--windows-signature-file", options.windowsSignatureFile),
    ...optionalArg("--macos-signature-file", options.macosSignatureFile),
    ...optionalArg("--macos-notarization-file", options.macosNotarizationFile),
  ];
}

function optionalArg(flag, value) {
  return value ? [flag, value] : [];
}

function parseArgs(args) {
  let root = defaultRoot;
  let inputPath = "";
  let sourceAuthority = "local";
  let runnerType = "";
  let requiredPlatforms = ["windows", "macos", "linux"];
  let windowsSignatureFile = "";
  let macosSignatureFile = "";
  let macosNotarizationFile = "";
  let forceManifest = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force-manifest") {
      forceManifest = true;
      continue;
    }
    if (arg === "--root") {
      root = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
      continue;
    }
    if (arg === "--input-dir") {
      inputPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--input-dir=")) {
      inputPath = arg.slice("--input-dir=".length);
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
    if (arg === "--windows-signature-file") {
      windowsSignatureFile = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--windows-signature-file=")) {
      windowsSignatureFile = resolve(arg.slice("--windows-signature-file=".length));
      continue;
    }
    if (arg === "--macos-signature-file") {
      macosSignatureFile = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--macos-signature-file=")) {
      macosSignatureFile = resolve(arg.slice("--macos-signature-file=".length));
      continue;
    }
    if (arg === "--macos-notarization-file") {
      macosNotarizationFile = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--macos-notarization-file=")) {
      macosNotarizationFile = resolve(arg.slice("--macos-notarization-file=".length));
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (inputPath.trim() === "") {
    fail("--input-dir is required.");
  }

  sourceAuthority = sourceAuthority.trim();
  if (!["local", "self-hosted"].includes(sourceAuthority)) {
    fail("--source-authority must be local or self-hosted.");
  }
  runnerType = runnerType.trim();
  if (runnerType === "") {
    runnerType = sourceAuthority === "self-hosted" ? "self-hosted-release-machine" : "local-release-machine";
  }
  if (requiredPlatforms.length === 0) {
    fail("--require-platforms must include at least one platform.");
  }

  return {
    forceManifest,
    inputDir: resolve(inputPath),
    macosNotarizationFile,
    macosSignatureFile,
    requiredPlatforms,
    root,
    runnerType,
    sourceAuthority,
    windowsSignatureFile,
  };
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value.`);
  }
  return value;
}

function parsePlatformList(value) {
  const platforms = value
    .split(",")
    .map((platform) => platform.trim())
    .filter(Boolean);
  const invalidPlatforms = platforms.filter((platform) => !["windows", "macos", "linux"].includes(platform));
  if (invalidPlatforms.length > 0) {
    fail(`Unsupported required platform(s): ${invalidPlatforms.join(", ")}`);
  }
  return [...new Set(platforms)];
}

function displayPath(path) {
  const relativePath = relative(options?.root ?? defaultRoot, path);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return relativePath.replace(/\\/g, "/") || basename(path);
  }
  return path;
}

function fail(message) {
  console.error(`${scriptName}: ${message}`);
  process.exit(1);
}
