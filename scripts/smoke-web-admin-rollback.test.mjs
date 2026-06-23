import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const PACKAGER_PATH = fileURLToPath(new URL("./package-web-release.mjs", import.meta.url));
const ROLLBACK_PATH = fileURLToPath(new URL("./smoke-web-admin-rollback.mjs", import.meta.url));

const STRICT_DEPLOYMENT_HEADERS = `/*
  Content-Security-Policy: frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
`;

function createWebFixture(t, version, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "web-admin-rollback-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
  });

  writeFile(root, "package.json", JSON.stringify({ version }));
  const files = {
    "apps/web/dist/.well-known/security.txt": "Contact: mailto:security@example.com\n",
    "apps/web/dist/_headers": STRICT_DEPLOYMENT_HEADERS,
    "apps/web/dist/404.html": "<!doctype html><title>Not Found</title>",
    "apps/web/dist/assets/app.js": `console.log('joessh web admin ${version}');`,
    "apps/web/dist/assets/index.css": "body { color: #111; }",
    "apps/web/dist/favicon.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    "apps/web/dist/humans.txt": "JoeSSH Team\n",
    "apps/web/dist/index.html": "<!doctype html><div id=\"root\"></div>",
    "apps/web/dist/manifest.json": JSON.stringify({
      icons: [{ src: "/favicon.svg", sizes: "any" }],
      name: "JoeSSH Admin",
      scope: "/",
      start_url: "/",
    }),
    "apps/web/dist/offline.html": "<!doctype html><title>Offline</title>",
    "apps/web/dist/robots.txt": "User-agent: *\nDisallow:\n",
    "apps/web/dist/sw.js": "self.addEventListener('fetch', () => {});",
    ...overrides,
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    if (contents !== null) {
      writeFile(root, relativePath, contents);
    }
  }

  const result = spawnSync(process.execPath, [PACKAGER_PATH, "--root", root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return root;
}

function runRollback(root, previousRoot, previousVersion, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      ROLLBACK_PATH,
      "--root",
      root,
      "--previous-root",
      previousRoot,
      "--previous",
      `reports/release/web/joessh-web-admin-${previousVersion}.zip`,
      ...extraArgs,
    ],
    { encoding: "utf8" },
  );
}

function writeFile(root, relativePath, contents) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(join(root, ...relativePath.split("/")), "utf8"));
}

test("writes Web Admin rollback evidence for a verified previous release bundle", (t) => {
  const currentRoot = createWebFixture(t, "0.1.0-beta.2");
  const previousRoot = createWebFixture(t, "0.1.0-beta.1");

  const result = runRollback(currentRoot, previousRoot, "0.1.0-beta.1");

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(currentRoot, "reports", "release", "web", "rollback-smoke.json")), true);
  assert.equal(existsSync(join(currentRoot, "reports", "release", "web", "rollback-smoke-SHA256SUMS.txt")), true);
  const evidence = readJson(currentRoot, "reports/release/web/rollback-smoke.json");
  assert.equal(evidence.artifact, "web-admin-rollback-smoke");
  assert.equal(evidence.version, "0.1.0-beta.2");
  assert.equal(evidence.previous.version, "0.1.0-beta.1");
  assert.notEqual(evidence.current.sha256, evidence.previous.sha256);
});

test("rejects rollback evidence when previous bundle equals the current bundle", (t) => {
  const currentRoot = createWebFixture(t, "0.1.0-beta.2");

  const result = runRollback(currentRoot, currentRoot, "0.1.0-beta.2");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be different bundles/);
});

test("rejects rollback evidence when the previous package is not deployable", (t) => {
  const currentRoot = createWebFixture(t, "0.1.0-beta.2");
  const previousRoot = createWebFixture(t, "0.1.0-beta.1", {
    "apps/web/dist/_headers": null,
  });

  const result = runRollback(currentRoot, previousRoot, "0.1.0-beta.1");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required zip entry _headers/);
  assert.match(result.stderr, /previous Web Admin release package verification failed/);
});
