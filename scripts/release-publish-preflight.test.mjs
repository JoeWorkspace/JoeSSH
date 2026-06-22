import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PREFLIGHT_SCRIPT_PATH = fileURLToPath(new URL("./release-publish-preflight.mjs", import.meta.url));
const WEB_PACKAGER_PATH = fileURLToPath(new URL("./package-web-release.mjs", import.meta.url));
const STRICT_DEPLOYMENT_HEADERS = `/*
  Content-Security-Policy: frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
`;

function createReleaseFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release-publish-preflight-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  writeFile(root, "package-lock.json", JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "node_modules/@tauri-apps/api": { version: "2.5.0" },
      "node_modules/@tauri-apps/cli": { version: "2.11.3" },
    },
  }));
  writeFile(root, "Cargo.lock", cargoLockFixture([["atlasterm-sync", "0.1.0-beta.1"]]));
  writeFile(root, "apps/desktop/src-tauri/Cargo.lock", cargoLockFixture([["tauri", "2.8.5"]]));
  writeFile(root, "docs/release-checklist.md", "# Public Beta release notes\n");
  writeFile(root, "docs/release-notes/0.1.0-beta.1.md", "# JoeSSH 0.1.0-beta.1\n");
  writeReleaseSbomFixture(root);

  const desktopArtifacts = [
    ["desktop installer", "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe"],
    ["macos dmg", "reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg"],
    ["linux appimage", "reports/release/desktop/JoeSSH_0.1.0-beta.1_amd64.AppImage"],
  ];
  for (const [content, path] of desktopArtifacts) {
    writeFile(root, path, content);
  }

  writeWebDistFixture(root);
  runWebPackager(root);
  writeFile(root, "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64", "sync binary");
  writeManifest(root, "reports/release/desktop/SHA256SUMS.txt", desktopArtifacts);
  writeManifest(root, "reports/release/sync/SHA256SUMS.txt", [
    ["sync binary", "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64"],
  ]);
  const syncEvidence = JSON.stringify(
    {
      artifact: "sync-backup-restore-smoke",
      binary: "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64",
      binaryKind: "packaged-release",
      binaryManifest: "reports/release/sync/SHA256SUMS.txt",
      binarySha256: sha256("sync binary"),
      evidenceVersion: 1,
      platform: "linux",
      recovery: { rtoMs: 123 },
      version: "0.1.0-beta.1",
    },
    null,
    2,
  );
  writeFile(root, "reports/release/sync/backup-restore-smoke.json", `${syncEvidence}\n`);
  writeManifest(root, "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt", [
    [`${syncEvidence}\n`, "reports/release/sync/backup-restore-smoke.json"],
  ]);
  const desktopEvidence = JSON.stringify(
    {
      artifacts: [
        {
          path: "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe",
          platform: "windows",
          sha256: sha256("desktop installer"),
          signed: true,
          signatureVerification:
            "signtool verify /pa reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe passed",
        },
        {
          path: "reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg",
          platform: "macos",
          sha256: sha256("macos dmg"),
          signed: true,
          notarized: true,
          signatureVerification: "codesign --verify reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg passed",
          notarizationVerification: "spctl --assess reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg passed",
        },
        {
          path: "reports/release/desktop/JoeSSH_0.1.0-beta.1_amd64.AppImage",
          platform: "linux",
          sha256: sha256("linux appimage"),
          packageType: "AppImage",
        },
      ],
    },
    null,
    2,
  );
  writeFile(root, "reports/release/desktop/release-evidence.json", desktopEvidence);
  writeManifest(root, "reports/release/desktop/release-evidence-SHA256SUMS.txt", [
    [desktopEvidence, "reports/release/desktop/release-evidence.json"],
  ]);
  writeReleaseProvenanceFixture(root);

  return root;
}

function writeWebDistFixture(root) {
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
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    writeFile(root, relativePath, contents);
  }
}

