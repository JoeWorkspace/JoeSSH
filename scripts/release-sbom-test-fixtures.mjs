import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { bindSbom, cargoLockInventory, lockfileBinding, sbomFileNames, sha256File } from "./release-sbom-lib.mjs";
import { licenseComponents, licenseInventoryName, licenseTextsName } from "./release-license-lib.mjs";

const cargoNames = [
  ["atlasterm-core", "atlasterm-sync", "axum", "russh", "russh-sftp", "serde", "tokio", "uuid"],
  ["atlasterm-desktop-shell", "atlasterm-core", "russh", "russh-sftp", "serde", "tauri", "tokio", "uuid"],
];
const registry = "registry+https://github.com/rust-lang/crates.io-index";
export function writeReleaseSbomFixture(root) {
  const file = (name, content) => { const path = resolve(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
  const json = (name, content) => file(name, `${JSON.stringify(content, null, 2)}\n`);
  const version = existsSync(resolve(root, "package.json")) ? JSON.parse(readFileSync(resolve(root, "package.json"))).version : "1.0.0";
  const lock = existsSync(resolve(root, "package-lock.json")) ? JSON.parse(readFileSync(resolve(root, "package-lock.json"))) : { lockfileVersion: 3, packages: {} };
  for (const workspace of ["desktop", "web"]) {
    lock.packages[`apps/${workspace}`] = { name: `@atlasterm/${workspace}`, version, dependencies: { [`${workspace}-dependency`]: "1.0.0" } };
    lock.packages[`node_modules/${workspace}-dependency`] = { version: "1.0.0", license: "MIT" };
  }
  json("package-lock.json", lock);
  const documents = {};
  for (const [index, lockfile] of ["Cargo.lock", "apps/desktop/src-tauri/Cargo.lock"].entries()) {
    const previous = existsSync(resolve(root, lockfile)) ? cargoLockInventory(root, lockfile) : [];
    const packages = cargoNames[index].map((name) => {
      const entry = previous.find((pkg) => pkg.name === name);
      return { name, version: entry?.version ?? (name.startsWith("atlasterm-") ? version : "1.0.0"), ...(name.startsWith("atlasterm-") ? {} : { source: registry, license: "MIT" }) };
    });
    file(lockfile, "version = 4\n" + packages.map((entry) => `\n[[package]]\nname = "${entry.name}"\nversion = "${entry.version}"\n${entry.source ? `source = "${entry.source}"\n` : ""}`).join(""));
    documents[sbomFileNames[index + 2]] = { packages, workspace_members: packages.filter((entry) => entry.name.startsWith("atlasterm-")).map((entry) => entry.name), version: 1 };
  }
  for (const workspace of ["desktop", "web"]) {
    documents[`npm-${workspace}-sbom.cdx.json`] = { bomFormat: "CycloneDX", specVersion: "1.5", metadata: {}, components: [
      { name: `@atlasterm/${workspace}`, version },
      { name: `${workspace}-dependency`, version: "1.0.0", licenses: [{ license: { id: "MIT" } }] },
    ] };
  }
  for (const [name, document] of Object.entries(documents)) json(`reports/release/${name}`, bindSbom(document, root, name.startsWith("npm-") ? "npm" : "cargo"));
  refreshFixtureLicenseInventory(root);
  writeSbomManifest(root);
}

export function refreshFixtureLicenseInventory(root) {
  const documents = Object.fromEntries(sbomFileNames.map((name) => [name, JSON.parse(readFileSync(resolve(root, "reports/release", name)))]));
  const content = "Synthetic license text used only by isolated regression test fixtures.\n";
  const sha256 = createHash("sha256").update(content).digest("hex");
  writeFileSync(resolve(root, "reports/release", licenseTextsName), JSON.stringify({ [sha256]: content }));
  const inventory = { schemaVersion: 1, lockfiles: lockfileBinding(root), sboms: Object.fromEntries(sbomFileNames.map((name) => [name, sha256File(resolve(root, "reports/release", name))])), components: licenseComponents(documents, root).map(({ id, ecosystem, name, version, license }) => ({ id, ecosystem, name, version, license, texts: [{ source: "LICENSE", sha256 }] })) };
  writeFileSync(resolve(root, "reports/release", licenseInventoryName), JSON.stringify(inventory));
}

export function writeSbomManifest(root) {
  const names = new Set([...sbomFileNames, licenseInventoryName, licenseTextsName]);
  const entries = [...names].sort().map((name) => `reports/release/${name}`);
  writeFileSync(resolve(root, "reports/release/SBOM-SHA256SUMS.txt"), entries.map((name) => `${sha256File(resolve(root, name))}  ${name}\n`).join(""));
}
