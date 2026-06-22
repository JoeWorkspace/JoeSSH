import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PACKAGER_PATH = fileURLToPath(new URL("./package-web-release.mjs", import.meta.url));
const VERIFIER_PATH = fileURLToPath(new URL("./verify-web-release-package.mjs", import.meta.url));

const STRICT_DEPLOYMENT_HEADERS = `/*
  Content-Security-Policy: frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
`;

function createFixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "web-release-verify-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  const files = {
    "apps/web/dist/.well-known/security.txt": "Contact: mailto:security@example.com\n",
    "apps/web/dist/_headers": STRICT_DEPLOYMENT_HEADERS,
    "apps/web/dist/404.html": "<!doctype html><title>Not Found</title>",
    "apps/web/dist/assets/app.js": "console.log('joessh web admin');",
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

  return root;
}

function packageFixture(root) {
  const result = spawnSync(process.execPath, [PACKAGER_PATH, "--root", root], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function runVerifier(root) {
  return spawnSync(process.execPath, [VERIFIER_PATH, "--root", root], {
    encoding: "utf8",
  });
}

function writeFile(root, relativePath, contents) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("verifies a packaged Web Admin release zip", (t) => {
  const root = createFixture(t);
  packageFixture(root);

  const result = runVerifier(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Verified Web Admin release package reports\/release\/web\/joessh-web-admin-0\.1\.0-beta\.1\.zip/);
});

test("rejects release zips missing deployment security headers", (t) => {
  const root = createFixture(t, {
    "apps/web/dist/_headers": null,
  });
  packageFixture(root);

  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required zip entry _headers/);
  assert.match(result.stderr, /_headers missing deployment X-Frame-Options/);
});

test("rejects token-like values inside packaged Web Admin assets", (t) => {
  const root = createFixture(t, {
    "apps/web/dist/assets/app.js": 'const leaked = "ATLASTERM_SYNC_ADMIN_TOKEN";',
  });
  packageFixture(root);

  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /assets\/app\.js: JoeSSH token environment variable name/);
});

test("rejects release zips that drift from their checksum manifest", (t) => {
  const root = createFixture(t);
  packageFixture(root);
  const manifestPath = join(root, "reports", "release", "web", "SHA256SUMS.txt");
  writeFileSync(manifestPath, `${sha256("original zip")}  reports/release/web/joessh-web-admin-0.1.0-beta.1.zip\n`);

  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /checksum manifest hash mismatch/);
});
