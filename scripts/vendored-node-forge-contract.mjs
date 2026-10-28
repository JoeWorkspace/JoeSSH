import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

const metadataFile = "JOESSH-PATCH.json";
const verifiedRecords = new WeakSet();
export function assertVerifiedNodeForge(record) {
  if (!verifiedRecords.has(record)) throw new Error("Original node-forge audit requires the verified pinned distribution.");
}

// This independent pin must change only after source, patch, file-set, and
// cryptographic regression review. Editable package metadata is not authority.
export const NODE_FORGE_REGISTRATION = deepFreeze({
  "name": "node-forge",
  "version": "1.4.2",
  "path": "vendor/node-forge-1.4.2",
  "dependencySpec": "file:vendor/node-forge-1.4.2",
  "metadataSha256": "af047ece8378dda66c06cbeff73736639641c4f0dbcb6cf9aa579efa90c4bcc4",
  "archive": "https://registry.npmjs.org/node-forge/-/node-forge-1.4.2.tgz",
  "integrity": "sha512-rRtAR5XLJ8gCKd9du4qrKAsgCG1ObGP4gLeNJMa4vYSeq4bmBMOJk5IHkrviBV0q7uoAJlVd8HEQYQSVUb4FGQ==",
  "shasum": "9988b154241e3b401a969a76cfb7aca7ddb5e70b",
  "archiveSha256": "2a1307974013e802032149b472fca74d492572251b51b995f5f09d19725c5e10",
  "repository": "https://github.com/digitalbazaar/forge",
  "gitCommit": "7928054627d93ab8c0216b756246e8ca8d62a93e",
  "license": "(BSD-3-Clause OR GPL-2.0)",
  "licenseSha256": "f63ff0e4e239244aa79280da2dd4811a0469e5e201caf5cbc0d97c3a1dff8e82",
  "sourceAdjustments": {
    "lib/pkcs12.js": {
      "originalSha256": "4e471bf3e717d940a07b34d5716d988cfa01b143c38c3fc1f8b597cb83d29742",
      "sha256": "71602edc791742fc947f9cc3725bb08b18c6cbc681b8953b491dae851a4fe5a2",
      "reason": "Reviewed behavior-neutral false-positive adjustment."
    },
    "README.md": {
      "originalSha256": "548e7cd9b92703b46bd34a6c73c1be5df9901a2012a029f87e073b776e53314c",
      "sha256": "c1d731151a68b66e9ae78aaebde2cf85eec0994ea47c0bf36cff9337c381c390",
      "reason": "Remove the previously reviewed duplicate password-derived seed example."
    }
  },
  "removedFiles": [
    "dist/forge.all.min.js",
    "dist/forge.all.min.js.map",
    "dist/forge.min.js",
    "dist/forge.min.js.map",
    "dist/prime.worker.min.js",
    "dist/prime.worker.min.js.map",
    "flash/swf/SocketPool.swf"
  ]
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
  const result = deepFreeze({
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
  });
  verifiedRecords.add(result);
  return result;
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
    metadata.schemaVersion !== 2 ||
    !isDeepStrictEqual(metadata.package, {
      name: NODE_FORGE_REGISTRATION.name,
      version: NODE_FORGE_REGISTRATION.version,
      license: NODE_FORGE_REGISTRATION.license,
    }) ||
    !isDeepStrictEqual(metadata.source, expectedSource) ||
    metadata.distribution?.kind !== "node-only" ||
    !isDeepStrictEqual(metadata.distribution?.removedFiles, NODE_FORGE_REGISTRATION.removedFiles) ||
    !isDeepStrictEqual(metadata.distribution?.sourceAdjustments, NODE_FORGE_REGISTRATION.sourceAdjustments) ||
    !isDeepStrictEqual(metadata.license, {
      expression: NODE_FORGE_REGISTRATION.license,
      file: "LICENSE",
      sha256: NODE_FORGE_REGISTRATION.licenseSha256,
    }) || !isRecord(metadata.files) || !isRecord(metadata.originalFiles)
  ) {
    throw new Error("node-forge vendor source or distribution metadata is not approved.");
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
      !adjustment &&
      record.sha256 !== originalHash
    ) {
      throw new Error("Unapproved node-forge source modification: " + name);
    }
  }
  if (metadata.files["LICENSE"].sha256 !== NODE_FORGE_REGISTRATION.licenseSha256) {
    throw new Error("node-forge license identity mismatch.");
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
