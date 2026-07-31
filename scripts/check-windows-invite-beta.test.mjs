import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  checkWindowsInviteBeta,
  formatWindowsInviteBetaResults,
} from "./check-windows-invite-beta.mjs";

test("accepts a scoped and fail-closed Windows invite Beta contract", (t) => {
  const root = createFixture(t);
  const results = checkWindowsInviteBeta(root);

  assert.equal(
    results.every((result) => result.ok),
    true,
    formatWindowsInviteBetaResults(results),
  );
});

test("rejects a Windows package command that silently requires other platforms", (t) => {
  const root = createFixture(t, {
    packageWindowsCommand:
      "node scripts/package-desktop-release.mjs --require-platforms windows,macos,linux",
  });
  const results = checkWindowsInviteBeta(root);
  const output = formatWindowsInviteBetaResults(results);

  assert.match(
    output,
    /FAIL Windows invite packaging is isolated from formal multi-platform release evidence/,
  );
});

test("rejects an invite guide that omits the unsigned staging and privacy boundary", (t) => {
  const root = createFixture(t, {
    guide: "# Windows Desktop\n10–30 testers\n",
  });
  const results = checkWindowsInviteBeta(root);
  const output = formatWindowsInviteBetaResults(results);

  assert.match(
    output,
    /FAIL Windows invite guide records scope, staged rollout, signing, privacy, support, and stop rules/,
  );
});

test("rejects reviewed_sha interpolation directly inside PowerShell", (t) => {
  const workflow = createWorkflowFixture()
    .replace(
      "REVIEWED_SHA_INPUT: ${{ inputs.reviewed_sha }}",
      "REVIEWED_SHA_INPUT: placeholder",
    )
    .replace(
      '$env:REVIEWED_SHA_INPUT -cnotmatch "\\A[0-9a-fA-F]{40}\\z"',
      '"${{ inputs.reviewed_sha }}" -cnotmatch "\\A[0-9a-fA-F]{40}\\z"',
    );
  const root = createFixture(t, { workflow });
  const output = formatWindowsInviteBetaResults(checkWindowsInviteBeta(root));

  assert.match(
    output,
    /FAIL Windows workflow validates a full reviewed SHA passed to PowerShell only through env/,
  );
});

test("rejects a workflow without protected-main environment approval", (t) => {
  const workflow = createWorkflowFixture()
    .replace(
      "if: github.ref == 'refs/heads/main' && github.ref_protected == true",
      "if: true",
    )
    .replace("environment: windows-invite-stage-a", "environment: unprotected");
  const root = createFixture(t, { workflow });
  const output = formatWindowsInviteBetaResults(checkWindowsInviteBeta(root));

  assert.match(
    output,
    /FAIL Windows workflow binds approval to the protected main Stage A environment/,
  );
});

test("rejects a workflow that omits upload digest evidence", (t) => {
  const workflow = createWorkflowFixture().replace(
    "ARTIFACT_DIGEST: ${{ steps.upload.outputs.artifact-digest }}",
    "ARTIFACT_DIGEST: unavailable",
  );
  const root = createFixture(t, { workflow });
  const output = formatWindowsInviteBetaResults(checkWindowsInviteBeta(root));

  assert.match(
    output,
    /FAIL Windows workflow records hash-bound artifact evidence for external promotion review/,
  );
});

test("rejects a workflow with a floating Action tag", (t) => {
  const workflow = createWorkflowFixture().replace(
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "actions/upload-artifact@v7",
  );
  const root = createFixture(t, { workflow });
  const output = formatWindowsInviteBetaResults(checkWindowsInviteBeta(root));

  assert.match(
    output,
    /FAIL Windows workflow pins every external Action to a full commit SHA/,
  );
});

test("rejects a workflow with floating Node or npx tool resolution", (t) => {
  const workflow = createWorkflowFixture()
    .replace("node-version: 22.22.2", "node-version: 22")
    .replace(
      "npx --no-install playwright install chromium",
      "npx playwright install chromium",
    );
  const root = createFixture(t, { workflow });
  const output = formatWindowsInviteBetaResults(checkWindowsInviteBeta(root));

  assert.match(
    output,
    /FAIL Windows workflow is manual, least-privilege, Stage A-only, and handoff-only/,
  );
});

test("rejects a promotion gate without external anchors and stable snapshots", (t) => {
  const root = createFixture(t, {
    promotionScript: [
      "inviteDistributionReady: true",
      "3-5-trusted-technical-testers",
      "openP0 !== 0",
      "openP1 !== 0",
      'value.defender?.status !== "clean"',
      "HANDOFF-SHA256SUMS.txt",
      "inspectPortableExecutable",
      "inspectAuthenticode",
    ].join("\n"),
  });
  const output = formatWindowsInviteBetaResults(checkWindowsInviteBeta(root));

  assert.match(
    output,
    /FAIL Promotion revalidates external anchors, PE, Authenticode, stable snapshots, and unlinked inputs/,
  );
});

function createFixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "joessh-windows-beta-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));

  const packageWindowsCommand =
    overrides.packageWindowsCommand ??
    "node scripts/package-windows-invite-beta.mjs --stage-a";
  writeJson(root, "package.json", {
    scripts: {
      lint: "eslint apps/ packages/ scripts/ tests/e2e/ --ext .ts,.tsx,.mjs,.cjs",
      "test:windows-invite-beta":
        "node --test scripts/check-windows-invite-beta.test.mjs",
      "test:windows-invite-package":
        "node --test scripts/package-windows-invite-beta.test.mjs",
      "test:windows-invite-promotion":
        "node --test scripts/promote-windows-invite-beta.test.mjs",
      "test:rust-advisory-strict":
        "node --test scripts/run-rust-advisory-gate.test.mjs",
      "qa:beta:windows:contract":
        "npm run test:windows-invite-beta && npm run test:windows-invite-package && npm run test:windows-invite-promotion && node scripts/check-windows-invite-beta.mjs",
      "qa:beta:windows:source":
        "npm run qa:beta:windows:contract && npm run lint && npm run qa:desktop && npm run qa:desktop:subresource-integrity && npm run qa:desktop:security-headers && npm run qa:desktop:bundle-size && npm run qa:rust && npm run qa:rust-advisory:strict && npm run qa:tauri && npm run qa:prod-audit && npm run qa:e2e:desktop:fresh && npm run qa:e2e:desktop:visual:fresh",
      "qa:beta:windows:required":
        "npm run qa:beta:windows:source && npm run qa:desktop:real-ssh-smoke:required",
      "qa:beta:windows": "npm run qa:beta:windows:required",
      "qa:beta:windows:fixture":
        "node scripts/run-real-ssh-smoke-fixture.mjs -- npm run qa:beta:windows:source",
      "qa:rust-advisory:strict":
        "npm run test:rust-advisory-strict && node scripts/run-rust-advisory-gate.mjs",
      "qa:e2e:desktop:fresh": "npm run test:desktop:fresh -w @atlasterm/e2e --",
      "qa:e2e:desktop:visual:fresh":
        "npm run test:desktop:visual:fresh -w @atlasterm/e2e --",
      "release:desktop:package:windows-invite:stage-a": packageWindowsCommand,
      "release:desktop:package:windows-invite:stage-b":
        "node scripts/block-windows-invite-stage-b.mjs",
      "release:desktop:build:windows-invite":
        "node scripts/build-windows-invite-beta.mjs",
      "release:desktop:promote:windows-invite":
        "node scripts/promote-windows-invite-beta.mjs",
      "release:desktop:unsigned-staging-report":
        "node scripts/report-desktop-unsigned-staging.mjs",
    },
  });
  writeJson(root, "tests/e2e/package.json", {
    scripts: {
      "test:desktop:fresh":
        "node scripts/run-playwright-with-fresh-ports.mjs --config=playwright.desktop.config.ts",
      "test:desktop:visual:fresh":
        "node scripts/run-playwright-with-fresh-ports.mjs --config=playwright.desktop-visual.config.ts",
    },
  });
  writeFile(
    root,
    "tests/e2e/playwright.desktop.config.ts",
    "desktop-workbench desktop-accessibility webServer strictPort",
  );
  writeFile(
    root,
    "tests/e2e/playwright.desktop-visual.config.ts",
    "desktop-visual-wide desktop-visual-narrow width: 1440 width: 900 webServer",
  );
  writeFile(
    root,
    "scripts/package-windows-invite-beta.mjs",
    [
      'const WINDOWS_EXTENSIONS = new Set([".exe"]);',
      "Expected exactly one Desktop installer",
      "reports/handoff/desktop/windows-invite",
      "publicReleaseEvidence: false",
      "releaseEligible: false",
      "build-attestation",
      "valid Windows PE installer",
    ].join("\n"),
  );
  writeFile(
    root,
    "scripts/build-windows-invite-beta.mjs",
    [
      "rmSync(bundleDir",
      "windows-invite-build-attestation",
      'ATLASTERM_DESKTOP_RELEASE_BUNDLES: "nsis"',
      "sourceTreeClean: true",
    ].join("\n"),
  );
  writeFile(
    root,
    "scripts/promote-windows-invite-beta.mjs",
    overrides.promotionScript ??
      [
        "inviteDistributionReady: true",
        "3-5-trusted-technical-testers",
        "openP0 !== 0",
        "openP1 !== 0",
        'value.defender?.status !== "clean"',
        "HANDOFF-SHA256SUMS.txt",
        "--reviewed-sha",
        "--expected-artifact-sha256",
        "inspectPortableExecutable",
        "inspectAuthenticode",
        "assertSnapshotsUnchanged",
        "linkStat.nlink !== 1",
        "exact Stage A input allowlist",
      ].join("\n"),
  );
  writeFile(
    root,
    "scripts/block-windows-invite-stage-b.mjs",
    "Stage B is No-Go\nnative-smoke promotion",
  );
  writeFile(
    root,
    "scripts/run-rust-advisory-gate.mjs",
    'hasRustAuditErrorDiagnostics\n"--no-fetch"\nresult.status === 0',
  );
  writeFile(root, "docs/windows-invite-native-smoke.template.json", "{}");
  writeFile(
    root,
    ".github/workflows/windows-invite-beta.yml",
    overrides.workflow ?? createWorkflowFixture(),
  );
  writeFile(
    root,
    "docs/windows-invite-beta.md",
    overrides.guide ??
      [
        "# Windows Desktop",
        "3–5 可信测试者先使用 unsigned internal staging。",
        "通过签名门禁后扩到 10–30 人。",
        "Mobile、Web Admin、托管 Sync 不在范围。",
        "运行 release:desktop:unsigned-staging-report 并核对 SHA-256。",
        "签名是扩大测试的前提，不提供 SLA。",
        "反馈和日志必须脱敏，并定义停止条件。",
        "复用 public-beta-dogfood-script.md。",
      ].join("\n"),
  );

  return root;
}

