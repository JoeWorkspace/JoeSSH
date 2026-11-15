import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, posix, relative, resolve } from "node:path";

export const sbomLockfiles = [
  "package-lock.json", "Cargo.lock", "apps/desktop/src-tauri/Cargo.lock",
];
export const sbomFileNames = [
  "npm-desktop-sbom.cdx.json", "npm-web-sbom.cdx.json",
  "cargo-metadata.json", "tauri-cargo-metadata.json",
];
export const bindingProperty = "joessh:lockfile-sha256";

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function lockfileBinding(root) {
  return Object.fromEntries(sbomLockfiles.map((file) => [file, sha256File(resolve(root, file))]));
}

export function bindSbom(document, root, kind) {
  const binding = lockfileBinding(root);
  if (kind === "npm") {
    document.metadata ??= {};
    document.metadata.properties = [
      ...(document.metadata.properties ?? []).filter((entry) => entry.name !== bindingProperty),
      { name: bindingProperty, value: JSON.stringify(binding) },
    ];
  } else {
    document.metadata ??= {};
    document.metadata.joesshLockfileSha256 = binding;
  }
  return document;
}

export function validateSbomBinding(document, root, kind) {
  let binding;
  if (kind === "npm") {
    const matches = (document.metadata?.properties ?? []).filter((entry) => entry.name === bindingProperty);
    if (matches.length !== 1) throw new Error("must include exactly one current lockfile binding");
    try { binding = JSON.parse(matches[0].value); } catch { throw new Error("has an invalid lockfile binding"); }
  } else {
    binding = document.metadata?.joesshLockfileSha256;
  }
  const expected = lockfileBinding(root);
  if (!binding || Object.keys(binding).length !== sbomLockfiles.length ||
      sbomLockfiles.some((file) => binding[file] !== expected[file])) {
    throw new Error("lockfile binding does not match the current release lockfiles");
  }
}

export function npmComponentName(component) {
  const purl = component.purl;
  if (typeof purl === "string" && purl.startsWith("pkg:npm/")) {
    const value = purl.slice("pkg:npm/".length).split("?")[0];
    const separator = value.lastIndexOf("@");
    if (separator > 0) {
      const version = decodeURIComponent(value.slice(separator + 1));
      if (version !== component.version) throw new Error("npm component purl version disagrees with its version");
      return decodeURIComponent(value.slice(0, separator));
    }
  }
  if (typeof component.name !== "string" || !component.name) throw new Error("npm component is missing a package name");
  return component.group ? `${component.group}/${component.name}` : component.name;
}

export function readNpmLock(root) {
  const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages || typeof lock.packages !== "object") {
    throw new Error("package-lock.json must contain a v2/v3 packages inventory");
  }
  return lock;
}

export function npmPackageName(location, entry) {
  return entry.name ?? location.split("node_modules/").at(-1);
}

export function npmWorkspaceInventory(root, workspace) {
  const lock = readNpmLock(root);
  const workspacePath = `apps/${workspace}`;
  if (!lock.packages[workspacePath]) throw new Error(`package-lock.json is missing ${workspacePath}`);
  const visited = new Set();
  const inventory = [];
  function visit(location) {
    const entry = lock.packages[location];
    if (!entry) throw new Error(`package-lock.json is missing resolved dependency ${location}`);
    if (entry.link) return visit(entry.resolved);
    if (visited.has(location)) return;
    visited.add(location);
    if (typeof entry.version !== "string") throw new Error(`package-lock.json package lacks version: ${location}`);
    const manifestPath = resolve(root, location, "package.json");
    const name = entry.name ?? (location.includes("node_modules/")
      ? npmPackageName(location, entry)
      : existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).name : undefined);
    if (!name) throw new Error(`package-lock.json package lacks name: ${location}`);
    inventory.push({ name, version: entry.version, location, ...entry });
    const dependencies = { ...entry.dependencies, ...entry.devDependencies, ...entry.optionalDependencies, ...entry.peerDependencies };
    for (const dependency of Object.keys(dependencies)) {
      let parent = location;
      let resolved;
      for (;;) {
        if (posix.basename(parent) !== "node_modules") {
          const candidate = posix.join(parent, "node_modules", dependency);
          if (lock.packages[candidate]) { resolved = candidate; break; }
        }
        if (!parent || parent === ".") break;
        parent = posix.dirname(parent);
        if (parent === ".") parent = "";
      }
      if (resolved) visit(resolved);
      else if (!Object.hasOwn(entry.optionalDependencies ?? {}, dependency) && !entry.peerDependenciesMeta?.[dependency]?.optional) {
        throw new Error(`package-lock.json cannot resolve ${dependency} from ${location}`);
      }
    }
  }
  visit(workspacePath);
  return inventory;
}

