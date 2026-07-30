import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(import.meta.dirname, "..");

export function checkWindowsInviteBeta(rootPath = defaultRoot) {
  const root = resolve(rootPath);
  const rootPackage = readJson(root, "package.json");
  const e2ePackage = readJson(root, "tests/e2e/package.json");
  const inviteGuide = readText(root, "docs/windows-invite-beta.md");
  const desktopConfig = readText(
    root,
    "tests/e2e/playwright.desktop.config.ts",
  );
  const desktopVisualConfig = readText(
    root,
    "tests/e2e/playwright.desktop-visual.config.ts",
  );
  const packageScript = readText(
    root,
    "scripts/package-windows-invite-beta.mjs",
  );
  const buildScript = readText(root, "scripts/build-windows-invite-beta.mjs");
  const promotionScript = readText(
    root,
    "scripts/promote-windows-invite-beta.mjs",
  );
  const stageBBlocker = readText(
    root,
    "scripts/block-windows-invite-stage-b.mjs",
  );
  const rustAdvisoryGate = readText(root, "scripts/run-rust-advisory-gate.mjs");
  const workflow = readText(root, ".github/workflows/windows-invite-beta.yml");
  const workflowRunBlocks = extractWorkflowRunBlocks(workflow);
  const reviewedInputExpressions =
    workflow.match(/\$\{\{\s*inputs\.reviewed_sha\s*\}\}/g) ?? [];
  const workflowActionRefs = [
    ...workflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm),
  ].map((match) => match[1]);
  const rootScripts = rootPackage?.scripts ?? {};
  const e2eScripts = e2ePackage?.scripts ?? {};
  const results = [];

  addFileCheck(
    results,
    root,
    "docs/windows-invite-beta.md",
    "Windows invite Beta guide exists",
  );
  addFileCheck(
    results,
    root,
    "tests/e2e/playwright.desktop-visual.config.ts",
    "Desktop-only visual Playwright config exists",
  );
  addFileCheck(
    results,
    root,
    "scripts/package-windows-invite-beta.mjs",
    "Windows invite artifact packager exists",
  );
  addFileCheck(
    results,
    root,
    "scripts/build-windows-invite-beta.mjs",
    "Commit-bound Windows invite builder exists",
  );
  addFileCheck(
    results,
    root,
    "scripts/promote-windows-invite-beta.mjs",
    "Native-smoke Stage A promotion gate exists",
  );
  addFileCheck(
    results,
    root,
    "docs/windows-invite-native-smoke.template.json",
    "Native-smoke evidence template exists",
  );
  addFileCheck(
    results,
    root,
    ".github/workflows/windows-invite-beta.yml",
    "Windows-only invite workflow exists",
  );
  addScriptCheck(results, rootScripts, "test:windows-invite-beta", [
    "node --test scripts/check-windows-invite-beta.test.mjs",
  ]);
  addScriptCheck(results, rootScripts, "test:windows-invite-package", [
    "node --test scripts/package-windows-invite-beta.test.mjs",
  ]);
  addScriptCheck(results, rootScripts, "test:windows-invite-promotion", [
    "node --test scripts/promote-windows-invite-beta.test.mjs",
  ]);
  addScriptCheck(results, rootScripts, "test:rust-advisory-strict", [
    "node --test scripts/run-rust-advisory-gate.test.mjs",
  ]);
  addScriptCheck(results, rootScripts, "qa:beta:windows:contract", [
    "npm run test:windows-invite-beta",
    "npm run test:windows-invite-package",
    "npm run test:windows-invite-promotion",
    "node scripts/check-windows-invite-beta.mjs",
  ]);
  addScriptCheck(results, rootScripts, "qa:beta:windows:source", [
    "npm run qa:beta:windows:contract",
    "npm run lint",
    "npm run qa:desktop",
    "npm run qa:desktop:subresource-integrity",
    "npm run qa:desktop:security-headers",
    "npm run qa:desktop:bundle-size",
    "npm run qa:rust",
    "npm run qa:rust-advisory:strict",
    "npm run qa:tauri",
    "npm run qa:prod-audit",
    "npm run qa:e2e:desktop:fresh",
    "npm run qa:e2e:desktop:visual:fresh",
  ]);
  addScriptCheck(results, rootScripts, "qa:beta:windows:required", [
    "npm run qa:beta:windows:source",
    "npm run qa:desktop:real-ssh-smoke:required",
  ]);
  addScriptCheck(results, rootScripts, "qa:beta:windows", [
    "npm run qa:beta:windows:required",
  ]);
  addScriptCheck(results, rootScripts, "qa:beta:windows:fixture", [
    "node scripts/run-real-ssh-smoke-fixture.mjs -- npm run qa:beta:windows:source",
  ]);
  addScriptCheck(results, rootScripts, "qa:rust-advisory:strict", [
    "npm run test:rust-advisory-strict",
    "node scripts/run-rust-advisory-gate.mjs",
  ]);
  addScriptCheck(
    results,
    rootScripts,
    "release:desktop:package:windows-invite:stage-a",
    ["node scripts/package-windows-invite-beta.mjs --stage-a"],
  );
  addScriptCheck(
    results,
    rootScripts,
    "release:desktop:package:windows-invite:stage-b",
    ["node scripts/block-windows-invite-stage-b.mjs"],
  );
  addScriptCheck(results, rootScripts, "release:desktop:build:windows-invite", [
    "node scripts/build-windows-invite-beta.mjs",
  ]);
  addScriptCheck(
    results,
    rootScripts,
    "release:desktop:promote:windows-invite",
    ["node scripts/promote-windows-invite-beta.mjs"],
  );
  addScriptCheck(
    results,
    rootScripts,
    "release:desktop:unsigned-staging-report",
    ["node scripts/report-desktop-unsigned-staging.mjs"],
  );
  addScriptCheck(results, rootScripts, "qa:e2e:desktop:fresh", [
    "npm run test:desktop:fresh -w @atlasterm/e2e",
  ]);
  addScriptCheck(results, rootScripts, "qa:e2e:desktop:visual:fresh", [
    "npm run test:desktop:visual:fresh -w @atlasterm/e2e",
  ]);
  addScriptCheck(results, e2eScripts, "test:desktop:fresh", [
    "playwright.desktop.config.ts",
  ]);
  addScriptCheck(results, e2eScripts, "test:desktop:visual:fresh", [
    "playwright.desktop-visual.config.ts",
  ]);

  const windowsPackageCommand = [
    rootScripts["release:desktop:package:windows-invite:stage-a"] ?? "",
  ].join(" ");
  addCheck(
    results,
    windowsPackageCommand.includes("package-windows-invite-beta.mjs") &&
      !windowsPackageCommand.includes("package-desktop-release.mjs") &&
      !/\b(?:macos|linux)\b/i.test(windowsPackageCommand),
    "Windows invite packaging is isolated from formal multi-platform release evidence",
  );
  addCheck(
    results,
    (rootScripts["release:desktop:package:windows-invite:stage-b"] ?? "") ===
      "node scripts/block-windows-invite-stage-b.mjs" &&
      stageBBlocker.includes("Stage B is No-Go") &&
      stageBBlocker.includes("native-smoke promotion"),
    "Stage B stays fail-closed until trusted signing and promotion exist",
  );

  const windowsGateCommand = rootScripts["qa:beta:windows:source"] ?? "";
  addCheck(
    results,
    !/\bqa:(?:mobile|web|sync|release:public)\b/.test(windowsGateCommand),
    "Windows invite source gate stays scoped to Desktop and shared safety checks",
  );
  addCheck(
    results,
    !windowsGateCommand.includes("real-ssh-smoke") &&
      (rootScripts["qa:beta:windows:required"] ?? "").includes(
        "qa:desktop:real-ssh-smoke:required",
      ) &&
      (rootScripts["qa:beta:windows:fixture"] ?? "").includes(
        "run-real-ssh-smoke-fixture.mjs -- npm run qa:beta:windows:source",
      ),
    "Required and fixture gates execute the real SSH smoke exactly once",
  );
  addCheck(
    results,
    (rootScripts.lint ?? "").includes("tests/e2e/"),
    "Root lint includes Playwright acceptance tests",
  );
  addCheck(
    results,
    desktopConfig.includes("desktop-workbench") &&
      desktopConfig.includes("desktop-accessibility") &&
      desktopConfig.includes("webServer") &&
      desktopConfig.includes("strictPort"),
    "Desktop E2E config starts an isolated Desktop server and covers workbench plus accessibility",
  );
  addCheck(
    results,
    desktopVisualConfig.includes("desktop-visual-wide") &&
      desktopVisualConfig.includes("desktop-visual-narrow") &&
      desktopVisualConfig.includes("width: 1440") &&
      desktopVisualConfig.includes("width: 900") &&
      desktopVisualConfig.includes("webServer"),
    "Desktop visual config covers wide and narrow Windows layouts",
  );
  addCheck(
    results,
    packageScript.includes('const WINDOWS_EXTENSIONS = new Set([".exe"])') &&
      packageScript.includes("Expected exactly one Desktop installer") &&
      packageScript.includes("reports/handoff/desktop/windows-invite") &&
      packageScript.includes("publicReleaseEvidence: false") &&
      packageScript.includes("releaseEligible: false") &&
      packageScript.includes("build-attestation") &&
      packageScript.includes("valid Windows PE installer") &&
      !packageScript.includes("ATLASTERM_RELEASE_POWERSHELL_COMMAND") &&
      !packageScript.includes("ATLASTERM_RELEASE_GIT_COMMAND"),
    "Stage A packager binds a real PE to trusted commands, identity, commit, and handoff",
  );
  addCheck(
    results,
    buildScript.includes("rmSync(bundleDir") &&
      buildScript.includes("windows-invite-build-attestation") &&
      buildScript.includes('ATLASTERM_DESKTOP_RELEASE_BUNDLES: "nsis"') &&
      buildScript.includes("sourceTreeClean: true"),
    "Windows builder clears stale NSIS output and emits commit-bound attestation",
  );
  addCheck(
    results,
    promotionScript.includes("inviteDistributionReady: true") &&
      promotionScript.includes("3-5-trusted-technical-testers") &&
      promotionScript.includes("openP0 !== 0") &&
      promotionScript.includes("openP1 !== 0") &&
      promotionScript.includes('value.defender?.status !== "clean"') &&
      promotionScript.includes("HANDOFF-SHA256SUMS.txt"),
    "Promotion requires hash-bound native smoke, Defender, and zero open P0/P1",
  );
  addCheck(
    results,
    promotionScript.includes("--reviewed-sha") &&
      promotionScript.includes("--expected-artifact-sha256") &&
      promotionScript.includes("inspectPortableExecutable") &&
      promotionScript.includes("inspectAuthenticode") &&
      promotionScript.includes("assertSnapshotsUnchanged") &&
      promotionScript.includes("linkStat.nlink !== 1") &&
      promotionScript.includes("exact Stage A input allowlist"),
    "Promotion revalidates external anchors, PE, Authenticode, stable snapshots, and unlinked inputs",
  );
  addCheck(
    results,
    rustAdvisoryGate.includes("hasRustAuditErrorDiagnostics") &&
      rustAdvisoryGate.includes('"--no-fetch"') &&
      rustAdvisoryGate.includes("result.status === 0"),
    "RustSec gate rejects error diagnostics and retries only against the fresh cache",
  );
  addCheck(
    results,
    workflow.includes("workflow_dispatch:") &&
      workflow.includes("reviewed_sha:") &&
      workflow.includes("runs-on: windows-2025") &&
      workflow.includes("contents: read") &&
      workflow.includes("qa:beta:windows:fixture") &&
      workflow.includes("release:desktop:build:windows-invite") &&
      workflow.includes("release:desktop:package:windows-invite:stage-a") &&
      workflow.includes("reports/handoff/desktop/windows-invite") &&
      workflow.includes("cargo-audit --version 0.22.2 --locked") &&
      !workflow.includes("path: reports/release") &&
      !workflow.includes("package-desktop-release") &&
      !workflow.includes("release:publish"),
    "Windows workflow is manual, least-privilege, Stage A-only, and handoff-only",
  );
  addCheck(
    results,
    workflowActionRefs.length > 0 &&
      workflowActionRefs.every((ref) => /^[a-f0-9]{40}$/i.test(ref)),
    "Windows workflow pins every external Action to a full commit SHA",
  );
  addCheck(
    results,
    workflow.includes(
      "if: github.ref == 'refs/heads/main' && github.ref_protected == true",
    ) &&
      workflow.includes("environment: windows-invite-stage-a") &&
      workflow.includes("DISPATCH_REF: ${{ github.ref }}") &&
      workflow.includes("REF_PROTECTED: ${{ github.ref_protected }}") &&
      workflow.includes('$env:DISPATCH_REF -cne "refs/heads/main"') &&
      workflow.includes(
        '[StringComparer]::OrdinalIgnoreCase.Equals($env:REF_PROTECTED, "true")',
      ),
    "Windows workflow binds approval to the protected main Stage A environment",
  );
  addCheck(
    results,
    reviewedInputExpressions.length === 1 &&
      workflow.includes("REVIEWED_SHA_INPUT: ${{ inputs.reviewed_sha }}") &&
      workflow.includes("DISPATCH_SHA: ${{ github.sha }}") &&
      workflow.includes(
        '$env:REVIEWED_SHA_INPUT -cnotmatch "\\A[0-9a-fA-F]{40}\\z"',
      ) &&
      /OrdinalIgnoreCase\.Equals\(\s*\$env:REVIEWED_SHA_INPUT,\s*\$env:DISPATCH_SHA\s*\)/s.test(
        workflow,
      ) &&
      workflowRunBlocks.every(
        (runBlock) => !runBlock.includes("${{ inputs.reviewed_sha }}"),
      ),
    "Windows workflow validates a full reviewed SHA passed to PowerShell only through env",
  );

  const uploadStepIndex = workflow.indexOf("id: upload");
  const summaryStepIndex = workflow.indexOf(
    "- name: Record the distribution boundary",
  );
  addCheck(
    results,
    uploadStepIndex >= 0 &&
      summaryStepIndex > uploadStepIndex &&
      workflow.includes(
        '"reviewed_sha=$($env:REVIEWED_SHA_INPUT.ToLowerInvariant())" >> $env:GITHUB_OUTPUT',
      ) &&
      workflow.includes(
        "Get-FileHash -LiteralPath $installer[0].FullName -Algorithm SHA256",
      ) &&
      workflow.includes(
        '"installer_sha256=$installerSha256" >> $env:GITHUB_OUTPUT',
      ) &&
      workflow.includes(
        "REVIEWED_SHA: ${{ steps.review.outputs.reviewed_sha }}",
      ) &&
      workflow.includes(
        "INSTALLER_SHA256: ${{ steps.handoff.outputs.installer_sha256 }}",
      ) &&
      workflow.includes(
        "ARTIFACT_ID: ${{ steps.upload.outputs.artifact-id }}",
      ) &&
      workflow.includes(
        "ARTIFACT_URL: ${{ steps.upload.outputs.artifact-url }}",
      ) &&
      workflow.includes(
        "ARTIFACT_DIGEST: ${{ steps.upload.outputs.artifact-digest }}",
      ) &&
      workflow.includes("Reviewed commit:") &&
      workflow.includes("Installer SHA-256:") &&
      workflow.includes("Workflow artifact digest:") &&
      workflow.includes("External approval:"),
    "Windows workflow records hash-bound artifact evidence for external promotion review",
  );

  const requiredGuideTerms = [
    "Windows Desktop",
    "3–5",
    "10–30",
    "Mobile",
    "Web Admin",
    "托管 Sync",
    "unsigned internal staging",
    "release:desktop:unsigned-staging-report",
    "SHA-256",
    "签名",
    "不提供 SLA",
    "脱敏",
    "停止",
    "public-beta-dogfood-script.md",
  ];
  addCheck(
    results,
    requiredGuideTerms.every((term) => inviteGuide.includes(term)),
    "Windows invite guide records scope, staged rollout, signing, privacy, support, and stop rules",
  );

  return results;
}

