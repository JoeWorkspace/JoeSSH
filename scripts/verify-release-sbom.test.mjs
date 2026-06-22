import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CHECKER_PATH = fileURLToPath(new URL("./verify-release-sbom.mjs", import.meta.url));

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release-sbom-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeSbomFiles(root);
  writeSbomManifest(root);
  return root;
}

function writeSbomFiles(root, overrides = {}) {
  const files = {
    "reports/release/npm-desktop-sbom.cdx.json": cyclonedxFixture("desktop"),
    "reports/release/npm-web-sbom.cdx.json": cyclonedxFixture("web"),
    "reports/release/cargo-metadata.json": rustWorkspaceCargoMetadataFixture(),
    "reports/release/tauri-cargo-metadata.json": tauriCargoMetadataFixture(),
    ...overrides,
  };

  for (const [path, content] of Object.entries(files)) {
    writeFile(root, path, content);
  }
}

function writeSbomManifest(root) {
  const paths = [
    "reports/release/cargo-metadata.json",
    "reports/release/npm-desktop-sbom.cdx.json",
    "reports/release/npm-web-sbom.cdx.json",
    "reports/release/tauri-cargo-metadata.json",
  ];
  writeFile(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    paths.map((path) => `${sha256File(root, path)}  ${path}`).join("\n") + "\n",
  );
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function cyclonedxFixture(name) {
  return JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    metadata: { component: { name } },
    components: [{ name: `${name}-dependency`, version: "1.0.0" }],
  });
}

function rustWorkspaceCargoMetadataFixture(packageNames = [
  "atlasterm-core",
  "atlasterm-sync",
  "axum",
  "russh",
  "russh-sftp",
  "serde",
  "tokio",
  "uuid",
]) {
  return cargoMetadataFixture(packageNames, ["atlasterm-core", "atlasterm-sync"]);
}

function tauriCargoMetadataFixture(packageNames = [
  "atlasterm-desktop-shell",
  "atlasterm-core",
  "russh",
  "russh-sftp",
  "serde",
  "tauri",
  "tokio",
  "uuid",
]) {
  return cargoMetadataFixture(packageNames, ["atlasterm-desktop-shell"]);
}

function cargoMetadataFixture(packageNames, workspacePackageNames) {
  return JSON.stringify({
    packages: packageNames.map((name) => ({ name, version: "0.1.0-beta.1" })),
    workspace_members: workspacePackageNames.map((name) => `path+file:///${name}`),
    version: 1,
  });
}

function sha256File(root, relativePath) {
  const path = join(root, ...relativePath.split("/"));
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runChecker(root) {
  return spawnSync(process.execPath, [CHECKER_PATH, "--root", root], {
    encoding: "utf8",
  });
}

test("accepts complete release SBOM files and checksums", (t) => {
  const result = runChecker(createFixture(t));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Release SBOM verified for 4 file/);
});

test("rejects malformed CycloneDX SBOMs", (t) => {
  const root = createFixture(t);
  writeSbomFiles(root, {
    "reports/release/npm-web-sbom.cdx.json": JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      components: [],
      metadata: {},
    }),
  });
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Web Admin npm CycloneDX SBOM must include at least one component/);
});

test("rejects missing SBOM checksum coverage", (t) => {
  const root = createFixture(t);
  writeFile(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    `${sha256File(root, "reports/release/npm-web-sbom.cdx.json")}  reports/release/npm-web-sbom.cdx.json\n`,
  );

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /SBOM checksum manifest is missing reports\/release\/npm-desktop-sbom\.cdx\.json/);
});

test("rejects stale SBOM checksums", (t) => {
  const root = createFixture(t);
  writeFile(root, "reports/release/npm-desktop-sbom.cdx.json", cyclonedxFixture("mutated"));

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /hash mismatch for reports\/release\/npm-desktop-sbom\.cdx\.json/);
});

test("rejects workspace-only Cargo metadata", (t) => {
  const root = createFixture(t);
  writeSbomFiles(root, {
    "reports/release/cargo-metadata.json": rustWorkspaceCargoMetadataFixture(["atlasterm-core", "atlasterm-sync"]),
  });
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Rust workspace cargo metadata must include third-party dependency packages/);
  assert.match(result.stderr, /rerun cargo metadata without --no-deps/);
});

test("rejects Rust workspace Cargo metadata missing required dependency packages", (t) => {
  const root = createFixture(t);
  writeSbomFiles(root, {
    "reports/release/cargo-metadata.json": rustWorkspaceCargoMetadataFixture([
      "atlasterm-core",
      "atlasterm-sync",
      "russh",
      "russh-sftp",
      "serde",
      "tokio",
      "uuid",
    ]),
  });
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Rust workspace cargo metadata is missing expected package\(s\): axum/);
});

test("rejects Tauri shell Cargo metadata missing required shell packages", (t) => {
  const root = createFixture(t);
  writeSbomFiles(root, {
    "reports/release/tauri-cargo-metadata.json": tauriCargoMetadataFixture([
      "atlasterm-desktop-shell",
      "atlasterm-core",
      "russh",
      "russh-sftp",
      "serde",
      "tokio",
      "uuid",
    ]),
  });
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Tauri shell cargo metadata is missing expected package\(s\): tauri/);
});