function runWebPackager(root) {
  const result = spawnSync(process.execPath, [WEB_PACKAGER_PATH, "--root", root], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function writeReleaseSbomFixture(root) {
  const sbomFiles = [
    ["reports/release/npm-desktop-sbom.cdx.json", cyclonedxFixture("desktop")],
    ["reports/release/npm-web-sbom.cdx.json", cyclonedxFixture("web")],
    ["reports/release/cargo-metadata.json", cargoMetadataFixture("atlasterm-sync")],
    ["reports/release/tauri-cargo-metadata.json", cargoMetadataFixture("atlasterm-desktop-shell")],
  ];
  for (const [path, content] of sbomFiles) {
    writeFile(root, path, content);
  }
  writeManifest(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    sbomFiles.map(([path, content]) => [content, path]),
  );
}

function cyclonedxFixture(name) {
  return JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    metadata: { component: { name } },
    components: [{ name: `${name}-dependency`, version: "1.0.0" }],
  });
}

function cargoMetadataFixture(name) {
  const packages =
    name === "atlasterm-desktop-shell"
      ? ["atlasterm-desktop-shell", "atlasterm-core", "russh", "russh-sftp", "serde", "tauri", "tokio", "uuid"]
      : ["atlasterm-core", "atlasterm-sync", "axum", "russh", "russh-sftp", "serde", "tokio", "uuid"];
  const workspaceMembers =
    name === "atlasterm-desktop-shell" ? ["atlasterm-desktop-shell"] : ["atlasterm-core", "atlasterm-sync"];

  return JSON.stringify({
    packages: packages.map((packageName) => ({ name: packageName, version: "0.1.0-beta.1" })),
    workspace_members: workspaceMembers.map((packageName) => `path+file:///${packageName}`),
    version: 1,
  });
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function writeManifest(root, relativePath, entries) {
  writeFile(
    root,
    relativePath,
    entries.map(([content, artifactPath]) => `${sha256(content)}  ${artifactPath}`).join("\n") + "\n",
  );
}

function writeReleaseProvenanceFixture(root) {
  const manifestPaths = [
    "reports/release/SBOM-SHA256SUMS.txt",
    "reports/release/desktop/SHA256SUMS.txt",
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    "reports/release/sync/SHA256SUMS.txt",
    "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt",
    "reports/release/web/SHA256SUMS.txt",
  ];
  const provenance = JSON.stringify(
    {
      checksumManifests: manifestPaths.map((path) => ({
        entries: parseManifest(root, path),
        path,
        sha256: sha256(readFile(root, path)),
      })),
      generatedAt: "2026-06-21T00:00:00.000Z",
      lockfiles: [
        "package-lock.json",
        "Cargo.lock",
        "apps/desktop/src-tauri/Cargo.lock",
      ].map((path) => ({ path, sha256: sha256(readFile(root, path)) })),
      product: "JoeSSH",
      provenanceVersion: 1,
      releaseNotes: {
        path: "docs/release-notes/0.1.0-beta.1.md",
        sha256: sha256(readFile(root, "docs/release-notes/0.1.0-beta.1.md")),
      },
      releaseTag: "v0.1.0-beta.1",
      source: {
        cleanTreeExcluding: "reports/release",
        gitCommit: "abc123",
        gitFsckStrict: true,
        releaseTagCommit: "abc123",
        repository: "https://github.com/joessh/joessh.git",
      },
      toolchain: {
        cargo: "cargo 1.88.0 (release-test)",
        node: process.version,
        npm: "10.9.7",
        rustc: "rustc 1.88.0 (release-test)",
        tauri: {
          npmApi: "2.5.0",
          npmCli: "2.11.3",
          rustCrate: "2.8.5",
        },
      },
      verifiers: [
        "verify-artifact-checksums.mjs --all-release",
        "verify-web-release-package.mjs",
        "verify-sync-release-evidence.mjs",
        "verify-desktop-release-evidence.mjs",
        "verify-release-sbom.mjs",
        "verify-release-provenance.mjs",
      ],
      version: "0.1.0-beta.1",
    },
    null,
    2,
  );
  writeFile(root, "reports/release/release-provenance.json", `${provenance}\n`);
  writeManifest(root, "reports/release/release-provenance-SHA256SUMS.txt", [
    [`${provenance}\n`, "reports/release/release-provenance.json"],
  ]);
}

function parseManifest(root, relativePath) {
  return readFile(root, relativePath)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s\s(.+)$/);
      assert.ok(match, `${relativePath} fixture manifest line should parse: ${line}`);
      return { path: match[2], sha256: match[1] };
    });
}

