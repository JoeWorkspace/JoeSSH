const ROOT = "/";
const HOME = ".";
const UNSAFE_ENTRY_NAME_PATTERN = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x061c, 0x061c],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
] as const;

/// Normalize a POSIX-style SFTP remote path without introducing host OS path
/// behavior. Absolute paths stay rooted at `/`; relative paths stay
/// home-relative so the initial SFTP view can open the SSH login directory.
export function normalizeSftpRemotePath(path: string): string {
  const trimmed = path.trim();
  const absolute = trimmed.startsWith(ROOT);
  const parts: string[] = [];

  for (const segment of trimmed.split(ROOT)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }

  if (absolute) return parts.length > 0 ? `${ROOT}${parts.join(ROOT)}` : ROOT;
  return parts.length > 0 ? parts.join(ROOT) : HOME;
}

/// Join a remote directory and child path using POSIX SFTP semantics, avoiding
/// `//file` at root and collapsing repeated/trailing separators.
export function joinSftpRemotePath(dir: string, child: string): string {
  const base = normalizeSftpRemotePath(dir);
  if (child === "") return base;
  if (base === ROOT) return normalizeSftpRemotePath(`${ROOT}${child}`);
  if (base === HOME) return normalizeSftpRemotePath(child);
  return normalizeSftpRemotePath(`${base}${ROOT}${child}`);
}

/// SFTP directory listings come from an untrusted remote endpoint. Treat entry
/// names as single path segments before using them for navigation or transfer.
export function isSafeSftpEntryName(name: string): boolean {
  return name.trim() !== "" && name !== "." && name !== ".." && !hasUnsafeSftpEntryNameChar(name);
}

/// Join a directory with a remote listing entry name. Returns undefined rather
/// than normalizing traversal into another directory context.
export function joinSftpRemoteEntryPath(dir: string, entryName: string): string | undefined {
  return isSafeSftpEntryName(entryName) ? joinSftpRemotePath(dir, entryName) : undefined;
}

function hasUnsafeSftpEntryNameChar(name: string): boolean {
  for (const char of name) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (char === ROOT || char === "\\") {
      return true;
    }
    if (UNSAFE_ENTRY_NAME_PATTERN.some(([start, end]) => codePoint >= start && codePoint <= end)) {
      return true;
    }
  }
  return false;
}

/// The parent of a POSIX-style remote path. It will not walk past `/` for
/// absolute paths or `.` for home-relative paths.
export function parentSftpRemotePath(path: string): string {
  const normalized = normalizeSftpRemotePath(path);
  if (normalized === ROOT || normalized === HOME) return normalized;

  const slash = normalized.lastIndexOf(ROOT);
  if (!normalized.startsWith(ROOT) && slash < 0) return HOME;
  if (slash === 0) return ROOT;
  return normalized.slice(0, slash);
}
