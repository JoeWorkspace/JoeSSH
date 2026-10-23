// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useForwardRules } from "./useForwardRules";

describe("useForwardRules", () => {
  it("toggles local state when no IPC is wired (web preview)", async () => {
    const { result } = renderHook(() => useForwardRules());
    expect(result.current.active).toBe(false);

    await act(async () => { await result.current.startRule("r1", "127.0.0.1:0", "db", 5432); });
    expect(result.current.runtime.r1).toEqual({ active: true });

    await act(async () => { await result.current.stopRule("r1"); });
    expect(result.current.runtime.r1).toEqual({ active: false });
  });

  it("starts a real forward and records forward id + bound address", async () => {
    const start = vi.fn().mockResolvedValue({ forward_id: "fwd-1", bound_addr: "127.0.0.1:54321" });
    const stop = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useForwardRules(start, stop));
    expect(result.current.active).toBe(true);

    await act(async () => { await result.current.startRule("r1", "127.0.0.1:0", "db.internal", 5432); });
    expect(start).toHaveBeenCalledWith("127.0.0.1:0", "db.internal", 5432);
    expect(result.current.runtime.r1).toEqual({ active: true, forwardId: "fwd-1", boundAddr: "127.0.0.1:54321" });
  });

  it("ignores duplicate start calls while a forward is pending", async () => {
    let resolveStart: (value: { forward_id: string; bound_addr: string }) => void = () => {};
    const start = vi.fn().mockImplementation(
      () => new Promise<{ forward_id: string; bound_addr: string }>((resolve) => {
        resolveStart = resolve;
      }),
    );
    const stop = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useForwardRules(start, stop));

    let firstStart: Promise<void> = Promise.resolve();
    let duplicateStart: Promise<void> = Promise.resolve();
    await act(async () => {
      firstStart = result.current.startRule("r1", "127.0.0.1:0", "db.internal", 5432);
      duplicateStart = result.current.startRule("r1", "127.0.0.1:0", "db.internal", 5432);
      await Promise.resolve();
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(result.current.runtime.r1).toEqual({ active: false, pending: true, error: undefined });

    await act(async () => {
      resolveStart({ forward_id: "fwd-1", bound_addr: "127.0.0.1:54321" });
      await firstStart;
      await duplicateStart;
    });

    expect(result.current.runtime.r1).toEqual({ active: true, forwardId: "fwd-1", boundAddr: "127.0.0.1:54321" });
  });

  it("stops a real forward via its forward id", async () => {
    const start = vi.fn().mockResolvedValue({ forward_id: "fwd-9", bound_addr: "127.0.0.1:5" });
    const stop = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useForwardRules(start, stop));

    await act(async () => { await result.current.startRule("r1", "b", "t", 1); });
    await act(async () => { await result.current.stopRule("r1"); });
    expect(stop).toHaveBeenCalledWith("fwd-9");
    expect(result.current.runtime.r1).toEqual({ active: false });
  });

  it("ignores duplicate stop calls while a forward stop is pending", async () => {
    const start = vi.fn().mockResolvedValue({ forward_id: "fwd-9", bound_addr: "127.0.0.1:5" });
    let resolveStop: () => void = () => {};
    const stop = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveStop = resolve;
      }),
    );
    const { result } = renderHook(() => useForwardRules(start, stop));

    await act(async () => { await result.current.startRule("r1", "b", "t", 1); });

    let firstStop: Promise<void> = Promise.resolve();
    let duplicateStop: Promise<void> = Promise.resolve();
    await act(async () => {
      firstStop = result.current.stopRule("r1");
      duplicateStop = result.current.stopRule("r1");
      await Promise.resolve();
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.runtime.r1).toEqual({ active: true, forwardId: "fwd-9", boundAddr: "127.0.0.1:5", pending: true, error: undefined });

    await act(async () => {
      resolveStop();
      await firstStop;
      await duplicateStop;
    });

    expect(result.current.runtime.r1).toEqual({ active: false });
  });

  it("records an error when starting a forward fails", async () => {
    const start = vi.fn().mockRejectedValue("bind denied");
    const stop = vi.fn();
    const { result } = renderHook(() => useForwardRules(start, stop));

    await act(async () => { await result.current.startRule("r1", "b", "t", 1); });
    await waitFor(() => expect(result.current.runtime.r1?.error).toBe("bind denied"));
    expect(result.current.runtime.r1?.active).toBe(false);
  });

  it("stops a rule with no live forward id without calling the IPC", async () => {
    const start = vi.fn().mockResolvedValue({ forward_id: "f", bound_addr: "a" });
    const stop = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useForwardRules(start, stop));

    // No prior startRule -> no runtime entry -> stop must be a local no-op.
    await act(async () => { await result.current.stopRule("r1"); });
    expect(stop).not.toHaveBeenCalled();
    expect(result.current.runtime.r1).toEqual({ active: false });
  });

  it("keeps the forward active and records the error when stopping fails", async () => {
    const start = vi.fn().mockResolvedValue({ forward_id: "fwd-x", bound_addr: "127.0.0.1:1" });
    const stop = vi.fn().mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useForwardRules(start, stop));

    await act(async () => { await result.current.startRule("r1", "b", "t", 1); });
    await act(async () => { await result.current.stopRule("r1"); });
    expect(result.current.runtime.r1).toEqual({ active: true, forwardId: "fwd-x", boundAddr: "127.0.0.1:1", error: "network down" });
  });

  it("preserves forwards across tab changes and stops the original forward after returning", async () => {
    const start = vi.fn().mockResolvedValue({ forward_id: "fwd-1", bound_addr: "127.0.0.1:5" });
    const stop = vi.fn().mockResolvedValue(undefined);
    const nextStart = vi.fn().mockResolvedValue({ forward_id: "fwd-2", bound_addr: "127.0.0.1:6" });
    const nextStop = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ startFn, stopFn, sessionId }) => useForwardRules(startFn, stopFn, { sessionId, liveSessionIds: ["first", "second"] }),
      { initialProps: { startFn: start, stopFn: stop, sessionId: "first" }, wrapper: StrictMode },
    );

    await act(async () => { await result.current.startRule("r1", "127.0.0.1:0", "db", 5432); });
    expect(result.current.runtime.r1).toEqual({ active: true, forwardId: "fwd-1", boundAddr: "127.0.0.1:5" });

    rerender({ startFn: nextStart, stopFn: nextStop, sessionId: "second" });

    await waitFor(() => expect(result.current.runtime).toEqual({}));
    expect(stop).not.toHaveBeenCalled();
    rerender({ startFn: start, stopFn: stop, sessionId: "first" });
    expect(result.current.runtime.r1.forwardId).toBe("fwd-1");
    await act(async () => { await result.current.stopRule("r1"); });
    expect(stop).toHaveBeenCalledWith("fwd-1");
    expect(nextStop).not.toHaveBeenCalled();
  });

  it("keeps a pending start's result in its owning session while another tab is active", async () => {
    let resolveStart!: (value: { forward_id: string; bound_addr: string }) => void;
    const start = vi.fn()
      .mockImplementationOnce(() => new Promise<{ forward_id: string; bound_addr: string }>((resolve) => { resolveStart = resolve; }))
      .mockResolvedValueOnce({ forward_id: "fwd-second", bound_addr: "127.0.0.1:54322" });
    const stop = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ sessionId }) => useForwardRules(start, stop, { sessionId, liveSessionIds: ["first", "second"] }),
      { initialProps: { sessionId: "first" } },
    );
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.startRule("r1", "127.0.0.1:0", "synthetic.invalid", 5432); });
    rerender({ sessionId: "second" });
    await act(async () => { await result.current.startRule("r1", "127.0.0.1:0", "synthetic.invalid", 5432); });
    await act(async () => {
      resolveStart({ forward_id: "fwd-first", bound_addr: "127.0.0.1:54321" });
      await pending;
    });
    expect(result.current.runtime.r1.forwardId).toBe("fwd-second");
    expect(stop).not.toHaveBeenCalled();
    rerender({ sessionId: "first" });
    expect(result.current.runtime.r1.forwardId).toBe("fwd-first");
  });

  it("cleans a removed session and ignores its late pending forward", async () => {
    let resolveStart!: (value: { forward_id: string; bound_addr: string }) => void;
    const start = vi.fn()
      .mockResolvedValueOnce({ forward_id: "fwd-live", bound_addr: "127.0.0.1:1" })
      .mockImplementationOnce(() => new Promise<{ forward_id: string; bound_addr: string }>((resolve) => { resolveStart = resolve; }))
      .mockResolvedValueOnce({ forward_id: "fwd-second", bound_addr: "127.0.0.1:3" });
    const stop = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ sessionId, liveSessionIds }) => useForwardRules(start, stop, { sessionId, liveSessionIds }),
      { initialProps: { sessionId: "first", liveSessionIds: ["first", "second"] } },
    );
    await act(async () => { await result.current.startRule("r1", "127.0.0.1:0", "synthetic.invalid", 5432); });
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.startRule("r2", "127.0.0.1:0", "synthetic.invalid", 5432); });
    rerender({ sessionId: "second", liveSessionIds: ["first", "second"] });
    await act(async () => { await result.current.startRule("r1", "127.0.0.1:0", "synthetic.invalid", 5432); });
    rerender({ sessionId: "second", liveSessionIds: ["second"] });
    expect(stop).toHaveBeenCalledWith("fwd-live");
    await act(async () => {
      resolveStart({ forward_id: "fwd-late", bound_addr: "127.0.0.1:2" });
      await pending;
    });
    expect(stop).toHaveBeenCalledWith("fwd-late");
    expect(stop).not.toHaveBeenCalledWith("fwd-second");
    expect(result.current.runtime.r1.forwardId).toBe("fwd-second");
  });

  it("does not replace an already active forward with a duplicate start", async () => {
    const start = vi.fn().mockResolvedValue({ forward_id: "fwd-existing", bound_addr: "127.0.0.1:1" });
    const stop = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useForwardRules(start, stop));
    await act(async () => {
      await result.current.startRule("r1", "127.0.0.1:0", "synthetic.invalid", 5432);
      await result.current.startRule("r1", "127.0.0.1:0", "synthetic.invalid", 5432);
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(result.current.runtime.r1.forwardId).toBe("fwd-existing");
  });

  it("disposes live and late forwards when the workspace unmounts", async () => {
    let resolveStart!: (value: { forward_id: string; bound_addr: string }) => void;
    const start = vi.fn()
      .mockResolvedValueOnce({ forward_id: "fwd-live", bound_addr: "127.0.0.1:1" })
      .mockImplementationOnce(() => new Promise<{ forward_id: string; bound_addr: string }>((resolve) => { resolveStart = resolve; }));
    const stop = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useForwardRules(start, stop));
    await act(async () => { await result.current.startRule("r1", "127.0.0.1:0", "synthetic.invalid", 5432); });
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.startRule("r2", "127.0.0.1:0", "synthetic.invalid", 5432); });
    unmount();
    expect(stop).toHaveBeenCalledWith("fwd-live");
    await act(async () => {
      resolveStart({ forward_id: "fwd-late", bound_addr: "127.0.0.1:2" });
      await pending;
    });
    expect(stop).toHaveBeenCalledWith("fwd-late");
  });

  it("rejects saved UI callbacks after their owning session is removed or unmounted", async () => {
    const start = vi.fn().mockResolvedValue({ forward_id: "fwd-first", bound_addr: "127.0.0.1:1" });
    const stop = vi.fn().mockResolvedValue(undefined);
    const { result, rerender, unmount } = renderHook(
      ({ sessionId, liveSessionIds }) => useForwardRules(start, stop, { sessionId, liveSessionIds }),
      { initialProps: { sessionId: "first", liveSessionIds: ["first", "second"] } },
    );
    const retiredStart = result.current.startRule;
    const retiredStop = result.current.stopRule;
    rerender({ sessionId: "second", liveSessionIds: ["second"] });
    await act(async () => {
      await retiredStart("r1", "127.0.0.1:0", "synthetic.invalid", 5432);
      await retiredStop("r1");
    });
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(result.current.runtime).toEqual({});
    const unmountedStart = result.current.startRule;
    unmount();
    await unmountedStart("r1", "127.0.0.1:0", "synthetic.invalid", 5432);
    expect(start).not.toHaveBeenCalled();
  });

  it("ignores a removed session's delayed start failure without leaking it into another session", async () => {
    let rejectStart!: (reason: Error) => void;
    const start = vi.fn(() => new Promise<{ forward_id: string; bound_addr: string }>((_resolve, reject) => { rejectStart = reject; }));
    const stop = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ sessionId, liveSessionIds }) => useForwardRules(start, stop, { sessionId, liveSessionIds }),
      { initialProps: { sessionId: "first", liveSessionIds: ["first", "second"] } },
    );
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.startRule("r1", "127.0.0.1:0", "synthetic.invalid", 5432); });
    rerender({ sessionId: "second", liveSessionIds: ["second"] });
    await act(async () => {
      rejectStart(new Error("synthetic session already disconnected"));
      await pending;
    });
    expect(result.current.runtime).toEqual({});
    expect(stop).not.toHaveBeenCalled();
  });
});
