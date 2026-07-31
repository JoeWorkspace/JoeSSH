import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import YAML from "yaml";

const EXPECTED_GITLEAKS_VERSION = "8.30.1";
const EXPECTED_GITLEAKS_LINUX_X64_SHA256 =
  "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb";
const EXPECTED_GITLEAKS_ASSET_URL =
  "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz";
const EXPECTED_GITLEAKS_CONFIG_SHA256 =
  "17692ae221e51b1fe8fa4cd7862e02258d23a8873fc75ebd12251a0372fa2dfe";
const EXPECTED_GITLEAKS_IGNORE_SHA256 =
  "a60c709073214edf6582b7cb911364b184743516b30a4970493195d04ee47ccf";

const options = parseArgs(process.argv.slice(2));
const root = resolve(options.root ?? resolve(import.meta.dirname, ".."));
const configPath = resolve(root, ".gitleaks.toml");
const ignorePath = resolve(root, ".gitleaksignore");
const command = process.env.JOESSH_GITLEAKS_COMMAND ?? "gitleaks";
const prefixArgs = parsePrefixArgs(process.env.JOESSH_GITLEAKS_ARGS);

assertReviewedConfiguration(configPath, ignorePath);
assertReleaseWiring(root);

const versionResult = run(["version"]);
if (!versionResult.ok) {
  fail(
    "Gitleaks is required for the pre-publication full-history scan.",
    versionResult,
  );
}
const versionText = firstLine(
  `${versionResult.stdout}\n${versionResult.stderr}`,
);
const installedVersion = parseVersion(versionText);
if (installedVersion !== EXPECTED_GITLEAKS_VERSION) {
  console.error(
    `Unsupported Gitleaks version: ${sanitize(versionText || "unknown")}. Exact version ${EXPECTED_GITLEAKS_VERSION} is required.`,
  );
  process.exit(1);
}

const scanResult = run([
  "git",
  "--redact=100",
  "--no-banner",
  "--no-color",
  `--config=${configPath}`,
  `--gitleaks-ignore-path=${ignorePath}`,
  "--log-opts=--all",
  root,
]);
if (!scanResult.ok) {
  fail(
    "Full Git history secret scan failed. Treat findings as potential credential exposure; rotate real credentials before considering any history rewrite.",
    scanResult,
  );
}

console.log(
  `PASS Full Git history secret scan completed with ${sanitize(versionText)}.`,
);
console.log(
  "No report containing secret material was written to the repository.",
);

function run(args) {
  const result = spawnSync(command, [...prefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20 * 60_000,
    windowsHide: true,
  });
  return {
    error: result.error ?? null,
    ok: !result.error && result.status === 0,
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function parseArgs(args) {
  let rootValue = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      rootValue = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      rootValue = arg.slice("--root=".length);
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
  return { root: rootValue };
}

function parsePrefixArgs(value) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 1 &&
      parsed.every(
        (entry) =>
          typeof entry === "string" &&
          isAbsolute(entry) &&
          !entry.startsWith("-") &&
          !/[\0\r\n]/.test(entry),
      )
    ) {
      return parsed;
    }
  } catch {
    // Stable error below.
  }
  console.error(
    "JOESSH_GITLEAKS_ARGS may contain exactly one absolute wrapper path and no flags.",
  );
  process.exit(2);
}

function parseVersion(value) {
  const match = value.match(/\bv?(\d+\.\d+\.\d+)\b/i);
  return match?.[1] ?? null;
}

