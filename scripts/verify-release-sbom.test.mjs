import { refreshFixtureLicenseInventory, writeReleaseSbomFixture, writeSbomManifest } from "./release-sbom-test-fixtures.mjs";
import { bindSbom, sanitizeCargoMetadata } from "./release-sbom-lib.mjs";
import { cargoArchiveTexts, collectLicenseMaterials, githubCommitLicenseTexts, npmArchiveTexts, readLicenseArchive, validateOfficialLicenseReference, validateRequiredLicenseSource, validateReviewedCargoAssociation } from "./release-license-lib.mjs";
import { referencedCargoLicenseSources, reviewedCargoLicenseSources } from "./release-license-source-overrides.mjs";
import { gzipSync } from "node:zlib";
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

  writeReleaseSbomFixture(root);
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

function updateJson(root, file, update) {
  const path = join(root, file);
  const value = JSON.parse(readFileSync(path, "utf8"));
  update(value);
  writeFileSync(path, JSON.stringify(value));
}

test("rejects stale npm versions even with refreshed binding, license inventory and checksums", (t) => {
  const root = createFixture(t);
  updateJson(root, "reports/release/npm-web-sbom.cdx.json", (doc) => {
    doc.components[1].version = "0.0.1";
    bindSbom(doc, root, "npm");
  });
  refreshFixtureLicenseInventory(root);
  writeSbomManifest(root);
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm inventory differs from current workspace lock/);
});

test("rejects a stale Cargo version even with current binding and hashes", (t) => {
  const root = createFixture(t);
  updateJson(root, "reports/release/tauri-cargo-metadata.json", (doc) => { doc.packages.find((pkg) => pkg.name === "tauri").version = "0.0.1"; });
  refreshFixtureLicenseInventory(root);
  writeSbomManifest(root);
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cargo package tauri@0.0.1 does not match/);
});

test("rejects lockfile drift after generation", (t) => {
  const root = createFixture(t);
  writeFileSync(join(root, "Cargo.lock"), readFileSync(join(root, "Cargo.lock"), "utf8") + "\n# changed after generation\n");
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lockfile binding does not match/);
});

test("rejects omitted npm transitive dependencies", (t) => {
  const root = createFixture(t);
  updateJson(root, "reports/release/npm-web-sbom.cdx.json", (doc) => { doc.components.pop(); });
  refreshFixtureLicenseInventory(root);
  writeSbomManifest(root);
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing: web-dependency@1.0.0/);
});

for (const [label, update, expected] of [
  ["missing license component", (doc) => doc.components.pop(), /license inventory is incomplete/],
  ["unknown license", (doc) => { doc.components[0].license = "LicenseRef-Private"; }, /unreviewed license/],
  ["missing license text", (doc) => { doc.components[0].texts = []; }, /missing license texts/],
  ["absolute private source path", (doc) => { doc.components[0].texts[0].source = "C:/Users/private/LICENSE"; }, /invalid license material path/],
]) {
  test(`rejects ${label} despite refreshed manifest`, (t) => {
    const root = createFixture(t);
    updateJson(root, "reports/release/third-party-licenses.json", update);
    writeSbomManifest(root);
    const result = runChecker(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  });
}

test("rejects license text tampering", (t) => {
  const root = createFixture(t);
  const inventory = JSON.parse(readFileSync(join(root, "reports/release/third-party-licenses.json")));
  updateJson(root, "reports/release/third-party-license-texts.json", (texts) => { texts[inventory.components[0].texts[0].sha256] = "tampered"; });
  writeSbomManifest(root);
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /license text hash mismatch/);
});