export function formatWindowsInviteBetaResults(results) {
  const failures = results.filter((result) => !result.ok);
  const lines = results.map(
    (result) => `${result.ok ? "PASS" : "FAIL"} ${result.label}`,
  );
  lines.push(
    failures.length === 0
      ? `Windows invite Beta contract passed (${results.length}/${results.length}).`
      : `Windows invite Beta contract failed (${failures.length}/${results.length} checks).`,
  );
  return lines.join("\n");
}

function addFileCheck(results, root, relativePath, label) {
  addCheck(results, existsSync(resolve(root, relativePath)), label);
}

function addScriptCheck(results, scripts, name, requiredFragments) {
  const command = scripts[name];
  addCheck(
    results,
    typeof command === "string" &&
      requiredFragments.every((fragment) => command.includes(fragment)),
    `Package script ${name} contains the reviewed command chain`,
  );
}

function addCheck(results, ok, label) {
  results.push({ label, ok: Boolean(ok) });
}

function readJson(root, relativePath) {
  const text = readText(root, relativePath);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readText(root, relativePath) {
  const path = resolve(root, relativePath);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function extractWorkflowRunBlocks(workflow) {
  const lines = workflow.split(/\r?\n/);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)run:\s*\|\s*$/);
    if (!match) {
      continue;
    }

    const baseIndent = match[1].length;
    const block = [];
    for (let lineIndex = index + 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (line.trim() === "") {
        block.push(line);
        continue;
      }

      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= baseIndent) {
        break;
      }
      block.push(line);
    }
    blocks.push(block.join("\n"));
  }

  return blocks;
}

function parseCliArgs(args) {
  let root = defaultRoot;
  let noFail = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-fail") {
      noFail = true;
      continue;
    }
    if (arg === "--root") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--root requires a path.");
      }
      root = resolve(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { noFail, root };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const { noFail, root } = parseCliArgs(process.argv.slice(2));
    const results = checkWindowsInviteBeta(root);
    const hasFailures = results.some((result) => !result.ok);
    console.log(formatWindowsInviteBetaResults(results));
    if (hasFailures && !noFail) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
