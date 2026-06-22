// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSftpDirectory, joinPath, parentPath } from "./useSftpDirectory";
import { isSafeSftpEntryName, joinSftpRemoteEntryPath, joinSftpRemotePath, normalizeSftpRemotePath } from "./sftpRemotePath";

const entry = (name: string, is_dir = false) => ({ name, is_dir, size: is_dir ? null : 10 });

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

describe("useSftpDirectory", () => {
  it("stays idle and inactive when no list function is provided", () => {
    const { result } = renderHook(() => useSftpDirectory(undefined));
    expect(result.current.status).toEqual({ phase: "idle" });
    expect(result.current.path).toBe(".");
    expect(result.current.active).toBe(false);
  });

  it("defaults the live SFTP browser to the SSH login directory", async () => {
    const list = vi.fn().mockResolvedValue([entry("home.log")]);
    const { result } = renderHook(() => useSftpDirectory(list));

    await waitFor(() => expect(result.current.status.phase).toBe("ready"));
    expect(result.current.path).toBe(".");
    expect(result.current.canGoUp).toBe(false);
    expect(list).toHaveBeenCalledWith(".");
  });

  it("loads the initial directory on mount", async () => {
    const list = vi.fn().mockResolvedValue([entry("a.txt"), entry("logs", true)]);
    const { result } = renderHook(() => useSftpDirectory(list, "/srv"));

    await waitFor(() => expect(result.current.status.phase).toBe("ready"));
    expect(list).toHaveBeenCalledWith("/srv");
    expect(result.current.status).toEqual({ phase: "ready", entries: [entry("a.txt"), entry("logs", true)] });
    expect(result.current.active).toBe(true);
  });

  it("normalizes the initial directory before listing", async () => {
    const list = vi.fn().mockResolvedValue([entry("x")]);
    const { result } = renderHook(() => useSftpDirectory(list, "/srv//logs/"));

    await waitFor(() => expect(result.current.status.phase).toBe("ready"));
    expect(result.current.path).toBe("/srv/logs");
    expect(list).toHaveBeenCalledWith("/srv/logs");
  });

  it("captures listing errors", async () => {
    const list = vi.fn().mockRejectedValue(new Error("permission denied"));
    const { result } = renderHook(() => useSftpDirectory(list, "/root"));

    await waitFor(() => expect(result.current.status.phase).toBe("error"));
    expect(result.current.status).toEqual({ phase: "error", message: "permission denied" });
  });

  it("stringifies a non-Error rejection reason", async () => {
    const list = vi.fn().mockRejectedValue("raw failure");
    const { result } = renderHook(() => useSftpDirectory(list, "/root"));

    await waitFor(() => expect(result.current.status.phase).toBe("error"));
    expect(result.current.status).toEqual({ phase: "error", message: "raw failure" });
  });

  it("navigates to a new path and reloads", async () => {
    const list = vi.fn().mockResolvedValue([entry("x")]);
    const { result } = renderHook(() => useSftpDirectory(list, "/srv"));
    await waitFor(() => expect(result.current.status.phase).toBe("ready"));

    act(() => result.current.open("/srv/logs"));
    await waitFor(() => expect(result.current.path).toBe("/srv/logs"));
    expect(list).toHaveBeenLastCalledWith("/srv/logs");
  });

  it("keeps slow stale directory listings from overwriting the current path", async () => {
    const first = deferred<ReturnType<typeof entry>[]>();
    const second = deferred<ReturnType<typeof entry>[]>();
    const list = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSftpDirectory(list, "/srv"));

    await waitFor(() => expect(list).toHaveBeenCalledWith("/srv"));
    act(() => result.current.open("/srv/logs"));
    await waitFor(() => expect(list).toHaveBeenCalledWith("/srv/logs"));

    await act(async () => {
      second.resolve([entry("current.log")]);
      await second.promise;
    });
    await waitFor(() => expect(result.current.status).toEqual({ phase: "ready", entries: [entry("current.log")] }));

    await act(async () => {
      first.resolve([entry("stale.log")]);
      await first.promise;
    });

    expect(result.current.path).toBe("/srv/logs");
    expect(result.current.status).toEqual({ phase: "ready", entries: [entry("current.log")] });
  });

  it("normalizes opened paths before reloading", async () => {
    const list = vi.fn().mockResolvedValue([entry("x")]);
    const { result } = renderHook(() => useSftpDirectory(list, "/srv"));
    await waitFor(() => expect(result.current.status.phase).toBe("ready"));

    act(() => result.current.open("/srv//logs/./archive/"));
    await waitFor(() => expect(result.current.path).toBe("/srv/logs/archive"));
    expect(list).toHaveBeenLastCalledWith("/srv/logs/archive");
  });

  it("refresh re-lists the current path", async () => {
    const list = vi.fn().mockResolvedValue([entry("x")]);
    const { result } = renderHook(() => useSftpDirectory(list, "/srv"));
    await waitFor(() => expect(result.current.status.phase).toBe("ready"));
    list.mockClear();

    act(() => result.current.refresh());
    await waitFor(() => expect(list).toHaveBeenCalledWith("/srv"));
  });

  it("drills into a child directory and goes back up, with canGoUp at root", async () => {
    const list = vi.fn().mockResolvedValue([entry("logs", true)]);
    const { result } = renderHook(() => useSftpDirectory(list, "/srv"));
    await waitFor(() => expect(result.current.status.phase).toBe("ready"));
    expect(result.current.canGoUp).toBe(true);

    act(() => result.current.openChild("logs"));
    await waitFor(() => expect(result.current.path).toBe("/srv/logs"));
    expect(list).toHaveBeenLastCalledWith("/srv/logs");

    act(() => result.current.goUp());
    await waitFor(() => expect(result.current.path).toBe("/srv"));

    act(() => result.current.goUp());
    await waitFor(() => expect(result.current.path).toBe("/"));
    expect(result.current.canGoUp).toBe(false);
  });

  it("drills into a home-relative child directory and returns to login directory", async () => {
    const list = vi.fn().mockResolvedValue([entry("logs", true)]);
    const { result } = renderHook(() => useSftpDirectory(list));
    await waitFor(() => expect(result.current.status.phase).toBe("ready"));

    act(() => result.current.openChild("logs"));
    await waitFor(() => expect(result.current.path).toBe("logs"));
    expect(result.current.canGoUp).toBe(true);
    expect(list).toHaveBeenLastCalledWith("logs");

    act(() => result.current.goUp());
    await waitFor(() => expect(result.current.path).toBe("."));
    expect(result.current.canGoUp).toBe(false);
  });

  it("ignores unsafe remote child names from directory listings", async () => {
    const list = vi.fn().mockResolvedValue([entry("logs", true)]);
    const { result } = renderHook(() => useSftpDirectory(list, "/srv"));
    await waitFor(() => expect(result.current.status.phase).toBe("ready"));
    list.mockClear();

    act(() => result.current.openChild("../etc"));
    await waitFor(() => expect(result.current.path).toBe("/srv"));
    expect(list).not.toHaveBeenCalled();
  });
});

