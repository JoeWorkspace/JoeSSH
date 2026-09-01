import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const metadataFile = "JOESSH-PATCH.json";
const registrations = Object.freeze([
  Object.freeze({
    name: "decode-uri-component",
    version: "0.5.0",
    path: "vendor/decode-uri-component-0.5.0",
    dependencySpec: "file:vendor/decode-uri-component-0.5.0",
    metadataSha256:
      "19e68fc3104e04ccc8c10cf1f24c7ff4a42991ab12b4783f5a2b0b7f645f5656",
    archive:
      "https://registry.npmjs.org/decode-uri-component/-/decode-uri-component-0.5.0.tgz",
    integrity:
      "sha512-1BiQVoK8C9gUbQU6NzAtO/tkz2qOFpEObMWpcFvhx4fYnj4Oc5yzaJN/LD36ihkVUdXyh5ZekzX+yM+ty/SrPg==",
    shasum: "4592fa1e1d640ec5e2760e2e168ad2ab5f2c9da1",
    repository: "https://github.com/SamVerschueren/decode-uri-component",
    gitCommit: "a12fabaa28303cc8b5b07e93d128f4fc09fc31e5",
    securityFixCommit: "fa479dafeede7bedf04e5c89aa78f2a78c664005",
    advisory: "https://github.com/advisories/GHSA-vcc3-ghjq-m6fr",
    license: "MIT",
  }),
]);

export function registeredVendoredNpmDirectoryNames() {
  return registrations.map(({ path }) => path.slice("vendor/".length));
}

export function isRegisteredVendoredNpmDirectory(directoryName) {
  return registrations.some(
    ({ path }) => path.slice("vendor/".length) === directoryName,
  );
}

export function verifyVendoredNpmDirectory(root, directoryName) {
  const registration = registrations.find(
    ({ path }) => path.slice("vendor/".length) === directoryName,
  );
  if (!registration) {
    throw new Error(`Unregistered vendored npm directory: ${directoryName}.`);
  }
  return verifyRegistration(root, registration);
}

export function verifyVendoredNpmPackages(root) {
  const rootPath = checkedRoot(root);
  const packageJson = readJson(checkedPath(rootPath, "package.json", "file"));
  const packageLock = readJson(
    checkedPath(rootPath, "package-lock.json", "file"),
  );
  const records = [];

  for (const registration of registrations) {
    const dependency = packageJson.dependencies?.[registration.name];
    if (dependency === undefined) {
      continue;
    }
    if (dependency !== registration.dependencySpec) {
      throw new Error(
        `${registration.name} must use reviewed vendored spec ${registration.dependencySpec}.`,
      );
    }
    if (
      packageJson.overrides?.[registration.name] !== `$${registration.name}`
    ) {
      throw new Error(
        `${registration.name} must override every transitive edge with its reviewed direct dependency.`,
      );
    }
    if (
      packageLock.packages?.[""]?.dependencies?.[registration.name] !==
      registration.dependencySpec
    ) {
      throw new Error(
        `${registration.name} root dependency is not bound in package-lock.json.`,
      );
    }
    if (
      !isDeepStrictEqual(
        packageLock.packages?.[`node_modules/${registration.name}`],
        { resolved: registration.path, link: true },
      )
    ) {
      throw new Error(
        `${registration.name} package-lock link does not target ${registration.path}.`,
      );
    }
    const lockEntry = packageLock.packages?.[registration.path];
    if (
      lockEntry?.name !== registration.name ||
      lockEntry?.version !== registration.version ||
      lockEntry?.license !== registration.license
    ) {
      throw new Error(
        `${registration.name} vendored package identity is not locked.`,
      );
    }
    records.push(verifyRegistration(rootPath, registration));
  }

  return records;
}