export function validateNpmInventory(document, root, workspace) {
  const locked = npmWorkspaceInventory(root, workspace);
  const expected = new Set(locked.map((entry) => `${entry.name}@${entry.version}`));
  const actual = new Set((document.components ?? []).map((entry) => {
    if (typeof entry.version !== "string" || !entry.version) throw new Error("npm component is missing its version");
    const name = npmComponentName(entry);
    const declared = (entry.licenses ?? []).map((license) => license.expression ?? license.license?.id ?? license.license?.name).filter(Boolean).join(" AND ");
    const lockedLicense = locked.find((pkg) => pkg.name === name && pkg.version === entry.version)?.license;
    if (lockedLicense && declared !== lockedLicense) throw new Error(`npm license declaration disagrees with lockfile for ${name}`);
    return `${name}@${entry.version}`;
  }));
  const missing = [...expected].filter((entry) => !actual.has(entry));
  const unexpected = [...actual].filter((entry) => !expected.has(entry));
  if (missing.length || unexpected.length) {
    throw new Error(`npm inventory differs from current workspace lock (missing: ${missing.join(", ") || "none"}; stale/unexpected: ${unexpected.join(", ") || "none"})`);
  }
}

export function cargoLockInventory(root, file) {
  const source = readFileSync(resolve(root, file), "utf8");
  const packages = source.split(/^\[\[package\]\]\s*$/m).slice(1).map((block) => {
    const field = (name) => block.match(new RegExp(`^${name} = "([^"\\r\\n]+)"$`, "m"))?.[1];
    const name = field("name");
    const version = field("version");
    if (!name || !version) throw new Error(`${file} has an invalid package entry`);
    return { name, version, source: field("source"), checksum: field("checksum") };
  });
  if (!packages.length) throw new Error(`${file} has no packages`);
  return packages;
}

export function validateCargoInventory(document, root, file) {
  const locked = cargoLockInventory(root, file);
  const key = (entry) => `${entry.name}@${entry.version}:${entry.source ?? "workspace"}`;
  const actual = new Set((document.packages ?? []).map(key));
  const missing = locked.filter((entry) => !actual.has(key(entry)));
  if (actual.size !== document.packages.length) throw new Error("Cargo inventory contains duplicate packages");
  for (const pkg of document.packages ?? []) {
    if (!locked.some((entry) => entry.name === pkg.name && entry.version === pkg.version &&
        (entry.source ?? null) === (pkg.source ?? null))) {
      throw new Error(`Cargo package ${pkg.name}@${pkg.version} does not match ${file}`);
    }
  }
  if (missing.length) throw new Error(`Cargo inventory omits current locked packages: ${missing.map(key).join(", ")}`);
}

export function assertReportOutput(root, output) {
  const path = resolve(root, output);
  const inside = relative(resolve(root, "reports"), path);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new Error("SBOM output must be a directory below reports/");
  const canonicalRoot = realpathSync(root);
  let current = path;
  while (current !== root) {
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (info) {
      if (info.isSymbolicLink()) throw new Error("SBOM output must not traverse symlinks or junctions");
      const resolved = relative(canonicalRoot, realpathSync(current));
      if (resolved.startsWith("..") || isAbsolute(resolved)) throw new Error("SBOM output escapes the repository");
    }
    const parent = dirname(current);
    if (parent === current) throw new Error("SBOM output escapes the repository");
    current = parent;
  }
  return path;
}

// Cargo metadata contains source/cache paths. Public material uses stable labels
// and must not publish local usernames or absolute checkout/cache paths.
export function sanitizeCargoMetadata(document, root) {
  const replacements = [[root.replaceAll("\\", "/"), "workspace:"]];
  for (const pkg of document.packages ?? []) {
    if (typeof pkg.manifest_path === "string") {
      replacements.push([dirname(pkg.manifest_path).replaceAll("\\", "/"), `crate:${pkg.name}@${pkg.version}`]);
    }
  }
  replacements.sort((a, b) => b[0].length - a[0].length);
  const visit = (value, key) => {
    if (["target_directory", "build_directory"].includes(key)) return "build-output:";
    if (typeof value === "string") {
      let result = value.replaceAll("\\", "/");
      for (const [from, to] of replacements) result = result.replaceAll(from, to);
      return result;
    }
    if (Array.isArray(value)) return value.map((entry) => visit(entry));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, visit(entry, name)]));
    return value;
  };
  return visit(document);
}
