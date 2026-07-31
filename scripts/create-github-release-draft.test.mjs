import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildThirdPartyLicenseBundle } from "./third-party-license-contract.mjs";
import {
  sourceBoundReleaseSbomEnvironment,
  writeSourceBoundReleaseSbomFixture,
  writePublishedLicenseSourceInputFixture,
} from "./release-sbom-test-fixtures.mjs";

const DRAFT_SCRIPT_PATH = fileURLToPath(
  new URL("./create-github-release-draft.mjs", import.meta.url),
);

function createReleaseFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release-draft-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeFile(
    root,
    "package.json",
    JSON.stringify({ name: "atlasterm", version: "0.1.0-beta.1" }),
  );
  writeFile(
    root,
    "package-lock.json",
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/@tauri-apps/api": { version: "2.5.0" },
        "node_modules/@tauri-apps/cli": { version: "2.11.3" },
      },
    }),
  );
  writeFile(
    root,
    "Cargo.lock",
    cargoLockFixture([["atlasterm-sync", "0.1.0-beta.1"]]),
  );
  writeFile(
    root,
    "apps/desktop/src-tauri/Cargo.lock",
    cargoLockFixture([["tauri", "2.8.5"]]),
  );
  writeFile(root, "docs/release-checklist.md", "# Release notes\n");
  writeFile(
    root,
    "docs/release-notes/0.1.0-beta.1.md",
    "# JoeSSH 0.1.0-beta.1\n",
  );
  writeReleaseSbomFixture(root);
  writePublishedLicenseFixture(root);

  const desktopArtifacts = [
    [
      "desktop installer",
      "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe",
    ],
    ["macos dmg", "reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg"],
    [
      "linux appimage",
      "reports/release/desktop/JoeSSH_0.1.0-beta.1_amd64.AppImage",
    ],
  ];
  for (const [content, path] of desktopArtifacts) {
    writeArtifact(root, path, content);
  }
  writeArtifact(
    root,
    "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip",
    "web bundle",
  );
  writeArtifact(
    root,
    "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64",
    "sync binary",
  );
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
  writeFile(
    root,
    "reports/release/sync/backup-restore-smoke.json",
    `${syncEvidence}\n`,
  );

  writeManifest(
    root,
    "reports/release/desktop/SHA256SUMS.txt",
    desktopArtifacts,
  );
  writeManifest(root, "reports/release/web/SHA256SUMS.txt", [
    ["web bundle", "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip"],
  ]);
  writeManifest(root, "reports/release/sync/SHA256SUMS.txt", [
    ["sync binary", "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64"],
  ]);
  writeManifest(
    root,
    "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt",
    [[`${syncEvidence}\n`, "reports/release/sync/backup-restore-smoke.json"]],
  );
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
          signatureVerification:
            "codesign --verify reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg passed",
          notarizationVerification:
            "spctl --assess reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg passed",
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
  writeFile(
    root,
    "reports/release/desktop/release-evidence.json",
    desktopEvidence,
  );
  const desktopEvidenceSource = desktopEvidenceSourceFixture();
  writeFile(
    root,
    "reports/release/desktop/release-evidence-source.json",
    desktopEvidenceSource,
  );
  writeManifest(
    root,
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    [
      [desktopEvidence, "reports/release/desktop/release-evidence.json"],
      [
        desktopEvidenceSource,
        "reports/release/desktop/release-evidence-source.json",
      ],
    ],
  );
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
  writeSourceBoundReleaseSbomFixture(root);
}

function writePublishedLicenseFixture(root) {
  writePublishedLicenseSourceInputFixture(root);
  const { checksumText, manifestText, noticesText } =
    buildThirdPartyLicenseBundle(root);
  writeFile(
    root,
    "reports/release/third-party-licenses/manifest.json",
    manifestText,
  );
  writeFile(
    root,
    "reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt",
    noticesText,
  );
  writeFile(
    root,
    "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
    checksumText,
  );
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
    entries
      .map(([content, artifactPath]) => `${sha256(content)}  ${artifactPath}`)
      .join("\n") + "\n",
  );
}

