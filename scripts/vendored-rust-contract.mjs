import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const registrySource = "registry+https://github.com/rust-lang/crates.io-index";
const metadataFile = "JOESSH-PATCH.json";

// This reviewed registration is independent of the editable vendor metadata.
// Updating a backport requires reviewing this pin as well as the complete tree.
const registrations = Object.freeze([
  Object.freeze({
    name: "glib",
    version: "0.18.5",
    path: "vendor/glib-0.18.5",
    metadataSha256:
      "faf446bb4c7457d8f202bab947f9fb300e7570abfc49b39ade29cac28748841e",
    archiveUrl: "https://static.crates.io/crates/glib/glib-0.18.5.crate",
    archiveSha256:
      "233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5",
    repository: "https://github.com/gtk-rs/gtk-rs-core",
    upstreamCommit: "42b9caf98e03ded086362d9653ca58fe94dc8658",
    advisory: "RUSTSEC-2024-0429",
    patchUrl: "https://github.com/gtk-rs/gtk-rs-core/pull/1343",
    patchCommit: "b5a4071e439bef2b5eea76c3aa25e5ae84839e34",
    mergeCommit: "05dff0ee696f9bcd8617cd48c4b812d046d440cb",
    patchPath: "src/variant_iter.rs",
    originalSha256:
      "1fd02859333761c45321b32f28b24233446b97d0022a90d3a937ed162585b90e",
    patchedSha256:
      "a0f5ee8acb8faa089bcdfbc9a57372609fce7654026ccef7d9a224d05a654ccc",
    declaredLicense: "MIT",
    authors: Object.freeze(["The gtk-rs Project Developers"]),
    licenseFiles: Object.freeze(["LICENSE", "COPYRIGHT"]),
    metadataFileCount: 121,
    additionalFiles: Object.freeze(["tests/variant_str_iter.rs"]),
    patchedAdvisories: Object.freeze(["RUSTSEC-2024-0429"]),
    patchKind: "glib-official-backport",
  }),
  Object.freeze({
    name: "tauri",
    version: "2.11.2",
    path: "vendor/tauri-2.11.2",
    metadataSha256:
      "8cbe92763bc72047cf23cb051b4ee42043e68843f383e6fa5acb1e1d86fc2d97",
    archiveUrl: "https://static.crates.io/crates/tauri/tauri-2.11.2.crate",
    archiveSha256:
      "437404997acf375d85f1177afa7e11bb971f274ed6a7b83a2a3e339015f4cc28",
    repository: "https://github.com/tauri-apps/tauri",
    upstreamCommit: "499df79be65ef8c0670abc0207cd9e37b55d8491",
    issueUrl: "https://github.com/tauri-apps/tauri/issues/14935",
    patchRationale:
      "Disable the unused Windows self-relaunch implementation for the Microsoft Store build while retaining upstream behavior on other platforms.",
    patchPath: "src/process.rs",
    originalSha256:
      "9c413b0b6b74df553028f826ee0bc60164db533dceb96d79bf6c47b6358aa8ba",
    patchedSha256:
      "53ac553ccfe1d0bc2f829da559e3d4a8193945e01e247306f377e1f8aa3cf609",
    declaredLicense: "Apache-2.0 OR MIT",
    authors: Object.freeze(["Tauri Programme within The Commons Conservancy"]),
    licenseFiles: Object.freeze(["LICENSE_APACHE-2.0", "LICENSE_MIT"]),
    metadataFileCount: 142,
    additionalFiles: Object.freeze([]),
    patchedAdvisories: Object.freeze([]),
    patchKind: "tauri-store-compatibility",
  }),
]);

const firstPartyManifests = Object.freeze({
  "atlasterm-core": "crates/core/Cargo.toml",
  "atlasterm-sync": "services/sync/Cargo.toml",
  "atlasterm-desktop-shell": "apps/desktop/src-tauri/Cargo.toml",
});

