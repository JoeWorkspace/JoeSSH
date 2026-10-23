import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

const metadataFile = "JOESSH-PATCH.json";

// This independent pin must change only after source, patch, file-set, and
// cryptographic regression review. Editable package metadata is not authority.
export const NODE_FORGE_REGISTRATION = deepFreeze({
  name: "node-forge",
  version: "1.4.0",
  path: "vendor/node-forge-1.4.0",
  dependencySpec: "file:vendor/node-forge-1.4.0",
  metadataSha256:
    "fe2b1bf06499efd7b3a970a122dcd64ee8d17ec8586454aa15892b5e33b4b127",
  archive: "https://registry.npmjs.org/node-forge/-/node-forge-1.4.0.tgz",
  integrity:
    "sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ==",
  shasum: "1c7b7d8bdc2d078739f58287d589d903a11b2fc2",
  archiveSha256:
    "bf9d7ca0d774235354697bd4b5e642af6505e7ce2066762c3b855138cf870820",
  repository: "https://github.com/digitalbazaar/forge",
  gitCommit: "fa385f92440879601240020f158bed68e444e83a",
  securityFixCommit: "db05494352dd3c9a5a07c5270333dcc78866cad2",
  upstreamPullRequest: "https://github.com/digitalbazaar/forge/pull/1159",
  upstreamStatus: "open-unmerged",
  patchSha256:
    "37b89ad5884509ccd246b120bf6ad185eaf8963da91769b7781de111c4a4bb92",
  originalRsaSha256:
    "fd4740238145ec26470eb3f06a627c72039538ce1307dbdce40521f94dfd0a50",
  patchedRsaSha256:
    "c7b72e7ef41f4fc0e5228dce3e37851e9ca064c789365d5e392c25d1c5f6e710",
  license: "(BSD-3-Clause OR GPL-2.0)",
  licenseSha256:
    "f63ff0e4e239244aa79280da2dd4811a0469e5e201caf5cbc0d97c3a1dff8e82",
  sourceAdjustments: {
    "lib/pkcs12.js": {
      originalSha256:
        "d0f9693ff8b6e755031566139f0e23a762c9a7af6a1b08a27d522810019906d3",
      sha256:
        "a3f5e45ff46e94979de8a78d1031d61d5941982263f52e9a5b3e2c5d2c26cc83",
      reason:
        "Equivalent bracket-property alias assignment avoids a non-secret false positive after linear-history merges.",
    },
    "README.md": {
      originalSha256:
        "4ea0e2db410fd5d87c3c9b21912b9ed3fe6c57b3107fa92e2c90b1e618121a49",
      sha256:
        "19fe5303e915a3f81e59cb25e2ea0d425bbef52854ccc2d4a8630b2694f68d95",
      reason:
        "Remove a duplicate password-derived seed example while retaining the original secure random 32-byte seed example.",
    },
  },
  patchedAdvisories: ["GHSA-86w9-cpqp-85rv"],
  removedFiles: [
    "dist/forge.all.min.js",
    "dist/forge.min.js",
    "dist/prime.worker.min.js",
    "dist/forge.all.min.js.map",
    "dist/forge.min.js.map",
    "dist/prime.worker.min.js.map",
    "flash/swf/SocketPool.swf",
  ],
});

/**
 * Verify the complete reviewed Node-only backport tree. Dependency/lock binding,
 * duplicate installed packages, and fresh original-identity advisory evaluation
 * belong to the integrating npm contract and must also pass before release.
 */
