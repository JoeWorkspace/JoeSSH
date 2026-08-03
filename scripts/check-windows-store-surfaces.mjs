import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const defaultRoot = resolve(import.meta.dirname, "..");
const STORE_BUILD_COMMAND = "npm run build:microsoft-store";
const STORE_FRONTEND_SCRIPT =
  "tsc -p tsconfig.json --noEmit && vite build --mode microsoft-store && node inline-css.mjs && node ../../scripts/apply-subresource-integrity.mjs dist";
const STORE_RUNTIME_QA_SCRIPT =
  "npx --no-install playwright install chromium && npm run qa:windows-store-surfaces && npm run qa:e2e:desktop:store:fresh";
const STORE_RUNTIME_QA_INSTALLED_SCRIPT =
  "npm run qa:windows-store-surfaces && npm run qa:e2e:desktop:store:fresh";
const STORE_ROOT_E2E_SCRIPT =
  "npm run test:desktop:store:fresh -w @atlasterm/e2e --";
const STORE_WORKSPACE_E2E_SCRIPT =
  "node scripts/run-playwright-with-fresh-ports.mjs --config=playwright.desktop-store.config.ts";
const STORE_RUNTIME_FILE_HASHES = Object.freeze({
  "tests/e2e/scripts/run-playwright-with-fresh-ports.mjs":
    "c4f7d68a7d757cb953fe62893b4b4c126d4ae89e122d6baabcb8f61a0f08fafa",
  "tests/e2e/playwright.desktop-store.config.ts":
    "b7420f628fa35a1d09d84398597d2c1108df925aa44c56975551d2c2c007dce8",
  "tests/e2e/specs/desktop-store-release.spec.ts":
    "41d9c17ae66e2b25c6a236b275ea5648c80a215ecb23c027117407909290d071",
});
const STORE_RUNTIME_REPORT_PATH = "tests/e2e/test-results/store-runtime/";

