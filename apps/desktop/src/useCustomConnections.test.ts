// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCustomConnections } from "./useCustomConnections";
import { CUSTOM_CONNECTIONS_STORAGE_KEY, readStoredCustomConnections } from "./persistence";

const conn = (name: string, host = "h") => ({ name, host, group: "Personal", tags: ["ssh"] });

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("useCustomConnections", () => {
  it("starts empty and adds a connection that persists", () => {
    const { result } = renderHook(() => useCustomConnections());
    expect(result.current.connections).toEqual([]);

    act(() => { expect(result.current.add(conn("my-box"))).toBe(true); });
    expect(result.current.connections).toEqual([conn("my-box")]);
    // Persisted to storage.
    expect(readStoredCustomConnections()).toEqual([conn("my-box")]);
  });

  it("trims the name on add", () => {
    const { result } = renderHook(() => useCustomConnections());
    act(() => { result.current.add({ ...conn("  spaced  "), name: "  spaced  " }); });
    expect(result.current.connections[0].name).toBe("spaced");
  });

  it("rejects duplicate names and names reserved by built-ins", () => {
    const { result } = renderHook(() => useCustomConnections(["prod-edge-01"]));
    act(() => { result.current.add(conn("dup")); });

    act(() => { expect(result.current.add(conn("dup"))).toBe(false); });
    act(() => { expect(result.current.add(conn("prod-edge-01"))).toBe(false); });
    act(() => { expect(result.current.add({ ...conn(""), name: "" })).toBe(false); });
    expect(result.current.connections).toHaveLength(1);
  });

  it("reports name availability", () => {
    const { result } = renderHook(() => useCustomConnections(["builtin"]));
    act(() => { result.current.add(conn("taken")); });

    expect(result.current.isNameAvailable("fresh")).toBe(true);
    expect(result.current.isNameAvailable("taken")).toBe(false);
    expect(result.current.isNameAvailable("builtin")).toBe(false);
    expect(result.current.isNameAvailable("  ")).toBe(false);
  });

  it("removes a connection", () => {
    const { result } = renderHook(() => useCustomConnections());
    act(() => { result.current.add(conn("a")); });
    act(() => { result.current.add(conn("b")); });
    act(() => { result.current.remove("a"); });
    expect(result.current.connections.map((c) => c.name)).toEqual(["b"]);
  });

  it("updates fields of an existing connection without touching the name", () => {
    const { result } = renderHook(() => useCustomConnections());
    act(() => { result.current.add(conn("box", "old-host")); });
    act(() => { result.current.add(conn("other", "keep-host")); });
    act(() => { result.current.update("box", { host: "new-host", port: 2222 }); });
    expect(result.current.connections[0]).toEqual({ name: "box", host: "new-host", group: "Personal", tags: ["ssh"], port: 2222 });
    // The non-matching connection is left untouched.
    expect(result.current.connections[1]).toEqual(conn("other", "keep-host"));
  });

  it("hydrates initial state from storage", () => {
    localStorage.setItem(CUSTOM_CONNECTIONS_STORAGE_KEY, JSON.stringify([conn("stored")]));
    const { result } = renderHook(() => useCustomConnections());
    expect(result.current.connections).toEqual([conn("stored")]);
  });
});
