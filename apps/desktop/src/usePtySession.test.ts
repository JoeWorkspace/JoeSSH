// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePtySession, type PtyDeps } from "./usePtySession";

function makeDeps(overrides: Partial<PtyDeps> = {}) {
  const unlisten = vi.fn();
  let dataSink: (b: number[]) => void = () => {};
  let exitSink: (c: number) => void = () => {};
  const deps: PtyDeps = {
    open: vi.fn().mockResolvedValue("pty-1"),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(async (_id, onData, onExit) => {
      dataSink = onData;
      exitSink = onExit;
      return unlisten;
    }),
    ...overrides,
  };
  return {
    deps,
    unlisten,
    emitData: (b: number[]) => dataSink(b),
    emitExit: (c: number) => exitSink(c),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("usePtySession", () => {
  it("is inactive and does nothing when deps is undefined", async () => {
    const { result } = renderHook(() => usePtySession(undefined, () => {}));
    expect(result.current.active).toBe(false);
    await act(async () => {
      await result.current.open(80, 24);
    });
    expect(result.current.status).toBe("idle");
  });

  it("opens, subscribes, and pipes output bytes to the sink", async () => {
    const onData = vi.fn();
    const { deps, emitData } = makeDeps();
    const { result } = renderHook(() => usePtySession(deps, onData));

    await act(async () => {
      await result.current.open(80, 24);
    });
    expect(deps.open).toHaveBeenCalledWith(80, 24);
    expect(result.current.status).toBe("open");

    act(() => emitData([104, 105]));
    expect(onData).toHaveBeenCalledWith([104, 105]);
  });

  it("forwards write and resize to the open pty", async () => {
    const { deps } = makeDeps();
    const { result } = renderHook(() => usePtySession(deps, () => {}));
    await act(async () => {
      await result.current.open(80, 24);
    });

    act(() => result.current.write([97]));
    expect(deps.write).toHaveBeenCalledWith("pty-1", [97]);
    act(() => result.current.resize(120, 40));
    expect(deps.resize).toHaveBeenCalledWith("pty-1", 120, 40);
  });

  it("surfaces native PTY command blocks and clears them after a safe write", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(
        "pty input blocked by desktop safety policy: rm -rf /",
      )
      .mockResolvedValueOnce(undefined);
    const { deps } = makeDeps({ write });
    const { result } = renderHook(() => usePtySession(deps, () => {}));
    await act(async () => {
      await result.current.open(80, 24);
    });

    act(() => result.current.write([114, 109, 10]));
    await waitFor(() => expect(result.current.blockedReason).toBe("rm -rf /"));
    expect(result.current.status).toBe("open");

    act(() => result.current.write([108, 115, 10]));
    await waitFor(() => expect(result.current.blockedReason).toBeNull());
    expect(result.current.status).toBe("open");
  });

  it("keeps stale PTY command block errors from replacing a newer session state", async () => {
    const writeFailure = deferred<void>();
    const first = makeDeps({
      open: vi.fn().mockResolvedValue("pty-old"),
      write: vi.fn(() => writeFailure.promise),
    });
    const second = makeDeps({ open: vi.fn().mockResolvedValue("pty-new") });
    const { result, rerender } = renderHook(
      ({ deps }) => usePtySession(deps, () => {}),
      { initialProps: { deps: first.deps as PtyDeps | undefined } },
    );
    await act(async () => {
      await result.current.open(80, 24);
    });

    act(() => result.current.write([114, 109, 10]));
    rerender({ deps: second.deps });
    await waitFor(() => expect(result.current.status).toBe("idle"));

    await act(async () => {
      writeFailure.reject(
        "pty input blocked by desktop safety policy: rm -rf /",
      );
      await writeFailure.promise.catch(() => undefined);
    });

    expect(result.current.blockedReason).toBeNull();
  });

  it("moves to closed when the pty emits exit", async () => {
    const { deps, emitExit } = makeDeps();
    const { result } = renderHook(() => usePtySession(deps, () => {}));
    await act(async () => {
      await result.current.open(80, 24);
    });

    act(() => emitExit(0));
    await waitFor(() => expect(result.current.status).toBe("closed"));
    expect(result.current.exitCode).toBe(0);
  });

  it("clears refs on exit so a terminal can be reopened", async () => {
    const { deps, emitExit } = makeDeps();
    const { result } = renderHook(() => usePtySession(deps, () => {}));
    await act(async () => {
      await result.current.open(80, 24);
    });

    act(() => emitExit(0));
    await waitFor(() => expect(result.current.status).toBe("closed"));

    await act(async () => {
      await result.current.open(100, 30);
    });
    expect(deps.open).toHaveBeenCalledTimes(2);
    expect(deps.open).toHaveBeenLastCalledWith(100, 30);
    expect(result.current.status).toBe("open");
  });

  it("close unlistens and closes the pty", async () => {
    const { deps, unlisten } = makeDeps();
    const { result } = renderHook(() => usePtySession(deps, () => {}));
    await act(async () => {
      await result.current.open(80, 24);
    });

    act(() => result.current.close());
    expect(unlisten).toHaveBeenCalled();
    expect(deps.close).toHaveBeenCalledWith("pty-1");
    expect(result.current.status).toBe("closed");
    // write after close is a no-op (no pty id)
    act(() => result.current.write([1]));
    expect((deps.write as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("does not re-open when already open", async () => {
    const { deps } = makeDeps();
    const { result } = renderHook(() => usePtySession(deps, () => {}));
    await act(async () => {
      await result.current.open(80, 24);
    });
    await act(async () => {
      await result.current.open(80, 24);
    });
    expect((deps.open as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("coalesces repeated open requests while the first PTY is still opening", async () => {
    const pendingOpen = deferred<string>();
    const { deps } = makeDeps({ open: vi.fn(() => pendingOpen.promise) });
    const { result } = renderHook(() => usePtySession(deps, () => {}));

    let firstOpen: Promise<void> = Promise.resolve();
    let repeatedOpen: Promise<void> = Promise.resolve();
    act(() => {
      firstOpen = result.current.open(80, 24);
      repeatedOpen = result.current.open(120, 40);
    });

    expect(deps.open).toHaveBeenCalledTimes(1);
    expect(deps.open).toHaveBeenCalledWith(80, 24);

    await act(async () => {
      pendingOpen.resolve("pty-pending");
      await firstOpen;
      await repeatedOpen;
    });
    expect(result.current.status).toBe("open");
  });

  it("tears down a PTY after an unexpected write failure so reconnect can work", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("transport closed"));
    const { deps, unlisten } = makeDeps({ write });
    const { result } = renderHook(() => usePtySession(deps, () => {}));
    await act(async () => {
      await result.current.open(80, 24);
    });

    act(() => result.current.write([108, 115, 10]));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(unlisten).toHaveBeenCalledOnce();
    expect(deps.close).toHaveBeenCalledWith("pty-1");

    await act(async () => {
      await result.current.open(100, 30);
    });
    expect(deps.open).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("open");
  });

  it("sets error status when open fails", async () => {
    const { deps } = makeDeps({
      open: vi.fn().mockRejectedValue(new Error("no session")),
    });
    const { result } = renderHook(() => usePtySession(deps, () => {}));
    await act(async () => {
      await result.current.open(80, 24);
    });
    expect(result.current.status).toBe("error");
  });

  it("tears down on unmount", async () => {
    const { deps, unlisten } = makeDeps();
    const { result, unmount } = renderHook(() => usePtySession(deps, () => {}));
    await act(async () => {
      await result.current.open(80, 24);
    });
    unmount();
    expect(unlisten).toHaveBeenCalled();
    expect(deps.close).toHaveBeenCalledWith("pty-1");
  });

  it("tears down the old pty when backend deps change and allows the new session to open", async () => {
    const onData = vi.fn();
    const first = makeDeps({ open: vi.fn().mockResolvedValue("pty-old") });
    const second = makeDeps({ open: vi.fn().mockResolvedValue("pty-new") });
    const { result, rerender } = renderHook(
      ({ deps }) => usePtySession(deps, onData),
      { initialProps: { deps: first.deps as PtyDeps | undefined } },
    );

    await act(async () => {
      await result.current.open(80, 24);
    });
    expect(result.current.status).toBe("open");

    rerender({ deps: second.deps });

    await waitFor(() => expect(first.unlisten).toHaveBeenCalled());
    expect(first.deps.close).toHaveBeenCalledWith("pty-old");
    await waitFor(() => expect(result.current.status).toBe("idle"));

    act(() => first.emitData([1]));
    expect(onData).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.open(100, 30);
    });
    expect(second.deps.open).toHaveBeenCalledWith(100, 30);
    expect(second.deps.subscribe).toHaveBeenCalledWith(
      "pty-new",
      expect.any(Function),
      expect.any(Function),
    );
    expect(result.current.status).toBe("open");
  });

  it("closes delayed pty opens that resolve after the session deps changed", async () => {
    const lateOpen = deferred<string>();
    const first = makeDeps({ open: vi.fn(() => lateOpen.promise) });
    const second = makeDeps({ open: vi.fn().mockResolvedValue("pty-new") });
    const { result, rerender } = renderHook(
      ({ deps }) => usePtySession(deps, () => {}),
      { initialProps: { deps: first.deps as PtyDeps | undefined } },
    );

    let opening: Promise<void> | undefined;
    act(() => {
      opening = result.current.open(80, 24);
    });
    await waitFor(() => expect(result.current.status).toBe("opening"));

    rerender({ deps: second.deps });
    await waitFor(() => expect(result.current.status).toBe("idle"));

    await act(async () => {
      lateOpen.resolve("pty-late");
      await opening;
    });

    expect(first.deps.close).toHaveBeenCalledWith("pty-late");
    expect(first.deps.subscribe).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.open(120, 40);
    });
    expect(second.deps.open).toHaveBeenCalledWith(120, 40);
    expect(second.deps.subscribe).toHaveBeenCalledWith(
      "pty-new",
      expect.any(Function),
      expect.any(Function),
    );
    expect(result.current.status).toBe("open");
  });

  it("resize/close before open are safe no-ops, and unmount without open closes nothing", () => {
    const { deps } = makeDeps();
    const { result, unmount } = renderHook(() => usePtySession(deps, () => {}));
    // No open() yet -> no pty id -> these must not call the IPC.
    act(() => result.current.resize(100, 30));
    act(() => result.current.close());
    expect((deps.resize as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect((deps.close as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    unmount();
    expect((deps.close as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
