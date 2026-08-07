// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragReorder } from "./useDragReorder";

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
    readStoredConnectionOrder: (defaultOrder: readonly string[]) => {
      const raw = store.get("atlasterm.connectionOrder");
      if (!raw) return [...defaultOrder];
      try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [...defaultOrder];
        const storedOrder = arr.filter((x: unknown) => typeof x === "string");
        if (storedOrder.length === 0) return [...defaultOrder];
        const allowed = new Set(defaultOrder);
        const ordered = storedOrder.filter((n: string) => allowed.has(n));
        const orderedSet = new Set(ordered);
        return [...ordered, ...defaultOrder.filter((n: string) => !orderedSet.has(n))];
      } catch { return [...defaultOrder]; }
    },
    writeStorageJson: (key: string, value: unknown) => {
      store.set(key, JSON.stringify(value));
    },
  };
});

describe("useDragReorder", () => {
  beforeEach(() => {
    store.clear();
  });

  it("initializes with default order", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2"]));
    expect(result.current.state.dragging).toBeNull();
    expect(result.current.state.dragOver).toBeNull();
    expect(result.current.state.order).toEqual(["s1", "s2"]);
  });

  it("starts drag", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2"]));
    act(() => result.current.startDrag("s1"));
    expect(result.current.state.dragging).toBe("s1");
  });

  it("drags over", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2"]));
    act(() => result.current.startDrag("s1"));
    act(() => result.current.dragOver("s2"));
    expect(result.current.state.dragOver).toBe("s2");
  });

  it("ignores drag over self", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2"]));
    act(() => result.current.startDrag("s1"));
    act(() => result.current.dragOver("s1"));
    expect(result.current.state.dragOver).toBeNull();
  });

  it("drags leave clears dragOver", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2"]));
    act(() => result.current.startDrag("s1"));
    act(() => result.current.dragOver("s2"));
    act(() => result.current.dragLeave());
    expect(result.current.state.dragOver).toBeNull();
  });

  it("reorders on drag end", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2", "s3"]));
    act(() => result.current.startDrag("s1"));
    act(() => result.current.dragOver("s3"));
    act(() => result.current.dragEnd());
    expect(result.current.state.order).toEqual(["s2", "s3", "s1"]);
    expect(result.current.state.dragging).toBeNull();
    expect(result.current.state.dragOver).toBeNull();
  });

  it("persists order on drag end", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2"]));
    act(() => result.current.startDrag("s1"));
    act(() => result.current.dragOver("s2"));
    act(() => result.current.dragEnd());
    expect(JSON.parse(store.get("atlasterm.connectionOrder") ?? "[]")).toEqual(["s2", "s1"]);
  });

  it("moves a connection before another connection by keyboard action", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2", "s3"]));
    act(() => result.current.moveBefore("s3", "s2"));
    expect(result.current.state.order).toEqual(["s1", "s3", "s2"]);
    expect(JSON.parse(store.get("atlasterm.connectionOrder") ?? "[]")).toEqual(["s1", "s3", "s2"]);
  });

  it("moves a connection after another connection by keyboard action", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2", "s3"]));
    act(() => result.current.moveAfter("s1", "s2"));
    expect(result.current.state.order).toEqual(["s2", "s1", "s3"]);
  });

  it("ignores keyboard moves with unknown targets", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2"]));
    act(() => result.current.moveBefore("s1", "missing"));
    act(() => result.current.moveAfter("missing", "s2"));
    expect(result.current.state.order).toEqual(["s1", "s2"]);
  });

  it("ignores keyboard moves that target the same connection", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2"]));
    act(() => result.current.moveBefore("s1", "s1"));
    act(() => result.current.moveAfter("s2", "s2"));
    expect(result.current.state.order).toEqual(["s1", "s2"]);
  });

  it("does nothing on drag end without drag target", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2"]));
    act(() => result.current.startDrag("s1"));
    act(() => result.current.dragEnd());
    expect(result.current.state.order).toEqual(["s1", "s2"]);
  });

  it("does nothing when dragged item not in order", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2"]));
    // Manually set dragging to an item not in order
    act(() => result.current.dispatch({ type: "SET_ORDER", order: ["s1", "s2"] }));
    act(() => result.current.startDrag("s1"));
    // Remove s1 from order after drag started
    act(() => result.current.dispatch({ type: "SET_ORDER", order: ["s2"] }));
    act(() => result.current.dragOver("s2"));
    act(() => result.current.dragEnd());
    expect(result.current.state.order).toEqual(["s2"]);
  });

  it("ignores unknown actions", () => {
    const { result } = renderHook(() => useDragReorder(["s1"]));
    // @ts-expect-error testing unknown action
    act(() => result.current.dispatch({ type: "UNKNOWN" }));
    expect(result.current.state.order).toEqual(["s1"]);
  });

  it("dispatches SET_ORDER directly", () => {
    const { result } = renderHook(() => useDragReorder(["s1", "s2"]));
    act(() => result.current.dispatch({ type: "SET_ORDER", order: ["s3", "s4"] }));
    expect(result.current.state.order).toEqual(["s3", "s4"]);
  });

  it("adds and removes connection names while preserving the current order", () => {
    const { result, rerender } = renderHook(
      ({ connectionNames }) => useDragReorder(connectionNames),
      { initialProps: { connectionNames: ["s1", "s2"] } },
    );
    act(() => result.current.moveBefore("s2", "s1"));
    expect(result.current.state.order).toEqual(["s2", "s1"]);

    rerender({ connectionNames: ["s1", "s2", "custom-server"] });
    expect(result.current.state.order).toEqual([
      "s2",
      "s1",
      "custom-server",
    ]);

    rerender({ connectionNames: ["s2", "custom-server"] });
    expect(result.current.state.order).toEqual(["s2", "custom-server"]);
  });
});
