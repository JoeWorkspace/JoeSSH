import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const GENERATOR_PATH = fileURLToPath(new URL("./generate-release-provenance.mjs", import.meta.url));
const VERIFIER_PATH = fileURLToPath(new URL("./verify-release-provenance.mjs", import.meta.url));

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release-provenance-"));
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
  writeFile(root, "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip", "web bundle");
  writeFile(root, "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64", "sync binary");
  const desktopEvidence = JSON.stringify({
    artifacts: desktopArtifacts.map(([content, path]) => ({
      path,
      platform: path.endsWith(".exe") ? "windows" : path.endsWith(".dmg") ? "macos" : "linux",
      sha256: sha256(content),
    })),
  });
  writeFile(root, "reports/release/desktop/release-evidence.json", desktopEvidence);
  const desktopEvidenceSource = desktopEvidenceSourceFixture();
  writeFile(root, "reports/release/desktop/release-evidence-source.json", desktopEvidenceSource);
  const syncEvidence = JSON.stringify({
    binary: "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64",
    binaryManifest: "reports/release/sync/SHA256SUMS.txt",
    binarySha256: sha256("sync binary"),
  });
  writeFile(root, "reports/release/sync/backup-restore-smoke.json", syncEvidence);
  writeManifest(root, "reports/release/desktop/SHA256SUMS.txt", desktopArtifacts);
  writeManifest(root, "reports/release/desktop/release-evidence-SHA256SUMS.txt", [
    [desktopEvidence, "reports/release/desktop/release-evidence.json"],
    [desktopEvidenceSource, "reports/release/desktop/release-evidence-source.json"],
  ]);
  writeManifest(root, "reports/release/web/SHA256SUMS.txt", [
    ["web bundle", "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip"],
  ]);
  writeManifest(root, "reports/release/sync/SHA256SUMS.txt", [
    ["sync binary", "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64"],
  ]);
  writeManifest(root, "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt", [
    [syncEvidence, "reports/release/sync/backup-restore-smoke.json"],
  ]);

  return root;
}

function desktopEvidenceSourceFixture() {
  return JSON.stringify(
    {
      artifactName: "desktop-release-evidence",
      formalEvidenceJob: {
        conclusion: "success",
        databaseId: 123456780,
        name: "Package Formal Desktop Evidence",
        status: "completed",
      },
      importedAt: "2026-06-21T00:00:00.000Z",
      releaseRef: "v0.1.0-beta.1",
      releaseTagCommit: "abc123",
      repository: "JoeWorkspace/JoeSSH",
      sourceVersion: 1,
      workflowRun: {
        conclusion: "success",
        headSha: "abc123",
        id: "123456789",
        status: "completed",
        url: "https://github.example/actions/runs/123456789",
        workflowDatabaseId: 987654321,
        workflowName: "Desktop Release Artifacts",
      },
    },
    null,
    2,
  );
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
  return JSON.stringify({
    packages: [{ name, version: "0.1.0-beta.1" }],
    workspace_members: [`path+file:///${name}`],
    version: 1,
  });
}