function writeReleaseProvenanceFixture(root) {
  const manifestPaths = [
    "reports/release/SBOM-SHA256SUMS.txt",
    "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
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
        "verify-third-party-licenses.mjs",
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
  const provenance = JSON.parse(
    readFile(root, "reports/release/release-provenance.json"),
  );
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
      assert.ok(
        match,
        `${relativePath} fixture manifest line should parse: ${line}`,
      );
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
    .map(
      ([name, version]) =>
        `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`,
    )
    .join("\n");
}

function runDraft(root, env = createFakeReleaseMachineCommands(root)) {
  return spawnSync(
    process.execPath,
    [DRAFT_SCRIPT_PATH, "--root", root, "--dry-run", "--desktop"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    },
  );
}

function runPublishDraft(root, env = {}) {
  return spawnSync(
    process.execPath,
    [DRAFT_SCRIPT_PATH, "--root", root, "--desktop"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    },
  );
}

function createFakeReleaseMachineCommands(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    dirtyStatus: "",
    duplicateRelease: false,
    fixtureRoot: root,
    ghAuthFails: false,
    githubControlsFail: false,
    mainCommit: "abc123",
    mainCommitAfterCreate: null,
    mainCommitAfterReadinessAfterCreate: null,
    releaseDeleteConfirmationUnknownFails: false,
    releaseDeleteFails: false,
    releaseCreateFails: false,
    releaseId: 424242,
    releaseCheckAppId: 15368,
    releaseCheckConclusion: "success",
    releaseCheckHeadSha: "abc123",
    releaseCheckMissing: false,
    releaseCheckPages: null,
    releaseCheckPagesAfterCreate: null,
    releaseCheckStatus: "completed",
    releaseCheckTotalCount: null,
    releaseCheckTotalCountAfterCreate: null,
    releaseChecks: null,
    releaseChecksAfterCreate: null,
    releaseViewUnknownFails: false,
    remoteTagCommit: options.remoteTagCommit ?? options.tagCommit ?? "abc123",
    remoteTagCommitAfterCreate: null,
    remoteTagMissing: false,
    remoteTagObjectCommit: "abc123",
    remoteTagObjectSha: "c".repeat(40),
    remoteTagType: "commit",
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
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join(" ");
const remoteStatePath = path.join(
  state.fixtureRoot,
  "fake-github-release-state.json",
);
const deletionMarkerPath = remoteStatePath + ".deleted";
const mainAdvanceMarkerPath = remoteStatePath + ".main-advanced";

function digest(buffer) {
  return "sha256:" + crypto.createHash("sha256").update(buffer).digest("hex");
}

function readRemoteRelease() {
  if (!fs.existsSync(remoteStatePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(remoteStatePath, "utf8"));
}

function writeRemoteRelease(release) {
  fs.writeFileSync(
    remoteStatePath,
    JSON.stringify(release, null, 2),
    "utf8",
  );
}

function notFound() {
  console.error("gh: Not Found (HTTP 404)");
  process.exit(1);
}

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
if (
  key ===
  "release view v0.1.0-beta.1 --repo JoeWorkspace/JoeSSH --json url"
) {
  if (state.duplicateRelease || readRemoteRelease() !== null) {
    console.log('{"url":"https://github.com/joessh/joessh/releases/tag/v0.1.0-beta.1"}');
    process.exit(0);
  }
  if (state.releaseViewUnknownFails) {
    console.error("network endpoint not found");
    process.exit(1);
  }
  console.error("release not found");
  process.exit(1);
}
if (
  key.startsWith(
    "release create v0.1.0-beta.1 --repo JoeWorkspace/JoeSSH --draft",
  )
) {
  const notesIndex = args.indexOf("--notes-file");
  const notesPath = notesIndex === -1 ? "" : args[notesIndex + 1];
  const uploadPaths = notesIndex === -1 ? [] : args.slice(notesIndex + 2);
  const titleIndex = args.indexOf("--title");
  const releaseTitle = titleIndex === -1 ? "" : args[titleIndex + 1];
  if (state.mutateSourceAtReleaseCreate) {
    const sourcePath = path.resolve(
      state.fixtureRoot,
      ...state.mutateSourceAtReleaseCreate.relativePath.split("/"),
    );
    fs.writeFileSync(
      sourcePath,
      state.mutateSourceAtReleaseCreate.content,
      "utf8",
    );
  }
  let tamperedUpload = null;
  if (state.tamperSnapshotDuringUpload) {
    tamperedUpload = uploadPaths.find(
      (uploadPath) =>
        path.basename(uploadPath) ===
        state.tamperSnapshotDuringUpload.uploadName,
    );
    if (!tamperedUpload) {
      console.error(
        "snapshot tamper target not found: " +
          state.tamperSnapshotDuringUpload.uploadName,
      );
      process.exit(2);
    }
  }
  let originalSnapshot = null;
  if (tamperedUpload) {
    const metadata = fs.statSync(tamperedUpload);
    originalSnapshot = {
      atime: metadata.atime,
      bytes: fs.readFileSync(tamperedUpload),
      mode: metadata.mode & 0o777,
      mtime: metadata.mtime,
    };
    fs.chmodSync(tamperedUpload, 0o600);
    fs.writeFileSync(
      tamperedUpload,
      state.tamperSnapshotDuringUpload.content,
      "utf8",
    );
  }
  const uploadedBytes = uploadPaths.map((uploadPath) => ({
    bytes: fs.readFileSync(uploadPath),
    path: uploadPath,
  }));
  if (tamperedUpload) {
    fs.writeFileSync(tamperedUpload, originalSnapshot.bytes);
    fs.chmodSync(tamperedUpload, originalSnapshot.mode);
    fs.utimesSync(
      tamperedUpload,
      originalSnapshot.atime,
      originalSnapshot.mtime,
    );
  }
  if (state.captureReleaseCreatePath) {
    const snapshotRoot = path.dirname(notesPath);
    const capture = {
      args,
      notes: {
        content: fs.readFileSync(notesPath, "utf8"),
        path: notesPath,
      },
      snapshotRoot,
      uploads: uploadedBytes.map(({ bytes, path: uploadPath }) => ({
        content: bytes.toString("utf8"),
        localContentAfterUpload: fs.readFileSync(uploadPath, "utf8"),
        path: uploadPath,
        readOnly: (fs.statSync(uploadPath).mode & 0o222) === 0,
      })),
    };
    fs.writeFileSync(
      state.captureReleaseCreatePath,
      JSON.stringify(capture, null, 2),
      "utf8",
    );
  }
  if (state.releaseCreateFails) {
    console.error("draft creation failed");
    process.exit(1);
  }
  const release = {
    assets: uploadedBytes.map(({ bytes, path: uploadPath }, index) => ({
      digest: digest(bytes),
      id: 500000 + index,
      name: path.basename(uploadPath),
      size: bytes.length,
      state: "uploaded",
    })),
    draft: true,
    html_url:
      "https://github.com/joessh/joessh/releases/tag/v0.1.0-beta.1",
    id: state.releaseId,
    name: releaseTitle,
    tag_name: "v0.1.0-beta.1",
  };
  if (state.remoteAssetDigestMissing && release.assets.length > 0) {
    delete release.assets[0].digest;
  }
  if (state.remoteAssetSizeDelta) {
    const asset = release.assets.find(
      ({ name }) => name === state.remoteAssetSizeDelta.uploadName,
    );
    if (!asset) {
      console.error(
        "remote size tamper target not found: " +
          state.remoteAssetSizeDelta.uploadName,
      );
      process.exit(2);
    }
    asset.size += state.remoteAssetSizeDelta.delta;
  }
  if (state.remoteAssetRename) {
    const asset = release.assets.find(
      ({ name }) => name === state.remoteAssetRename.uploadName,
    );
    if (!asset) {
      console.error(
        "remote rename target not found: " + state.remoteAssetRename.uploadName,
      );
      process.exit(2);
    }
    asset.name = state.remoteAssetRename.remoteName;
  }
  if (state.remoteAssetExtra) {
    const bytes = Buffer.from(state.remoteAssetExtra.content, "utf8");
    release.assets.push({
      digest: digest(bytes),
      id: 599999,
      name: state.remoteAssetExtra.name,
      size: bytes.length,
      state: "uploaded",
    });
  }
  writeRemoteRelease(release);
  console.log("created draft release");
  process.exit(0);
}
if (args[0] === "api") {
  const methodIndex = args.indexOf("--method");
  const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
  const endpoint = methodIndex === -1 ? args[1] : args[args.length - 1];
  const controlsRoot = "repos/JoeWorkspace/JoeSSH";
  const remoteTagRef =
    controlsRoot + "/git/ref/tags/v0.1.0-beta.1";
  const remoteTagObject =
    controlsRoot + "/git/tags/" + state.remoteTagObjectSha;
  if (method === "GET" && endpoint === remoteTagRef) {
    if (state.remoteTagMissing) {
      notFound();
    }
    const tagCommit =
      state.remoteTagCommitAfterCreate && readRemoteRelease() !== null
        ? state.remoteTagCommitAfterCreate
        : state.remoteTagCommit;
    console.log(
      JSON.stringify({
        object: {
          sha:
            state.remoteTagType === "tag"
              ? state.remoteTagObjectSha
              : tagCommit,
          type: state.remoteTagType,
        },
      }),
    );
    process.exit(0);
  }
  if (
    method === "GET" &&
    state.remoteTagType === "tag" &&
    endpoint === remoteTagObject
  ) {
    console.log(
      JSON.stringify({
        object: {
          sha: state.remoteTagObjectCommit,
          type: "commit",
        },
      }),
    );
    process.exit(0);
  }
  const byTag =
    endpoint ===
    controlsRoot + "/releases/tags/v0.1.0-beta.1";
  const idPrefix = controlsRoot + "/releases/";
  const requestedId =
    endpoint.startsWith(idPrefix) && !byTag
      ? Number(endpoint.slice(idPrefix.length))
      : null;

  if (method === "GET" && (byTag || Number.isSafeInteger(requestedId))) {
    if (
      state.releaseDeleteConfirmationUnknownFails &&
      fs.existsSync(deletionMarkerPath)
    ) {
      console.error("network unavailable while confirming deletion");
      process.exit(1);
    }
    const release = readRemoteRelease();
    if (
      release === null ||
      (Number.isSafeInteger(requestedId) && release.id !== requestedId)
    ) {
      notFound();
    }
    const response =
      Number.isSafeInteger(requestedId) &&
      state.releaseIdLookupReturnsWrongIdentity
        ? { ...release, id: release.id + 1 }
        : release;
    console.log(JSON.stringify(response));
    process.exit(0);
  }

  if (method === "DELETE" && Number.isSafeInteger(requestedId)) {
    const release = readRemoteRelease();
    if (release === null || release.id !== requestedId) {
      notFound();
    }
    if (state.releaseDeleteFails) {
      console.error("deletion denied");
      process.exit(1);
    }
    if (state.captureReleaseCleanupPath) {
      fs.writeFileSync(
        state.captureReleaseCleanupPath,
        JSON.stringify(
          {
            deletedId: requestedId,
            endpoint,
            tag: release.tag_name,
          },
          null,
          2,
        ),
        "utf8",
      );
    }
    fs.rmSync(remoteStatePath);
    fs.writeFileSync(deletionMarkerPath, "deleted\\n", "utf8");
    process.exit(0);
  }

  let controlsResponse;
  if (method === "GET" && endpoint === controlsRoot) {
    controlsResponse = {
      default_branch: "main",
      private: state.githubControlsFail,
      visibility: state.githubControlsFail ? "private" : "public",
    };
  } else if (method === "GET" && endpoint === controlsRoot + "/branches/main") {
    const mainAdvancedAfterReadiness =
      state.mainCommitAfterReadinessAfterCreate &&
      fs.existsSync(mainAdvanceMarkerPath);
    controlsResponse = {
      commit: {
        sha:
          state.mainCommitAfterCreate && readRemoteRelease() !== null
            ? state.mainCommitAfterCreate
            : mainAdvancedAfterReadiness
              ? state.mainCommitAfterReadinessAfterCreate
            : state.mainCommit,
      },
      name: "main",
      protected: true,
    };
  } else if (
    method === "GET" &&
    (endpoint ===
      controlsRoot +
        "/commits/abc123/check-runs?check_name=Public%20Release%20Readiness&filter=latest&per_page=100" ||
      endpoint.startsWith(
        controlsRoot +
          "/commits/abc123/check-runs?check_name=Public%20Release%20Readiness&filter=latest&per_page=100&page=",
      ))
  ) {
    const afterCreate = readRemoteRelease() !== null;
    if (afterCreate && state.mainCommitAfterReadinessAfterCreate) {
      fs.writeFileSync(mainAdvanceMarkerPath, "advanced-after-readiness\\n", "utf8");
    }
    const pageMatch = endpoint.match(/&page=([0-9]+)$/);
    const page = pageMatch ? Number(pageMatch[1]) : 1;
    const configuredChecks =
      afterCreate && state.releaseChecksAfterCreate !== null
        ? state.releaseChecksAfterCreate
        : state.releaseChecks;
    const defaultChecks = state.releaseCheckMissing
      ? []
      : configuredChecks ?? [
          {
            app: { id: state.releaseCheckAppId },
            conclusion: state.releaseCheckConclusion,
            head_sha: state.releaseCheckHeadSha,
            id: 123456789,
            name: "Public Release Readiness",
            started_at: "2026-07-31T08:00:00Z",
            status: state.releaseCheckStatus,
          },
        ];
    const configuredPages =
      afterCreate && state.releaseCheckPagesAfterCreate !== null
        ? state.releaseCheckPagesAfterCreate
        : state.releaseCheckPages;
    const checkRuns = configuredPages
      ? configuredPages[page - 1] ?? []
      : page === 1
        ? defaultChecks
        : [];
    const configuredTotal =
      afterCreate && state.releaseCheckTotalCountAfterCreate !== null
        ? state.releaseCheckTotalCountAfterCreate
        : state.releaseCheckTotalCount;
    const totalCount =
      configuredTotal ??
      (configuredPages ? configuredPages.flat().length : defaultChecks.length);
    controlsResponse = { check_runs: checkRuns, total_count: totalCount };
  } else if (
    method === "GET" &&
    endpoint === controlsRoot + "/branches/main/protection"
  ) {
    controlsResponse = {
      allow_deletions: { enabled: false },
      allow_force_pushes: { enabled: false },
      enforce_admins: { enabled: true },
      required_pull_request_reviews: {
        bypass_pull_request_allowances: { apps: [], teams: [], users: [] },
        require_last_push_approval: true,
        required_approving_review_count: 1,
      },
      required_status_checks: {
        checks: [{ app_id: 15368, context: "Public Release Readiness" }],
        contexts: ["Public Release Readiness"],
        strict: true,
      },
    };
  } else if (
    method === "GET" &&
    endpoint === controlsRoot + "/private-vulnerability-reporting"
  ) {
    controlsResponse = { enabled: true };
  } else if (
    method === "GET" &&
    endpoint.startsWith(controlsRoot + "/environments/") &&
    endpoint.endsWith("/secrets?per_page=100")
  ) {
    controlsResponse = [{ secrets: [], total_count: 0 }];
  } else if (
    method === "GET" &&
    endpoint.startsWith(controlsRoot + "/environments/")
  ) {
    const environment = decodeURIComponent(endpoint.split("/").at(-1));
    controlsResponse = {
      can_admins_bypass: false,
      deployment_branch_policy: {
        custom_branch_policies: false,
        protected_branches: true,
      },
      name: environment,
      protection_rules: [
        {
          prevent_self_review: true,
          reviewers: [
            {
              reviewer: { id: 1, login: "release-reviewer" },
              type: "User",
            },
          ],
          type: "required_reviewers",
        },
      ],
    };
  } else if (
    method === "GET" &&
    endpoint === controlsRoot + "/actions/secrets?per_page=100"
  ) {
    controlsResponse = [{ secrets: [], total_count: 0 }];
  } else if (
    method === "GET" &&
    endpoint === controlsRoot + "/actions/artifacts?per_page=100"
  ) {
    controlsResponse = [{ artifacts: [], total_count: 0 }];
  } else if (
    method === "GET" &&
    endpoint === controlsRoot + "/actions/cache/usage"
  ) {
    controlsResponse = {
      active_caches_count: 0,
      active_caches_size_in_bytes: 0,
    };
  }
  if (controlsResponse !== undefined) {
    console.log(JSON.stringify(controlsResponse));
    process.exit(0);
  }
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
    ...sourceBoundReleaseSbomEnvironment(root),
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
    JOESSH_GITHUB_BILLING_CONFIRMED: "1",
  };
}

function writeNodeBackedCommand(binDir, name, source) {
  const jsPath = join(binDir, `${name}.js`);
  writeFileSync(jsPath, source, "utf8");
  return jsPath;
}

test("dry run verifies artifacts and prints the GitHub release command", (t) => {
  const result = runDraft(createReleaseFixture(t));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    /Release draft dry run passed for v0\.1\.0-beta\.1/,
  );
  assert.match(
    result.stdout,
    /gh release create v0\.1\.0-beta\.1 --repo JoeWorkspace\/JoeSSH --draft/,
  );
  assert.match(
    result.stdout,
    /reports\/release\/desktop\/JoeSSH_0\.1\.0-beta\.1_x64-setup\.exe/,
  );
});

test("dry run blocks when lock-bound license source evidence fails", (t) => {
  const root = createReleaseFixture(t);
  writeFile(root, "node_modules/desktop-dependency/LICENSE", "tampered\n");

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /does not byte-match its lockfile-bound source archive/,
  );
  assert.doesNotMatch(result.stdout, /Release draft dry run passed/);
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

test("uploads only verified private snapshot bytes when a source artifact is replaced after verification", (t) => {
  const root = createReleaseFixture(t);
  const capturePath = join(root, "release-create-capture.json");
  const sourceArtifact =
    "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip";
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, {
      captureReleaseCreatePath: capturePath,
      mutateSourceAtReleaseCreate: {
        content: "attacker replacement",
        relativePath: sourceArtifact,
      },
    }),
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFile(root, sourceArtifact), "attacker replacement");
  const capture = JSON.parse(readFileSync(capturePath, "utf8"));
  const uploadedWebArtifact = capture.uploads.find(({ path }) =>
    path.endsWith("joessh-web-admin-0.1.0-beta.1.zip"),
  );
  assert.ok(uploadedWebArtifact, "the verified Web artifact must be uploaded");
  assert.equal(uploadedWebArtifact.content, "web bundle");
  assert.equal(uploadedWebArtifact.readOnly, true);
  assert.ok(
    capture.uploads.every(
      ({ path }) =>
        path.startsWith(
          `${capture.snapshotRoot}${process.platform === "win32" ? "\\" : "/"}`,
        ) && !path.startsWith(join(root, "reports", "release")),
    ),
    "every gh upload argument must point only into the private snapshot",
  );
  assert.equal(capture.notes.content, "# JoeSSH 0.1.0-beta.1\n");
  assert.ok(capture.notes.path.startsWith(capture.snapshotRoot));
  assert.equal(capture.args.includes("--draft"), true);
  assert.equal(capture.args.includes("--verify-tag"), true);
  assert.deepEqual(
    capture.args.slice(
      capture.args.indexOf("--repo"),
      capture.args.indexOf("--repo") + 2,
    ),
    ["--repo", "JoeWorkspace/JoeSSH"],
  );
  assert.equal(
    existsSync(capture.snapshotRoot),
    false,
    "the private snapshot must always be removed after gh exits",
  );
});

