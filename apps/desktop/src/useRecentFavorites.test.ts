// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecentFavorites } from "./useRecentFavorites";

const store = new Map<string, string>();
vi.mock("./persistence", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./persistence")>();
  return {
    ...mod,
    readStoredStringList: (key: string, opts?: { maxItems?: number }) => {
      const raw = store.get(key);
      if (!raw) return [];
      try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter((x: unknown) => typeof x === "string").slice(0, opts?.maxItems ?? Number.MAX_SAFE_INTEGER) : [];
      } catch { return []; }
    },
    writeStorageJson: (key: string, value: unknown) => {
      store.set(key, JSON.stringify(value));
    },
  };
});

describe("useRecentFavorites", () => {
  beforeEach(() => {
    store.clear();
  });

  it("initializes with empty state", () => {
    const { result } = renderHook(() => useRecentFavorites());
    expect(result.current.state.recentConnections).toEqual([]);
    expect(result.current.state.favorites).toEqual([]);
    expect(result.current.state.recentCommands).toEqual([]);
  });

  it("records a connection and moves it to front", () => {
    const { result } = renderHook(() => useRecentFavorites());
    act(() => result.current.recordConnection("s1"));
    expect(result.current.state.recentConnections).toEqual(["s1"]);
    act(() => result.current.recordConnection("s2"));
    expect(result.current.state.recentConnections).toEqual(["s2", "s1"]);
    act(() => result.current.recordConnection("s1"));
    expect(result.current.state.recentConnections).toEqual(["s1", "s2"]);
  });

  it("limits recent connections to 8", () => {
    const { result } = renderHook(() => useRecentFavorites());
    for (let i = 0; i < 10; i++) {
      act(() => result.current.recordConnection(`s${i}`));
    }
    expect(result.current.state.recentConnections).toHaveLength(8);
    expect(result.current.state.recentConnections[0]).toBe("s9");
  });

  it("toggles favorites", () => {
    const { result } = renderHook(() => useRecentFavorites());
    act(() => result.current.toggleFavorite("s1"));
    expect(result.current.state.favorites).toContain("s1");
    act(() => result.current.toggleFavorite("s1"));
    expect(result.current.state.favorites).not.toContain("s1");
  });

  it("persists favorites", () => {
    const { result } = renderHook(() => useRecentFavorites());
    act(() => result.current.toggleFavorite("s1"));
    expect(JSON.parse(store.get("atlasterm.favorites") ?? "[]")).toContain("s1");
  });

  it("persists recent connections", () => {
    const { result } = renderHook(() => useRecentFavorites());
    act(() => result.current.recordConnection("s1"));
    act(() => result.current.recordConnection("s2"));
    expect(JSON.parse(store.get("atlasterm.recentConnections") ?? "[]")).toEqual(["s2", "s1"]);
  });

  it("persists recent commands", () => {
    const { result } = renderHook(() => useRecentFavorites());
    act(() => result.current.recordCommand("cmd1"));
    expect(JSON.parse(store.get("atlasterm.recentCommands") ?? "[]")).toEqual(["cmd1"]);
  });

  it("records commands", () => {
    const { result } = renderHook(() => useRecentFavorites());
    act(() => result.current.recordCommand("cmd1"));
    expect(result.current.state.recentCommands).toEqual(["cmd1"]);
    act(() => result.current.recordCommand("cmd2"));
    expect(result.current.state.recentCommands).toEqual(["cmd2", "cmd1"]);
  });

  it("ignores unknown actions", () => {
    const { result } = renderHook(() => useRecentFavorites());
    act(() => result.current.recordConnection("s1"));
    // @ts-expect-error testing unknown action
    act(() => result.current.dispatch({ type: "UNKNOWN" }));
    expect(result.current.state.recentConnections).toEqual(["s1"]);
  });

  it("limits recent commands to 10", () => {
    const { result } = renderHook(() => useRecentFavorites());
    for (let i = 0; i < 12; i++) {
      act(() => result.current.recordCommand(`cmd${i}`));
    }
    expect(result.current.state.recentCommands).toHaveLength(10);
  });
});