test("redacts checkout and Cargo cache paths from public metadata", () => {
  const root = process.platform === "win32" ? "C:\\private\\repo" : "/private/repo";
  const cache = process.platform === "win32" ? "C:\\Users\\private\\cache\\dependency" : "/home/private/cache/dependency";
  const doc = sanitizeCargoMetadata({ workspace_root: root, target_directory: `${root}/target`, packages: [{ name: "dependency", version: "1", manifest_path: join(cache, "Cargo.toml"), targets: [{ src_path: join(cache, "src/lib.rs") }] }] }, root);
  assert.doesNotMatch(JSON.stringify(doc), /private|Users|\/home\//);
  assert.equal(doc.workspace_root, "workspace:");
  assert.equal(doc.packages[0].manifest_path, "crate:dependency@1/Cargo.toml");
});

function sourceArchive(files) {
  const parts = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(name);
    header.write(body.length.toString(8).padStart(11, "0"), 124);
    header.write("0", 156);
    header.fill(32, 148, 156);
    header.write([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0"), 148);
    header[154] = 0;
    parts.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}

test("reads an SRI-verified npm archive with the DefinitelyTyped top-level directory", async () => {
  const archive = sourceArchive({ "react/package.json": JSON.stringify({ name: "@types/react", version: "1.0.0", license: "MIT" }), "react/LICENSE": "original license" });
  const entry = { name: "@types/react", version: "1.0.0", resolved: "https://registry.npmjs.org/@types/react/-/react-1.0.0.tgz", integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}` };
  const result = await npmArchiveTexts(entry, async () => new Response(archive));
  assert.equal(result.files.get("LICENSE").toString(), "original license");
  await assert.rejects(npmArchiveTexts(entry, async () => new Response(Buffer.from("tampered"))), /archive integrity mismatch/);
});

test("collects a license embedded in AUTHORS while excluding a plain author list", () => {
  const plain = readLicenseArchive(sourceArchive({ "package/AUTHORS": "Example Author" }), "package.json");
  assert.equal(plain.files.size, 0);
  const content = "Copyright Example\nPermission is hereby granted, free of charge\nTHE SOFTWARE IS PROVIDED AS IS\n";
  const embedded = readLicenseArchive(sourceArchive({ "package/AUTHORS": content }), "package.json");
  assert.equal(embedded.files.get("AUTHORS").toString(), content);
});

test("collector rejects a license declaration that disagrees with the verified npm archive", async (t) => {
  const root = createFixture(t);
  const archives = new Map();
  updateJson(root, "package-lock.json", (lock) => {
    for (const workspace of ["desktop", "web"]) {
      const name = `${workspace}-dependency`;
      const archive = sourceArchive({ "package/package.json": JSON.stringify({ name, version: "1.0.0", license: workspace === "desktop" ? "Apache-2.0" : "MIT" }), "package/LICENSE": "original license" });
      const entry = lock.packages[`node_modules/${name}`];
      entry.resolved = `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`;
      entry.integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
      archives.set(entry.resolved, archive);
    }
  });
  const docs = Object.fromEntries(["desktop", "web"].map((workspace) => [`npm-${workspace}-sbom.cdx.json`, JSON.parse(readFileSync(join(root, `reports/release/npm-${workspace}-sbom.cdx.json`)))]));
  const result = await collectLicenseMaterials(root, docs, { fetchArchive: async (url) => new Response(archives.get(String(url))) });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /archive license declaration disagrees with SBOM/);
});

test("Cargo license material comes from checksum-verified crate bytes rather than mutable extracted files", (t) => {
  const root = createFixture(t);
  const component = { name: "example", version: "1.0.0", manifestPath: join(root, "registry/src/index/example-1.0.0/Cargo.toml") };
  const manifest = '[package]\nname = "example"\nversion = "1.0.0"\nlicense = "MIT"\n';
  const archive = sourceArchive({ "example-1.0.0/Cargo.toml": manifest, "example-1.0.0/LICENSE": "original license" });
  const archivePath = "registry/cache/index/example-1.0.0.crate";
  writeFile(root, archivePath, archive);
  writeFile(root, "registry/src/index/example-1.0.0/LICENSE", "tampered extracted license");
  const locked = { checksum: createHash("sha256").update(archive).digest("hex"), source: "registry+https://github.com/rust-lang/crates.io-index" };
  const result = cargoArchiveTexts(component, locked);
  assert.equal(result.files.get("LICENSE").toString(), "original license");
  writeFile(root, archivePath, "tampered archive");
  assert.throws(() => cargoArchiveTexts(component, locked), /archive checksum does not match lockfile/);
});

test("rejects omitted non-special Cargo transitive dependencies", (t) => {
  const root = createFixture(t);
  const lockPath = join(root, "Cargo.lock");
  writeFileSync(lockPath, readFileSync(lockPath, "utf8") + '\n[[package]]\nname = "extra-transitive"\nversion = "1.0.0"\n');
  for (const name of ["npm-desktop-sbom.cdx.json", "npm-web-sbom.cdx.json", "cargo-metadata.json", "tauri-cargo-metadata.json"]) {
    updateJson(root, `reports/release/${name}`, (doc) => bindSbom(doc, root, name.startsWith("npm-") ? "npm" : "cargo"));
  }
  refreshFixtureLicenseInventory(root);
  writeSbomManifest(root);
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cargo inventory omits current locked packages: extra-transitive/);
});

test("immutable upstream license fallback validates committed blob bytes", async () => {
  const content = Buffer.from("upstream original license");
  const sha = createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
  const source = { repository: "https://github.com/example/project", vcsInfo: { git: { sha1: "a".repeat(40) }, path_in_vcs: "crates/example" }, archiveSha256: "b".repeat(64) };
  const tree = { tree: [{ type: "blob", path: "LICENSE", size: content.length, sha }] };
  const fetchSource = async (url) => new Response(url.includes("api.github.com") ? JSON.stringify(tree) : content);
  const result = await githubCommitLicenseTexts(source, fetchSource);
  assert.equal(result.files.get("LICENSE").toString(), content.toString());
  await assert.rejects(githubCommitLicenseTexts(source, async (url) => new Response(url.includes("api.github.com") ? JSON.stringify(tree) : "tampered")), /blob does not match committed tree/);
});

test("official source reference cannot survive current Cargo checksum drift", () => {
  const reference = referencedCargoLicenseSources.find((entry) => entry.component === "cargo:selectors@0.36.1");
  const component = { id: reference.component, licenseSource: { kind: "official-license-reference", archiveSha256: reference.archiveSha256, noticeFileSha256: reference.noticeFileSha256, url: reference.licenseTextUrl, sha256: reference.licenseTextSha256 }, texts: [{ source: reference.licenseTextFile, sha256: reference.licenseTextSha256 }, { source: `${reference.noticeFile}.license-notice`, sha256: reference.noticeSha256 }] };
  const texts = { [reference.noticeSha256]: "/* This Source Code Form is subject to the terms of the Mozilla Public\n * License, v. 2.0. If a copy of the MPL was not distributed with this\n * file, You can obtain one at https://mozilla.org/MPL/2.0/. */\n" };
  assert.doesNotThrow(() => validateOfficialLicenseReference(component, reference.archiveSha256, texts));
  assert.throws(() => validateOfficialLicenseReference(component, "a".repeat(64), texts), /invalid original license reference/);
  assert.throws(() => validateOfficialLicenseReference(component, reference.archiveSha256, { [reference.noticeSha256]: "replacement https://mozilla.org/MPL/2.0/" }), /invalid original license reference/);
  assert.doesNotThrow(() => validateRequiredLicenseSource(component, reference.archiveSha256));
  assert.throws(() => validateRequiredLicenseSource({ ...component, licenseSource: undefined }, reference.archiveSha256), /required original license source is missing/);
});

test("reviewed source association and full original material cannot be deleted", () => {
  const reviewed = reviewedCargoLicenseSources.find((entry) => entry.component === "cargo:tao-macros@0.1.3");
  const component = { id: reviewed.component, licenseSource: { kind: "upstream-commit", archiveSha256: reviewed.archiveSha256, repository: reviewed.repository, commit: reviewed.commit, packagePath: reviewed.pathInVcs, reviewedAssociation: reviewed.associationKind }, texts: reviewed.materials.map((entry) => ({ source: entry.path, sha256: entry.sha256 })) };
  assert.doesNotThrow(() => validateReviewedCargoAssociation(component));
  const removedAssociation = structuredClone(component);
  delete removedAssociation.licenseSource.reviewedAssociation;
  assert.throws(() => validateReviewedCargoAssociation(removedAssociation), /invalid reviewed upstream license association/);
  const noticeOnly = structuredClone(component);
  noticeOnly.texts = noticeOnly.texts.filter((text) => text.source === "LICENSE.spdx");
  assert.throws(() => validateReviewedCargoAssociation(noticeOnly), /invalid reviewed upstream license association/);
  assert.doesNotThrow(() => validateRequiredLicenseSource(component, reviewed.archiveSha256));
  assert.throws(() => validateRequiredLicenseSource({ ...component, licenseSource: undefined }, reviewed.archiveSha256), /required original license source is missing/);
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
