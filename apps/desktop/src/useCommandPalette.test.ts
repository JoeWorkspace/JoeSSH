// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCommandPalette } from "./useCommandPalette";

describe("useCommandPalette", () => {
  it("initializes with closed state", () => {
    const { result } = renderHook(() => useCommandPalette());
    expect(result.current.state.open).toBe(false);
    expect(result.current.state.input).toBe("");
    expect(result.current.state.index).toBe(0);
  });

  it("opens the palette", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.open());
    expect(result.current.state.open).toBe(true);
    expect(result.current.state.input).toBe("");
  });

  it("opens the palette with initial input", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.open("test"));
    expect(result.current.state.open).toBe(true);
    expect(result.current.state.input).toBe("test");
  });

  it("ignores non-string initial input from click handlers", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.open({ type: "click" }));
    expect(result.current.state.open).toBe(true);
    expect(result.current.state.input).toBe("");
  });

  it("opens via dispatch without input", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.dispatch({ type: "OPEN" }));
    expect(result.current.state.open).toBe(true);
    expect(result.current.state.input).toBe("");
  });

  it("closes the palette", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.open());
    act(() => result.current.close());
    expect(result.current.state.open).toBe(false);
    expect(result.current.state.input).toBe("");
    expect(result.current.state.index).toBe(0);
  });

  it("sets input", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.setInput("test"));
    expect(result.current.state.input).toBe("test");
    expect(result.current.state.index).toBe(0);
  });

  it("sets index", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.setIndex(3));
    expect(result.current.state.index).toBe(3);
  });

  it("moves up", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.setIndex(3));
    act(() => result.current.dispatch({ type: "MOVE_UP" }));
    expect(result.current.state.index).toBe(2);
  });

  it("moves up at boundary stays at 0", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.dispatch({ type: "MOVE_UP" }));
    expect(result.current.state.index).toBe(0);
  });

  it("moves down", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.dispatch({ type: "MOVE_DOWN", max: 5 }));
    expect(result.current.state.index).toBe(1);
  });

  it("resets index", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.setIndex(5));
    act(() => result.current.dispatch({ type: "RESET_INDEX" }));
    expect(result.current.state.index).toBe(0);
  });

  it("ignores unknown actions", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.setIndex(5));
    // @ts-expect-error testing unknown action
    act(() => result.current.dispatch({ type: "UNKNOWN" }));
    expect(result.current.state.index).toBe(5);
  });

  it("resets index on input change", () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => result.current.setIndex(5));
    act(() => result.current.setInput("new"));
    expect(result.current.state.index).toBe(0);
  });
});