test("rejects and deletes the exact draft when snapshot bytes are swapped only during upload", (t) => {
  const root = createReleaseFixture(t);
  const capturePath = join(root, "tampered-release-create-capture.json");
  const cleanupPath = join(root, "tampered-release-cleanup.json");
  const remoteStatePath = join(root, "fake-github-release-state.json");
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, {
      captureReleaseCleanupPath: cleanupPath,
      captureReleaseCreatePath: capturePath,
      tamperSnapshotDuringUpload: {
        content: "evil bytes",
        uploadName: "joessh-web-admin-0.1.0-beta.1.zip",
      },
    }),
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Remote GitHub draft asset verification failed/);
  assert.match(
    result.stderr,
    /joessh-web-admin-0\.1\.0-beta\.1\.zip digest is sha256:/,
  );
  assert.match(
    result.stderr,
    /was deleted by exact ID and its absence was confirmed by both ID and tag/,
  );
  const capture = JSON.parse(readFileSync(capturePath, "utf8"));
  const uploadedWebArtifact = capture.uploads.find(({ path }) =>
    path.endsWith("joessh-web-admin-0.1.0-beta.1.zip"),
  );
  assert.equal(uploadedWebArtifact.content, "evil bytes");
  assert.equal(uploadedWebArtifact.localContentAfterUpload, "web bundle");
  assert.equal(uploadedWebArtifact.readOnly, true);
  assert.equal(existsSync(capture.snapshotRoot), false);
  assert.deepEqual(JSON.parse(readFileSync(cleanupPath, "utf8")), {
    deletedId: 424242,
    endpoint: "repos/JoeWorkspace/JoeSSH/releases/424242",
    tag: "v0.1.0-beta.1",
  });
  assert.equal(
    existsSync(remoteStatePath),
    false,
    "the rejected remote draft must be removed",
  );
});