function createFakeCommands(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    dirtyStatus: "",
    fsckFails: false,
    tagCommit: "abc123",
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
  console.log(state.tagCommit);
  process.exit(0);
}
if (key === "fsck --strict") {
  if (state.fsckFails) {
    console.error("dangling object");
    process.exit(1);
  }
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
if (!versions[tool]) {
  console.error("unknown tool: " + tool);
  process.exit(2);
}
console.log(versions[tool]);
`,
    "utf8",
  );

  return {
    ATLASTERM_RELEASE_CARGO_ARGS: JSON.stringify([fakeToolPath, "cargo"]),
    ATLASTERM_RELEASE_CARGO_COMMAND: process.execPath,
    ATLASTERM_RELEASE_GIT_ARGS: JSON.stringify([fakeGitPath]),
    ATLASTERM_RELEASE_GIT_COMMAND: process.execPath,
    ATLASTERM_RELEASE_NPM_ARGS: JSON.stringify([fakeToolPath, "npm"]),
    ATLASTERM_RELEASE_NPM_COMMAND: process.execPath,
    ATLASTERM_RELEASE_RUSTC_ARGS: JSON.stringify([fakeToolPath, "rustc"]),
    ATLASTERM_RELEASE_RUSTC_COMMAND: process.execPath,
  };
}

function runGenerator(root, env = createFakeCommands(root)) {
  return spawnSync(process.execPath, [GENERATOR_PATH, "--root", root], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function runVerifier(root, env = createFakeCommands(root), extraArgs = []) {
  return spawnSync(process.execPath, [VERIFIER_PATH, "--root", root, ...extraArgs], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

test("generates and verifies release provenance for staged release artifacts", (t) => {
  const root = createFixture(t);
  const env = createFakeCommands(root);

  const generated = runGenerator(root, env);

  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  assert.equal(existsSync(join(root, "reports", "release", "release-provenance.json")), true);
  assert.equal(existsSync(join(root, "reports", "release", "release-provenance-SHA256SUMS.txt")), true);

  const provenance = JSON.parse(readFile(root, "reports/release/release-provenance.json"));
  assert.equal(provenance.provenanceVersion, 1);
  assert.equal(provenance.releaseTag, "v0.1.0-beta.1");
  assert.equal(provenance.source.gitCommit, "abc123");
  assert.equal(provenance.source.repository, "https://github.com/joessh/joessh.git");
  assert.equal(provenance.source.gitFsckStrict, true);
  assert.equal(provenance.releaseNotes.path, "docs/release-notes/0.1.0-beta.1.md");
  assert.deepEqual(
    provenance.lockfiles.map((entry) => entry.path).sort(),
    ["Cargo.lock", "apps/desktop/src-tauri/Cargo.lock", "package-lock.json"],
  );
  assert.deepEqual(
    provenance.checksumManifests.map((entry) => entry.path).sort(),
    [
      "reports/release/SBOM-SHA256SUMS.txt",
      "reports/release/desktop/SHA256SUMS.txt",
      "reports/release/desktop/release-evidence-SHA256SUMS.txt",
      "reports/release/sync/SHA256SUMS.txt",
      "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt",
      "reports/release/web/SHA256SUMS.txt",
    ],
  );
  assert.equal(provenance.toolchain.tauri.npmCli, "2.11.3");
  assert.equal(provenance.toolchain.tauri.rustCrate, "2.8.5");
  assert.match(
    readFile(root, "reports/release/release-provenance-SHA256SUMS.txt"),
    /^([a-f0-9]{64}) {2}reports\/release\/release-provenance\.json\n$/,
  );

  const verified = runVerifier(root, env);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.match(verified.stdout, /Release provenance verified for v0\.1\.0-beta\.1/);
});

test("rejects release provenance generation without Desktop evidence source coverage", (t) => {
  const root = createFixture(t);
  const env = createFakeCommands(root);
  rmSync(join(root, "reports", "release", "desktop", "release-evidence-source.json"));
  writeManifest(root, "reports/release/desktop/release-evidence-SHA256SUMS.txt", [
    [readFile(root, "reports/release/desktop/release-evidence.json"), "reports/release/desktop/release-evidence.json"],
  ]);

  const generated = runGenerator(root, env);

  assert.equal(generated.status, 1);
  assert.match(generated.stderr, /Desktop formal evidence source sidecar must be covered/);
});

test("rejects stale artifact hashes after provenance generation", (t) => {
  const root = createFixture(t);
  const env = createFakeCommands(root);
  assert.equal(runGenerator(root, env).status, 0);

  writeFile(root, "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip", "mutated web bundle");
  const verified = runVerifier(root, env);

  assert.equal(verified.status, 1);
  assert.match(verified.stderr, /artifact hash mismatch for reports\/release\/web\/joessh-web-admin-0\.1\.0-beta\.1\.zip/);
});

test("rejects provenance without checksum coverage for the provenance file", (t) => {
  const root = createFixture(t);
  const env = createFakeCommands(root);
  assert.equal(runGenerator(root, env).status, 0);

  rmSync(join(root, "reports", "release", "release-provenance-SHA256SUMS.txt"));
  const verified = runVerifier(root, env);

  assert.equal(verified.status, 1);
  assert.match(verified.stderr, /missing provenance checksum manifest/);
});

test("rejects generation when required Public Beta checksum manifests are missing", (t) => {
  const root = createFixture(t);
  rmSync(join(root, "reports", "release", "sync", "backup-restore-smoke-SHA256SUMS.txt"));

  const generated = runGenerator(root);

  assert.equal(generated.status, 1);
  assert.match(generated.stderr, /Required Public Beta checksum manifest\(s\) missing/);
  assert.match(generated.stderr, /reports\/release\/sync\/backup-restore-smoke-SHA256SUMS\.txt/);
});

test("rejects unexpected staged checksum manifests after provenance generation", (t) => {
  const root = createFixture(t);
  const env = createFakeCommands(root);
  assert.equal(runGenerator(root, env).status, 0);

  writeFile(root, "reports/release/extra.txt", "extra artifact");
  writeManifest(root, "reports/release/extra-SHA256SUMS.txt", [
    ["extra artifact", "reports/release/extra.txt"],
  ]);
  const verified = runVerifier(root, env);

  assert.equal(verified.status, 1);
  assert.match(verified.stderr, /unexpected Public Beta checksum manifest is staged/);
  assert.match(verified.stderr, /reports\/release\/extra-SHA256SUMS\.txt/);
});

test("can skip current Git checks for draft dry-runs while preserving content checks", (t) => {
  const root = createFixture(t);
  const env = createFakeCommands(root);
  assert.equal(runGenerator(root, env).status, 0);

  const toolEnv = { ...env };
  delete toolEnv.ATLASTERM_RELEASE_GIT_ARGS;
  delete toolEnv.ATLASTERM_RELEASE_GIT_COMMAND;
  const verified = runVerifier(root, toolEnv, ["--skip-current-git-check"]);

  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
});

test("rejects generation when git fsck --strict fails", (t) => {
  const root = createFixture(t);

  const generated = runGenerator(root, createFakeCommands(root, { fsckFails: true }));

  assert.equal(generated.status, 1);
  assert.match(generated.stderr, /git fsck --strict must pass to generate release provenance/);
});

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function readFile(root, relativePath) {
  return readFileSync(join(root, ...relativePath.split("/")), "utf8");
}

function writeManifest(root, relativePath, entries) {
  writeFile(
    root,
    relativePath,
    entries.map(([content, artifactPath]) => `${sha256(content)}  ${artifactPath}`).join("\n") + "\n",
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cargoLockFixture(packages) {
  return packages
    .map(([name, version]) => `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`)
    .join("\n");
}
