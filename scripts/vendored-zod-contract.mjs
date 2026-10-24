import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

const metadataFile = "JOESSH-PATCH.json";
const verifiedRecords = new WeakSet();
export const ZOD_REGISTRATION = deepFreeze({
  name: "zod",
  version: "3.25.76",
  path: "vendor/zod-3.25.76",
  dependencySpec: "file:../../../vendor/zod-3.25.76",
  consumer: "@expo/cli",
  consumerPath: "node_modules/@expo/cli",
  installedPath: "node_modules/@expo/cli/node_modules/zod",
  metadataSha256:
    "a8a380d0402f1951835cadac8bbf36f725e5543f1b0624a92925b00c57eaed03",
  archive: "https://registry.npmjs.org/zod/-/zod-3.25.76.tgz",
  integrity:
    "sha512-gzUt/qt81nXsFGKIFcC3YnfEAx5NkunCfnDlvuBSSFS02bcXu4Lmea0AFIUwbLWxWPx3d9p8S5QoaujKcNQxcQ==",
  shasum: "26841c3f6fd22a6a2760e7ccb719179768471e34",
  archiveSha256:
    "9e1f1a05f0dd0c1dab64ee91ceb9bf55cd44d35368c70edda80a2fdc70a88377",
  repository: "https://github.com/colinhacks/zod",
  gitCommit: "50606616c0d291caf3210a7521da51271b918333",
  securityFixCommit: "a0ebf970f2d752e5f58527cd2942ff48be4f46bd",
  patchSha256:
    "21323423c37de5b02e9362b58a1ccab1f1c2d0dcbfbdc158907659a462bf72ab",
  license: "MIT",
  patchedAdvisories: ["GHSA-mrhx-c7xc-m3w5"],
});

// Source checks are also used by Rust/SBOM jobs that intentionally do not install npm.
// They must not mint the capability accepted by runtime audit recognition.
export function verifyVendoredZodSource(root) {
  return verifyZod(root, true);
}

export function verifyVendoredZod(root) {
  return verifyZod(root, false);
}

