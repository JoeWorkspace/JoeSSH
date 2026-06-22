import { useCallback, useEffect, useState } from "react";
import type { SftpEntry } from "./ipc";
import { joinSftpRemoteEntryPath, normalizeSftpRemotePath, parentSftpRemotePath } from "./sftpRemotePath";

export type SftpListFn = (path: string) => Promise<SftpEntry[]>;

/// Join a POSIX-style directory path with a child name, collapsing the
/// trailing slash so the root (`/`) does not double up.
export function joinPath(dir: string, child: string): string | undefined {
  return joinSftpRemoteEntryPath(dir, child);
}

/// The parent of a POSIX-style path. The root (`/`) and empty are their own
/// parent (no-op going up past root).
export function parentPath(dir: string): string {
  return parentSftpRemotePath(dir);
}

export type SftpDirectoryStatus =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; entries: SftpEntry[] }
  | { phase: "error"; message: string };

/// Drives a remote SFTP directory listing. `list` is injected (the desktop
/// runtime passes a real `sftp_list`-backed loader); when `list` is undefined
/// the hook stays idle so the panel can show its static/demo fallback.
export function useSftpDirectory(list: SftpListFn | undefined, initialPath = ".") {
  const [path, setPath] = useState(() => normalizeSftpRemotePath(initialPath));
  const [status, setStatus] = useState<SftpDirectoryStatus>({ phase: "idle" });

  const load = useCallback(
    async (target: string) => {
      if (!list) return;
      const remotePath = normalizeSftpRemotePath(target);
      setStatus({ phase: "loading" });
      try {
        const entries = await list(remotePath);
        setStatus({ phase: "ready", entries });
      } catch (error) {
        setStatus({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    [list],
  );

  useEffect(() => {
    void load(path);
  }, [load, path]);

  const open = useCallback((next: string) => setPath(normalizeSftpRemotePath(next)), []);
  const openChild = useCallback((name: string) => setPath((current) => joinPath(current, name) ?? current), []);
  const goUp = useCallback(() => setPath((current) => parentPath(current)), []);
  const refresh = useCallback(() => void load(path), [load, path]);

  return { path, status, open, openChild, goUp, refresh, canGoUp: path !== "/" && path !== ".", active: list !== undefined };
}
