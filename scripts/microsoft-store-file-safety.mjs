import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

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
  if (!leftIdentity || !rightIdentity) return false;
  return (
    (leftIdentity.device === rightIdentity.device &&
      leftIdentity.inode === rightIdentity.inode) ||
    leftIdentity.realpath === rightIdentity.realpath
  );
}