test("fails closed and deletes the draft when GitHub omits an asset digest", (t) => {
  const root = createReleaseFixture(t);
  const cleanupPath = join(root, "missing-digest-release-cleanup.json");
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, {
      captureReleaseCleanupPath: cleanupPath,
      remoteAssetDigestMissing: true,
    }),
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    /an exact sha256:<lowercase-hex> digest is required/,
  );
  assert.equal(JSON.parse(readFileSync(cleanupPath, "utf8")).deletedId, 424242);
  assert.equal(existsSync(join(root, "fake-github-release-state.json")), false);
});

test("rejects remote asset name and size metadata outside the snapshot allowlist", (t) => {
  const root = createReleaseFixture(t);
  const cleanupPath = join(root, "metadata-tamper-release-cleanup.json");
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, {
      captureReleaseCleanupPath: cleanupPath,
      remoteAssetRename: {
        remoteName: "renamed-sync-binary",
        uploadName: "joessh-sync-0.1.0-beta.1-linux-x64",
      },
      remoteAssetSizeDelta: {
        delta: 1,
        uploadName: "joessh-web-admin-0.1.0-beta.1.zip",
      },
    }),
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    /joessh-web-admin-0\.1\.0-beta\.1\.zip size is 11; expected 10/,
  );
  assert.match(
    result.stderr,
    /missing asset joessh-sync-0\.1\.0-beta\.1-linux-x64/,
  );
  assert.match(result.stderr, /unexpected asset renamed-sync-binary/);
  assert.equal(JSON.parse(readFileSync(cleanupPath, "utf8")).deletedId, 424242);
});