function readFile(root, relativePath) {
  return readFileSync(join(root, ...relativePath.split("/")), "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cargoLockFixture(packages) {
  return packages
    .map(([name, version]) => `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`)
    .join("\n");
}

function runPreflight(root, env = createFakeGitCommands(root)) {
  return spawnSync(process.execPath, [PREFLIGHT_SCRIPT_PATH, "--root", root], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function runPreflightWithoutFakeGit(root) {
  return spawnSync(process.execPath, [PREFLIGHT_SCRIPT_PATH, "--root", root], {
    encoding: "utf8",
  });
}

function createFakeGitCommands(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    duplicateRelease: false,
    dirtyStatus: "",
    ghAuthFails: false,
    releaseViewUnknownFails: false,
    tagCommit: "abc123",
    tagMissing: false,
    ...options,
  };
  const fakeGitPath = join(binDir, "git.js");
  writeFileSync(
    fakeGitPath,
    `
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join(" ");
if (key === "rev-parse --is-inside-work-tree") {
  console.log("true");
  process.exit(0);
}
if (key === "status --porcelain=v1 --untracked-files=all -- . :(exclude)reports/release") {
  if (state.dirtyStatus) {
    console.log(state.dirtyStatus);
  }
  process.exit(0);
}
if (key === "rev-parse HEAD") {
  console.log("abc123");
  process.exit(0);
}
if (key === "rev-parse --verify v0.1.0-beta.1^{}") {
  if (state.tagMissing) {
    console.error("fatal: Needed a single revision");
    process.exit(1);
  }
  console.log(state.tagCommit);
  process.exit(0);
}
if (key === "fsck --strict") {
  process.exit(0);
}
if (key === "remote get-url origin") {
  console.log("https://github.com/joessh/joessh.git");
  process.exit(0);
}
console.error("unexpected git args: " + key);
process.exit(2);
`,
    "utf8",
  );

  const fakeGhPath = join(binDir, "gh.js");
  writeFileSync(
    fakeGhPath,
    `
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join(" ");
if (key === "--version") {
  console.log("gh version 2.0.0");
  process.exit(0);
}
if (key === "auth status") {
  if (state.ghAuthFails) {
    console.error("not logged in");
    process.exit(1);
  }
  console.log("Logged in");
  process.exit(0);
}
if (key === "release view v0.1.0-beta.1 --json url") {
  if (state.duplicateRelease) {
    console.log('{"url":"https://github.example/releases/v0.1.0-beta.1"}');
    process.exit(0);
  }
  if (state.releaseViewUnknownFails) {
    console.error("network unavailable");
    process.exit(1);
  }
  console.error("release not found");
  process.exit(1);
}
console.error("unexpected gh args: " + key);
process.exit(2);
`,
    "utf8",
  );

  const fakeToolPath = join(binDir, "tool.js");
  writeFileSync(
    fakeToolPath,
    `
const [tool, ...args] = process.argv.slice(2);
if (args.join(" ") !== "--version") {
  console.error("unexpected tool args: " + [tool, ...args].join(" "));
  process.exit(2);
}
const versions = {
  npm: "10.9.7",
  cargo: "cargo 1.88.0 (release-test)",
  rustc: "rustc 1.88.0 (release-test)",
};
console.log(versions[tool] ?? "");
process.exit(versions[tool] ? 0 : 2);
`,
    "utf8",
  );

  return {
    ATLASTERM_RELEASE_CARGO_ARGS: JSON.stringify([fakeToolPath, "cargo"]),
    ATLASTERM_RELEASE_CARGO_COMMAND: process.execPath,
    ATLASTERM_RELEASE_GH_ARGS: JSON.stringify([fakeGhPath]),
    ATLASTERM_RELEASE_GH_COMMAND: process.execPath,
    ATLASTERM_RELEASE_GIT_ARGS: JSON.stringify([fakeGitPath]),
    ATLASTERM_RELEASE_GIT_COMMAND: process.execPath,
    ATLASTERM_RELEASE_NPM_ARGS: JSON.stringify([fakeToolPath, "npm"]),
    ATLASTERM_RELEASE_NPM_COMMAND: process.execPath,
    ATLASTERM_RELEASE_RUSTC_ARGS: JSON.stringify([fakeToolPath, "rustc"]),
    ATLASTERM_RELEASE_RUSTC_COMMAND: process.execPath,
  };
}

test("publish preflight verifies checksums, evidence, SBOM, provenance, and release draft dry run", (t) => {
  const result = runPreflight(createReleaseFixture(t));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Verify release Git checkout/);
  assert.match(result.stdout, /Verified clean Git checkout at v0\.1\.0-beta\.1/);
  assert.match(result.stdout, /Verify GitHub CLI publish readiness/);
  assert.match(result.stdout, /Verified GitHub CLI authentication and no existing v0\.1\.0-beta\.1 release/);
  assert.match(result.stdout, /Verify release artifact checksums/);
  assert.match(result.stdout, /Verify Web Admin release package/);
  assert.match(result.stdout, /Verify Sync release evidence/);
  assert.match(result.stdout, /Verify Desktop signing\/distribution evidence/);
  assert.match(result.stdout, /Verify release SBOM/);
  assert.match(result.stdout, /Verify release provenance/);
  assert.match(result.stdout, /Release draft dry run passed for v0\.1\.0-beta\.1/);
  assert.match(result.stdout, /Public release publish preflight passed/);
});

test("publish preflight rejects missing Git checkout metadata", (t) => {
  const result = runPreflightWithoutFakeGit(createReleaseFixture(t));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Git checkout metadata is required for publish preflight/);
  assert.match(result.stderr, /Public release publish preflight failed: Verify release Git checkout/);
});

