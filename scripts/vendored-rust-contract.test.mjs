import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import {
  isFirstPartyCargoPackage,
  verifyVendoredRustPackage,
  verifyVendoredRustPackages,
} from "./vendored-rust-contract.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const packagePath = "vendor/glib-0.18.5";
const identity = Object.freeze({ name: "glib", version: "0.18.5" });

function fixture(t) {
  const tempBase = realpathSync(tmpdir());
  const root = mkdtempSync(join(tempBase, "joessh-vendor-test-"));
  cpSync(join(repositoryRoot, packagePath), join(root, packagePath), {
    recursive: true,
  });
  t.after(() => {
    const target = resolve(root);
    const fromBase = relative(tempBase, target);
    if (
      isAbsolute(fromBase) ||
      fromBase.includes(sep) ||
      !fromBase.startsWith("joessh-vendor-test-")
    ) {
      throw new Error("Unsafe fixture cleanup target.");
    }
    rmSync(target, { recursive: true, force: true });
  });
  return root;
}

function packageFile(root, path) {
  return join(root, packagePath, path);
}

function changeMetadata(root, mutate) {
  const path = packageFile(root, "JOESSH-PATCH.json");
  const metadata = JSON.parse(readFileSync(path, "utf8"));
  mutate(metadata);
  writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

test("verifies the real official backport, license and registry audit identity", () => {
  const records = verifyVendoredRustPackages(repositoryRoot);
  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.declaredLicense, "MIT");
  assert.equal(Object.keys(record.fileHashes).length, 123);
  assert.equal(Object.keys(record.metadata.files).length, 121);
  assert.deepEqual(record.registryPackage, {
    ...identity,
    source: "registry+https://github.com/rust-lang/crates.io-index",
    checksum:
      "233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5",
  });
  assert.deepEqual(record.patchedAdvisories, ["RUSTSEC-2024-0429"]);
  assert.deepEqual(record.metadata.licenseFiles, ["LICENSE", "COPYRIGHT"]);
  assert.match(record.metadataSha256, /^[a-f0-9]{64}$/);
  assert.match(record.treeSha256, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.metadata.files));
});

test("tree digest is stable after copying the package to another checkout", (t) => {
  const root = fixture(t);
  const expected = verifyVendoredRustPackage(repositoryRoot, identity);
  const actual = verifyVendoredRustPackage(root, {
    ...identity,
    manifestPath: packageFile(root, "Cargo.toml"),
  });
  assert.equal(actual.treeSha256, expected.treeSha256);
  assert.equal(actual.metadataSha256, expected.metadataSha256);
});

test("rejects replacing the safe code with the original unsound implementation", (t) => {
  const root = fixture(t);
  const path = packageFile(root, "src/variant_iter.rs");
  const text = readFileSync(path, "utf8")
    .replace("let mut p:", "let p:")
    .replace("                &mut p,", "                &p,");
  writeFileSync(path, text);
  assert.throws(
    () => verifyVendoredRustPackage(root, identity),
    /SHA-256 mismatch/,
  );
});

test("rejects an unrelated upstream source modification", (t) => {
  const root = fixture(t);
  const path = packageFile(root, "src/lib.rs");
  writeFileSync(
    path,
    `${readFileSync(path, "utf8")}\n// unauthorized source\n`,
  );
  assert.throws(
    () => verifyVendoredRustPackage(root, identity),
    /SHA-256 mismatch/,
  );
});

test("editing both source and its metadata hash cannot approve a new patch", (t) => {
  const root = fixture(t);
  const path = packageFile(root, "src/variant_iter.rs");
  const bytes = Buffer.from(`${readFileSync(path, "utf8")}\n// extra change\n`);
  writeFileSync(path, bytes);
  changeMetadata(root, (metadata) => {
    metadata.patch.files[0].patchedSha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");
  });
  assert.throws(
    () => verifyVendoredRustPackage(root, identity),
    /metadata.*reviewed SHA-256/,
  );
});

test("metadata cannot substitute a new upstream archive or license", (t) => {
  const root = fixture(t);
  changeMetadata(root, (metadata) => {
    metadata.upstream.archiveUrl = "https://example.invalid/glib.crate";
    metadata.licenseFiles = [];
  });
  assert.throws(
    () => verifyVendoredRustPackage(root, identity),
    /metadata.*reviewed SHA-256/,
  );
});

test("metadata cannot expand the file allowlist with a traversal path", (t) => {
  const root = fixture(t);
  changeMetadata(root, (metadata) => {
    metadata.additionalFiles["../../outside.rs"] = "0".repeat(64);
  });
  assert.throws(
    () => verifyVendoredRustPackage(root, identity),
    /metadata.*reviewed SHA-256/,
  );
});

test("rejects added files even if the existing file hashes still match", (t) => {
  const root = fixture(t);
  writeFileSync(packageFile(root, "src/injected.rs"), "pub fn injected() {}\n");
  assert.throws(
    () => verifyVendoredRustPackage(root, identity),
    /Unexpected vendor file/,
  );
});