test("rechecks the newly created draft by its exact numeric release ID", (t) => {
  const root = createReleaseFixture(t);
  const cleanupPath = join(root, "identity-change-release-cleanup.json");
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, {
      captureReleaseCleanupPath: cleanupPath,
      releaseIdLookupReturnsWrongIdentity: true,
    }),
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    /GitHub API release identity changed from ID 424242 to 424243/,
  );
  assert.deepEqual(JSON.parse(readFileSync(cleanupPath, "utf8")), {
    deletedId: 424242,
    endpoint: "repos/JoeWorkspace/JoeSSH/releases/424242",
    tag: "v0.1.0-beta.1",
  });
});

test("fails with manual isolation instructions when draft deletion cannot be confirmed", (t) => {
  const root = createReleaseFixture(t);
  const cleanupPath = join(root, "unconfirmed-release-cleanup.json");
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, {
      captureReleaseCleanupPath: cleanupPath,
      releaseDeleteConfirmationUnknownFails: true,
      tamperSnapshotDuringUpload: {
        content: "evil bytes",
        uploadName: "joessh-web-admin-0.1.0-beta.1.zip",
      },
    }),
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /MANUAL ISOLATION REQUIRED/);
  assert.match(result.stderr, /release ID 424242/);
  assert.match(
    result.stderr,
    /gh api --method DELETE repos\/JoeWorkspace\/JoeSSH\/releases\/424242/,
  );
  assert.equal(JSON.parse(readFileSync(cleanupPath, "utf8")).deletedId, 424242);
});

