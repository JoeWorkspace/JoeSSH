// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
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

  it("clears runtime state when the backend session changes", async () => {
    const start = vi.fn().mockResolvedValue({ forward_id: "fwd-1", bound_addr: "127.0.0.1:5" });
    const stop = vi.fn().mockResolvedValue(undefined);
    const nextStart = vi.fn().mockResolvedValue({ forward_id: "fwd-2", bound_addr: "127.0.0.1:6" });
    const nextStop = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ startFn, stopFn }) => useForwardRules(startFn, stopFn),
      { initialProps: { startFn: start, stopFn: stop } },
    );

    await act(async () => { await result.current.startRule("r1", "127.0.0.1:0", "db", 5432); });
    expect(result.current.runtime.r1).toEqual({ active: true, forwardId: "fwd-1", boundAddr: "127.0.0.1:5" });

    rerender({ startFn: nextStart, stopFn: nextStop });

    await waitFor(() => expect(result.current.runtime).toEqual({}));
  });
});