function verifyRegistration(root, registration) {
  const rootPath = checkedRoot(root);
  const directory = checkedPath(rootPath, registration.path, "directory");
  const metadataPath = checkedPath(directory, metadataFile, "file");
  const metadataBytes = readFileSync(metadataPath);
  if (sha256(metadataBytes) !== registration.metadataSha256) {
    throw new Error(
      `${registration.name}@${registration.version} npm vendor metadata does not match its reviewed SHA-256.`,
    );
  }
  const metadata = readJsonBytes(metadataBytes, metadataPath);
  assertMetadata(metadata, registration);

  const expected = new Map(
    Object.entries(metadata.files).map(([path, record]) => [
      path,
      record.sha256,
    ]),
  );
  expected.set(metadataFile, registration.metadataSha256);
  const actual = new Map();
  for (const name of readdirSync(directory)) {
    assertSafeName(name);
    const path = join(directory, name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Vendored npm entry must be a regular file: ${name}.`);
    }
    if (!expected.has(name)) {
      throw new Error(`Unexpected vendored npm file: ${name}.`);
    }
    actual.set(name, sha256(readFileSync(path)));
  }
  if (actual.size !== expected.size) {
    throw new Error(
      `${registration.name}@${registration.version} vendored npm file set is incomplete.`,
    );
  }
  for (const [path, hash] of expected) {
    if (actual.get(path) !== hash) {
      throw new Error(`Vendored npm file SHA-256 mismatch: ${path}.`);
    }
  }

  const esmSource = decodeUtf8(
    readFileSync(checkedPath(directory, "index.js", "file")),
  );
  const commonJsSource = decodeUtf8(
    readFileSync(checkedPath(directory, "index.cjs", "file")),
  );
  const marker = "export default function decodeUriComponent(encodedURI) {";
  if (
    esmSource.split(marker).length - 1 !== 1 ||
    commonJsSource !==
      esmSource.replace(
        marker,
        "module.exports = function decodeUriComponent(encodedURI) {",
      )
  ) {
    throw new Error(
      "Vendored npm CommonJS entry must differ from upstream only at the reviewed export declaration.",
    );
  }

  const packageJson = readJson(checkedPath(directory, "package.json", "file"));
  const originalPackage = readJson(
    checkedPath(directory, "package.original.json", "file"),
  );
  const expectedPackage = {
    ...originalPackage,
    main: "./index.cjs",
    module: "./index.js",
    types: "./index.d.ts",
    exports: {
      types: "./index.d.ts",
      import: "./index.js",
      require: "./index.cjs",
      default: "./index.js",
    },
    files: ["index.js", "index.cjs", "index.d.ts"],
  };
  delete expectedPackage.scripts;
  delete expectedPackage.devDependencies;
  delete expectedPackage.overrides;
  delete expectedPackage.tsd;
  if (!isDeepStrictEqual(packageJson, expectedPackage)) {
    throw new Error(
      "Vendored npm package metadata must preserve reviewed upstream fields, omit only package-development configuration, and add the compatibility entries.",
    );
  }

  const treeSha256 = sha256(
    [...actual.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, hash]) => `${path}\0${hash}\n`)
      .join(""),
  );
  return deepFreeze({
    name: registration.name,
    version: registration.version,
    path: registration.path,
    directory,
    metadata,
    metadataSha256: registration.metadataSha256,
    treeSha256,
    fileHashes: Object.fromEntries(actual),
    declaredLicense: registration.license,
  });
}

function assertMetadata(metadata, registration) {
  if (
    metadata.schemaVersion !== 1 ||
    !isDeepStrictEqual(metadata.package, {
      name: registration.name,
      version: registration.version,
      license: registration.license,
    }) ||
    metadata.source?.archive !== registration.archive ||
    metadata.source?.integrity !== registration.integrity ||
    metadata.source?.shasum !== registration.shasum ||
    metadata.source?.repository !== registration.repository ||
    metadata.source?.gitCommit !== registration.gitCommit ||
    metadata.source?.securityFixCommit !== registration.securityFixCommit ||
    metadata.source?.advisory !== registration.advisory ||
    metadata.patch?.kind !== "module-compatibility" ||
    typeof metadata.patch?.rationale !== "string" ||
    metadata.patch.rationale.length < 80 ||
    !Array.isArray(metadata.patch?.changes) ||
    metadata.patch.changes.length !== 2 ||
    !metadata.files ||
    typeof metadata.files !== "object" ||
    Array.isArray(metadata.files)
  ) {
    throw new Error(
      "Vendored npm metadata differs from the reviewed source and compatibility registration.",
    );
  }
  for (const [path, record] of Object.entries(metadata.files)) {
    assertSafeName(path);
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      typeof record.role !== "string" ||
      !/^[a-f0-9]{64}$/u.test(record.sha256)
    ) {
      throw new Error(`Invalid vendored npm file record: ${path}.`);
    }
  }
}

function checkedRoot(root) {
  if (typeof root !== "string" || root.length === 0) {
    throw new Error("Repository root is required.");
  }
  const path = resolve(root);
  const stats = lstatSync(path);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !samePath(path, realpathSync(path))
  ) {
    throw new Error(
      "Repository root must be a real directory without symlinks.",
    );
  }
  return path;
}

function checkedPath(root, path, kind) {
  assertRelativePath(path);
  let current = root;
  const segments = path.split("/");
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) {
      throw new Error(`Symlink is forbidden: ${path}.`);
    }
    const directory = index < segments.length - 1 || kind === "directory";
    if (directory ? !stats.isDirectory() : !stats.isFile()) {
      throw new Error(
        `Expected a regular ${directory ? "directory" : "file"}: ${path}.`,
      );
    }
  }
  const inside = relative(root, current);
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error(`Vendored npm path escapes its root: ${path}.`);
  }
  return current;
}

function assertRelativePath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    /[\\<>:"|?*]/u.test(path) ||
    isAbsolute(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe vendored npm relative path: ${path}.`);
  }
}

function assertSafeName(name) {
  assertRelativePath(name);
  if (name.includes("/")) {
    throw new Error(
      `Vendored npm package must contain only top-level files: ${name}.`,
    );
  }
}

function samePath(left, right) {
  const normalize = (path) =>
    process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  return normalize(left) === normalize(right);
}

function readJson(path) {
  return readJsonBytes(readFileSync(path), path);
}

function readJsonBytes(bytes, path) {
  try {
    return JSON.parse(decodeUtf8(bytes));
  } catch (error) {
    throw new Error(
      `${path} must contain strict UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}.`,
      { cause: error },
    );
  }
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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
