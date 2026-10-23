import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

// Anchor an explicitly selected checkout at its real location. Descendants
// must not redirect output through links, even when the link stays in the repo.
export function assertArtifactPath(root, path, kind = "file") {
  if (kind !== "file" && kind !== "directory") {
    throw new Error("Artifact path kind must be file or directory.");
  }
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(path);
  const descendant = relative(absoluteRoot, absolutePath);
  if (
    descendant === "" ||
    descendant === ".." ||
    descendant.startsWith(`..${sep}`) ||
    isAbsolute(descendant)
  ) {
    throw new Error(`Artifact path must stay below its checkout: ${path}`);
  }
  const canonicalRoot = realpathSync(absoluteRoot);
  if (!lstatSync(canonicalRoot).isDirectory()) {
    throw new Error("Artifact checkout must be a directory.");
  }
  const parts = descendant.split(sep);
  let current = absoluteRoot;
  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index]);
    let entry;
    try {
      entry = lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Artifact path must not contain a symbolic link or junction: ${current}`,
      );
    }
    const expected = resolve(canonicalRoot, ...parts.slice(0, index + 1));
    if (comparablePath(realpathSync(current)) !== comparablePath(expected)) {
      throw new Error(
        `Artifact path resolves outside its expected location: ${current}`,
      );
    }
    const directory = index < parts.length - 1 || kind === "directory";
    if (directory ? !entry.isDirectory() : !entry.isFile()) {
      throw new Error(
        `Artifact path must be a regular ${directory ? "directory" : "file"}: ${current}`,
      );
    }
    if (!directory && entry.nlink !== 1) {
      throw new Error(`Artifact file must not have hard links: ${current}`);
    }
  }
  return absolutePath;
}

export function ensureArtifactDirectory(root, path) {
  assertArtifactPath(root, path, "directory");
  mkdirSync(path, { recursive: true });
  assertArtifactPath(root, path, "directory");
}

export function writeArtifactFile(root, path, content, options) {
  assertArtifactPath(root, path);
  ensureArtifactDirectory(root, dirname(path));
  assertArtifactPath(root, path);
  writeFileSync(path, content, options);
}

function comparablePath(path) {
  return process.platform === "win32" ? path.toLowerCase() : path;
}