test("always removes the private snapshot when GitHub draft creation fails", (t) => {
  const root = createReleaseFixture(t);
  const capturePath = join(root, "failed-release-create-capture.json");
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, {
      captureReleaseCreatePath: capturePath,
      releaseCreateFails: true,
    }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /draft creation failed/);
  const capture = JSON.parse(readFileSync(capturePath, "utf8"));
  assert.equal(capture.args.includes("--draft"), true);
  assert.equal(
    existsSync(capture.snapshotRoot),
    false,
    "the private snapshot must be removed on gh failure",
  );
});

test("non-dry-run rejects a dirty Git working tree", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, { dirtyStatus: " M package.json" }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Git working tree outside reports\/release must be clean/,
  );
  assert.match(result.stderr, /M package\.json/);
});

test("non-dry-run rejects a missing release tag", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, { tagMissing: true }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release tag v0\.1\.0-beta\.1 must exist/);
});

test("non-dry-run rejects a release tag that does not point at HEAD", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, { tagCommit: "def456" }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Release tag v0\.1\.0-beta\.1 must point at HEAD/,
  );
});

test("non-dry-run rejects a missing or mismatched remote release tag", async (t) => {
  const cases = [
    [
      "missing",
      { remoteTagMissing: true },
      /Remote release tag v0\.1\.0-beta\.1 must exist/,
    ],
    [
      "mismatched",
      { remoteTagCommit: "def456" },
      /Remote release tag v0\.1\.0-beta\.1 points at def456/,
    ],
  ];

  for (const [name, options, diagnostic] of cases) {
    await t.test(name, (subtest) => {
      const root = createReleaseFixture(subtest);
      const result = runPublishDraft(
        root,
        createFakeReleaseMachineCommands(root, options),
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, diagnostic);
      assert.equal(
        existsSync(join(root, "fake-github-release-state.json")),
        false,
      );
    });
  }
});

test("non-dry-run rejects a candidate outside protected main", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, { mainCommit: "def456" }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Release candidate abc123 must exactly equal protected main commit def456/,
  );
  assert.equal(existsSync(join(root, "fake-github-release-state.json")), false);
});

