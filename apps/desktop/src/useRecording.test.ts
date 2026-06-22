// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useRecording } from "./useRecording";

describe("useRecording", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with recording off", () => {
    const { result } = renderHook(() => useRecording());
    expect(result.current.recording).toBe(false);
    expect(result.current.recordingTimeLabel).toBe("00:00");
  });

  it("toggles recording on and off", () => {
    const { result } = renderHook(() => useRecording());
    act(() => result.current.toggleRecording());
    expect(result.current.recording).toBe(true);
    act(() => result.current.toggleRecording());
    expect(result.current.recording).toBe(false);
  });

  it("increments time while recording", () => {
    const { result } = renderHook(() => useRecording());
    act(() => result.current.toggleRecording());
    expect(result.current.recordingTimeLabel).toBe("00:00");

    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.recordingTimeLabel).toBe("00:01");

    act(() => { vi.advanceTimersByTime(59000); });
    expect(result.current.recordingTimeLabel).toBe("01:00");
  });

  it("resets time when recording stops", () => {
    const { result } = renderHook(() => useRecording());
    act(() => result.current.toggleRecording());
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.recordingTimeLabel).toBe("00:05");

    act(() => result.current.toggleRecording());
    expect(result.current.recordingTimeLabel).toBe("00:00");
  });

  it("formats time with padding", () => {
    const { result } = renderHook(() => useRecording());
    act(() => result.current.toggleRecording());

    act(() => { vi.advanceTimersByTime(125000); });
    expect(result.current.recordingTimeLabel).toBe("02:05");
  });

  it("cleans up interval on unmount", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { result, unmount } = renderHook(() => useRecording());
    act(() => result.current.toggleRecording());
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
