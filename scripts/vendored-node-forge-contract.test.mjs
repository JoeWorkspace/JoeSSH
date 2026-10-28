import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  NODE_FORGE_REGISTRATION,
  verifyVendoredNodeForge,
} from "./vendored-node-forge-contract.mjs";

const root = resolve(import.meta.dirname, "..");
// Optional source is only for running this isolated fixture suite before root
// integration; CI/default requires the actual checked-in vendor tree.
const source = process.env.JOESSH_NODE_FORGE_TEST_SOURCE
  ? resolve(process.env.JOESSH_NODE_FORGE_TEST_SOURCE)
  : join(root, NODE_FORGE_REGISTRATION.path);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "joessh-forge-contract-"));
  t.after(() => {
    assert.equal(dirname(directory), tmpdir());
    assert(directory.includes("joessh-forge-contract-"));
    rmSync(directory, { recursive: true, force: true });
  });
  const vendor = join(directory, NODE_FORGE_REGISTRATION.path);
  mkdirSync(dirname(vendor), { recursive: true });
  cpSync(source, vendor, { recursive: true });
  return { root: directory, vendor };
}

test("verifies complete reviewed tree and preserves registry identity", (t) => {
  const f = fixture(t);
  const result = verifyVendoredNodeForge(f.root);
  assert.equal(result.name, "node-forge");
  assert.equal(result.version, "1.4.2");
  assert.equal(result.path, "vendor/node-forge-1.4.2");
  assert.equal(result.directory, f.vendor);
  assert.equal(result.metadataSha256, NODE_FORGE_REGISTRATION.metadataSha256);
  assert.equal(result.declaredLicense, "(BSD-3-Clause OR GPL-2.0)");
  assert.equal(Object.keys(result.fileHashes).length, 54);
  assert.match(result.treeSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(result.registryPackage, {
    name: "node-forge",
    version: "1.4.2",
    resolved: NODE_FORGE_REGISTRATION.archive,
    integrity: NODE_FORGE_REGISTRATION.integrity,
    shasum: NODE_FORGE_REGISTRATION.shasum,
  });
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.metadata.files));
  assert(Object.isFrozen(result.registryPackage));
  assert(Object.isFrozen(NODE_FORGE_REGISTRATION));
  assert(Object.isFrozen(NODE_FORGE_REGISTRATION.removedFiles));
  assert.throws(() => {
    result.registryPackage.version = "1.4.1";
  }, TypeError);
});

for (const name of [
  "lib/rsa.js",
  "lib/asn1.js",
  "lib/pkcs12.js",
  "README.md",
  "LICENSE",
  "package.original.json",
]) {
  test("rejects content tampering: " + name, (t) => {
    const f = fixture(t);
    appendFileSync(join(f.vendor, name), "\nmodified\n");
    assert.throws(() => verifyVendoredNodeForge(f.root), /SHA-256 mismatch/u);
  });
}

test("rejects manifest changes including old browser export", (t) => {
  const f = fixture(t);
  const file = join(f.vendor, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.exports["."] = { default: "./dist/forge.min.js" };
  writeFileSync(file, JSON.stringify(pkg));
  assert.throws(() => verifyVendoredNodeForge(f.root), /SHA-256 mismatch/u);
});

test("rejects extra source files", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.vendor, "lib/unreviewed.js"), "module.exports = {};\n");
  assert.throws(() => verifyVendoredNodeForge(f.root), /Unexpected.*file/u);
});

test("rejects old browser dist directory and bundle", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.vendor, "dist"));
  writeFileSync(
    join(f.vendor, "dist/forge.min.js"),
    "unpatched browser bundle\n",
  );
  assert.throws(
    () => verifyVendoredNodeForge(f.root),
    /Unexpected.*directory/u,
  );
});

test("rejects unexpected empty directory", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.vendor, "unused"));
  assert.throws(
    () => verifyVendoredNodeForge(f.root),
    /Unexpected.*directory/u,
  );
});

test("rejects missing source file", (t) => {
  const f = fixture(t);
  unlinkSync(join(f.vendor, "lib/rsa.js"));
  assert.throws(() => verifyVendoredNodeForge(f.root), /incomplete/u);
});

test("rejects metadata tampering even when a modified source hash is updated", (t) => {
  const f = fixture(t);
  const rsa = join(f.vendor, "lib/rsa.js");
  appendFileSync(rsa, "\nmodified\n");
  const file = join(f.vendor, "JOESSH-PATCH.json");
  const metadata = JSON.parse(readFileSync(file, "utf8"));
  metadata.files["lib/rsa.js"].sha256 = createHash("sha256")
    .update(readFileSync(rsa))
    .digest("hex");
  writeFileSync(file, JSON.stringify(metadata, null, 2) + "\n");
  assert.throws(
    () => verifyVendoredNodeForge(f.root),
    /metadata differs.*reviewed SHA-256/u,
  );
});

test("rejects missing metadata", (t) => {
  const f = fixture(t);
  unlinkSync(join(f.vendor, "JOESSH-PATCH.json"));
  assert.throws(() => verifyVendoredNodeForge(f.root), /ENOENT/u);
});

test("rejects hardlinked code", (t) => {
  const f = fixture(t);
  linkSync(join(f.vendor, "lib/rsa.js"), join(f.root, "external-hardlink.js"));
  assert.throws(() => verifyVendoredNodeForge(f.root), /without links/u);
});

test("rejects hardlinked metadata", (t) => {
  const f = fixture(t);
  linkSync(
    join(f.vendor, "JOESSH-PATCH.json"),
    join(f.root, "external-metadata.json"),
  );
  assert.throws(() => verifyVendoredNodeForge(f.root), /without links/u);
});

test("rejects vendor directory junction/symlink", (t) => {
  const f = fixture(t);
  const outside = join(f.root, "linked-package");
  renameSync(f.vendor, outside);
  symlinkSync(
    outside,
    f.vendor,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => verifyVendoredNodeForge(f.root), /real directory/u);
});

test("rejects nested library junction/symlink", (t) => {
  const f = fixture(t);
  const outside = join(f.root, "linked-lib");
  renameSync(join(f.vendor, "lib"), outside);
  symlinkSync(
    outside,
    join(f.vendor, "lib"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => verifyVendoredNodeForge(f.root), /symlink\/junction/u);
});

test("rejects vendor ancestor junction/symlink", (t) => {
  const f = fixture(t);
  const old = join(f.root, "vendor");
  const outside = join(f.root, "linked-vendor");
  renameSync(old, outside);
  symlinkSync(outside, old, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => verifyVendoredNodeForge(f.root), /real directory/u);
});

test("rejects root alias junction/symlink", (t) => {
  const f = fixture(t);
  const holder = mkdtempSync(join(tmpdir(), "joessh-forge-alias-"));
  t.after(() => {
    assert.equal(dirname(holder), tmpdir());
    rmSync(holder, { recursive: true, force: true });
  });
  const alias = join(holder, "root");
  symlinkSync(f.root, alias, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => verifyVendoredNodeForge(alias), /real directory/u);
});

// Lock/manifest dependency binding and duplicate installed registry copies are
// tested by the parent npm integration wrapper, not this tree-only contract.
