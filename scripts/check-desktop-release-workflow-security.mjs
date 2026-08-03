import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const defaultWorkflowPath = resolve(
  import.meta.dirname,
  "..",
  ".github/workflows/desktop-release-artifacts.yml",
);

const EXPECTED_MATRIX = [
  {
    platform: "windows",
    os: "windows-2025",
    runner_arch: "x86_64",
    bundles: "nsis",
  },
  {
    platform: "macos",
    os: "macos-15",
    runner_arch: "arm64",
    bundles: "dmg",
  },
  {
    platform: "linux",
    os: "ubuntu-24.04",
    runner_arch: "x86_64",
    bundles: "appimage deb",
  },
];

const EXPECTED_ACTIONS = [
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "dtolnay/rust-toolchain@2c7215f132e9ebf062739d9130488b56d53c060c",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
];

const EXPECTED_GUARD_SCRIPT = [
  "set -euo pipefail",
  'if [[ "${FORMAL_EVIDENCE}" == "true" ]]; then',
  'echo "FORMAL_SIGNING_DISABLED: Desktop formal signing and notarization automation is disabled." >&2',
  "exit 1",
  "fi",
  'if [[ ! "${RETENTION_DAYS}" =~ ^([1-9]|[12][0-9]|30)$ ]]; then',
  'echo "retention_days must be 1 through 30." >&2',
  "exit 1",
  "fi",
].join("\n");

const EXPECTED_ARCHITECTURE_SCRIPT = [
  "set -euo pipefail",
  'actual_arch="$(uname -m)"',
  'if [[ "${actual_arch}" != "${EXPECTED_RUNNER_ARCH}" ]]; then',
  'echo "Expected unsigned runner architecture ${EXPECTED_RUNNER_ARCH}, received ${actual_arch}." >&2',
  "exit 1",
  "fi",
].join("\n");

const EXPECTED_NPM_PIN_SCRIPT = [
  "set -euo pipefail",
  "npm install --global --ignore-scripts --no-audit --no-fund npm@10.9.7",
  'test "$(npm --version)" = "10.9.7"',
].join("\n");

const EXPECTED_LINUX_DEPENDENCIES = [
  "set -euo pipefail",
  "sudo apt-get update",
  "sudo apt-get install -y \\",
  "build-essential \\",
  "curl \\",
  "file \\",
  "libayatana-appindicator3-dev \\",
  "librsvg2-dev \\",
  "libssl-dev \\",
  "libwebkit2gtk-4.1-dev \\",
  "libxdo-dev \\",
  "patchelf \\",
  "wget",
].join("\n");

const EXPECTED_UPLOAD_PATHS = [
  "apps/desktop/src-tauri/target/release/bundle/**/*.AppImage",
  "apps/desktop/src-tauri/target/release/bundle/**/*.deb",
  "apps/desktop/src-tauri/target/release/bundle/**/*.dmg",
  "apps/desktop/src-tauri/target/release/bundle/**/*.exe",
  "apps/desktop/src-tauri/target/release/bundle/**/*.msi",
  "apps/desktop/src-tauri/target/release/bundle/**/*.msix",
  "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
  "reports/release/third-party-licenses/manifest.json",
  "reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt",
];

const FORBIDDEN_FORMAL_MARKERS = [
  "desktop-release-evidence",
  "Package Formal Desktop Evidence",
  "Import-PfxCertificate",
  "security import",
  "notarytool",
  "codesign",
  "signtool",
  "ATLASTERM_WINDOWS_CERTIFICATE",
  "ATLASTERM_APPLE_CERTIFICATE",
  "windows-signature-verification",
  "macos-signature-verification",
  "macos-notarization-verification",
];

const REPOSITORY_EXECUTION_PATTERN =
  /\b(?:npm|npx|pnpm|yarn|cargo|rustc|tauri)\b|release:desktop|apt-get\s+(?:install|update)/;

