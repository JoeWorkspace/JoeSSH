// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSftpTransfer } from "./useSftpTransfer";

describe("useSftpTransfer", () => {
  it("keeps the first download when another transfer starts before it settles", async () => {
    let resolveRead: (bytes: number[]) => void = () => {};
    const read = vi.fn(
      () => new Promise<number[]>((resolve) => {
        resolveRead = resolve;
      }),
    );
    const write = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSftpTransfer(read, write));
    let first: Promise<number[] | undefined> = Promise.resolve(undefined);
    await act(async () => {
      first = result.current.download("/first");
      expect(await result.current.download("/second")).toBeUndefined();
      expect(await result.current.upload("/upload", [4])).toBe(false);
      result.current.rejectTooLarge();
    });
    expect(result.current.status).toEqual({ phase: "transferring" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();

    await act(async () => {
      resolveRead([1, 2, 3]);
      expect(await first).toEqual([1, 2, 3]);
    });
    expect(result.current.status).toEqual({ phase: "idle" });
    await act(async () => {
      expect(await result.current.upload("/upload", [4])).toBe(true);
    });
  });

  it("preserves a successful upload when a second transfer is attempted", async () => {
    let resolveWrite: () => void = () => {};
    const read = vi.fn().mockResolvedValue([9]);
    const write = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
    );
    const { result } = renderHook(() => useSftpTransfer(read, write));
    let first: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      first = result.current.upload("/first", [1]);
      expect(await result.current.download("/download")).toBeUndefined();
      expect(await result.current.upload("/second", [2])).toBe(false);
    });
    expect(result.current.status).toEqual({ phase: "transferring" });
    expect(read).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveWrite();
      expect(await first).toBe(true);
    });
    expect(result.current.status).toEqual({ phase: "idle" });
  });

  it("is inactive and no-ops when no IPC is wired", async () => {
    const { result } = renderHook(() => useSftpTransfer());
    expect(result.current.active).toBe(false);

    let bytes: number[] | undefined = [9];
    await act(async () => {
      bytes = await result.current.download("/p");
    });
    expect(bytes).toBeUndefined();

    let ok = true;
    await act(async () => {
      ok = await result.current.upload("/p", [1]);
    });
    expect(ok).toBe(false);
    expect(result.current.status).toEqual({ phase: "idle" });
  });

  it("downloads bytes and returns to idle", async () => {
    const read = vi.fn().mockResolvedValue([1, 2, 3]);
    const write = vi.fn();
    const { result } = renderHook(() => useSftpTransfer(read, write));
    expect(result.current.active).toBe(true);

    let bytes: number[] | undefined;
    await act(async () => {
      bytes = await result.current.download("/srv/a");
    });
    expect(bytes).toEqual([1, 2, 3]);
    expect(read).toHaveBeenCalledWith("/srv/a");
    expect(result.current.status).toEqual({ phase: "idle" });
  });

  it("rejects downloads with known sizes over the transfer limit before reading", async () => {
    const read = vi.fn().mockResolvedValue([1, 2, 3]);
    const write = vi.fn();
    const { result } = renderHook(() =>
      useSftpTransfer(read, write, {
        limitMessage: (limit) => `too large: ${limit}`,
        maxBytes: 2,
      }),
    );

    let bytes: number[] | undefined = [0];
    await act(async () => {
      bytes = await result.current.download("/srv/huge.tar", {
        knownSizeBytes: 3,
      });
    });

    expect(bytes).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({
      phase: "error",
      message: "too large: 2",
    });
  });

  it("rejects downloaded payloads over the transfer limit", async () => {
    const read = vi.fn().mockResolvedValue([1, 2, 3]);
    const write = vi.fn();
    const { result } = renderHook(() =>
      useSftpTransfer(read, write, {
        limitMessage: (limit) => `too large: ${limit}`,
        maxBytes: 2,
      }),
    );

    let bytes: number[] | undefined = [0];
    await act(async () => {
      bytes = await result.current.download("/srv/huge.tar");
    });

    expect(bytes).toBeUndefined();
    expect(read).toHaveBeenCalledWith("/srv/huge.tar");
    expect(result.current.status).toEqual({
      phase: "error",
      message: "too large: 2",
    });
  });

  it("uploads bytes and returns true", async () => {
    const read = vi.fn();
    const write = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSftpTransfer(read, write));

    let ok = false;
    await act(async () => {
      ok = await result.current.upload("/srv/b", [4, 5]);
    });
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledWith("/srv/b", [4, 5]);
  });

  it("rejects upload payloads over the transfer limit before writing", async () => {
    const read = vi.fn();
    const write = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSftpTransfer(read, write, {
        limitMessage: (limit) => `too large: ${limit}`,
        maxBytes: 2,
      }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.upload("/srv/b", [4, 5, 6]);
    });

    expect(ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({
      phase: "error",
      message: "too large: 2",
    });
  });

  it("records a download error (non-Error reason stringified)", async () => {
    const read = vi.fn().mockRejectedValue("read boom");
    const write = vi.fn();
    const { result } = renderHook(() => useSftpTransfer(read, write));

    let bytes: number[] | undefined = [0];
    await act(async () => {
      bytes = await result.current.download("/p");
    });
    expect(bytes).toBeUndefined();
    expect(result.current.status).toEqual({
      phase: "error",
      message: "read boom",
    });
  });

  it("records an upload error", async () => {
    const read = vi.fn();
    const write = vi.fn().mockRejectedValue(new Error("disk full"));
    const { result } = renderHook(() => useSftpTransfer(read, write));

    let ok = true;
    await act(async () => {
      ok = await result.current.upload("/p", [1]);
    });
    expect(ok).toBe(false);
    expect(result.current.status).toEqual({
      phase: "error",
      message: "disk full",
    });
  });

  it("ignores a stale download result after the active backend changes", async () => {
    let resolveOldRead: (bytes: number[]) => void = () => {};
    const oldRead = vi.fn(
      () =>
        new Promise<number[]>((resolve) => {
          resolveOldRead = resolve;
        }),
    );
    const newRead = vi.fn().mockResolvedValue([9]);
    const oldWrite = vi.fn();
    const newWrite = vi.fn();
    const { result, rerender } = renderHook(
      ({ read, write }) => useSftpTransfer(read, write),
      { initialProps: { read: oldRead, write: oldWrite } },
    );

    let staleDownload: Promise<number[] | undefined> =
      Promise.resolve(undefined);
    act(() => {
      staleDownload = result.current.download("/old/secret");
    });
    rerender({ read: newRead, write: newWrite });

    let staleBytes: number[] | undefined = [1];
    await act(async () => {
      resolveOldRead([1, 2, 3]);
      staleBytes = await staleDownload;
    });

    expect(staleBytes).toBeUndefined();
    expect(result.current.status).toEqual({ phase: "idle" });
  });

  it("keeps a replacement backend busy when an old transfer settles", async () => {
    let resolveOld: (bytes: number[]) => void = () => {};
    let resolveNew: (bytes: number[]) => void = () => {};
    const oldRead = vi.fn(
      () => new Promise<number[]>((resolve) => {
        resolveOld = resolve;
      }),
    );
    const newRead = vi.fn(
      () => new Promise<number[]>((resolve) => {
        resolveNew = resolve;
      }),
    );
    const write = vi.fn();
    const { result, rerender } = renderHook(
      ({ read }) => useSftpTransfer(read, write),
      { initialProps: { read: oldRead } },
    );
    let oldDownload: Promise<number[] | undefined> = Promise.resolve(undefined);
    let newDownload: Promise<number[] | undefined> = Promise.resolve(undefined);
    act(() => {
      oldDownload = result.current.download("/old");
    });
    rerender({ read: newRead });
    act(() => {
      newDownload = result.current.download("/new");
    });
    await act(async () => {
      resolveOld([1]);
      expect(await oldDownload).toBeUndefined();
      expect(await result.current.download("/duplicate")).toBeUndefined();
    });
    expect(result.current.status).toEqual({ phase: "transferring" });
    expect(newRead.mock.calls).toEqual([["/new"]]);
    await act(async () => {
      resolveNew([2]);
      expect(await newDownload).toEqual([2]);
    });
    expect(result.current.status).toEqual({ phase: "idle" });
  });

  it("ignores a stale upload completion after the active backend changes", async () => {
    let resolveOldWrite: () => void = () => {};
    const oldWrite = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOldWrite = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ read, write }) => useSftpTransfer(read, write),
      {
        initialProps: {
          read: vi.fn().mockResolvedValue([]),
          write: oldWrite,
        },
      },
    );

    let staleUpload: Promise<boolean> = Promise.resolve(true);
    act(() => {
      staleUpload = result.current.upload("/old/file", [1]);
    });
    rerender({
      read: vi.fn().mockResolvedValue([]),
      write: vi.fn().mockResolvedValue(undefined),
    });

    let completed = true;
    await act(async () => {
      resolveOldWrite();
      completed = await staleUpload;
    });

    expect(completed).toBe(false);
    expect(result.current.status).toEqual({ phase: "idle" });
  });
});