function createWorkflowFixture() {
  return [
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      reviewed_sha:",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  build-stage-a:",
    "    if: github.ref == 'refs/heads/main' && github.ref_protected == true",
    "    runs-on: windows-2025",
    "    environment: windows-invite-stage-a",
    "    steps:",
    "      - name: Review",
    "        id: review",
    "        env:",
    "          REVIEWED_SHA_INPUT: ${{ inputs.reviewed_sha }}",
    "          DISPATCH_SHA: ${{ github.sha }}",
    "          DISPATCH_REF: ${{ github.ref }}",
    "          REF_PROTECTED: ${{ github.ref_protected }}",
    "        run: |",
    '          if ($env:DISPATCH_REF -cne "refs/heads/main") { throw "main only" }',
    '          if (-not [StringComparer]::OrdinalIgnoreCase.Equals($env:REF_PROTECTED, "true")) { throw "protected only" }',
    '          if ($env:REVIEWED_SHA_INPUT -cnotmatch "\\A[0-9a-fA-F]{40}\\z") { throw "full SHA only" }',
    "          if (-not [StringComparer]::OrdinalIgnoreCase.Equals(",
    "            $env:REVIEWED_SHA_INPUT,",
    "            $env:DISPATCH_SHA",
    '          )) { throw "SHA mismatch" }',
    '          "reviewed_sha=$($env:REVIEWED_SHA_INPUT.ToLowerInvariant())" >> $env:GITHUB_OUTPUT',
    "      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "        with:",
    "          node-version: 22.22.2",
    "      - name: Pin npm 10.9.7",
    "        shell: bash",
    "        run: |",
    "          set -euo pipefail",
    "          npm install --global --ignore-scripts --no-audit --no-fund npm@10.9.7",
    '          test "$(npm --version)" = "10.9.7"',
    "      - name: Gate",
    "        run: npm run qa:beta:windows:fixture",
    "      - name: Browser",
    "        run: npx --no-install playwright install chromium",
    "      - name: Audit",
    "        run: cargo install cargo-audit --version 0.22.2 --locked",
    "      - name: Build",
    "        run: npm run release:desktop:build:windows-invite",
    "      - name: Package",
    "        run: npm run release:desktop:package:windows-invite:stage-a",
    "      - name: Handoff",
    "        id: handoff",
    "        run: |",
    "          reports/handoff/desktop/windows-invite",
    "          $installerSha256 = (Get-FileHash -LiteralPath $installer[0].FullName -Algorithm SHA256).Hash",
    '          "installer_sha256=$installerSha256" >> $env:GITHUB_OUTPUT',
    "      - name: Upload",
    "        id: upload",
    "        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "      - name: Record the distribution boundary",
    "        env:",
    "          REVIEWED_SHA: ${{ steps.review.outputs.reviewed_sha }}",
    "          INSTALLER_SHA256: ${{ steps.handoff.outputs.installer_sha256 }}",
    "          ARTIFACT_ID: ${{ steps.upload.outputs.artifact-id }}",
    "          ARTIFACT_URL: ${{ steps.upload.outputs.artifact-url }}",
    "          ARTIFACT_DIGEST: ${{ steps.upload.outputs.artifact-digest }}",
    "        run: |",
    '          "Reviewed commit:"',
    '          "Installer SHA-256:"',
    '          "Workflow artifact digest:"',
    '          "External approval:"',
  ].join("\n");
}

function writeJson(root, relativePath, value) {
  writeFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(root, relativePath, value) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}