test("non-dry-run rejects a failed or incorrectly sourced readiness check", async (t) => {
  const cases = [
    ["missing", { releaseCheckMissing: true }, /must have a latest/],
    [
      "failed",
      { releaseCheckConclusion: "failure" },
      /completed\/success; received completed\/failure/,
    ],
    ["wrong app", { releaseCheckAppId: 42 }, /GitHub Actions App 15368/],
  ];

  for (const [name, options, diagnostic] of cases) {
    await t.test(name, (subtest) => {
      const root = createReleaseFixture(subtest);
      const result = runPublishDraft(
        root,
        createFakeReleaseMachineCommands(root, options),
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, diagnostic);
      assert.equal(
        existsSync(join(root, "fake-github-release-state.json")),
        false,
      );
    });
  }
});

test("non-dry-run accepts multiple suites when the newest readiness check succeeds", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, {
      releaseChecks: [
        {
          app: { id: 15368 },
          conclusion: "failure",
          head_sha: "abc123",
          id: 123456788,
          name: "Public Release Readiness",
          started_at: "2026-07-31T07:00:00Z",
          status: "completed",
        },
        {
          app: { id: 15368 },
          conclusion: "success",
          head_sha: "abc123",
          id: 123456789,
          name: "Public Release Readiness",
          started_at: "2026-07-31T08:00:00Z",
          status: "completed",
        },
      ],
    }),
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("deletes a new draft if the remote tag moves during creation", (t) => {
  const root = createReleaseFixture(t);
  const cleanupPath = join(root, "moved-tag-release-cleanup.json");
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, {
      captureReleaseCleanupPath: cleanupPath,
      remoteTagCommitAfterCreate: "def456",
    }),
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    /Remote release tag v0\.1\.0-beta\.1 points at def456/,
  );
  assert.match(
    result.stderr,
    /was deleted by exact ID and its absence was confirmed by both ID and tag/,
  );
  assert.equal(JSON.parse(readFileSync(cleanupPath, "utf8")).deletedId, 424242);
  assert.equal(existsSync(join(root, "fake-github-release-state.json")), false);
});

test("deletes a new draft if protected main moves during creation", (t) => {
  const root = createReleaseFixture(t);
  const cleanupPath = join(root, "moved-main-release-cleanup.json");
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, {
      captureReleaseCleanupPath: cleanupPath,
      mainCommitAfterCreate: "def456",
    }),
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    /Release candidate abc123 must exactly equal protected main commit def456/,
  );
  assert.match(
    result.stderr,
    /was deleted by exact ID and its absence was confirmed by both ID and tag/,
  );
  assert.equal(JSON.parse(readFileSync(cleanupPath, "utf8")).deletedId, 424242);
  assert.equal(existsSync(join(root, "fake-github-release-state.json")), false);
});

test("deletes a new draft if protected main moves while readiness is rechecked", (t) => {
  const root = createReleaseFixture(t);
  const cleanupPath = join(root, "readiness-main-move-release-cleanup.json");
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, {
      captureReleaseCleanupPath: cleanupPath,
      mainCommitAfterReadinessAfterCreate: "def456",
    }),
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    /Release candidate abc123 must exactly equal protected main commit def456/,
  );
  assert.match(
    result.stderr,
    /was deleted by exact ID and its absence was confirmed by both ID and tag/,
  );
  assert.equal(JSON.parse(readFileSync(cleanupPath, "utf8")).deletedId, 424242);
  assert.equal(existsSync(join(root, "fake-github-release-state.json")), false);
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
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, { ghAuthFails: true }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GitHub CLI must be authenticated/);
});

test("non-dry-run rejects failing GitHub release controls", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, { githubControlsFail: true }),
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL repository-public/);
  assert.match(
    result.stderr,
    /GitHub release controls must pass before drafting a public release/,
  );
  assert.equal(existsSync(join(root, "fake-github-release-state.json")), false);
});

test("non-dry-run rejects duplicate GitHub releases", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, { duplicateRelease: true }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exists/);
});

test("non-dry-run rejects ambiguous GitHub release lookup failures", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, { releaseViewUnknownFails: true }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Unable to confirm GitHub Release v0\.1\.0-beta\.1 does not already exist/,
  );
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
  writeFile(
    root,
    "reports/release/web/joessh-web-admin-0.1.0-beta.1.zip",
    "mutated web bundle",
  );

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA256 checksum verification failed/);
  assert.match(result.stderr, /hash mismatch/);
});

test("dry run rejects Web Admin manifests without the release package", (t) => {
  const root = createReleaseFixture(t);
  writeFile(root, "apps/web/dist/index.html", "web dist");
  writeManifest(root, "reports/release/web/SHA256SUMS.txt", [
    ["web dist", "apps/web/dist/index.html"],
  ]);

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

test("dry run rejects checksum-covered raw Cargo metadata renamed into the public upload tree", (t) => {
  const root = createReleaseFixture(t);
  const path = "reports/release/renamed-cargo-metadata.json";
  const content =
    '{"workspace_root":"C:\\\\Users\\\\release-builder\\\\JoeSSH"}\n';
  writeFile(root, path, content);
  writeFile(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    `${readFile(root, "reports/release/SBOM-SHA256SUMS.txt")}${sha256(content)}  ${path}\n`,
  );

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside the exact public upload allowlist/);
  assert.match(result.stderr, /reports\/release\/renamed-cargo-metadata\.json/);
});

test("dry run rejects local-only handoff files in the release upload tree", (t) => {
  const root = createReleaseFixture(t);
  writeFile(
    root,
    "reports/release/desktop/formal-evidence-unblock-report.json",
    '{"decision":"no-go"}\n',
  );

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Local-only handoff file\(s\) must not be uploaded/,
  );
  assert.match(
    result.stderr,
    /reports\/release\/desktop\/formal-evidence-unblock-report\.json/,
  );
});