export function checkDesktopReleaseWorkflowSecurity(workflowText) {
  const checks = [];
  const parsed = parseWorkflow(workflowText);
  if (!parsed.ok) {
    return [
      {
        label: `Workflow YAML parses with unique keys: ${parsed.error}`,
        passed: false,
      },
    ];
  }

  const workflow = parsed.value;
  const jobs = isRecord(workflow?.jobs) ? workflow.jobs : {};
  const jobNames = Object.keys(jobs);
  const policyJob = jobs.policy;
  const buildJob = jobs["build-unsigned"];
  const policySteps = Array.isArray(policyJob?.steps) ? policyJob.steps : [];
  const buildSteps = Array.isArray(buildJob?.steps) ? buildJob.steps : [];
  const allSteps = [...policySteps, ...buildSteps];

  const workflowDispatch = workflow?.on?.workflow_dispatch;
  const formalInput = workflowDispatch?.inputs?.formal_evidence;
  const retentionInput = workflowDispatch?.inputs?.retention_days;
  add(
    checks,
    isExactRecord(workflow, [
      "name",
      "on",
      "concurrency",
      "permissions",
      "jobs",
    ]) &&
      workflow?.name === "Desktop Release Artifacts" &&
      isExactRecord(workflow?.on, ["workflow_dispatch"]) &&
      isExactRecord(workflowDispatch, ["inputs"]) &&
      isExactRecord(workflowDispatch?.inputs, [
        "formal_evidence",
        "retention_days",
      ]) &&
      isExactRecord(formalInput, [
        "description",
        "required",
        "default",
        "type",
      ]) &&
      formalInput?.required === true &&
      formalInput?.default === false &&
      formalInput?.type === "boolean" &&
      isExactRecord(retentionInput, [
        "description",
        "required",
        "default",
        "type",
      ]) &&
      retentionInput?.required === true &&
      retentionInput?.default === "14" &&
      retentionInput?.type === "string" &&
      isExactRecord(workflow?.concurrency, ["group", "cancel-in-progress"]) &&
      workflow?.concurrency?.group ===
        "${{ github.workflow }}-${{ github.ref }}" &&
      workflow?.concurrency?.["cancel-in-progress"] === false,
    "Workflow preserves the reviewed dispatch contract and formal_evidence compatibility input",
  );

  add(
    checks,
    isExactReadPermission(workflow?.permissions) &&
      jobNames.join(",") === "policy,build-unsigned" &&
      jobNames[0] === "policy",
    "Workflow is structurally limited to the policy gate and unsigned staging job",
  );

  const guard = policySteps[0];
  add(
    checks,
    isExactRecord(policyJob, ["name", "runs-on", "permissions", "steps"]) &&
      policyJob?.name === "Enforce unsigned staging policy" &&
      policyJob?.["runs-on"] === "ubuntu-24.04" &&
      isExactReadPermission(policyJob?.permissions) &&
      !Object.hasOwn(policyJob ?? {}, "environment") &&
      policySteps.length === 1 &&
      isExactRecord(guard, ["name", "shell", "env", "run"]) &&
      guard?.name === "Reject disabled formal signing" &&
      guard?.shell === "bash" &&
      isExactRecord(guard?.env, ["FORMAL_EVIDENCE", "RETENTION_DAYS"]) &&
      guard?.env?.FORMAL_EVIDENCE === "${{ inputs.formal_evidence }}" &&
      guard?.env?.RETENTION_DAYS === "${{ inputs.retention_days }}" &&
      normalizedExecutableScript(guard?.run) === EXPECTED_GUARD_SCRIPT &&
      sameArray(buildJob?.needs, ["policy"]) &&
      !Object.hasOwn(buildJob ?? {}, "if"),
    "Formal requests fail closed with FORMAL_SIGNING_DISABLED before any build",
  );

  const serialized = JSON.stringify(workflow);
  const forbiddenKeys = collectForbiddenKeys(workflow);
  add(
    checks,
    forbiddenKeys.length === 0 &&
      !/\$\{\{\s*secrets\./.test(serialized) &&
      !FORBIDDEN_FORMAL_MARKERS.some((marker) => serialized.includes(marker)),
    "No job exposes environments, id-token, GitHub secrets, or signing and notarization commands",
  );

  const repositoryExecutionJobs = Object.entries(jobs)
    .filter(([, job]) =>
      (Array.isArray(job?.steps) ? job.steps : []).some((step) =>
        REPOSITORY_EXECUTION_PATTERN.test(
          normalizedExecutableScript(step?.run),
        ),
      ),
    )
    .map(([jobName]) => jobName);
  add(
    checks,
    repositoryExecutionJobs.length === 1 &&
      repositoryExecutionJobs[0] === "build-unsigned" &&
      isUnprivilegedJob(buildJob),
    "Repository build code runs only in the unprivileged unsigned job",
  );

  add(
    checks,
    isExactRecord(buildJob, [
      "name",
      "needs",
      "runs-on",
      "permissions",
      "strategy",
      "steps",
    ]) &&
      buildJob?.name === "Build unsigned Desktop ${{ matrix.platform }}" &&
      sameArray(buildJob?.needs, ["policy"]) &&
      buildJob?.["runs-on"] === "${{ matrix.os }}" &&
      isExactReadPermission(buildJob?.permissions) &&
      !Object.hasOwn(buildJob ?? {}, "environment") &&
      buildJob?.strategy?.["fail-fast"] === false &&
      isExactRecord(buildJob?.strategy, ["fail-fast", "matrix"]) &&
      isExactRecord(buildJob?.strategy?.matrix, ["include"]) &&
      JSON.stringify(buildJob?.strategy?.matrix?.include) ===
        JSON.stringify(EXPECTED_MATRIX),
    "Unsigned matrix uses fixed runners, exact architectures, and reviewed bundle targets",
  );

  const actionReferences = allSteps
    .filter((step) => Object.hasOwn(step ?? {}, "uses"))
    .map((step) => step.uses);
  const checkout = buildSteps[1];
  add(
    checks,
    JSON.stringify(actionReferences) === JSON.stringify(EXPECTED_ACTIONS) &&
      actionReferences.every(
        (reference) =>
          typeof reference === "string" &&
          !reference.startsWith("docker://") &&
          /^[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)+@[a-f0-9]{40}$/i.test(reference),
      ) &&
      isExactRecord(checkout, ["uses", "with"]) &&
      checkout?.uses === EXPECTED_ACTIONS[0] &&
      isExactRecord(checkout?.with, ["persist-credentials", "ref"]) &&
      checkout?.with?.["persist-credentials"] === false &&
      checkout?.with?.ref === "${{ github.sha }}",
    "Every action is full-SHA pinned and checkout credentials are disabled",
  );

  const architecture = buildSteps[0];
  add(
    checks,
    buildSteps.length === 10 &&
      isExactRecord(architecture, ["name", "shell", "env", "run"]) &&
      architecture?.name === "Assert unsigned runner architecture" &&
      architecture?.shell === "bash" &&
      isExactRecord(architecture?.env, ["EXPECTED_RUNNER_ARCH"]) &&
      architecture?.env?.EXPECTED_RUNNER_ARCH === "${{ matrix.runner_arch }}" &&
      normalizedExecutableScript(architecture?.run) ===
        EXPECTED_ARCHITECTURE_SCRIPT,
    "Unsigned build verifies the exact matrix runner architecture before checkout",
  );

  const node = buildSteps[2];
  const npmPin = buildSteps[3];
  const rust = buildSteps[4];
  const linuxDependencies = buildSteps[5];
  const install = buildSteps[6];
  add(
    checks,
    isExactRecord(node, ["uses", "with"]) &&
      node?.uses === EXPECTED_ACTIONS[1] &&
      isExactRecord(node?.with, ["node-version"]) &&
      node?.with?.["node-version"] === "22.22.2" &&
      isExactRecord(npmPin, ["name", "shell", "run"]) &&
      npmPin?.name === "Pin npm 10.9.7" &&
      npmPin?.shell === "bash" &&
      normalizedExecutableScript(npmPin?.run) === EXPECTED_NPM_PIN_SCRIPT &&
      isExactRecord(rust, ["uses", "with"]) &&
      rust?.uses === EXPECTED_ACTIONS[2] &&
      isExactRecord(rust?.with, ["toolchain"]) &&
      rust?.with?.toolchain === "1.96.0" &&
      isExactRecord(linuxDependencies, ["name", "if", "shell", "run"]) &&
      linuxDependencies?.name === "Install Tauri Linux dependencies" &&
      linuxDependencies?.if === "runner.os == 'Linux'" &&
      linuxDependencies?.shell === "bash" &&
      normalizedExecutableScript(linuxDependencies?.run) ===
        EXPECTED_LINUX_DEPENDENCIES &&
      isExactRecord(install, ["name", "shell", "run"]) &&
      install?.name === "Install locked dependencies" &&
      install?.shell === "bash" &&
      normalizedExecutableScript(install?.run) ===
        "npm ci --no-audit --no-fund",
    "Unsigned toolchains and dependency installation are exact-pinned",
  );

  const legal = buildSteps[7];
  const build = buildSteps[8];
  add(
    checks,
    isExactRecord(legal, ["name", "shell", "run"]) &&
      legal?.name === "Generate and verify Desktop legal resource" &&
      legal?.shell === "bash" &&
      normalizedExecutableScript(legal?.run) ===
        "npm run release:desktop:legal-resource" &&
      isExactRecord(build, ["name", "env", "run"]) &&
      build?.name === "Build unsigned Desktop bundle" &&
      isExactRecord(build?.env, ["ATLASTERM_DESKTOP_RELEASE_BUNDLES"]) &&
      build?.env?.ATLASTERM_DESKTOP_RELEASE_BUNDLES ===
        "${{ matrix.bundles }}" &&
      normalizedExecutableScript(build?.run) ===
        "npm run release:desktop:build" &&
      buildSteps.indexOf(legal) < buildSteps.indexOf(build),
    "Legal resources are generated and verified before the unsigned build",
  );

  const upload = buildSteps[9];
  const uploadPaths = normalizedPathList(upload?.with?.path);
  add(
    checks,
    isExactRecord(upload, ["name", "uses", "with"]) &&
      upload?.name === "Upload unsigned Desktop bundle" &&
      upload?.uses === EXPECTED_ACTIONS[3] &&
      isExactRecord(upload?.with, [
        "name",
        "path",
        "if-no-files-found",
        "retention-days",
      ]) &&
      upload?.with?.name === "desktop-unsigned-bundle-${{ matrix.platform }}" &&
      JSON.stringify(uploadPaths) === JSON.stringify(EXPECTED_UPLOAD_PATHS) &&
      upload?.with?.["if-no-files-found"] === "error" &&
      upload?.with?.["retention-days"] ===
        "${{ fromJSON(inputs.retention_days) }}" &&
      !/(?:formal|evidence|signature|notari)/i.test(
        [upload?.with?.name, ...uploadPaths].join("\n"),
      ),
    "Only explicitly unsigned artifacts are uploaded and cannot masquerade as formal evidence",
  );

  return checks;
}

function parseWorkflow(workflowText) {
  try {
    const document = parseDocument(workflowText, {
      merge: false,
      prettyErrors: true,
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) {
      throw new Error(document.errors.map((error) => error.message).join("; "));
    }
    const value = document.toJS({ maxAliasCount: 0 });
    if (!isRecord(value)) {
      throw new Error("workflow root must be a mapping");
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function collectForbiddenKeys(value, path = [], findings = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectForbiddenKeys(entry, [...path, String(index)], findings),
    );
    return findings;
  }
  if (!isRecord(value)) {
    return findings;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "environment" || key === "id-token" || key === "secrets") {
      findings.push([...path, key].join("."));
    }
    collectForbiddenKeys(child, [...path, key], findings);
  }
  return findings;
}

function isUnprivilegedJob(job) {
  return (
    isExactReadPermission(job?.permissions) &&
    !Object.hasOwn(job ?? {}, "environment") &&
    collectForbiddenKeys(job).length === 0 &&
    !/\$\{\{\s*secrets\./.test(JSON.stringify(job ?? {}))
  );
}

function normalizedExecutableScript(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function normalizedPathList(value) {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isExactReadPermission(value) {
  return isExactRecord(value, ["contents"]) && value.contents === "read";
}

function isExactRecord(value, expectedKeys) {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expectedKeys].sort())
  );
}

function sameArray(value, expected) {
  return (
    Array.isArray(value) && JSON.stringify(value) === JSON.stringify(expected)
  );
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function add(checks, passed, label) {
  checks.push({ label, passed: Boolean(passed) });
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const workflowPath = resolve(process.argv[2] ?? defaultWorkflowPath);
    const results = checkDesktopReleaseWorkflowSecurity(
      readFileSync(workflowPath, "utf8").replace(/^\uFEFF/, ""),
    );
    for (const result of results) {
      console.log(`${result.passed ? "[PASS]" : "[FAIL]"} ${result.label}`);
    }
    const failures = results.filter((result) => !result.passed);
    if (failures.length > 0) {
      process.exitCode = 1;
    } else {
      console.log(
        "Desktop unsigned release workflow security contract passed.",
      );
    }
  } catch (error) {
    console.error(`${basename(import.meta.url)}: ${error.message}`);
    process.exitCode = 1;
  }
}