function assertReviewedConfiguration(reviewedConfigPath, reviewedIgnorePath) {
  const expectedConfig = [
    'title = "JoeSSH Gitleaks configuration"',
    "",
    "[extend]",
    "useDefault = true",
  ].join("\n");
  let actualConfig;
  let actualIgnore;
  try {
    actualConfig = readFileSync(reviewedConfigPath, "utf8")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .trim();
    actualIgnore = readFileSync(reviewedIgnorePath, "utf8")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n");
  } catch (error) {
    console.error(
      `Reviewed Gitleaks configuration is required: ${sanitize(error.message)}`,
    );
    process.exit(1);
  }

  if (actualConfig !== expectedConfig) {
    console.error(
      "The Gitleaks configuration must only extend the upstream default rules.",
    );
    process.exit(1);
  }

  const actualFingerprints = actualIgnore
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const expectedFingerprints = [
    "9940faf60b265170bc9bb500afc1a48a0a306956:apps/mobile/services/sync.test.ts:generic-api-key:134",
    "9940faf60b265170bc9bb500afc1a48a0a306956:apps/mobile/services/sync.test.ts:generic-api-key:235",
    "d0ee222062acc5427680464e558913dcc1922428:apps/desktop/src/main.tsx:generic-api-key:206",
    "5e5f1eded2d1f1959193d2d76c4136fd14a81063:apps/desktop/src/safety.test.ts:curl-auth-header:248",
    "5e5f1eded2d1f1959193d2d76c4136fd14a81063:apps/desktop/src/safety.test.ts:curl-auth-header:249",
    "5e5f1eded2d1f1959193d2d76c4136fd14a81063:apps/desktop/src/terminalExecutor.test.ts:curl-auth-header:74",
    "5e5f1eded2d1f1959193d2d76c4136fd14a81063:crates/core/src/ssh.rs:private-key:751",
    "5e5f1eded2d1f1959193d2d76c4136fd14a81063:apps/desktop/src/main.tsx:generic-api-key:140",
    "5e5f1eded2d1f1959193d2d76c4136fd14a81063:services/sync/src/config.rs:generic-api-key:351",
  ];
  if (
    actualFingerprints.length !== expectedFingerprints.length ||
    actualFingerprints.some(
      (fingerprint, index) => fingerprint !== expectedFingerprints[index],
    )
  ) {
    console.error(
      "The Gitleaks ignore file must contain only the nine reviewed historical fixture fingerprints.",
    );
    process.exit(1);
  }
}

