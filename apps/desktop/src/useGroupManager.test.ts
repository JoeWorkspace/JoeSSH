// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGroupManager } from "./useGroupManager";

const BUILTIN = ["Production", "Staging", "Development"];

// Mock persistence module so writes go to a local Map instead of window.localStorage
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
    readStoredConnectionGroups: (_opts: { allowedGroups?: string[]; connectionNames?: string[] }) => {
      const raw = store.get("atlasterm.connectionGroups");
      if (!raw) return {};
      try {
        const obj = JSON.parse(raw);
        if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return {};
        return obj as Record<string, string>;
      } catch { return {}; }
    },
    writeStorageJson: (key: string, value: unknown) => {
      store.set(key, JSON.stringify(value));
    },
  };
});

describe("useGroupManager", () => {
  beforeEach(() => {
    store.clear();
  });

  it("initializes with builtin groups only", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    expect(result.current.state.customGroups).toEqual([]);
    expect(result.current.allGroupNames).toEqual(["Development", "Production", "Staging"]);
  });

  it("adds a custom group and persists it", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    act(() => result.current.dispatch({ type: "ADD_CUSTOM_GROUP", name: "NewGroup" }));
    expect(result.current.state.customGroups).toContain("NewGroup");
    expect(result.current.allGroupNames).toContain("NewGroup");
    expect(JSON.parse(store.get("atlasterm.customGroups") ?? "[]")).toContain("NewGroup");
  });

  it("removes a custom group and reassigns connections to Production", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, ["s1", "s2"]));
    act(() => result.current.dispatch({ type: "ADD_CUSTOM_GROUP", name: "Old" }));
    act(() => result.current.dispatch({ type: "MOVE_CONNECTION", connection: "s1", group: "Old" }));
    act(() => result.current.dispatch({ type: "MOVE_CONNECTION", connection: "s2", group: "Staging" }));
    act(() => result.current.dispatch({ type: "REMOVE_CUSTOM_GROUP", name: "Old" }));
    expect(result.current.state.customGroups).not.toContain("Old");
    expect(result.current.state.connectionGroups.s1).toBe("Production");
    expect(result.current.state.connectionGroups.s2).toBe("Staging");
  });

  it("removes a custom group with no assigned connections", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    act(() => result.current.dispatch({ type: "ADD_CUSTOM_GROUP", name: "Empty" }));
    act(() => result.current.dispatch({ type: "REMOVE_CUSTOM_GROUP", name: "Empty" }));
    expect(result.current.state.customGroups).not.toContain("Empty");
  });

  it("renames a custom group and updates connection assignments", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, ["s1", "s2"]));
    act(() => result.current.dispatch({ type: "ADD_CUSTOM_GROUP", name: "Old" }));
    act(() => result.current.dispatch({ type: "ADD_CUSTOM_GROUP", name: "Other" }));
    act(() => result.current.dispatch({ type: "MOVE_CONNECTION", connection: "s1", group: "Old" }));
    act(() => result.current.dispatch({ type: "MOVE_CONNECTION", connection: "s2", group: "Other" }));
    act(() => result.current.dispatch({ type: "RENAME_GROUP", oldName: "Old", newName: "New" }));
    expect(result.current.state.customGroups).toContain("New");
    expect(result.current.state.customGroups).toContain("Other");
    expect(result.current.state.customGroups).not.toContain("Old");
    expect(result.current.state.connectionGroups.s1).toBe("New");
    expect(result.current.state.connectionGroups.s2).toBe("Other");
  });

  it("does not rename onto an existing custom group (no duplicate group entry)", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, ["s1"]));
    act(() => result.current.dispatch({ type: "ADD_CUSTOM_GROUP", name: "A" }));
    act(() => result.current.dispatch({ type: "ADD_CUSTOM_GROUP", name: "B" }));
    act(() => result.current.dispatch({ type: "RENAME_GROUP", oldName: "A", newName: "B" }));
    // No-op: still exactly ["A","B"], no ["B","B"] duplicate.
    expect(result.current.state.customGroups).toEqual(["A", "B"]);
    expect(new Set(result.current.state.customGroups).size).toBe(result.current.state.customGroups.length);
  });

  it("moves a connection to a group", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, ["s1"]));
    act(() => result.current.dispatch({ type: "MOVE_CONNECTION", connection: "s1", group: "Staging" }));
    expect(result.current.state.connectionGroups.s1).toBe("Staging");
  });

  it("toggles collapse", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    act(() => result.current.dispatch({ type: "TOGGLE_COLLAPSE", group: "Production" }));
    expect(result.current.state.collapsedGroups.has("Production")).toBe(true);
    act(() => result.current.dispatch({ type: "TOGGLE_COLLAPSE", group: "Production" }));
    expect(result.current.state.collapsedGroups.has("Production")).toBe(false);
  });

  it("sets manager open state", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    act(() => result.current.dispatch({ type: "SET_MANAGER_OPEN", open: true }));
    expect(result.current.state.managerOpen).toBe(true);
    act(() => result.current.dispatch({ type: "SET_MANAGER_OPEN", open: false }));
    expect(result.current.state.managerOpen).toBe(false);
  });

  it("handles editing flow", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    act(() => result.current.dispatch({ type: "START_EDIT_GROUP", group: "Production" }));
    expect(result.current.state.editingGroup).toBe("Production");
    expect(result.current.state.editingGroupName).toBe("Production");

    act(() => result.current.dispatch({ type: "START_EDIT_GROUP", group: "Production", name: "Custom" }));
    expect(result.current.state.editingGroupName).toBe("Custom");

    act(() => result.current.dispatch({ type: "SET_EDITING_GROUP_NAME", name: "Prod" }));
    expect(result.current.state.editingGroupName).toBe("Prod");

    act(() => result.current.dispatch({ type: "CANCEL_EDIT" }));
    expect(result.current.state.editingGroup).toBeNull();
  });

  it("validates group names", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    expect(result.current.isGroupValid("NewGroup")).toBe(true);
    expect(result.current.isGroupValid("Production")).toBe(false);
    expect(result.current.isGroupValid("")).toBe(false);
    expect(result.current.isGroupValid("  ")).toBe(false);
  });

  it("sets new group name", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    act(() => result.current.dispatch({ type: "SET_NEW_GROUP_NAME", name: "Test" }));
    expect(result.current.state.newGroupName).toBe("Test");
  });

  it("sets move-to-group menu", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    act(() => result.current.dispatch({ type: "SET_MOVE_TO_GROUP_MENU", connection: "s1" }));
    expect(result.current.state.moveToGroupMenu).toBe("s1");
    act(() => result.current.dispatch({ type: "SET_MOVE_TO_GROUP_MENU", connection: null }));
    expect(result.current.state.moveToGroupMenu).toBeNull();
  });

  it("persists custom groups to storage", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    act(() => result.current.dispatch({ type: "ADD_CUSTOM_GROUP", name: "GroupA" }));
    act(() => result.current.dispatch({ type: "ADD_CUSTOM_GROUP", name: "GroupB" }));
    const stored = JSON.parse(store.get("atlasterm.customGroups") ?? "[]");
    expect(stored).toEqual(["GroupA", "GroupB"]);
  });

  it("ignores unknown actions", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    // @ts-expect-error testing unknown action
    act(() => result.current.dispatch({ type: "UNKNOWN" }));
    expect(result.current.state.customGroups).toEqual([]);
  });

  it("loads custom groups via LOAD_CUSTOM_GROUPS", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    act(() => result.current.dispatch({ type: "LOAD_CUSTOM_GROUPS", groups: ["Loaded"] }));
    expect(result.current.state.customGroups).toEqual(["Loaded"]);
  });

  it("loads connection groups via LOAD_CONNECTION_GROUPS", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, []));
    act(() => result.current.dispatch({ type: "LOAD_CONNECTION_GROUPS", groups: { s1: "Staging" } }));
    expect(result.current.state.connectionGroups).toEqual({ s1: "Staging" });
  });

  it("does not persist connections with invalid group names", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, ["s1"]));
    // Directly set an invalid group via LOAD_CONNECTION_GROUPS
    act(() => result.current.dispatch({ type: "LOAD_CONNECTION_GROUPS", groups: { s1: "NonExistent" } }));
    const stored = store.get("atlasterm.connectionGroups");
    // NonExistent is not a builtin or custom group, so it should not be persisted
    expect(stored === undefined || !stored.includes("NonExistent")).toBe(true);
  });

  it("persists connection group overrides to storage", () => {
    const { result } = renderHook(() => useGroupManager(BUILTIN, ["s1"]));
    act(() => result.current.dispatch({ type: "MOVE_CONNECTION", connection: "s1", group: "Staging" }));
    const stored = JSON.parse(store.get("atlasterm.connectionGroups") ?? "{}");
    expect(stored).toEqual({ s1: "Staging" });
  });

  it("drops persisted group overrides when a connection is removed", () => {
    const { result, rerender } = renderHook(
      ({ connectionNames }) => useGroupManager(BUILTIN, connectionNames),
      { initialProps: { connectionNames: ["custom-server"] } },
    );

    act(() =>
      result.current.dispatch({
        type: "MOVE_CONNECTION",
        connection: "custom-server",
        group: "Staging",
      }),
    );
    expect(
      JSON.parse(store.get("atlasterm.connectionGroups") ?? "{}"),
    ).toEqual({ "custom-server": "Staging" });

    rerender({ connectionNames: [] });
    expect(
      JSON.parse(store.get("atlasterm.connectionGroups") ?? "{}"),
    ).toEqual({});
  });
});
