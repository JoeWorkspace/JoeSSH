import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, parse, relative, resolve, sep } from "node:path";

function existingFileIdentity(path) {
  try {
    const stat = statSync(path, { bigint: true });
    const realpath = realpathSync.native(path);
    return {
      device: stat.dev,
      inode: stat.ino,
      realpath:
        process.platform === "win32" ? realpath.toLowerCase() : realpath,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`unable to inspect existing file: ${path}`, {
      cause: error,
    });
  }
}

function caseInsensitiveExistingPath(path) {
  const absolutePath = resolve(path);
  const { root } = parse(absolutePath);
  const segments = relative(root, absolutePath).split(sep).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    let entries;
    try {
      entries = readdirSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }

    const exact = entries.find((entry) => entry === segment);
    if (exact) {
      current = join(current, exact);
      continue;
    }

    const matches = entries.filter(
      (entry) => entry.toLowerCase() === segment.toLowerCase(),
    );
    if (matches.length !== 1) return null;
    current = join(current, matches[0]);
  }

  return current;
}

export function sameExistingFile(leftPath, rightPath) {
  const left = resolve(leftPath);
  const right = resolve(rightPath);
  const normalizedLeft =
    process.platform === "win32" ? left.toLowerCase() : left;
  const normalizedRight =
    process.platform === "win32" ? right.toLowerCase() : right;
  if (normalizedLeft === normalizedRight) return true;

  const leftIdentity = existingFileIdentity(left);
  const rightIdentity = existingFileIdentity(right);
  if (
    leftIdentity &&
    rightIdentity &&
    ((leftIdentity.device === rightIdentity.device &&
      leftIdentity.inode === rightIdentity.inode) ||
      leftIdentity.realpath === rightIdentity.realpath)
  ) {
    return true;
  }

  // A Windows-style casing variant may not exist on a case-sensitive host.
  // Resolve both paths through the directory entries before creating output.
  if (!leftIdentity || !rightIdentity) {
    const leftCaseInsensitive = caseInsensitiveExistingPath(left);
    const rightCaseInsensitive = caseInsensitiveExistingPath(right);
    if (leftCaseInsensitive && rightCaseInsensitive) {
      return leftCaseInsensitive.toLowerCase() === rightCaseInsensitive.toLowerCase();
    }
  }

  return false;
}