// No backport in a legacy fixture is optional. Any partial integration is not.
function verifyZod(root, sourceOnly) {
  if (typeof sourceOnly !== "boolean") {
    throw new Error("Zod verifier mode must be an explicit boolean.");
  }
  const rootPath = checkedDirectory(resolve(root));
  const manifest = existsSync(join(rootPath, "package.json"))
    ? json(readRegularFile(rootPath, "package.json"))
    : {};
  const lock = existsSync(join(rootPath, "package-lock.json"))
    ? json(readRegularFile(rootPath, "package-lock.json"))
    : {};
  const packages = lock.packages ?? {};
  const hasVersion3 = Object.entries(packages).some(
    ([name, entry]) =>
      (name === "node_modules/zod" ||
        name.endsWith("/node_modules/zod") ||
        entry?.name === "zod") &&
      /^3(?:\.|$)/u.test(entry?.version ?? ""),
  );
  const traces =
    existsSync(join(rootPath, ZOD_REGISTRATION.path)) ||
    hasVersion3 ||
    Object.hasOwn(manifest.overrides?.["@expo/cli"] ?? {}, "zod") ||
    /zod-3\.25\.76|zod-v3/iu.test(JSON.stringify([manifest, lock]));
  if (!traces) return undefined;
  if (
    !isDeepStrictEqual(manifest.overrides?.["@expo/cli"], {
      zod: ZOD_REGISTRATION.dependencySpec,
    })
  ) {
    throw new Error("Zod v3 requires the exact scoped Expo CLI file override.");
  }
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (/zod-v3/iu.test(name) || /zod-3\.25\.76/iu.test(String(spec))) {
        throw new Error(
          "Unexpected root Zod v3 alias or direct vendored dependency.",
        );
      }
    }
  }
  if (
    !isDeepStrictEqual(packages[ZOD_REGISTRATION.installedPath], {
      resolved: ZOD_REGISTRATION.path,
      link: true,
    })
  ) {
    throw new Error(
      "Zod v3 lock must bind the exact CLI link to its reviewed source.",
    );
  }
  const sourceEntry = packages[ZOD_REGISTRATION.path];
  if (
    !isDeepStrictEqual(sourceEntry, {
      name: "zod",
      version: "3.25.76",
      license: "MIT",
      funding: { url: "https://github.com/sponsors/colinhacks" },
    })
  ) {
    throw new Error("Zod v3 source identity is not locked.");
  }
  for (const [name, entry] of Object.entries(packages)) {
    if (
      name === ZOD_REGISTRATION.path ||
      name === ZOD_REGISTRATION.installedPath
    )
      continue;
    if (
      (entry?.resolved ?? "").includes("zod-3.25.76") ||
      /zod-v3/iu.test(name) ||
      ((name === "node_modules/zod" ||
        name.endsWith("/node_modules/zod") ||
        entry?.name === "zod") &&
        /^3(?:\.|$)/u.test(entry?.version ?? ""))
    ) {
      throw new Error("Unexpected duplicate or alternate Zod v3 lock entry.");
    }
  }

  const directory = checkedRelativeDirectory(rootPath, ZOD_REGISTRATION.path);
  const metadataBytes = readRegularFile(directory, metadataFile);
  if (sha256(metadataBytes) !== ZOD_REGISTRATION.metadataSha256)
    throw new Error("Zod vendor metadata differs from its reviewed SHA-256.");
  const metadata = json(metadataBytes);
  const originalBytes = readRegularFile(directory, "package.original.json");
  if (
    sha256(originalBytes) !== metadata.files?.["package.original.json"]?.sha256
  )
    throw new Error("Zod original package SHA-256 mismatch.");
  const original = json(originalBytes);
  assertMetadata(metadata, original);
  const expected = new Map(
    Object.entries(metadata.files).map(([name, record]) => [
      name,
      record.sha256,
    ]),
  );
  expected.set(metadataFile, ZOD_REGISTRATION.metadataSha256);
  const directories = new Set();
  for (const name of expected.keys()) {
    safePath(name);
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++)
      directories.add(parts.slice(0, i).join("/"));
  }
  const actual = new Map();
  function visit(folder, prefix = "") {
    for (const name of readdirSync(folder)) {
      safePath(name);
      const relativeName = prefix ? prefix + "/" + name : name;
      const file = join(folder, name);
      const stats = lstatSync(file);
      if (stats.isSymbolicLink())
        throw new Error("Zod vendor symlink/junction is forbidden.");
      if (stats.isDirectory()) {
        if (!directories.has(relativeName))
          throw new Error("Unexpected Zod vendor directory.");
        checkedDirectory(file);
        visit(file, relativeName);
      } else {
        if (!expected.has(relativeName))
          throw new Error("Unexpected Zod vendor file.");
        const bytes = readRegularFile(directory, relativeName);
        if (sha256(bytes) !== expected.get(relativeName))
          throw new Error("Zod vendor file SHA-256 mismatch: " + relativeName);
        if (
          relativeName !== metadataFile &&
          bytes.length !== metadata.files[relativeName].sizeBytes
        )
          throw new Error("Zod vendor file size mismatch.");
        actual.set(relativeName, sha256(bytes));
      }
    }
  }
  visit(directory);
  if (actual.size !== expected.size)
    throw new Error("Zod vendor file set is incomplete.");
  const expectedManifest = {
    ...original,
    files: [
      "index.*",
      "v3",
      "src/index.ts",
      "src/v3",
      "LICENSE",
      "README.md",
      "package.original.json",
      metadataFile,
      "JOESSH-BACKPORT.patch",
    ],
    exports: {
      ".": { node: original.exports["."] },
      "./v3": { node: original.exports["./v3"] },
      "./package.json": "./package.json",
    },
  };
  delete expectedManifest.scripts;
  delete expectedManifest.devDependencies;
  delete expectedManifest.zshy;
  if (
    !isDeepStrictEqual(
      json(readRegularFile(directory, "package.json")),
      expectedManifest,
    )
  )
    throw new Error("Zod package has unreviewed v3-only export changes.");

  if (!sourceOnly) {
    checkedRelativeDirectory(rootPath, ZOD_REGISTRATION.consumerPath);
    const installed = join(rootPath, ZOD_REGISTRATION.installedPath);
    if (normalize(realpathSync(installed)) !== normalize(directory))
      throw new Error("Installed CLI Zod v3 link has a different target.");
    const cliRequire = createRequire(
      join(rootPath, ZOD_REGISTRATION.consumerPath, "package.json"),
    );
    for (const [specifier, file] of [
      ["zod", "index.cjs"],
      ["zod/v3", "v3/index.cjs"],
    ]) {
      if (
        normalize(realpathSync(cliRequire.resolve(specifier))) !==
        normalize(join(directory, file))
      )
        throw new Error("CLI silently resolved a different Zod runtime.");
    }
    for (const specifier of metadata.distribution.removedExports) {
      let rejected = false;
      try {
        cliRequire.resolve("zod" + specifier.slice(1));
      } catch (error) {
        rejected = error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
      }
      if (!rejected)
        throw new Error("An unsupported old Zod v4 export remains reachable.");
    }
  }
  const record = deepFreeze({
    name: "zod",
    version: "3.25.76",
    path: ZOD_REGISTRATION.path,
    directory,
    metadata,
    metadataSha256: ZOD_REGISTRATION.metadataSha256,
    treeSha256: sha256(
      [...actual]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, digest]) => name + "\0" + digest + "\n")
        .join(""),
    ),
    fileHashes: Object.fromEntries(actual),
    declaredLicense: "MIT",
    registryPackage: {
      name: "zod",
      version: "3.25.76",
      resolved: ZOD_REGISTRATION.archive,
      integrity: ZOD_REGISTRATION.integrity,
      shasum: ZOD_REGISTRATION.shasum,
    },
    patchedAdvisories: [...ZOD_REGISTRATION.patchedAdvisories],
    installation: {
      verified: !sourceOnly,
      consumer: "@expo/cli",
      path: ZOD_REGISTRATION.installedPath,
    },
  });
  if (!sourceOnly) verifiedRecords.add(record);
  return record;
}