function assertReleaseWiring(repositoryRoot) {
  const packagePath = resolve(repositoryRoot, "package.json");
  const workflowPath = resolve(
    repositoryRoot,
    ".github",
    "workflows",
    "ci.yml",
  );
  let packageJson;
  let workflow;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    workflow = YAML.parse(readFileSync(workflowPath, "utf8"), {
      prettyErrors: true,
      uniqueKeys: true,
    });
  } catch (error) {
    console.error(
      `Release secret-scan wiring must be readable and structurally valid: ${sanitize(error.message)}`,
    );
    process.exit(1);
  }

  const expectedContractScript =
    "npm run qa:commercial:community && npm run qa:desktop-release-workflow-security && npm run test:github-release-controls && npm run test:git-history-secrets && npm run qa:windows-store-release";
  const scripts = packageJson.scripts ?? {};
  if (
    scripts["release:history-secret-scan"] !==
      "node scripts/check-git-history-secrets.mjs" ||
    scripts["qa:release-preparation:contracts"] !== expectedContractScript ||
    scripts["qa:release-preparation"] !==
      "npm run qa:release-preparation:contracts && npm run release:history-secret-scan"
  ) {
    console.error(
      "qa:release-preparation must run the reviewed contracts and the real full-history secret scan.",
    );
    process.exit(1);
  }

  const lintSteps = workflow?.jobs?.lint?.steps;
  if (!Array.isArray(lintSteps)) {
    console.error(
      "CI lint steps are required for the full-history secret scan.",
    );
    process.exit(1);
  }

  const checkoutIndex = lintSteps.findIndex(
    (step) =>
      typeof step?.uses === "string" &&
      /^actions\/checkout@[0-9a-f]{40}$/.test(step.uses) &&
      step.with?.["fetch-depth"] === 0 &&
      step.with?.["persist-credentials"] === false,
  );
  const installIndex = lintSteps.findIndex(
    (step) => step?.name === "Install pinned Gitleaks",
  );
  const preinstallScanIndex = lintSteps.findIndex(
    (step) =>
      step?.name === "Scan full Git history before dependency installation",
  );
  const npmCiIndex = lintSteps.findIndex(
    (step) => step?.run?.trim() === "npm ci",
  );
  const releaseGateIndex = lintSteps.findIndex(
    (step) => step?.run?.trim() === "npm run qa:release-preparation",
  );
  const installStep = lintSteps[installIndex];
  const expectedInstallRun = [
    "set -euo pipefail",
    `readonly asset_url="${EXPECTED_GITLEAKS_ASSET_URL}"`,
    'readonly archive="${RUNNER_TEMP}/gitleaks_8.30.1_linux_x64.tar.gz"',
    'readonly bin_dir="${RUNNER_TEMP}/gitleaks-bin"',
    'readonly gitleaks_bin="${bin_dir}/gitleaks"',
    "",
    "curl --fail --silent --show-error --location \\",
    '  --proto "=https" \\',
    "  --tlsv1.2 \\",
    '  --output "${archive}" \\',
    '  "${asset_url}"',
    'printf "%s  %s\\n" "${GITLEAKS_LINUX_X64_SHA256}" "${archive}" |',
    "  sha256sum --check --strict -",
    "",
    'mkdir -p "${bin_dir}"',
    'tar --extract --gzip --file "${archive}" --directory "${bin_dir}" gitleaks',
    'chmod 0755 "${gitleaks_bin}"',
    'actual_version="$("${gitleaks_bin}" version | tr -d "\\r")"',
    'if [[ "${actual_version}" != "${GITLEAKS_VERSION}" ]]; then',
    '  printf "Expected Gitleaks %s, got %s.\\n" \\',
    '    "${GITLEAKS_VERSION}" "${actual_version}" >&2',
    "  exit 1",
    "fi",
  ].join("\n");
  const expectedPreinstallScanRun = [
    "set -euo pipefail",
    'readonly gitleaks_bin="${RUNNER_TEMP}/gitleaks-bin/gitleaks"',
    "",
    'printf "%s  %s\\n" "${GITLEAKS_CONFIG_SHA256}" "${GITHUB_WORKSPACE}/.gitleaks.toml" |',
    "  sha256sum --check --strict -",
    'printf "%s  %s\\n" "${GITLEAKS_IGNORE_SHA256}" "${GITHUB_WORKSPACE}/.gitleaksignore" |',
    "  sha256sum --check --strict -",
    "",
    'actual_version="$("${gitleaks_bin}" version | tr -d "\\r")"',
    'if [[ "${actual_version}" != "${GITLEAKS_VERSION}" ]]; then',
    '  printf "Expected Gitleaks %s, got %s.\\n" \\',
    '    "${GITLEAKS_VERSION}" "${actual_version}" >&2',
    "  exit 1",
    "fi",
    '"${gitleaks_bin}" git \\',
    "  --redact=100 \\",
    "  --no-banner \\",
    "  --no-color \\",
    '  --config="${GITHUB_WORKSPACE}/.gitleaks.toml" \\',
    '  --gitleaks-ignore-path="${GITHUB_WORKSPACE}/.gitleaksignore" \\',
    "  --log-opts=--all \\",
    '  "${GITHUB_WORKSPACE}"',
  ].join("\n");
  const installContractMatches =
    installStep?.shell === "bash" &&
    installStep?.env?.GITLEAKS_VERSION === EXPECTED_GITLEAKS_VERSION &&
    installStep?.env?.GITLEAKS_LINUX_X64_SHA256 ===
      EXPECTED_GITLEAKS_LINUX_X64_SHA256 &&
    installStep?.run?.trim() === expectedInstallRun &&
    installStep?.["continue-on-error"] !== true;
  const preinstallScanStep = lintSteps[preinstallScanIndex];
  const preinstallScanContractMatches =
    preinstallScanStep?.shell === "bash" &&
    preinstallScanStep?.env?.GITLEAKS_VERSION === EXPECTED_GITLEAKS_VERSION &&
    preinstallScanStep?.env?.GITLEAKS_CONFIG_SHA256 ===
      EXPECTED_GITLEAKS_CONFIG_SHA256 &&
    preinstallScanStep?.env?.GITLEAKS_IGNORE_SHA256 ===
      EXPECTED_GITLEAKS_IGNORE_SHA256 &&
    preinstallScanStep?.run?.trim() === expectedPreinstallScanRun &&
    preinstallScanStep?.["continue-on-error"] !== true;
  const releaseGateStep = lintSteps[releaseGateIndex];
  const releaseGateUsesAbsoluteBinary =
    releaseGateStep?.env?.JOESSH_GITLEAKS_COMMAND ===
    "${{ runner.temp }}/gitleaks-bin/gitleaks";
  if (
    checkoutIndex < 0 ||
    installIndex <= checkoutIndex ||
    preinstallScanIndex <= installIndex ||
    npmCiIndex <= preinstallScanIndex ||
    releaseGateIndex <= npmCiIndex ||
    !installContractMatches ||
    !preinstallScanContractMatches ||
    !releaseGateUsesAbsoluteBinary ||
    releaseGateStep?.["continue-on-error"] === true
  ) {
    console.error(
      "CI lint must fetch full history, install and SHA-256 verify exact Gitleaks 8.30.1, scan through its absolute path before dependency installation, then run the real release-preparation gate with that absolute path.",
    );
    process.exit(1);
  }
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${flag} requires a value.`);
    process.exit(2);
  }
  return value;
}

function fail(message, result) {
  const diagnostic = result.error
    ? result.error.message
    : `${result.stderr}\n${result.stdout}`.trim() ||
      `exit status ${String(result.status)}`;
  console.error(`${message}\n${sanitize(diagnostic)}`);
  process.exit(1);
}

function firstLine(value) {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function sanitize(value) {
  return String(value)
    .replace(
      /\b(?:ghp|github_pat|sk_live|sk_test)_[A-Za-z0-9_-]{8,}\b/g,
      "<redacted-token>",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}
