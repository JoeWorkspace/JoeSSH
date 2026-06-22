// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useToast } from "./useToast";

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with empty toasts", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
  });

  it("adds a toast with default success tone", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.addToast("Test message"));
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Test message");
    expect(result.current.toasts[0].tone).toBe("success");
  });

  it("adds a toast with warning tone", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.addToast("Warning", "warning"));
    expect(result.current.toasts[0].tone).toBe("warning");
  });

  it("adds a toast with error tone", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.addToast("Error", "error"));
    expect(result.current.toasts[0].tone).toBe("error");
  });

  it("auto-removes toast after timeout", () => {
    const { result } = renderHook(() => useToast(3000));
    act(() => result.current.addToast("Temporary"));
    expect(result.current.toasts).toHaveLength(1);

    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.toasts).toHaveLength(0);
  });

  it("supports multiple toasts", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.addToast("First");
      result.current.addToast("Second");
      result.current.addToast("Third");
    });
    expect(result.current.toasts).toHaveLength(3);
  });

  it("removes only expired toasts", () => {
    const { result } = renderHook(() => useToast(5000));
    act(() => result.current.addToast("First"));
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => result.current.addToast("Second"));

    expect(result.current.toasts).toHaveLength(2);

    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Second");
  });

  it("assigns unique ids to toasts", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.addToast("A");
      result.current.addToast("B");
    });
    expect(result.current.toasts[0].id).not.toBe(result.current.toasts[1].id);
  });

  it("clears pending toast timers on unmount", () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { result, unmount } = renderHook(() => useToast());
    act(() => {
      result.current.addToast("A");
      result.current.addToast("B");
    });
    unmount();
    expect(clearSpy).toHaveBeenCalledTimes(2);
    clearSpy.mockRestore();
  });

  it("prunes fired timer handles so unmount only clears still-pending ones", () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { result, unmount } = renderHook(() => useToast(3000));
    act(() => {
      result.current.addToast("A");
      result.current.addToast("B");
    });
    // Let only the first toast's timer fire (both share the 3000ms timeout,
    // so advance fully to expire both, then add a third that stays pending).
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => result.current.addToast("C"));
    unmount();
    // Only the still-pending "C" timer should be cleared, not the 2 fired ones.
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });
});
