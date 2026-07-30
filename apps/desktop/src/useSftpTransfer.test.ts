// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSftpTransfer } from "./useSftpTransfer";

describe("useSftpTransfer", () => {
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
