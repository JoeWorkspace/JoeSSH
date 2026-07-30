import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(
  new URL("./check-desktop-release-evidence-parity.mjs", import.meta.url),
);
const REQUIRED_SECRETS = [
  "ATLASTERM_WINDOWS_CERTIFICATE",
  "ATLASTERM_WINDOWS_CERTIFICATE_PASSWORD",
  "ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT",
  "ATLASTERM_WINDOWS_TIMESTAMP_URL",
  "ATLASTERM_APPLE_CERTIFICATE",
  "ATLASTERM_APPLE_CERTIFICATE_PASSWORD",
  "ATLASTERM_APPLE_ID",
  "ATLASTERM_APPLE_PASSWORD",
  "ATLASTERM_APPLE_TEAM_ID",
  "ATLASTERM_KEYCHAIN_PASSWORD",
];

function createFixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "desktop-release-parity-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
  });

  const files = {
    ".github/workflows/desktop-release-artifacts.yml": createWorkflowFixture(),
    "scripts/configure-desktop-release-secrets.mjs": [
      "reports/handoff/desktop/secret-input-template.env",
      "desktop-release-evidence-preflight.mjs",
      ...REQUIRED_SECRETS,
    ].join("\n"),
    "scripts/desktop-release-evidence-preflight.mjs": [
      "desktop-release-artifacts.yml",
      "formal_evidence=true",
      "workflowRunArgs",
      "must be published to origin",
      ...REQUIRED_SECRETS,
    ].join("\n"),
    "scripts/diagnose-desktop-release-evidence.mjs": [
      "desktop-release-artifacts.yml",
      "reports/handoff/desktop/formal-evidence-unblock-report.json",
      "release-remote-ref",
      "desktop-signing-secrets",
      "github-ci",
      ...REQUIRED_SECRETS,
    ].join("\n"),
    "scripts/download-desktop-release-evidence.mjs": [
      "desktop-release-evidence",
      "Package Formal Desktop Evidence",
      "reports/release/desktop/release-evidence-source.json",
      "verify-desktop-release-evidence.mjs",
      "--require-source",
    ].join("\n"),
    "scripts/verify-desktop-release-evidence.mjs": [
      "desktop-release-evidence",
      "Package Formal Desktop Evidence",
      "reports/release/desktop/release-evidence-source.json",
      "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    ].join("\n"),
    "docs/desktop-distribution.md": [
      "Desktop Release Artifacts",
      "desktop-release-artifacts.yml",
      "desktop-release-evidence",
      "Package Formal Desktop Evidence",
      "reports/handoff/desktop/formal-evidence-unblock-report.json",
      "reports/release/desktop/release-evidence-source.json",
      "reports/release/desktop/release-evidence-SHA256SUMS.txt",
      ...REQUIRED_SECRETS,
    ].join("\n"),
    "docs/release-checklist.md": [
      "desktop-release-evidence",
      "Package Formal Desktop Evidence",
      "reports/handoff/desktop/formal-evidence-unblock-report.json",
      "reports/release/desktop/release-evidence-source.json",
      "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    ].join("\n"),
    "docs/repository-release-handoff.md": [
      "reports/handoff/desktop/formal-evidence-unblock-report.json",
      "reports/release/desktop/release-evidence-source.json",
    ].join("\n"),
    ...overrides,
  };

  for (const [relativePath, content] of Object.entries(files)) {
    writeFile(root, relativePath, `${content}\n`);
  }
  return root;
}

function createWorkflowFixture({ leakAppleCredential = false } = {}) {
  const windowsSecrets = REQUIRED_SECRETS.filter((secret) => secret.startsWith("ATLASTERM_WINDOWS_"));
  const appleSecrets = REQUIRED_SECRETS.filter(
    (secret) => secret.startsWith("ATLASTERM_APPLE_") || secret === "ATLASTERM_KEYCHAIN_PASSWORD",
  );
  const notarizationSecrets = [
    "ATLASTERM_APPLE_ID",
    "ATLASTERM_APPLE_PASSWORD",
    "ATLASTERM_APPLE_TEAM_ID",
  ];

  return [
    "name: Desktop Release Artifacts",
    "formal_evidence",
    "name: Package Formal Desktop Evidence",
    "name: desktop-release-evidence",
    "    steps:",
    "      - name: Prepare Windows signing certificate",
    "        if: runner.os == 'Windows' && inputs.formal_evidence",
    "        env:",
    ...windowsSecrets.map((secret) => `          ${secret}: \${{ secrets.${secret} }}`),
    "      - name: Prepare macOS signing certificate",
    "        if: runner.os == 'macOS' && inputs.formal_evidence",
    "        env:",
    ...appleSecrets.map((secret) => `          ${secret}: \${{ secrets.${secret} }}`),
    "      - name: Build Desktop bundle",
    "        if: runner.os != 'macOS' || inputs.formal_evidence == false",
    ...(leakAppleCredential
      ? ["        env:", "          APPLE_PASSWORD: ${{ secrets.ATLASTERM_APPLE_PASSWORD }}"]
      : []),
    "        run: npm run release:desktop:build",
    "      - name: Build formal macOS Desktop bundle",
    "        if: runner.os == 'macOS' && inputs.formal_evidence",
    "        env:",
    ...notarizationSecrets.map((secret) => `          ${secret}: \${{ secrets.${secret} }}`),
    "        run: npm run release:desktop:build",
  ].join("\n");
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function runParity(root) {
  return spawnSync(process.execPath, [SCRIPT_PATH, "--root", root], {
    encoding: "utf8",
  });
}

test("passes when workflow, scripts, and docs share the Desktop evidence contract", (t) => {
  const result = runParity(createFixture(t));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Desktop release evidence parity checks passed/);
});

test("fails when the workflow omits a required signing secret", (t) => {
  const workflow = [
    "name: Desktop Release Artifacts",
    "formal_evidence",
    "name: Package Formal Desktop Evidence",
    "name: desktop-release-evidence",
    ...REQUIRED_SECRETS.filter((secret) => secret !== "ATLASTERM_APPLE_PASSWORD").map(
      (secret) => `\${{ secrets.${secret} }}`,
    ),
  ].join("\n");

  const result = runParity(
    createFixture(t, {
      ".github/workflows/desktop-release-artifacts.yml": workflow,
    }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Desktop release workflow references GitHub secret ATLASTERM_APPLE_PASSWORD/);
});

test("fails when release docs drift from the formal evidence artifact name", (t) => {
  const result = runParity(
    createFixture(t, {
      "docs/desktop-distribution.md": [
        "Desktop Release Artifacts",
        "desktop-release-artifacts.yml",
        "formal-desktop-evidence",
        "Package Formal Desktop Evidence",
        "reports/handoff/desktop/formal-evidence-unblock-report.json",
        "reports/release/desktop/release-evidence-source.json",
        "reports/release/desktop/release-evidence-SHA256SUMS.txt",
        ...REQUIRED_SECRETS,
      ].join("\n"),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL docs\/desktop-distribution\.md documents 'desktop-release-evidence'/);
});

test("fails when the unsigned Desktop build receives an Apple credential", (t) => {
  const result = runParity(
    createFixture(t, {
      ".github/workflows/desktop-release-artifacts.yml": createWorkflowFixture({
        leakAppleCredential: true,
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Unsigned Desktop build excludes Apple signing credentials/);
});