test("rejects undeclared empty directories", (t) => {
  const root = fixture(t);
  mkdirSync(packageFile(root, "extra"));
  assert.throws(
    () => verifyVendoredRustPackage(root, identity),
    /Unexpected vendor directory/,
  );
});

test("rejects a missing license text", (t) => {
  const root = fixture(t);
  rmSync(packageFile(root, "LICENSE"));
  assert.throws(
    () => verifyVendoredRustPackage(root, identity),
    /Missing vendor file: LICENSE/,
  );
});

test("rejects a changed regression test without a reviewed registration update", (t) => {
  const root = fixture(t);
  writeFileSync(
    packageFile(root, "tests/variant_str_iter.rs"),
    "#[test] fn passes() {}\n",
  );
  assert.throws(
    () => verifyVendoredRustPackage(root, identity),
    /SHA-256 mismatch/,
  );
});

test("rejects source directories redirected through a symlink or Windows junction", (t) => {
  const root = fixture(t);
  const source = packageFile(root, "src");
  const outside = join(root, "outside-source");
  renameSync(source, outside);
  symlinkSync(
    outside,
    source,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => verifyVendoredRustPackage(root, identity), /symlink/i);
});

test("rejects a package directory redirected outside its registered location", (t) => {
  const root = fixture(t);
  const packageDirectory = join(root, packagePath);
  const outside = join(root, "outside-package");
  renameSync(packageDirectory, outside);
  symlinkSync(
    outside,
    packageDirectory,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => verifyVendoredRustPackage(root, identity), /symlink/i);
});

test("rejects unregistered packages, versions and mismatched Cargo manifest paths", () => {
  assert.throws(
    () =>
      verifyVendoredRustPackage(repositoryRoot, {
        name: "glib",
        version: "0.20.0",
      }),
    /Unregistered/,
  );
  assert.throws(
    () =>
      verifyVendoredRustPackage(repositoryRoot, {
        name: "new-package",
        version: "0.18.5",
      }),
    /Unregistered/,
  );
  for (const manifestPath of [
    "vendor/glib-0.18.5/Cargo.toml",
    join(repositoryRoot, "Cargo.toml"),
    `${join(repositoryRoot, packagePath)}${sep}src${sep}..${sep}Cargo.toml`,
  ]) {
    assert.throws(
      () =>
        verifyVendoredRustPackage(repositoryRoot, {
          ...identity,
          manifestPath,
        }),
      /manifest_path/,
    );
  }
});

test("the complete registry check rejects an undeclared sibling package", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "vendor/unregistered"));
  assert.throws(() => verifyVendoredRustPackages(root), /unregistered entries/);
});

test("first-party classification accepts exact cross-workspace paths only", (t) => {
  const root = fixture(t);
  const manifestPath = join(root, "crates/core/Cargo.toml");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, '[package]\nname = "atlasterm-core"\n');
  const core = {
    name: "atlasterm-core",
    id: "core-id",
    source: null,
    manifest_path: manifestPath,
  };
  assert.equal(
    isFirstPartyCargoPackage(core, { root, workspaceMembers: ["shell-id"] }),
    true,
  );
  assert.equal(
    isFirstPartyCargoPackage(
      {
        ...core,
        source: "registry+https://github.com/rust-lang/crates.io-index",
      },
      { root },
    ),
    false,
  );
  assert.equal(
    isFirstPartyCargoPackage(
      { ...core, name: "atlasterm-unregistered" },
      { root, workspaceMembers: ["core-id"] },
    ),
    false,
  );
  assert.equal(
    isFirstPartyCargoPackage(
      { ...core, manifest_path: packageFile(root, "Cargo.toml") },
      { root, workspaceMembers: ["core-id"] },
    ),
    false,
  );
});

test("CLI reports public provenance without disclosing absolute checkout paths", () => {
  const result = spawnSync(
    process.execPath,
    [
      join(import.meta.dirname, "verify-vendored-rust.mjs"),
      "--root",
      repositoryRoot,
      "--json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const records = JSON.parse(result.stdout);
  assert.equal(records[0].name, "glib");
  assert.deepEqual(records[0].patchedAdvisories, ["RUSTSEC-2024-0429"]);
  assert.equal(result.stdout.includes(repositoryRoot), false);
  assert.equal(Object.hasOwn(records[0], "directory"), false);
});

test("CLI fails on tampering and on unknown arguments", (t) => {
  const root = fixture(t);
  writeFileSync(packageFile(root, "README.md"), "tampered\n");
  const command = join(import.meta.dirname, "verify-vendored-rust.mjs");
  const tampered = spawnSync(process.execPath, [command, "--root", root], {
    encoding: "utf8",
  });
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /SHA-256 mismatch/);
  const unknown = spawnSync(process.execPath, [command, "--allow-unverified"], {
    encoding: "utf8",
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown/);
});