export function verifyVendoredNodeForge(root) {
  const rootPath = checkedRoot(root);
  const directory = checkedDirectory(rootPath, NODE_FORGE_REGISTRATION.path);
  const metadataBytes = readRegularFile(directory, metadataFile);
  if (sha256(metadataBytes) !== NODE_FORGE_REGISTRATION.metadataSha256) {
    throw new Error(
      "node-forge vendor metadata differs from its reviewed SHA-256.",
    );
  }
  const metadata = parseJson(metadataBytes);
  assertMetadata(metadata);

  const expected = new Map(
    Object.entries(metadata.files).map(([name, record]) => [
      name,
      record.sha256,
    ]),
  );
  expected.set(metadataFile, NODE_FORGE_REGISTRATION.metadataSha256);
  const expectedDirectories = new Set();
  for (const name of expected.keys()) {
    assertRelativePath(name);
    const segments = name.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      expectedDirectories.add(segments.slice(0, length).join("/"));
    }
  }

  const actual = new Map();
  function visit(current, prefix = "") {
    for (const name of readdirSync(current)) {
      assertRelativePath(name);
      const relativeName = prefix ? prefix + "/" + name : name;
      const absoluteName = join(current, name);
      const stats = lstatSync(absoluteName);
      if (stats.isSymbolicLink()) {
        throw new Error(
          "node-forge vendor symlink/junction is forbidden: " + relativeName,
        );
      }
      if (stats.isDirectory()) {
        if (!expectedDirectories.has(relativeName)) {
          throw new Error(
            "Unexpected node-forge vendor directory: " + relativeName,
          );
        }
        assertSameRealPath(absoluteName);
        visit(absoluteName, relativeName);
      } else {
        if (!expected.has(relativeName)) {
          throw new Error("Unexpected node-forge vendor file: " + relativeName);
        }
        assertRegular(stats, relativeName);
        assertSameRealPath(absoluteName);
        const digest = sha256(readFileSync(absoluteName));
        if (digest !== expected.get(relativeName)) {
          throw new Error(
            "node-forge vendor file SHA-256 mismatch: " + relativeName,
          );
        }
        actual.set(relativeName, digest);
      }
    }
  }
  visit(directory);
  if (actual.size !== expected.size) {
    throw new Error("node-forge vendor file set is incomplete.");
  }

  assertManifest(
    parseJson(readRegularFile(directory, "package.json")),
    parseJson(readRegularFile(directory, "package.original.json")),
  );
  const treeSha256 = sha256(
    [...actual]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, digest]) => name + "\0" + digest + "\n")
      .join(""),
  );
  return deepFreeze({
    name: NODE_FORGE_REGISTRATION.name,
    version: NODE_FORGE_REGISTRATION.version,
    path: NODE_FORGE_REGISTRATION.path,
    directory,
    metadata,
    metadataSha256: NODE_FORGE_REGISTRATION.metadataSha256,
    treeSha256,
    fileHashes: Object.fromEntries(actual),
    declaredLicense: NODE_FORGE_REGISTRATION.license,
    registryPackage: {
      name: NODE_FORGE_REGISTRATION.name,
      version: NODE_FORGE_REGISTRATION.version,
      resolved: NODE_FORGE_REGISTRATION.archive,
      integrity: NODE_FORGE_REGISTRATION.integrity,
      shasum: NODE_FORGE_REGISTRATION.shasum,
    },
    patchedAdvisories: [...NODE_FORGE_REGISTRATION.patchedAdvisories],
  });
}

function assertMetadata(metadata) {
  const expectedSource = {
    archive: NODE_FORGE_REGISTRATION.archive,
    integrity: NODE_FORGE_REGISTRATION.integrity,
    shasum: NODE_FORGE_REGISTRATION.shasum,
    archiveSha256: NODE_FORGE_REGISTRATION.archiveSha256,
    repository: NODE_FORGE_REGISTRATION.repository,
    gitCommit: NODE_FORGE_REGISTRATION.gitCommit,
  };
  if (
    metadata.schemaVersion !== 1 ||
    !isDeepStrictEqual(metadata.package, {
      name: NODE_FORGE_REGISTRATION.name,
      version: NODE_FORGE_REGISTRATION.version,
      license: NODE_FORGE_REGISTRATION.license,
    }) ||
    !isDeepStrictEqual(metadata.source, expectedSource) ||
    metadata.patch?.kind !== "security-backport" ||
    !isDeepStrictEqual(
      metadata.patch?.advisories,
      NODE_FORGE_REGISTRATION.patchedAdvisories,
    ) ||
    metadata.patch?.url !== NODE_FORGE_REGISTRATION.upstreamPullRequest ||
    metadata.patch?.upstreamStatus !== NODE_FORGE_REGISTRATION.upstreamStatus ||
    metadata.patch?.securityFixCommit !==
      NODE_FORGE_REGISTRATION.securityFixCommit ||
    metadata.patch?.patchSha256 !== NODE_FORGE_REGISTRATION.patchSha256 ||
    metadata.patch?.originalRsaSha256 !==
      NODE_FORGE_REGISTRATION.originalRsaSha256 ||
    metadata.patch?.patchedRsaSha256 !==
      NODE_FORGE_REGISTRATION.patchedRsaSha256 ||
    metadata.distribution?.kind !== "node-only" ||
    !isDeepStrictEqual(
      metadata.distribution?.removedFiles,
      NODE_FORGE_REGISTRATION.removedFiles,
    ) ||
    !isDeepStrictEqual(
      metadata.distribution?.sourceAdjustments,
      NODE_FORGE_REGISTRATION.sourceAdjustments,
    ) ||
    !isDeepStrictEqual(metadata.license, {
      expression: NODE_FORGE_REGISTRATION.license,
      file: "LICENSE",
      sha256: NODE_FORGE_REGISTRATION.licenseSha256,
    }) ||
    !isRecord(metadata.files) ||
    !isRecord(metadata.originalFiles)
  ) {
    throw new Error(
      "node-forge vendor source or patch metadata is not approved.",
    );
  }
  const originalNames = Object.keys(metadata.originalFiles);
  if (
    originalNames.length !== 59 ||
    Object.keys(metadata.files).length !== 53
  ) {
    throw new Error(
      "node-forge vendor source file inventory differs from reviewed archive.",
    );
  }
  for (const [name, record] of Object.entries(metadata.originalFiles)) {
    assertRelativePath(name);
    assertHash(record?.sha256);
  }
  const retained = originalNames.filter(
    (name) => !NODE_FORGE_REGISTRATION.removedFiles.includes(name),
  );
  if (
    !isDeepStrictEqual(
      [...Object.keys(metadata.files)].sort(),
      [...retained, "package.original.json"].sort(),
    )
  ) {
    throw new Error(
      "node-forge vendor may omit only the reviewed browser/Flash files.",
    );
  }
  for (const [name, record] of Object.entries(metadata.files)) {
    assertRelativePath(name);
    assertHash(record?.sha256);
    const originalName =
      name === "package.original.json" ? "package.json" : name;
    const originalHash = metadata.originalFiles[originalName]?.sha256;
    if (record.originalSha256 !== originalHash) {
      throw new Error("node-forge original source identity mismatch: " + name);
    }
    const adjustment = Object.hasOwn(
      NODE_FORGE_REGISTRATION.sourceAdjustments,
      name,
    )
      ? NODE_FORGE_REGISTRATION.sourceAdjustments[name]
      : null;
    if (
      adjustment &&
      (originalHash !== adjustment.originalSha256 ||
        record.sha256 !== adjustment.sha256)
    ) {
      throw new Error("Unapproved node-forge source adjustment: " + name);
    }
    if (
      name !== "package.json" &&
      name !== "lib/rsa.js" &&
      !adjustment &&
      record.sha256 !== originalHash
    ) {
      throw new Error("Unapproved node-forge source modification: " + name);
    }
  }
  if (
    metadata.files["LICENSE"].sha256 !==
      NODE_FORGE_REGISTRATION.licenseSha256 ||
    metadata.files["lib/rsa.js"].sha256 !==
      NODE_FORGE_REGISTRATION.patchedRsaSha256 ||
    metadata.originalFiles["lib/rsa.js"].sha256 !==
      NODE_FORGE_REGISTRATION.originalRsaSha256
  ) {
    throw new Error("node-forge license or RSA patch identity mismatch.");
  }
}