export function checkWindowsStoreSurfaces(
  rootPath = defaultRoot,
  { distPath } = {},
) {
  const root = resolve(rootPath);
  const rootPackage = readJson(resolve(root, "package.json"));
  const desktopPackage = readJson(resolve(root, "apps/desktop/package.json"));
  const e2ePackage = readJson(resolve(root, "tests/e2e/package.json"));
  const storeRuntimeFiles = Object.fromEntries(
    Object.keys(STORE_RUNTIME_FILE_HASHES).map((relativePath) => [
      relativePath,
      readText(resolve(root, relativePath)),
    ]),
  );
  const ciWorkflow = readText(resolve(root, ".github/workflows/ci.yml"));
  const desktopManifest = readJson(
    resolve(root, "apps/desktop/public/manifest.json"),
  );
  const publicProductDescription = readText(
    resolve(root, "apps/desktop/public/llms.txt"),
  );
  const storeConfig = readJson(
    resolve(root, "apps/desktop/src-tauri/tauri.microsoftstore.conf.json"),
  );
  const policy = readText(
    resolve(root, "apps/desktop/src/desktopSurfacePolicy.ts"),
  );
  const main = readText(resolve(root, "apps/desktop/src/main.tsx"));
  const panels = readText(resolve(root, "apps/desktop/src/panels.tsx"));
  const statusBar = readText(resolve(root, "apps/desktop/src/StatusBar.tsx"));
  const shortcuts = readText(
    resolve(root, "apps/desktop/src/ShortcutsOverlay.tsx"),
  );
  const onboarding = readText(
    resolve(root, "apps/desktop/src/GettingStartedOverlay.tsx"),
  );
  const viteConfig = readText(resolve(root, "apps/desktop/vite.config.ts"));
  const tests = [
    "desktopSurfacePolicy.test.ts",
    "panels.test.tsx",
    "StatusBar.test.tsx",
    "ShortcutsOverlay.test.tsx",
    "GettingStartedOverlay.test.tsx",
  ]
    .map((file) => readText(resolve(root, "apps/desktop/src", file)))
    .join("\n");
  const results = [];

  add(
    results,
    storeConfig?.build?.beforeBuildCommand === STORE_BUILD_COMMAND,
    "Store Tauri overlay forces the dedicated frontend build command",
  );
  add(
    results,
    desktopPackage?.scripts?.["build:microsoft-store"] ===
      STORE_FRONTEND_SCRIPT,
    "Desktop package exposes the exact Microsoft Store Vite mode",
  );
  add(
    results,
    rootPackage?.scripts?.["qa:windows-store-surfaces:runtime"] ===
      STORE_RUNTIME_QA_SCRIPT &&
      rootPackage?.scripts?.["qa:windows-store-surfaces:runtime:installed"] ===
        STORE_RUNTIME_QA_INSTALLED_SCRIPT,
    "Store runtime QA installs locked Chromium and keeps exact self-installing and installed-browser entry points",
  );
  add(
    results,
    rootPackage?.scripts?.["qa:e2e:desktop:store:fresh"] ===
      STORE_ROOT_E2E_SCRIPT,
    "Root Store E2E target delegates to the exact workspace runtime target",
  );
  add(
    results,
    e2ePackage?.scripts?.["test:desktop:store:fresh"] ===
      STORE_WORKSPACE_E2E_SCRIPT,
    "Workspace Store E2E target delegates through fresh ports to the exact config",
  );
  for (const [relativePath, expectedSha256] of Object.entries(
    STORE_RUNTIME_FILE_HASHES,
  )) {
    add(
      results,
      normalizedSha256(storeRuntimeFiles[relativePath]) === expectedSha256,
      `Store runtime contract locks ${relativePath} to reviewed SHA-256 ${expectedSha256}`,
    );
  }
  add(
    results,
    checkStoreRuntimeCiContract(ciWorkflow),
    "CI installs Chromium once per job, runs Store runtime on windows-2025, and uploads exact failure evidence",
  );
  add(
    results,
    policy.includes(
      'export const MICROSOFT_STORE_VITE_MODE = "microsoft-store"',
    ) &&
      policy.includes(
        'const previewModes = new Set(["development", "test", "future-preview"])',
      ) &&
      policy.includes("showCompanionProductSurfaces: showPreviewSurfaces") &&
      policy.includes("showFutureProductSurfaces: showPreviewSurfaces") &&
      policy.includes("sanitizeRightPanelForSurfacePolicy") &&
      policy.includes("resolvePanelShortcutForSurfacePolicy"),
    "Release surface policy is explicit-preview-only and fails closed",
  );
  add(
    results,
    main.includes("sanitizeRightPanelForSurfacePolicy(") &&
      main.includes("resolvePanelShortcutForSurfacePolicy(") &&
      main.includes('command.command !== "open-team"') &&
      main.includes("desktopSurfacePolicy.showFutureProductSurfaces &&") &&
      main.includes(
        "showFutureProductSurfaces={\n                desktopSurfacePolicy.showFutureProductSurfaces",
      ) &&
      main.includes(
        "showTeamAccess={desktopSurfacePolicy.showFutureProductSurfaces}",
      ) &&
      main.includes(
        "showCompanionProductSurfaces={\n            desktopSurfacePolicy.showCompanionProductSurfaces",
      ),
    "Workbench hides every Team entry point and passes release policy to child surfaces",
  );
  add(
    results,
    panels.includes("showFutureProductSurfaces = true") &&
      countOccurrences(panels, "showFutureProductSurfaces ? (") >= 2 &&
      statusBar.includes("showTeamAccess ? (") &&
      shortcuts.includes('(showFutureProductSurfaces || key !== "Ctrl+3")') &&
      countOccurrences(onboarding, "showCompanionProductSurfaces ? (") >= 2,
    "Settings, status, shortcuts, and onboarding all obey the release policy",
  );
  add(
    results,
    tests.includes(
      "fails closed for the dedicated Microsoft Store build mode",
    ) &&
      tests.includes(
        "hides recording, Sync, and Business placeholders for release builds",
      ) &&
      tests.includes("hides the unfinished team surface for release builds") &&
      tests.includes("hides the unfinished team shortcut for release builds") &&
      tests.includes(
        "keeps the Store onboarding focused on the shipped Desktop surface",
      ),
    "Component and policy tests cover every hidden Store surface",
  );
  add(
    results,
    viteConfig.includes('name: "joessh-release-surface-profile"') &&
      viteConfig.includes("content: mode") &&
      viteConfig.includes('name: "joessh-release-surface-profile"'),
    "Vite emits an auditable release-surface profile marker",
  );
  add(
    results,
    publicProductDescription.includes(
      "- [Port Forwarding](/?panel=forwarding) - Local port forwarding",
    ) &&
      publicProductDescription.includes(
        "Production and Microsoft Store builds exclude the contributor-only Team-access",
      ) &&
      publicProductDescription.includes(
        "These are not available\nin the Public Beta.",
      ) &&
      !publicProductDescription.includes("Local and remote port forwarding"),
    "Public Store product description claims only shipped release surfaces",
  );
  add(
    results,
    JSON.stringify(
      desktopManifest?.shortcuts?.map((shortcut) => shortcut?.url),
    ) ===
      JSON.stringify([
        "/?action=connect",
        "/?panel=sftp",
        "/?panel=forwarding",
        "/?panel=settings",
      ]),
    "Public Store manifest exposes only shipped release shortcuts",
  );

  if (distPath) {
    const dist = resolve(root, distPath);
    const indexPath = resolve(dist, "index.html");
    const index = existsSync(indexPath) ? readText(indexPath) : "";
    const profileMatches = [
      ...index.matchAll(
        /<meta\b[^>]*\bname=["']joessh-release-surface-profile["'][^>]*>/gi,
      ),
    ];
    add(
      results,
      existsSync(indexPath) &&
        statSync(indexPath).isFile() &&
        profileMatches.length === 1 &&
        /\bcontent=["']microsoft-store["']/i.test(profileMatches[0]?.[0] ?? ""),
      "Built Desktop index is bound to the microsoft-store surface profile",
    );
    add(
      results,
      existsSync(dist) &&
        listFiles(dist).some((path) => path.toLowerCase().endsWith(".js")),
      "Store frontend build produced executable JavaScript assets",
    );
    const builtProductDescriptionPath = resolve(dist, "llms.txt");
    const builtProductDescription = existsSync(builtProductDescriptionPath)
      ? readText(builtProductDescriptionPath)
      : "";
    add(
      results,
      builtProductDescription === publicProductDescription,
      "Built Store public product description matches the reviewed fail-closed source",
    );
    const builtManifestPath = resolve(dist, "manifest.json");
    const builtManifest = existsSync(builtManifestPath)
      ? readJson(builtManifestPath)
      : null;
    add(
      results,
      JSON.stringify(
        builtManifest?.shortcuts?.map((shortcut) => shortcut?.url),
      ) ===
        JSON.stringify([
          "/?action=connect",
          "/?panel=sftp",
          "/?panel=forwarding",
          "/?panel=settings",
        ]),
      "Built Store manifest exposes only shipped release shortcuts",
    );
  }

  return results;
}

function listFiles(directory) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : entry.isFile() ? [path] : [];
  });
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function normalizedSha256(value) {
  return createHash("sha256")
    .update(value.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

function checkStoreRuntimeCiContract(workflowText) {
  const workflow = parseWorkflow(workflowText);
  const jobs = isRecord(workflow?.jobs) ? workflow.jobs : null;
  const linuxJob = isRecord(jobs?.["test-e2e"]) ? jobs["test-e2e"] : null;
  const windowsJob = isRecord(jobs?.["store-runtime-windows"])
    ? jobs["store-runtime-windows"]
    : null;
  if (!linuxJob || !windowsJob) {
    return false;
  }

  const linuxRuns = getStepRuns(linuxJob);
  const windowsRuns = getStepRuns(windowsJob);
  const linuxContract =
    countCommandOccurrences(linuxRuns, "playwright install") === 1 &&
    linuxRuns.includes(
      "npx --no-install playwright install --with-deps chromium",
    ) &&
    linuxRuns.includes("npm run qa:windows-store-surfaces:runtime:installed") &&
    !containsSelfInstallingStoreRuntime(linuxRuns) &&
    hasStoreRuntimeFailureUpload(linuxJob);

  const windowsNeeds = Array.isArray(windowsJob.needs)
    ? windowsJob.needs
    : [windowsJob.needs];
  const pinNpmRun = getNamedStepRun(windowsJob, "Pin npm 10.9.7");
  const windowsContract =
    windowsJob["runs-on"] === "windows-2025" &&
    windowsJob["timeout-minutes"] === 30 &&
    JSON.stringify(windowsNeeds) === JSON.stringify(["build"]) &&
    pinNpmRun.includes("set -euo pipefail") &&
    pinNpmRun.includes(
      "npm install --global --ignore-scripts --no-audit --no-fund npm@10.9.7",
    ) &&
    pinNpmRun.includes('test "$(npm --version)" = "10.9.7"') &&
    hasPinnedSetupNodeStep(windowsJob) &&
    windowsRuns.includes("npm ci --ignore-scripts --no-audit --no-fund") &&
    countCommandOccurrences(windowsRuns, "playwright install") === 1 &&
    windowsRuns.includes("npx --no-install playwright install chromium") &&
    windowsRuns.includes(
      "npm run qa:windows-store-surfaces:runtime:installed",
    ) &&
    !containsSelfInstallingStoreRuntime(windowsRuns) &&
    hasStoreRuntimeFailureUpload(windowsJob);

  return linuxContract && windowsContract;
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

function getStepRuns(job) {
  if (!Array.isArray(job?.steps)) {
    return [];
  }
  return job.steps
    .map((step) => (isRecord(step) ? step.run : null))
    .filter((run) => typeof run === "string");
}

function getNamedStepRun(job, name) {
  if (!Array.isArray(job?.steps)) {
    return "";
  }
  const step = job.steps.find(
    (candidate) => isRecord(candidate) && candidate.name === name,
  );
  return isRecord(step) && typeof step.run === "string" ? step.run : "";
}

function countCommandOccurrences(runs, command) {
  return runs.reduce((total, run) => total + countOccurrences(run, command), 0);
}

function containsSelfInstallingStoreRuntime(runs) {
  return runs.some((run) =>
    /\bnpm\s+run\s+qa:windows-store-surfaces:runtime(?!:)(?=\s|$|[;&|])/.test(
      run,
    ),
  );
}

function hasPinnedSetupNodeStep(job) {
  if (!Array.isArray(job?.steps)) {
    return false;
  }
  return job.steps.some(
    (step) =>
      isRecord(step) &&
      step.uses ===
        "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020" &&
      isRecord(step.with) &&
      step.with["node-version"] === "22.22.2",
  );
}

function hasStoreRuntimeFailureUpload(job) {
  if (!Array.isArray(job?.steps)) {
    return false;
  }
  return job.steps.some(
    (step) =>
      isRecord(step) &&
      step.uses ===
        "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a" &&
      step.if === "failure()" &&
      step["continue-on-error"] === true &&
      isRecord(step.with) &&
      step.with.name === "store-runtime-report-${{ runner.os }}" &&
      step.with.path === STORE_RUNTIME_REPORT_PATH &&
      step.with["if-no-files-found"] === "ignore" &&
      step.with["retention-days"] === 3,
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function add(results, passed, label) {
  results.push({ label, passed: Boolean(passed) });
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dist") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--dist requires a repository-relative path.");
      }
      options.distPath = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const results = checkWindowsStoreSurfaces(defaultRoot, options);
    for (const result of results) {
      console.log(`${result.passed ? "[PASS]" : "[FAIL]"} ${result.label}`);
    }
    const failed = results.filter((result) => !result.passed);
    if (failed.length > 0) {
      process.exitCode = 1;
    } else {
      console.log("Windows Store surface contract passed.");
    }
  } catch (error) {
    console.error(`${basename(import.meta.url)}: ${error.message}`);
    process.exitCode = 1;
  }
}
