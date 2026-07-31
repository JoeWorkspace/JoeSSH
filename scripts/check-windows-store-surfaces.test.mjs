import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { checkWindowsStoreSurfaces } from "./check-windows-store-surfaces.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const contractFiles = [
  ".github/workflows/ci.yml",
  "package.json",
  "apps/desktop/package.json",
  "apps/desktop/public/llms.txt",
  "apps/desktop/public/manifest.json",
  "apps/desktop/src-tauri/tauri.microsoftstore.conf.json",
  "apps/desktop/src/desktopSurfacePolicy.ts",
  "apps/desktop/src/desktopSurfacePolicy.test.ts",
  "apps/desktop/src/main.tsx",
  "apps/desktop/src/panels.tsx",
  "apps/desktop/src/panels.test.tsx",
  "apps/desktop/src/StatusBar.tsx",
  "apps/desktop/src/StatusBar.test.tsx",
  "apps/desktop/src/ShortcutsOverlay.tsx",
  "apps/desktop/src/ShortcutsOverlay.test.tsx",
  "apps/desktop/src/GettingStartedOverlay.tsx",
  "apps/desktop/src/GettingStartedOverlay.test.tsx",
  "apps/desktop/vite.config.ts",
  "tests/e2e/package.json",
  "tests/e2e/playwright.desktop-store.config.ts",
  "tests/e2e/scripts/run-playwright-with-fresh-ports.mjs",
  "tests/e2e/specs/desktop-store-release.spec.ts",
];

test("current Store surface contract passes", () => {
  const results = checkWindowsStoreSurfaces(repositoryRoot);
  assert.deepEqual(
    results.filter((result) => !result.passed),
    [],
  );
});

test("fails when the Store overlay falls back to the ordinary build", (t) => {
  const fixture = createFixture(t);
  replace(
    fixture,
    "apps/desktop/src-tauri/tauri.microsoftstore.conf.json",
    "npm run build:microsoft-store",
    "npm run build",
  );

  assert.equal(checkWindowsStoreSurfaces(fixture)[0].passed, false);
});

test("fails when formal Store QA drops the built runtime exercise", (t) => {
  const fixture = createFixture(t);
  replace(
    fixture,
    "package.json",
    " && npm run qa:e2e:desktop:store:fresh",
    "",
  );

  const results = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    results.find((result) =>
      result.label.startsWith("Store runtime QA installs"),
    )?.passed,
    false,
  );
});

test("fails when the installed-browser Store runtime entry point is a no-op", (t) => {
  const fixture = createFixture(t);
  replace(
    fixture,
    "package.json",
    '"qa:windows-store-surfaces:runtime:installed": "npm run qa:windows-store-surfaces && npm run qa:e2e:desktop:store:fresh"',
    '"qa:windows-store-surfaces:runtime:installed": "node -e \\"process.exit(0)\\""',
  );

  const results = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    results.find((result) =>
      result.label.startsWith("Store runtime QA installs"),
    )?.passed,
    false,
  );
});

test("fails when the root Store E2E target is a no-op", (t) => {
  const fixture = createFixture(t);
  replace(
    fixture,
    "package.json",
    '"qa:e2e:desktop:store:fresh": "npm run test:desktop:store:fresh -w @atlasterm/e2e --"',
    '"qa:e2e:desktop:store:fresh": "node -e \\"process.exit(0)\\""',
  );

  const results = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    results.find((result) => result.label.startsWith("Root Store E2E target"))
      ?.passed,
    false,
  );
});

test("fails when the workspace Store E2E target is a no-op", (t) => {
  const fixture = createFixture(t);
  replace(
    fixture,
    "tests/e2e/package.json",
    '"test:desktop:store:fresh": "node scripts/run-playwright-with-fresh-ports.mjs --config=playwright.desktop-store.config.ts"',
    '"test:desktop:store:fresh": "node -e \\"process.exit(0)\\""',
  );

  const results = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    results.find((result) =>
      result.label.startsWith("Workspace Store E2E target"),
    )?.passed,
    false,
  );
});

test("fails when the fresh-port runner no longer launches Playwright", (t) => {
  const fixture = createFixture(t);
  replace(
    fixture,
    "tests/e2e/scripts/run-playwright-with-fresh-ports.mjs",
    "const child = spawn(process.execPath",
    "const child = spawn('node'",
  );

  const results = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    results.find((result) =>
      result.label.includes(
        "tests/e2e/scripts/run-playwright-with-fresh-ports.mjs",
      ),
    )?.passed,
    false,
  );
});

test("fails when the Store Playwright config starts a fake server", (t) => {
  const fixture = createFixture(t);
  replace(
    fixture,
    "tests/e2e/playwright.desktop-store.config.ts",
    "npm --prefix ../.. run preview -w @atlasterm/desktop",
    "node scripts/fake-store-server.mjs",
  );

  const results = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    results.find((result) =>
      result.label.includes("tests/e2e/playwright.desktop-store.config.ts"),
    )?.passed,
    false,
  );
});

test("fails when the Store release spec is replaced by an empty passing test", (t) => {
  const fixture = createFixture(t);
  write(
    fixture,
    "tests/e2e/specs/desktop-store-release.spec.ts",
    'import { test } from "@playwright/test";\ntest("noop", () => {});\n',
  );

  const results = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    results.find((result) =>
      result.label.includes("tests/e2e/specs/desktop-store-release.spec.ts"),
    )?.passed,
    false,
  );
});