test("dry run ignores repeatable internal RC audit handoff evidence", (t) => {
  const root = createReleaseFixture(t);
  const audit = '{"decision":"go"}\n';
  writeFile(root, "reports/handoff/release/public-beta-rc-audit.json", audit);
  writeFile(
    root,
    "reports/handoff/release/public-beta-rc-audit-SHA256SUMS.txt",
    `${sha256(audit)}  reports/handoff/release/public-beta-rc-audit.json\n`,
  );

  const first = runDraft(root);
  const second = runDraft(root);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(second.status, 0, second.stdout + second.stderr);
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
  assert.doesNotMatch(
    result.stdout,
    /apps\/desktop\/src-tauri\/target\/release\/bundle/,
  );
  assert.doesNotMatch(result.stdout, /raw-setup\.exe/);
});

test("dry run rejects missing desktop release evidence before drafting", (t) => {
  const root = createReleaseFixture(t);
  rmSync(join(root, "reports", "release", "desktop", "release-evidence.json"));

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing desktop release evidence/);
  assert.match(
    result.stderr,
    /reports\/release\/desktop\/release-evidence\.json/,
  );
});

test("dry run rejects desktop release evidence without workflow source provenance", (t) => {
  const root = createReleaseFixture(t);
  rmSync(
    join(root, "reports", "release", "desktop", "release-evidence-source.json"),
  );
  writeManifest(
    root,
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    [
      [
        readFile(root, "reports/release/desktop/release-evidence.json"),
        "reports/release/desktop/release-evidence.json",
      ],
    ],
  );

  const result = runDraft(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing desktop evidence source sidecar/);
});

test("non-dry-run rejects a newer pending readiness check hidden on page two", (t) => {
  const root = createReleaseFixture(t);
  const result = runPublishDraft(
    root,
    createFakeReleaseMachineCommands(root, {
      releaseCheckPages: draftPaginatedReadinessChecks({
        conclusion: null,
        status: "in_progress",
      }),
    }),
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /in_progress\/unreadable/);
  assert.equal(existsSync(join(root, "fake-github-release-state.json")), false);
});

test("deletes a new draft by exact ID when readiness changes during creation", async (t) => {
  for (const [name, status, conclusion, diagnostic] of [
    ["pending", "in_progress", null, /in_progress\/unreadable/],
    ["failed", "completed", "failure", /completed\/failure/],
  ]) {
    await t.test(name, (subtest) => {
      const root = createReleaseFixture(subtest);
      const cleanupPath = join(root, `${name}-readiness-release-cleanup.json`);
      const result = runPublishDraft(
        root,
        createFakeReleaseMachineCommands(root, {
          captureReleaseCleanupPath: cleanupPath,
          releaseChecksAfterCreate: [
            draftReadinessCheck(123456789, {
              appId: 15368,
              startedAt: "2026-07-31T08:00:00Z",
            }),
            draftReadinessCheck(123456790, {
              appId: 15368,
              conclusion,
              startedAt: "2026-07-31T09:00:00Z",
              status,
            }),
          ],
        }),
      );

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, diagnostic);
      assert.match(
        result.stderr,
        /was deleted by exact ID and its absence was confirmed by both ID and tag/,
      );
      assert.deepEqual(JSON.parse(readFileSync(cleanupPath, "utf8")), {
        deletedId: 424242,
        endpoint: "repos/JoeWorkspace/JoeSSH/releases/424242",
        tag: "v0.1.0-beta.1",
      });
      assert.equal(
        existsSync(join(root, "fake-github-release-state.json")),
        false,
      );
    });
  }
});

function draftReadinessCheck(id, options = {}) {
  return {
    app: { id: options.appId ?? 42 },
    conclusion: "conclusion" in options ? options.conclusion : "success",
    head_sha: "abc123",
    id,
    name: "Public Release Readiness",
    started_at:
      options.startedAt ??
      new Date(Date.UTC(2026, 6, 31, 0, 0, id)).toISOString(),
    status: options.status ?? "completed",
  };
}

function draftPaginatedReadinessChecks({ conclusion, status }) {
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    draftReadinessCheck(index + 1),
  );
  firstPage[0] = draftReadinessCheck(1, {
    appId: 15368,
    startedAt: "2026-07-31T07:00:00Z",
  });
  return [
    firstPage,
    [
      draftReadinessCheck(101, {
        appId: 15368,
        conclusion,
        startedAt: "2026-07-31T08:00:00Z",
        status,
      }),
    ],
  ];
}
