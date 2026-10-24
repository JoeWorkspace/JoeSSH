import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import {
  ZOD_REGISTRATION,
  assertVerifiedZod,
  verifyVendoredZod,
  verifyVendoredZodSource,
} from "./vendored-zod-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const source = join(root, ZOD_REGISTRATION.path);
const sourceEntry = {
  name: "zod",
  version: "3.25.76",
  license: "MIT",
  funding: { url: "https://github.com/sponsors/colinhacks" },
};
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "joessh-zod-contract-"));
  t.after(() => {
    assert.equal(dirname(directory), tmpdir());
    assert(directory.includes("joessh-zod-contract-"));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
function fixture(t, { installed = true } = {}) {
  const directory = temporary(t),
    vendor = join(directory, ZOD_REGISTRATION.path);
  mkdirSync(dirname(vendor), { recursive: true });
  cpSync(source, vendor, { recursive: true });
  const manifest = {
    name: "synthetic-zod-contract",
    version: "0.0.0",
    overrides: { "@expo/cli": { zod: ZOD_REGISTRATION.dependencySpec } },
  };
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { name: manifest.name, version: manifest.version },
      [ZOD_REGISTRATION.path]: sourceEntry,
      [ZOD_REGISTRATION.installedPath]: {
        resolved: ZOD_REGISTRATION.path,
        link: true,
      },
    },
  };
  writeJson(join(directory, "package.json"), manifest);
  writeJson(join(directory, "package-lock.json"), lock);
  if (installed) {
    const cli = join(directory, ZOD_REGISTRATION.consumerPath);
    mkdirSync(join(cli, "node_modules"), { recursive: true });
    writeJson(join(cli, "package.json"), {
      name: "@expo/cli",
      version: "57.0.11",
    });
    symlinkSync(
      vendor,
      join(directory, ZOD_REGISTRATION.installedPath),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  return { root: directory, vendor, manifest, lock };
}

test("verifies the complete reviewed v3-only tree and the actual scoped CLI resolution", (t) => {
  const f = fixture(t),
    verified = verifyVendoredZod(f.root);
  assert.equal(verified.installation.verified, true);
  assert.equal(verified.name, "zod");
  assert.equal(verified.version, "3.25.76");
  assert.equal(verified.declaredLicense, "MIT");
  assert.equal(verified.metadataSha256, ZOD_REGISTRATION.metadataSha256);
  assert.equal(Object.keys(verified.fileHashes).length, 146);
  assert.equal(Object.keys(verified.metadata.originalFiles).length, 596);
  assert.equal(verified.metadata.distribution.removedFiles.length, 453);
  assert.deepEqual(verified.metadata.distribution.supportedExports, [
    ".",
    "./v3",
    "./package.json",
  ]);
  assert.deepEqual(verified.patchedAdvisories, ["GHSA-mrhx-c7xc-m3w5"]);
  assert(Object.isFrozen(verified));
  assert(Object.isFrozen(verified.metadata.files));
  assert.doesNotThrow(() => assertVerifiedZod(verified));
  assert.throws(
    () => assertVerifiedZod(Object.freeze(structuredClone(verified))),
    /source-verified/,
  );
});

test("source proof verifies all pinned inputs without an npm installation and grants no runtime capability", (t) => {
  const f = fixture(t, { installed: false });
  const verified = verifyVendoredZodSource(f.root);
  assert.equal(verified.installation.verified, false);
  assert.equal(Object.keys(verified.fileHashes).length, 146);
  assert.equal(verified.metadataSha256, ZOD_REGISTRATION.metadataSha256);
  assert(Object.isFrozen(verified));
  assert(Object.isFrozen(verified.installation));
  assert.throws(() => assertVerifiedZod(verified), /source-verified/);
  assert.throws(() => verifyVendoredZod(f.root), /ENOENT/);
  // The strict API has no public skip flag, including leftover caller options.
  assert.throws(
    () => verifyVendoredZod(f.root, { sourceOnly: true }),
    /ENOENT/,
  );
});

test("source proof cannot gain runtime recognition even when actual installation checks could pass", (t) => {
  const f = fixture(t);
  const sourceProof = verifyVendoredZodSource(f.root);
  const installedProof = verifyVendoredZod(f.root);
  assert.equal(sourceProof.installation.verified, false);
  assert.equal(installedProof.installation.verified, true);
  assert.equal(sourceProof.treeSha256, installedProof.treeSha256);
  assert.throws(() => assertVerifiedZod(sourceProof), /source-verified/);
  assert.doesNotThrow(() => assertVerifiedZod(installedProof));
});

test("source proof still rejects source tampering and broken logical lock bindings without node_modules", (t) => {
  const f = fixture(t, { installed: false });
  const runtime = join(f.vendor, "v3/types.cjs");
  appendFileSync(runtime, "\nsynthetic tampering\n");
  assert.throws(() => verifyVendoredZodSource(f.root), /SHA-256/);
  cpSync(join(source, "v3/types.cjs"), runtime);
  f.lock.packages[ZOD_REGISTRATION.installedPath].resolved =
    "unreviewed/source";
  writeJson(join(f.root, "package-lock.json"), f.lock);
  assert.throws(() => verifyVendoredZodSource(f.root), /exact CLI link/);
});

test("a legacy fixture with no Zod v3 backport trace returns undefined", (t) => {
  const directory = temporary(t);
  assert.equal(verifyVendoredZod(directory), undefined);
  assert.equal(verifyVendoredZodSource(directory), undefined);
  writeJson(join(directory, "package.json"), {
    name: "legacy",
    overrides: { unrelated: "1.0.0" },
  });
  writeJson(join(directory, "package-lock.json"), {
    packages: { "node_modules/zod": { version: "4.6.7" } },
  });
  assert.equal(verifyVendoredZod(directory), undefined);
});

test("an orphaned source lock entry cannot skip verification when the vendor is missing", (t) => {
  const directory = temporary(t);
  writeJson(join(directory, "package.json"), { name: "legacy" });
  writeJson(join(directory, "package-lock.json"), {
    packages: { [ZOD_REGISTRATION.path]: sourceEntry },
  });
  assert.throws(() => verifyVendoredZod(directory), /exact scoped/);
});

for (const file of [
  "src/v3/types.ts",
  "v3/types.js",
  "v3/types.cjs",
  "index.d.cts",
  "LICENSE",
  "package.original.json",
  "JOESSH-BACKPORT.patch",
  "JOESSH-PATCH.json",
]) {
  test("rejects source or provenance tampering: " + file, (t) => {
    const f = fixture(t);
    appendFileSync(join(f.vendor, file), "\nsynthetic tampering\n");
    assert.throws(() => verifyVendoredZod(f.root), /SHA-256/);
    assert.throws(() => verifyVendoredZodSource(f.root), /SHA-256/);
  });
}

test("rejects a missing runtime file and reintroduced old v4 export surface", (t) => {
  const f = fixture(t);
  unlinkSync(join(f.vendor, "v3/types.js"));
  assert.throws(() => verifyVendoredZod(f.root), /incomplete/);
  cpSync(join(source, "v3/types.js"), join(f.vendor, "v3/types.js"));
  mkdirSync(join(f.vendor, "v4"));
  writeFileSync(
    join(f.vendor, "v4/index.js"),
    "export const unpatched = true;\n",
  );
  assert.throws(
    () => verifyVendoredZod(f.root),
    /Unexpected Zod vendor directory/,
  );
});

test("rejects a hard-linked runtime file", (t) => {
  const f = fixture(t);
  linkSync(join(f.vendor, "v3/types.cjs"), join(f.root, "extra-link.cjs"));
  assert.throws(() => verifyVendoredZod(f.root), /single-link/);
});

test("rejects a vendor directory junction even when it points to copied good bytes", (t) => {
  const f = fixture(t),
    moved = join(f.root, "copied-source");
  assert(!relative(f.root, moved).startsWith(".."));
  renameSync(f.vendor, moved);
  symlinkSync(
    moved,
    f.vendor,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => verifyVendoredZod(f.root), /real directory/);
});

for (const [label, change] of [
  [
    "naive alias override",
    (f) => {
      f.manifest.overrides["@expo/cli"].zod = "$@joessh/zod-v3";
    },
  ],
  [
    "global override",
    (f) => {
      delete f.manifest.overrides["@expo/cli"];
      f.manifest.overrides.zod = ZOD_REGISTRATION.dependencySpec;
    },
  ],
  [
    "extra parent override field",
    (f) => {
      f.manifest.overrides["@expo/cli"].unexpected = "1.0.0";
    },
  ],
  [
    "root alias",
    (f) => {
      f.manifest.dependencies = { "@joessh/zod-v3": "file:vendor/zod-3.25.76" };
    },
  ],
  [
    "broken relative link",
    (f) => {
      f.lock.packages[ZOD_REGISTRATION.installedPath].resolved =
        "node_modules/@expo/cli/vendor/zod-3.25.76";
    },
  ],
  [
    "extra installed link field",
    (f) => {
      f.lock.packages[ZOD_REGISTRATION.installedPath].version = "3.25.76";
    },
  ],
  [
    "unreviewed source lock field",
    (f) => {
      f.lock.packages[ZOD_REGISTRATION.path] = {
        ...sourceEntry,
        hasInstallScript: true,
      };
    },
  ],
  [
    "duplicate original registry copy",
    (f) => {
      f.lock.packages["node_modules/other/node_modules/zod"] = {
        version: "3.25.76",
      };
    },
  ],
  [
    "alternate hoist",
    (f) => {
      f.lock.packages["apps/mobile/node_modules/@expo/cli/node_modules/zod"] =
        f.lock.packages[ZOD_REGISTRATION.installedPath];
      delete f.lock.packages[ZOD_REGISTRATION.installedPath];
    },
  ],
]) {
  test("rejects partial or unsafe npm integration: " + label, (t) => {
    const f = fixture(t);
    change(f);
    writeJson(join(f.root, "package.json"), f.manifest);
    writeJson(join(f.root, "package-lock.json"), f.lock);
    assert.throws(() => verifyVendoredZod(f.root));
  });
}

test("rejects silent CLI fallback to the hoisted v4 package", (t) => {
  const f = fixture(t),
    nested = join(f.root, ZOD_REGISTRATION.installedPath);
  unlinkSync(nested);
  const hoisted = join(f.root, "node_modules/zod");
  mkdirSync(hoisted);
  writeJson(join(hoisted, "package.json"), {
    name: "zod",
    version: "4.6.7",
    main: "index.cjs",
  });
  writeFileSync(join(hoisted, "index.cjs"), "module.exports = {};\n");
  const cliRequire = createRequire(
    join(f.root, ZOD_REGISTRATION.consumerPath, "package.json"),
  );
  assert.equal(cliRequire.resolve("zod"), join(hoisted, "index.cjs"));
  assert.throws(() => verifyVendoredZod(f.root), /ENOENT/);
});
