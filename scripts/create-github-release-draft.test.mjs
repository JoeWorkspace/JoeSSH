import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const DRAFT_SCRIPT_PATH = fileURLToPath(new URL("./create-github-release-draft.mjs", import.meta.url));

function createReleaseFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release-draft-"));
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
  writeFile(root, "docs/release-checklist.md", "# Release notes\n");
  writeFile(root, "docs/release-notes/0.1.0-beta.1.md", "# JoeSSH 0.1.0-beta.1\n");
  writeReleaseSbomFixture(root);

  const desktopArtifacts = [
    ["desktop installer", "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe"],
    ["macos dmg", "reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg"],
    ["linux appimage", "reports/release/desktop/JoeSSH_0.1.0-beta.1_amd64.AppImage"],
  ];
  for (const [content, path] of desktopArtifacts) {
    writeArtifact(root, path, content);
  }
  writeArtifact(root, "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip", "web bundle");
  writeArtifact(root, "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64", "sync binary");
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

  writeManifest(root, "reports/release/desktop/SHA256SUMS.txt", desktopArtifacts);
  writeManifest(root, "reports/release/web/SHA256SUMS.txt", [
    ["web bundle", "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip"],
  ]);
  writeManifest(root, "reports/release/sync/SHA256SUMS.txt", [
    ["sync binary", "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64"],
  ]);
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
  const desktopEvidenceSource = desktopEvidenceSourceFixture();
  writeFile(root, "reports/release/desktop/release-evidence-source.json", desktopEvidenceSource);
  writeManifest(root, "reports/release/desktop/release-evidence-SHA256SUMS.txt", [
    [desktopEvidence, "reports/release/desktop/release-evidence.json"],
    [desktopEvidenceSource, "reports/release/desktop/release-evidence-source.json"],
  ]);
  writeReleaseProvenanceFixture(root);

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
    ["desktop sbom", "reports/release/npm-desktop-sbom.cdx.json", cyclonedxFixture("desktop")],
    ["web sbom", "reports/release/npm-web-sbom.cdx.json", cyclonedxFixture("web")],
    ["cargo metadata", "reports/release/cargo-metadata.json", cargoMetadataFixture("atlasterm-sync")],
    ["tauri cargo metadata", "reports/release/tauri-cargo-metadata.json", cargoMetadataFixture("atlasterm-desktop-shell")],
  ];
  for (const [, path, content] of sbomFiles) {
    writeFile(root, path, content);
  }
  writeManifest(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    sbomFiles.map(([, path, content]) => [content, path]),
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

function writeArtifact(root, relativePath, content) {
  writeFile(root, relativePath, content);
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
        "verify-desktop-release-evidence.mjs --require-source",
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

function rewriteReleaseProvenance(root, mutate) {
  const provenance = JSON.parse(readFile(root, "reports/release/release-provenance.json"));
  mutate(provenance);
  const text = `${JSON.stringify(provenance, null, 2)}\n`;
  writeFile(root, "reports/release/release-provenance.json", text);
  writeManifest(root, "reports/release/release-provenance-SHA256SUMS.txt", [
    [text, "reports/release/release-provenance.json"],
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

function runDraft(root, env = createFakeReleaseMachineCommands(root)) {
  return spawnSync(process.execPath, [DRAFT_SCRIPT_PATH, "--root", root, "--dry-run", "--desktop"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function runPublishDraft(root, env = {}) {
  return spawnSync(process.execPath, [DRAFT_SCRIPT_PATH, "--root", root, "--desktop"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function createFakeReleaseMachineCommands(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    dirtyStatus: "",
    duplicateRelease: false,
    ghAuthFails: false,
    releaseViewUnknownFails: false,
    tagCommit: "abc123",
    tagMissing: false,
    ...options,
  };

  const fakeGitPath = writeNodeBackedCommand(
    binDir,
    "git",
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
  );
  const fakeGhPath = writeNodeBackedCommand(
    binDir,
    "gh",
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
if (key.startsWith("release create v0.1.0-beta.1 --draft")) {
  console.log("created draft release");
  process.exit(0);
}
console.error("unexpected gh args: " + key);
process.exit(2);
`,
  );
  const fakeToolPath = writeNodeBackedCommand(
    binDir,
    "tool",
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
  );

  return {
    ATLASTERM_RELEASE_GH_ARGS: JSON.stringify([fakeGhPath]),
    ATLASTERM_RELEASE_GH_COMMAND: process.execPath,
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

function writeNodeBackedCommand(binDir, name, source) {
  const jsPath = join(binDir, `${name}.js`);
  writeFileSync(jsPath, source, "utf8");
  return jsPath;
}

test("dry run verifies artifacts and prints the GitHub release command", (t) => {
  const result = runDraft(createReleaseFixture(t));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Release draft dry run passed for v0\.1\.0-beta\.1/);
  assert.match(result.stdout, /gh release create v0\.1\.0-beta\.1 --draft/);
  assert.match(result.stdout, /reports\/release\/desktop\/JoeSSH_0\.1\.0-beta\.1_x64-setup\.exe/);
});

test("dry run rejects missing release notes", (t) => {
  const root = createReleaseFixture(t);
  rmSync(join(root, "docs", "release-notes", "0.1.0-beta.1.md"));

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release notes file is required/);
});

test("non-dry-run validates release machine state before creating a draft", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(root, createFakeReleaseMachineCommands(root));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /created draft release/);
});

test("non-dry-run rejects a dirty Git working tree", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(root, createFakeReleaseMachineCommands(root, { dirtyStatus: " M package.json" }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Git working tree outside reports\/release must be clean/);
  assert.match(result.stderr, /M package\.json/);
});

test("non-dry-run rejects a missing release tag", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(root, createFakeReleaseMachineCommands(root, { tagMissing: true }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release tag v0\.1\.0-beta\.1 must exist/);
});

test("non-dry-run rejects a release tag that does not point at HEAD", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(root, createFakeReleaseMachineCommands(root, { tagCommit: "def456" }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release tag v0\.1\.0-beta\.1 must point at HEAD/);
});

test("non-dry-run rejects release provenance from a different Git source", (t) => {
  const root = createReleaseFixture(t);
  rewriteReleaseProvenance(root, (provenance) => {
    provenance.source.gitCommit = "def456";
    provenance.source.releaseTagCommit = "def456";
  });

  const result = runPublishDraft(root, createFakeReleaseMachineCommands(root));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /source\.gitCommit does not match current HEAD/);
});

test("non-dry-run rejects unauthenticated GitHub CLI state", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(root, createFakeReleaseMachineCommands(root, { ghAuthFails: true }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GitHub CLI must be authenticated/);
});

test("non-dry-run rejects duplicate GitHub releases", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(root, createFakeReleaseMachineCommands(root, { duplicateRelease: true }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exists/);
});

test("non-dry-run rejects ambiguous GitHub release lookup failures", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(root, createFakeReleaseMachineCommands(root, { releaseViewUnknownFails: true }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unable to confirm GitHub Release v0\.1\.0-beta\.1 does not already exist/);
});

test("dry run rejects missing required checksum manifests", (t) => {
  const root = createReleaseFixture(t);
  rmSync(join(root, "reports", "release", "desktop", "SHA256SUMS.txt"));

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required SHA256 checksum manifest/);
  assert.match(result.stderr, /reports\/release\/desktop\/SHA256SUMS\.txt/);
});

test("dry run rejects missing SBOM checksum manifests", (t) => {
  const root = createReleaseFixture(t);
  rmSync(join(root, "reports", "release", "SBOM-SHA256SUMS.txt"));

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required SHA256 checksum manifest/);
  assert.match(result.stderr, /reports\/release\/SBOM-SHA256SUMS\.txt/);
});

test("dry run rejects stale checksum manifests before drafting", (t) => {
  const root = createReleaseFixture(t);
  writeFile(root, "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip", "mutated web bundle");

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA256 checksum verification failed/);
  assert.match(result.stderr, /hash mismatch/);
});

test("dry run rejects Web Admin manifests without the release package", (t) => {
  const root = createReleaseFixture(t);
  writeFile(root, "apps/web/dist/index.html", "web dist");
  writeManifest(root, "reports/release/web/SHA256SUMS.txt", [["web dist", "apps/web/dist/index.html"]]);

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing Web Admin release package/);
  assert.match(result.stderr, /joessh-web-admin-0\.1\.0-beta\.1\.zip/);
});

test("dry run rejects release upload files without checksum coverage", (t) => {
  const root = createReleaseFixture(t);
  writeFile(root, "reports/release/sync/uncovered-smoke.json", '{"ok":true}\n');

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release artifacts missing SHA256 coverage/);
  assert.match(result.stderr, /reports\/release\/sync\/uncovered-smoke\.json/);
});

test("dry run rejects local-only handoff files in the release upload tree", (t) => {
  const root = createReleaseFixture(t);
  writeFile(root, "reports/release/desktop/formal-evidence-unblock-report.json", '{"decision":"no-go"}\n');

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Local-only handoff file\(s\) must not be uploaded/);
  assert.match(result.stderr, /reports\/release\/desktop\/formal-evidence-unblock-report\.json/);
});

test("dry run uploads only staged reports release artifacts", (t) => {
  const root = createReleaseFixture(t);
  writeFile(
    root,
    "apps/desktop/src-tauri/target/release/bundle/nsis/JoeSSH_0.1.0-beta.1_raw-setup.exe",
    "raw tauri bundle",
  );

  const result = runDraft(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /apps\/desktop\/src-tauri\/target\/release\/bundle/);
  assert.doesNotMatch(result.stdout, /raw-setup\.exe/);
});

test("dry run rejects missing desktop release evidence before drafting", (t) => {
  const root = createReleaseFixture(t);
  rmSync(join(root, "reports", "release", "desktop", "release-evidence.json"));

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing desktop release evidence/);
  assert.match(result.stderr, /reports\/release\/desktop\/release-evidence\.json/);
});

test("dry run rejects desktop release evidence without workflow source provenance", (t) => {
  const root = createReleaseFixture(t);
  rmSync(join(root, "reports", "release", "desktop", "release-evidence-source.json"));
  writeManifest(root, "reports/release/desktop/release-evidence-SHA256SUMS.txt", [
    [readFile(root, "reports/release/desktop/release-evidence.json"), "reports/release/desktop/release-evidence.json"],
  ]);

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing desktop evidence source sidecar/);
});