/** Verify every registered package and reject undeclared vendor directories. */
export function verifyVendoredRustPackages(root) {
  const rootPath = checkedRoot(root);
  const vendorPath = checkedPath(rootPath, "vendor", "directory");
  const expected = registrations.map((entry) =>
    entry.path.slice("vendor/".length),
  );
  const entries = readdirSync(vendorPath).sort();
  if (JSON.stringify(entries) !== JSON.stringify(expected.sort())) {
    throw new Error(
      "Vendor directory contains missing or unregistered entries.",
    );
  }
  return registrations.map(({ name, version }) =>
    verifyVendoredRustPackage(rootPath, { name, version }),
  );
}

/**
 * Verify a registered path dependency. manifestPath, when supplied, must be its
 * real Cargo metadata path. Omitting it supports verification of public SBOMs.
 */
export function verifyVendoredRustPackage(
  root,
  { name, version, manifestPath } = {},
) {
  const registration = registrations.find(
    (entry) => entry.name === name && entry.version === version,
  );
  if (!registration) {
    throw new Error(`Unregistered vendored Rust package: ${name}@${version}.`);
  }
  const rootPath = checkedRoot(root);
  const directory = checkedPath(rootPath, registration.path, "directory");
  const expectedManifest = checkedPath(directory, "Cargo.toml", "file");
  if (
    manifestPath !== undefined &&
    !manifestMatches(manifestPath, expectedManifest)
  ) {
    throw new Error(
      `${name}@${version} manifest_path does not match its registration.`,
    );
  }
  const metadataBytes = readFileSync(
    checkedPath(directory, metadataFile, "file"),
  );
  const metadataSha256 = sha256(metadataBytes);
  if (metadataSha256 !== registration.metadataSha256) {
    throw new Error(
      `${name}@${version} metadata does not match its reviewed SHA-256.`,
    );
  }
  const metadata = JSON.parse(decodeUtf8(metadataBytes));
  assertRegisteredMetadata(metadata, registration);

  const expected = new Map(Object.entries(metadata.files));
  for (const entry of metadata.patch.files) {
    expected.set(entry.path, entry.patchedSha256);
  }
  for (const [path, hash] of Object.entries(metadata.additionalFiles)) {
    if (expected.has(path))
      throw new Error(`Duplicate vendor file registration: ${path}.`);
    expected.set(path, hash);
  }
  expected.set(metadataFile, metadataSha256);
  const directories = new Set();
  for (const [path, hash] of expected) {
    assertRelativePath(path);
    if (!/^[a-f0-9]{64}$/.test(hash))
      throw new Error(`Invalid vendor hash for ${path}.`);
    let parent = dirname(path).replaceAll("\\", "/");
    while (parent !== ".") {
      directories.add(parent);
      parent = dirname(parent).replaceAll("\\", "/");
    }
  }
  const actual = new Map();
  inspectTree(directory, "", expected, directories, actual);
  for (const [path, hash] of expected) {
    if (!actual.has(path)) throw new Error(`Missing vendor file: ${path}.`);
    if (actual.get(path) !== hash)
      throw new Error(`Vendor file SHA-256 mismatch: ${path}.`);
  }
  assertReviewedPatch(directory, registration);
  const treeSha256 = sha256(
    [...actual.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([path, hash]) => `${path}\0${hash}\n`)
      .join(""),
  );
  return deepFreeze({
    name,
    version,
    directory,
    metadata,
    metadataSha256,
    treeSha256,
    declaredLicense: registration.declaredLicense,
    authors: [...registration.authors],
    repository: registration.repository,
    fileHashes: Object.fromEntries(actual),
    registryPackage: {
      name,
      version,
      source: registrySource,
      checksum: registration.archiveSha256,
    },
    // Project the package back into registry auditing so path dependencies never
    // hide later advisories. Only explicitly registered official backports may
    // account for an unchanged upstream advisory.
    patchedAdvisories: [...registration.patchedAdvisories],
  });
}