test("fails when CI moves the Store runtime off the formal Windows runner", (t) => {
  const fixture = createFixture(t);
  replace(
    fixture,
    ".github/workflows/ci.yml",
    "  store-runtime-windows:\n    name: Store Runtime Windows\n    runs-on: windows-2025",
    "  store-runtime-windows:\n    name: Store Runtime Windows\n    runs-on: ubuntu-latest",
  );

  const results = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    results.find((result) =>
      result.label.startsWith("CI installs Chromium once"),
    )?.passed,
    false,
  );
});

test("fails when CI re-enters the self-installing Store runtime wrapper", (t) => {
  const fixture = createFixture(t);
  replace(
    fixture,
    ".github/workflows/ci.yml",
    "      - run: npm run qa:windows-store-surfaces:runtime:installed",
    "      - run: npm run qa:windows-store-surfaces:runtime",
  );

  const results = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    results.find((result) =>
      result.label.startsWith("CI installs Chromium once"),
    )?.passed,
    false,
  );
});

test("fails when CI uploads Store failure evidence from the wrong path", (t) => {
  const fixture = createFixture(t);
  replace(
    fixture,
    ".github/workflows/ci.yml",
    "          path: tests/e2e/test-results/store-runtime/",
    "          path: tests/e2e/playwright-report/",
  );

  const results = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    results.find((result) =>
      result.label.startsWith("CI installs Chromium once"),
    )?.passed,
    false,
  );
});

test("fails when settings stop obeying the future-surface policy", (t) => {
  const fixture = createFixture(t);
  replace(
    fixture,
    "apps/desktop/src/panels.tsx",
    "showFutureProductSurfaces = true",
    "showFutureProductSurfaces = false",
  );

  const results = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    results.find((result) =>
      result.label.startsWith("Settings, status, shortcuts"),
    )?.passed,
    false,
  );
});

test("verifies the built Store profile marker when dist is supplied", (t) => {
  const fixture = createFixture(t);
  write(
    fixture,
    "apps/desktop/dist/index.html",
    '<html><head><meta name="joessh-release-surface-profile" content="microsoft-store"></head></html>',
  );
  write(fixture, "apps/desktop/dist/assets/main.js", "console.log('JoeSSH');");
  write(
    fixture,
    "apps/desktop/dist/llms.txt",
    readFileSync(resolve(fixture, "apps/desktop/public/llms.txt"), "utf8"),
  );
  write(
    fixture,
    "apps/desktop/dist/manifest.json",
    readFileSync(resolve(fixture, "apps/desktop/public/manifest.json"), "utf8"),
  );

  const results = checkWindowsStoreSurfaces(fixture, {
    distPath: "apps/desktop/dist",
  });
  assert.deepEqual(
    results.filter((result) => !result.passed),
    [],
  );

  replace(
    fixture,
    "apps/desktop/dist/index.html",
    'content="microsoft-store"',
    'content="production"',
  );
  const failed = checkWindowsStoreSurfaces(fixture, {
    distPath: "apps/desktop/dist",
  });
  assert.equal(
    failed.find((result) => result.label.startsWith("Built Desktop index"))
      ?.passed,
    false,
  );
});

test("rejects public Store descriptions and shortcuts that expose preview-only claims", (t) => {
  const fixture = createFixture(t);
  replace(
    fixture,
    "apps/desktop/public/llms.txt",
    "Local port forwarding",
    "Local and remote port forwarding",
  );
  const descriptionResults = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    descriptionResults.find((result) =>
      result.label.startsWith("Public Store product description"),
    )?.passed,
    false,
  );

  const manifestPath = "apps/desktop/public/manifest.json";
  const manifest = JSON.parse(
    readFileSync(resolve(fixture, manifestPath), "utf8"),
  );
  manifest.shortcuts.push({
    name: "Team",
    short_name: "Team",
    url: "/?panel=team",
  });
  write(fixture, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestResults = checkWindowsStoreSurfaces(fixture);
  assert.equal(
    manifestResults.find((result) =>
      result.label.startsWith("Public Store manifest"),
    )?.passed,
    false,
  );
});

test("rejects a built Store description or manifest that drifts from reviewed public inputs", (t) => {
  const fixture = createFixture(t);
  write(
    fixture,
    "apps/desktop/dist/index.html",
    '<html><head><meta name="joessh-release-surface-profile" content="microsoft-store"></head></html>',
  );
  write(fixture, "apps/desktop/dist/assets/main.js", "console.log('JoeSSH');");
  write(fixture, "apps/desktop/dist/llms.txt", "Unreviewed product claims\n");
  write(
    fixture,
    "apps/desktop/dist/manifest.json",
    JSON.stringify({
      shortcuts: [{ name: "Team", url: "/?panel=team" }],
    }),
  );

  const results = checkWindowsStoreSurfaces(fixture, {
    distPath: "apps/desktop/dist",
  });
  assert.equal(
    results.find((result) =>
      result.label.startsWith("Built Store public product description"),
    )?.passed,
    false,
  );
  assert.equal(
    results.find((result) => result.label.startsWith("Built Store manifest"))
      ?.passed,
    false,
  );
});

function createFixture(t) {
  const fixture = mkdtempSync(join(tmpdir(), "joessh-store-surfaces-"));
  t.after(() => rmSync(fixture, { force: true, recursive: true }));
  for (const relativePath of contractFiles) {
    write(
      fixture,
      relativePath,
      readFileSync(resolve(repositoryRoot, relativePath), "utf8"),
    );
  }
  return fixture;
}

function replace(root, relativePath, before, after) {
  const path = resolve(root, relativePath);
  const text = readFileSync(path, "utf8");
  assert.ok(text.includes(before), `Fixture marker missing: ${before}`);
  writeFileSync(path, text.replace(before, after), "utf8");
}

function write(root, relativePath, text) {
  const path = resolve(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}