export function assertVerifiedZod(record) {
  if (!verifiedRecords.has(record))
    throw new Error(
      "Zod original-identity audit requires the source-verified pinned v3 backport.",
    );
}

function retainedPath(name) {
  return (
    name === "package.json" ||
    name === "LICENSE" ||
    name === "README.md" ||
    /^index\.(?:js|cjs|d\.ts|d\.cts)$/u.test(name) ||
    name === "src/index.ts" ||
    name.startsWith("v3/") ||
    name.startsWith("src/v3/")
  );
}
function assertMetadata(m, original) {
  const r = ZOD_REGISTRATION;
  const source = {
    archive: r.archive,
    integrity: r.integrity,
    shasum: r.shasum,
    archiveSha256: r.archiveSha256,
    repository: r.repository,
    gitCommit: r.gitCommit,
  };
  const modified = ["src/v3/types.ts", "v3/types.js", "v3/types.cjs"];
  if (
    m.schemaVersion !== 1 ||
    !isDeepStrictEqual(m.package, {
      name: "zod",
      version: "3.25.76",
      license: "MIT",
    }) ||
    !isDeepStrictEqual(m.source, source) ||
    m.patch?.kind !== "project-derived-security-backport" ||
    m.patch.upstreamCommit !== r.securityFixCommit ||
    m.patch.patchSha256 !== r.patchSha256 ||
    !isDeepStrictEqual(m.patch.advisories, r.patchedAdvisories) ||
    !isDeepStrictEqual(m.patch.modifiedFiles, modified) ||
    m.distribution?.kind !== "node-esm-cjs-v3-only" ||
    original.name !== "zod" ||
    original.version !== "3.25.76" ||
    original.license !== "MIT" ||
    !isRecord(m.originalFiles) ||
    !isRecord(m.files)
  )
    throw new Error("Zod source or backport metadata is not approved.");
  const originals = Object.keys(m.originalFiles);
  if (originals.length !== 596 || Object.keys(m.files).length !== 145)
    throw new Error("Zod archive file inventory changed.");
  const retained = originals.filter(retainedPath).sort();
  if (
    !isDeepStrictEqual(
      Object.keys(m.files).sort(),
      [...retained, "package.original.json", "JOESSH-BACKPORT.patch"].sort(),
    ) ||
    !isDeepStrictEqual(
      m.distribution.removedFiles,
      originals.filter((name) => !retainedPath(name)).sort(),
    ) ||
    !isDeepStrictEqual(
      m.distribution.removedExports,
      Object.keys(original.exports).filter(
        (name) => ![".", "./v3", "./package.json"].includes(name),
      ),
    ) ||
    !isDeepStrictEqual(m.distribution.supportedExports, [
      ".",
      "./v3",
      "./package.json",
    ])
  )
    throw new Error("Zod v3-only file or export boundary differs from review.");
  for (const [name, record] of Object.entries(m.originalFiles)) {
    safePath(name);
    validRecord(record);
  }
  for (const [name, record] of Object.entries(m.files)) {
    safePath(name);
    validRecord(record);
    const originalHash =
      m.originalFiles[name === "package.original.json" ? "package.json" : name]
        ?.sha256 ?? null;
    if (record.originalSha256 !== originalHash)
      throw new Error("Zod original source identity mismatch.");
    if (
      ![...modified, "package.json", "JOESSH-BACKPORT.patch"].includes(name) &&
      record.sha256 !== originalHash
    )
      throw new Error("Unapproved Zod source adjustment.");
  }
  if (
    m.files["JOESSH-BACKPORT.patch"].sha256 !== r.patchSha256 ||
    m.license?.file !== "LICENSE" ||
    m.license.expression !== "MIT" ||
    m.license.sha256 !== m.files.LICENSE.sha256
  )
    throw new Error("Zod patch or license binding changed.");
}
function validRecord(record) {
  if (
    !record ||
    typeof record.sha256 !== "string" ||
    record.sha256.length !== 64 ||
    !/^[a-f0-9]{64}$/u.test(record.sha256) ||
    !Number.isSafeInteger(record.sizeBytes) ||
    record.sizeBytes < 0
  )
    throw new Error("Invalid Zod file hash or size.");
}
function normalize(file) {
  return process.platform === "win32"
    ? resolve(file).toLowerCase()
    : resolve(file);
}
function checkedDirectory(file) {
  const info = lstatSync(file);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    normalize(realpathSync(file)) !== normalize(file)
  )
    throw new Error(
      "Zod path must be a real directory without a symlink/junction.",
    );
  return file;
}
function checkedRelativeDirectory(root, name) {
  safePath(name);
  let current = root;
  for (const part of name.split("/"))
    current = checkedDirectory(join(current, part));
  return current;
}
function readRegularFile(root, name) {
  safePath(name);
  const file = join(root, name),
    info = lstatSync(file);
  const rel = relative(root, realpathSync(file));
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    normalize(realpathSync(file)) !== normalize(file) ||
    rel === ".." ||
    rel.startsWith(".." + sep) ||
    isAbsolute(rel)
  )
    throw new Error(
      "Zod file must be direct, regular, inside its source, and single-link.",
    );
  return readFileSync(file);
}
function safePath(name) {
  if (
    typeof name !== "string" ||
    !name ||
    /[\\<>:"|?*]/u.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    isAbsolute(name) ||
    name
      .split("/")
      .some(
        (part) => !part || part === "." || part === ".." || /[. ]$/u.test(part),
      )
  )
    throw new Error("Unsafe Zod vendor path.");
}
function json(bytes) {
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!isRecord(value)) throw new Error("Zod metadata must be an object.");
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
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