function assertManifest(actual, original) {
  if (
    original.name !== NODE_FORGE_REGISTRATION.name ||
    original.version !== NODE_FORGE_REGISTRATION.version ||
    original.license !== NODE_FORGE_REGISTRATION.license
  ) {
    throw new Error("node-forge original package identity is not approved.");
  }
  const expected = {
    ...original,
    files: ["lib/*.js", "LICENSE", "package.original.json", metadataFile],
    exports: {
      ".": { node: "./lib/index.js" },
      "./package.json": "./package.json",
      "./lib/*": { node: "./lib/*" },
    },
  };
  delete expected.scripts;
  delete expected.devDependencies;
  delete expected.nyc;
  delete expected.jspm;
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      "node-forge package metadata has unapproved Node-only changes.",
    );
  }
}

function checkedRoot(root) {
  if (typeof root !== "string" || !root) {
    throw new Error("Repository root is required.");
  }
  const absolute = resolve(root);
  const stats = lstatSync(absolute);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Repository root must be a real directory.");
  }
  assertSameRealPath(absolute);
  return absolute;
}

function checkedDirectory(root, name) {
  assertRelativePath(name);
  let current = root;
  for (const part of name.split("/")) {
    current = join(current, part);
    const stats = lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(
        "node-forge vendor ancestor must be a real directory: " + name,
      );
    }
    assertSameRealPath(current);
  }
  const inside = relative(root, current);
  if (inside === ".." || inside.startsWith(".." + sep) || isAbsolute(inside)) {
    throw new Error("node-forge vendor directory escapes repository root.");
  }
  return current;
}

function readRegularFile(directory, name) {
  assertRelativePath(name);
  const full = join(directory, name);
  assertRegular(lstatSync(full), name);
  assertSameRealPath(full);
  return readFileSync(full);
}

function assertRegular(stats, name) {
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error(
      "node-forge vendor entry must be a regular file without links: " + name,
    );
  }
}

function assertSameRealPath(path) {
  const normalize = (p) =>
    process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p);
  if (normalize(path) !== normalize(realpathSync(path))) {
    throw new Error("node-forge path traverses a symlink/junction: " + path);
  }
}

function assertRelativePath(name) {
  if (
    typeof name !== "string" ||
    !name ||
    /[\\<>:"|?*]/u.test(name) ||
    isAbsolute(name) ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Unsafe node-forge vendor relative path.");
  }
}

function assertHash(hash) {
  if (typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash)) {
    throw new Error("Invalid node-forge file SHA-256.");
  }
}

function parseJson(bytes) {
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!isRecord(value)) {
    throw new Error("node-forge metadata must be a JSON object.");
  }
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