/** Known cross-workspace members also need an exact first-party manifest path. */
export function isFirstPartyCargoPackage(packageEntry, { root } = {}) {
  if (packageEntry?.source !== null || typeof root !== "string") return false;
  const path = firstPartyManifests[packageEntry?.name];
  if (!path || typeof packageEntry.manifest_path !== "string") return false;
  try {
    const rootPath = checkedRoot(root);
    const expected = checkedPath(rootPath, path, "file");
    return manifestMatches(packageEntry.manifest_path, expected);
  } catch {
    return false;
  }
}

function assertRegisteredMetadata(metadata, entry) {
  const patch = metadata.patch?.files;
  if (
    metadata.schemaVersion !== 1 ||
    metadata.name !== entry.name ||
    metadata.version !== entry.version ||
    metadata.path !== entry.path ||
    metadata.upstream?.archiveUrl !== entry.archiveUrl ||
    metadata.upstream?.sha256 !== entry.archiveSha256 ||
    metadata.upstream?.repository !== entry.repository ||
    metadata.upstream?.gitCommit !== entry.upstreamCommit ||
    !Array.isArray(patch) ||
    patch.length !== 1 ||
    patch[0].path !== entry.patchPath ||
    patch[0].originalSha256 !== entry.originalSha256 ||
    patch[0].patchedSha256 !== entry.patchedSha256 ||
    metadata.files?.[entry.patchPath] !== entry.originalSha256 ||
    Object.keys(metadata.files ?? {}).length !== entry.metadataFileCount ||
    JSON.stringify(Object.keys(metadata.additionalFiles ?? {}).sort()) !==
      JSON.stringify([...entry.additionalFiles].sort()) ||
    JSON.stringify(metadata.licenseFiles) !== JSON.stringify(entry.licenseFiles)
  ) {
    throw new Error(
      "Vendor metadata differs from the fixed upstream/patch/license registration.",
    );
  }
  if (
    entry.patchKind === "glib-official-backport" &&
    (metadata.patch?.advisory !== entry.advisory ||
      metadata.patch?.url !== entry.patchUrl ||
      metadata.patch?.commit !== entry.patchCommit ||
      metadata.patch?.mergeCommit !== entry.mergeCommit)
  ) {
    throw new Error(
      "GLib metadata differs from the official backport registration.",
    );
  }
  if (
    entry.patchKind === "tauri-store-compatibility" &&
    (metadata.patch?.kind !== "project-compatibility" ||
      metadata.patch?.upstreamIssue !== entry.issueUrl ||
      metadata.patch?.rationale !== entry.patchRationale)
  ) {
    throw new Error(
      "Tauri metadata differs from the Store compatibility registration.",
    );
  }
}