test("publish preflight rejects a dirty Git working tree", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(root, createFakeGitCommands(root, { dirtyStatus: " M package.json" }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Git working tree outside reports\/release must be clean for publish preflight/);
  assert.match(result.stderr, /M package\.json/);
});

test("publish preflight rejects a release tag that does not point at HEAD", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(root, createFakeGitCommands(root, { tagCommit: "def456" }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release tag v0\.1\.0-beta\.1 must point at HEAD for publish preflight/);
});

test("publish preflight rejects unauthenticated GitHub CLI state", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(root, createFakeGitCommands(root, { ghAuthFails: true }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GitHub CLI must be authenticated for publish preflight/);
  assert.match(result.stderr, /Public release publish preflight failed: Verify GitHub CLI publish readiness/);
});

test("publish preflight rejects duplicate GitHub releases", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(root, createFakeGitCommands(root, { duplicateRelease: true }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GitHub Release v0\.1\.0-beta\.1 already exists/);
  assert.match(result.stderr, /Public release publish preflight failed: Verify GitHub CLI publish readiness/);
});

test("publish preflight rejects ambiguous GitHub release lookup failures", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(root, createFakeGitCommands(root, { releaseViewUnknownFails: true }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unable to confirm GitHub Release v0\.1\.0-beta\.1 does not already exist/);
  assert.match(result.stderr, /Public release publish preflight failed: Verify GitHub CLI publish readiness/);
});

test("publish preflight fails when Desktop evidence is missing", (t) => {
  const root = createReleaseFixture(t);
  rmSync(join(root, "reports", "release", "desktop", "release-evidence.json"));
  rmSync(join(root, "reports", "release", "desktop", "release-evidence-SHA256SUMS.txt"));

  const result = runPreflight(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing desktop release evidence/);
  assert.match(result.stderr, /Public release publish preflight failed: Verify Desktop signing\/distribution evidence/);
});