describe("sftp path helpers", () => {
  it("normalizeSftpRemotePath keeps stable POSIX remote paths", () => {
    expect(normalizeSftpRemotePath("/")).toBe("/");
    expect(normalizeSftpRemotePath("////")).toBe("/");
    expect(normalizeSftpRemotePath("/srv//logs/")).toBe("/srv/logs");
    expect(normalizeSftpRemotePath("/srv/./logs/../audit")).toBe("/srv/audit");
    expect(normalizeSftpRemotePath("/../../etc")).toBe("/etc");
    expect(normalizeSftpRemotePath("")).toBe(".");
    expect(normalizeSftpRemotePath(".")).toBe(".");
    expect(normalizeSftpRemotePath("srv/logs")).toBe("srv/logs");
  });

  it("joinPath collapses a trailing slash", () => {
    expect(joinPath("/srv", "logs")).toBe("/srv/logs");
    expect(joinPath("/srv/", "logs")).toBe("/srv/logs");
    expect(joinPath("/", "etc")).toBe("/etc");
    expect(joinPath(".", "logs")).toBe("logs");
  });

  it("joinSftpRemotePath builds stable file payload paths", () => {
    expect(joinSftpRemotePath("/", "file.txt")).toBe("/file.txt");
    expect(joinSftpRemotePath("/srv/", "file.txt")).toBe("/srv/file.txt");
    expect(joinSftpRemotePath("/srv//logs", "audit.log")).toBe("/srv/logs/audit.log");
    expect(joinSftpRemotePath("/srv", "")).toBe("/srv");
    expect(joinSftpRemotePath("/srv", "file name #1.txt")).toBe("/srv/file name #1.txt");
    expect(joinSftpRemotePath("/srv/logs/", "../archive/report.txt")).toBe("/srv/archive/report.txt");
    expect(joinSftpRemotePath(".", "file.txt")).toBe("file.txt");
    expect(joinSftpRemotePath("logs", "audit.log")).toBe("logs/audit.log");
    expect(joinSftpRemotePath("logs", "../audit.log")).toBe("audit.log");
  });

  it("validates SFTP listing entry names before using them as path segments", () => {
    expect(isSafeSftpEntryName("file name #1.txt")).toBe(true);
    expect(isSafeSftpEntryName("")).toBe(false);
    expect(isSafeSftpEntryName("   ")).toBe(false);
    expect(isSafeSftpEntryName(".")).toBe(false);
    expect(isSafeSftpEntryName("..")).toBe(false);
    expect(isSafeSftpEntryName("../archive")).toBe(false);
    expect(isSafeSftpEntryName("logs/archive")).toBe(false);
    expect(isSafeSftpEntryName("logs\\archive")).toBe(false);
    expect(isSafeSftpEntryName("bad\u0000name")).toBe(false);
    expect(isSafeSftpEntryName("safe\u202ename")).toBe(false);
  });

  it("joinSftpRemoteEntryPath refuses names that escape the current directory", () => {
    expect(joinSftpRemoteEntryPath("/srv", "file name #1.txt")).toBe("/srv/file name #1.txt");
    expect(joinSftpRemoteEntryPath(".", "file.txt")).toBe("file.txt");
    expect(joinSftpRemoteEntryPath("/srv", "../archive/report.txt")).toBeUndefined();
    expect(joinSftpRemoteEntryPath("/srv", "/etc/passwd")).toBeUndefined();
    expect(joinSftpRemoteEntryPath("/srv", "logs/archive")).toBeUndefined();
    expect(joinSftpRemoteEntryPath("/srv", "logs\\archive")).toBeUndefined();
    expect(joinSftpRemoteEntryPath("/srv", "\u202ehidden")).toBeUndefined();
  });

  it("parentPath walks up and stops at root or login directory", () => {
    expect(parentPath("/srv/logs")).toBe("/srv");
    expect(parentPath("/srv/logs/")).toBe("/srv");
    expect(parentPath("/srv")).toBe("/");
    expect(parentPath("/")).toBe("/");
    expect(parentPath("")).toBe(".");
    expect(parentPath(".")).toBe(".");
    expect(parentPath("logs/audit")).toBe("logs");
    expect(parentPath("logs")).toBe(".");
  });
});