function assertReviewedPatch(directory, registration) {
  let original = decodeUtf8(
    readFileSync(checkedPath(directory, registration.patchPath, "file")),
  );
  if (registration.patchKind === "glib-official-backport") {
    original = replaceExactlyOnce(
      original,
      "let mut p: *mut libc::c_char = std::ptr::null_mut();",
      "let p: *mut libc::c_char = std::ptr::null_mut();",
    );
    original = replaceExactlyOnce(
      original,
      "                &mut p,",
      "                &p,",
    );
  } else if (registration.patchKind === "tauri-store-compatibility") {
    const patched = `pub fn restart(env: &Env) -> ! {
  #[cfg(target_os = "windows")]
  {
    // JoeSSH never exposes or calls the restart API. A packaged Microsoft
    // Store desktop binary must not retain Tauri's otherwise-unused local
    // process-launch implementation because it imports CreateProcessW and is
    // rejected by WACK's blocked executable test. Preserve the API contract
    // as a clean exit if an upstream path unexpectedly requests a restart.
    let _ = env;
    log::warn!("self-relaunch is disabled in the JoeSSH Microsoft Store build");
    std::process::exit(0);
  }

  #[cfg(not(target_os = "windows"))]
  {
    use std::process::{exit, Command};

    if let Ok(path) = current_binary(env) {
      // on macOS on updates the binary name might have changed
      // so we'll read the Contents/Info.plist file to determine the binary path
      #[cfg(target_os = "macos")]
      restart_macos_app(&path, env);

      if let Err(e) = Command::new(path).args(env.args_os.iter().skip(1)).spawn() {
        log::error!("failed to restart app: {e}");
      }
    }

    exit(0);
  }
}`;
    const upstream = `pub fn restart(env: &Env) -> ! {
  use std::process::{exit, Command};

  if let Ok(path) = current_binary(env) {
    // on macOS on updates the binary name might have changed
    // so we'll read the Contents/Info.plist file to determine the binary path
    #[cfg(target_os = "macos")]
    restart_macos_app(&path, env);

    if let Err(e) = Command::new(path).args(env.args_os.iter().skip(1)).spawn() {
      log::error!("failed to restart app: {e}");
    }
  }

  exit(0);
}`;
    original = replaceExactlyOnce(original, patched, upstream);
  } else {
    throw new Error(
      `Unknown reviewed vendor patch kind: ${registration.patchKind}.`,
    );
  }
  if (sha256(original) !== registration.originalSha256) {
    throw new Error(
      `Vendored ${registration.name} changes do not reconstruct the pinned upstream source.`,
    );
  }
}

function replaceExactlyOnce(text, before, after) {
  const index = text.indexOf(before);
  if (index < 0 || index !== text.lastIndexOf(before)) {
    throw new Error("Reviewed vendor patch must occur exactly once.");
  }
  return text.replace(before, after);
}

function inspectTree(root, prefix, expected, directories, actual) {
  for (const name of readdirSync(join(root, prefix))) {
    const path = prefix ? `${prefix}/${name}` : name;
    assertRelativePath(path);
    const absolute = join(root, ...path.split("/"));
    const stats = lstatSync(absolute);
    if (stats.isSymbolicLink())
      throw new Error(`Vendor symlink is forbidden: ${path}.`);
    if (stats.isDirectory()) {
      if (!directories.has(path))
        throw new Error(`Unexpected vendor directory: ${path}.`);
      inspectTree(root, path, expected, directories, actual);
    } else if (stats.isFile()) {
      if (!expected.has(path))
        throw new Error(`Unexpected vendor file: ${path}.`);
      actual.set(path, sha256(readFileSync(absolute)));
    } else {
      throw new Error(
        `Vendor entry must be a regular file or directory: ${path}.`,
      );
    }
  }
}

function checkedRoot(root) {
  if (typeof root !== "string" || root.length === 0)
    throw new Error("Repository root is required.");
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
    if (stats.isSymbolicLink())
      throw new Error(`Symlink is forbidden: ${path}.`);
    const directory = index < segments.length - 1 || kind === "directory";
    if (directory ? !stats.isDirectory() : !stats.isFile()) {
      throw new Error(
        `Expected a regular ${directory ? "directory" : "file"}: ${path}.`,
      );
    }
  }
  const inside = relative(root, current);
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error(`Vendor path escapes its root: ${path}.`);
  }
  return current;
}

function assertRelativePath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    /[\\<>:"|?*]/.test(path) ||
    [...path].some((character) => character.charCodeAt(0) < 32) ||
    isAbsolute(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe vendor relative path: ${path}.`);
  }
}

function samePath(left, right) {
  const normalize = (path) =>
    process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  return normalize(left) === normalize(right);
}

function manifestMatches(path, expected) {
  return (
    typeof path === "string" &&
    isAbsolute(path) &&
    !path.split(/[\\/]+/).some((part) => part === "." || part === "..") &&
    samePath(path, expected)
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
