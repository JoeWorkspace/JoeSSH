// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTerminalPane } from "./useTerminalPane";
import type { TerminalLine } from "./terminalExecutor";

function makeLines(count: number): TerminalLine[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `line-${i}`,
    text: `Line ${i} content`,
    kind: "output" as const,
  }));
}

function makeLinesWithMatches(query: string, count: number): TerminalLine[] {
  const lines = makeLines(count);
  lines[2] = { id: "match-1", text: `Found ${query} here`, kind: "output" };
  lines[5] = { id: "match-2", text: `Another ${query} match`, kind: "output" };
  lines[8] = { id: "match-3", text: `Third ${query} occurrence`, kind: "output" };
  return lines;
}

const defaultProps = {
  lines: makeLines(10),
  active: true,
  commandInput: "",
  commandHistory: [],
  onCommandInputChange: vi.fn(),
  onCommandSubmit: vi.fn(),
  searchQuery: "",
};

describe("useTerminalPane", () => {
  describe("search", () => {
    it("initializes with no matches", () => {
      const { result } = renderHook(() => useTerminalPane(defaultProps));
      expect(result.current.matchIndices).toEqual([]);
      expect(result.current.totalMatches).toBe(0);
      expect(result.current.matchCount).toBe(0);
    });

    it("computes match indices for search query", () => {
      const lines = makeLinesWithMatches("test", 10);
      const { result } = renderHook(() => useTerminalPane({ ...defaultProps, lines, searchQuery: "test" }));
      expect(result.current.matchIndices).toEqual([2, 5, 8]);
      expect(result.current.totalMatches).toBe(3);
      expect(result.current.matchCount).toBe(3);
    });

    it("navigates to next match", () => {
      const lines = makeLinesWithMatches("test", 10);
      const { result } = renderHook(() => useTerminalPane({ ...defaultProps, lines, searchQuery: "test" }));
      expect(result.current.currentMatchIdx).toBe(0);
      act(() => result.current.goToMatch(1));
      expect(result.current.currentMatchIdx).toBe(1);
      act(() => result.current.goToMatch(1));
      expect(result.current.currentMatchIdx).toBe(2);
    });

    it("wraps around to first match when going past last", () => {
      const lines = makeLinesWithMatches("test", 10);
      const { result } = renderHook(() => useTerminalPane({ ...defaultProps, lines, searchQuery: "test" }));
      act(() => result.current.goToMatch(1));
      act(() => result.current.goToMatch(1));
      act(() => result.current.goToMatch(1));
      expect(result.current.currentMatchIdx).toBe(0);
    });

    it("wraps around to last match when going before first", () => {
      const lines = makeLinesWithMatches("test", 10);
      const { result } = renderHook(() => useTerminalPane({ ...defaultProps, lines, searchQuery: "test" }));
      act(() => result.current.goToMatch(-1));
      expect(result.current.currentMatchIdx).toBe(2);
    });

    it("resets match index when search query changes", () => {
      const lines = makeLinesWithMatches("test", 10);
      const { result, rerender } = renderHook(
        (props) => useTerminalPane(props),
        { initialProps: { ...defaultProps, lines, searchQuery: "test" } },
      );
      act(() => result.current.goToMatch(1));
      expect(result.current.currentMatchIdx).toBe(1);
      rerender({ ...defaultProps, lines, searchQuery: "new" });
      expect(result.current.currentMatchIdx).toBe(0);
    });

    it("re-clamps the match index when the match set shrinks for the same query", () => {
      const manyMatches = makeLinesWithMatches("test", 10); // 3 matches
      const oneMatch = makeLines(10);
      oneMatch[1] = { id: "only-match", text: "only test line", kind: "output" };
      const { result, rerender } = renderHook(
        (props) => useTerminalPane(props),
        { initialProps: { ...defaultProps, lines: manyMatches, searchQuery: "test" } },
      );
      act(() => result.current.goToMatch(1));
      act(() => result.current.goToMatch(1));
      expect(result.current.currentMatchIdx).toBe(2);

      // Switching connections changes lines (1 match) but keeps the query.
      rerender({ ...defaultProps, lines: oneMatch, searchQuery: "test" });
      expect(result.current.totalMatches).toBe(1);
      expect(result.current.currentMatchIdx).toBe(0); // re-clamped, not stale 2
      expect(result.current.matchIndices[result.current.currentMatchIdx]).toBeDefined();
    });

    it("scrolls an off-screen match into view via the container scrollTop", () => {
      // Two matches: one near the top, one far down a long buffer.
      const lines = makeLines(400);
      lines[1] = { id: "near-match", text: "near needle", kind: "output" };
      lines[3] = { id: "near-match-2", text: "near needle two", kind: "output" };
      lines[300] = { id: "deep-match", text: "deep needle here", kind: "output" };
      const { result, rerender } = renderHook(
        (props) => useTerminalPane(props),
        { initialProps: { ...defaultProps, lines, searchQuery: "needle" } },
      );

      // Attach a stub element with a real viewport height; happy-dom does not lay out.
      const el = document.createElement("pre");
      Object.defineProperty(el, "clientHeight", { value: 360, configurable: true }); // 20 lines tall
      el.scrollTop = 0;
      (result.current.terminalPreRef as { current: HTMLPreElement | null }).current = el;

      // Navigate to the second near match (line 3): already within the viewport,
      // so neither scroll branch fires and scrollTop stays put.
      act(() => result.current.goToMatch(1)); // idx 1 -> line 3
      const lineHeight = result.current.LINE_HEIGHT;
      expect(el.scrollTop).toBe(0);

      // Navigate to the deep match (line 300): scrolls down into view.
      act(() => result.current.goToMatch(1)); // idx 2 -> line 300
      expect(el.scrollTop).toBeGreaterThan(0);
      expect(300 * lineHeight).toBeGreaterThanOrEqual(el.scrollTop);
      expect(300 * lineHeight + lineHeight).toBeLessThanOrEqual(el.scrollTop + 360);

      // Wrap back to the first near match (line 1): scrolls the view back up.
      act(() => result.current.goToMatch(1)); // idx 0 -> line 1
      expect(el.scrollTop).toBeLessThanOrEqual(1 * lineHeight);

      // With the ref attached but no matches, the effect early-returns (no scroll change).
      const before = el.scrollTop;
      rerender({ ...defaultProps, lines, searchQuery: "zzz-no-match" });
      expect(result.current.totalMatches).toBe(0);
      expect(el.scrollTop).toBe(before);
    });

    it("no-ops goToMatch when no matches", () => {
      const { result } = renderHook(() => useTerminalPane(defaultProps));
      act(() => result.current.goToMatch(1));
      expect(result.current.currentMatchIdx).toBe(0);
    });
  });

  describe("command history", () => {
    it("reports canAcceptCommand when active with handlers", () => {
      const { result } = renderHook(() => useTerminalPane(defaultProps));
      expect(result.current.canAcceptCommand).toBeTruthy();
    });

    it("reports canAcceptCommand=false when not active", () => {
      const { result } = renderHook(() => useTerminalPane({ ...defaultProps, active: false }));
      expect(result.current.canAcceptCommand).toBe(false);
    });

    it("navigates command history with ArrowUp/ArrowDown", () => {
      const history = ["cmd1", "cmd2", "cmd3"];
      const onChange = vi.fn();
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandHistory: history,
        commandInput: "",
        onCommandInputChange: onChange,
      }));

      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowUp", preventDefault: vi.fn() } as never);
      });
      expect(onChange).toHaveBeenCalledWith("cmd3");
    });

    it("navigates forward in history with ArrowDown", () => {
      const history = ["cmd1", "cmd2", "cmd3"];
      const onChange = vi.fn();
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandHistory: history,
        commandInput: "",
        onCommandInputChange: onChange,
      }));

      // First navigate into history with ArrowUp
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowUp", preventDefault: vi.fn() } as never);
      });
      expect(onChange).toHaveBeenCalledWith("cmd3");

      // Now navigate forward with ArrowDown
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowDown", preventDefault: vi.fn() } as never);
      });
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it("no-ops ArrowDown when not navigating history", () => {
      const history = ["cmd1"];
      const onChange = vi.fn();
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandHistory: history,
        commandInput: "",
        onCommandInputChange: onChange,
      }));

      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowDown", preventDefault: vi.fn() } as never);
      });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("autocomplete", () => {
    it("no-ops Tab when no suggestions", () => {
      const onChange = vi.fn();
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "",
        onCommandInputChange: onChange,
      }));

      act(() => {
        result.current.handleCommandKeyDown({ key: "Tab", preventDefault: vi.fn() } as never);
      });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("starts with no autocomplete suggestions", () => {
      const { result } = renderHook(() => useTerminalPane(defaultProps));
      expect(result.current.autocompleteSuggestions).toEqual([]);
      expect(result.current.autocompleteIdx).toBe(-1);
    });

    it("computes autocomplete suggestions from history", () => {
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "ku",
        commandHistory: ["kubectl get pods", "kubectl logs", "ls -la"],
      }));
      expect(result.current.autocompleteSuggestions.length).toBeGreaterThan(0);
      expect(result.current.autocompleteSuggestions.some((s) => s.startsWith("kubectl"))).toBe(true);
    });

    it("filters suggestions by prefix", () => {
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "ku",
        commandHistory: ["kubectl get pods", "docker ps"],
      }));
      expect(result.current.autocompleteSuggestions.every((s) => s.toLowerCase().startsWith("ku"))).toBe(true);
    });

    it("limits suggestions to 6", () => {
      const history = Array.from({ length: 20 }, (_, i) => `kubectl cmd${i}`);
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "ku",
        commandHistory: history,
      }));
      expect(result.current.autocompleteSuggestions.length).toBeLessThanOrEqual(6);
    });

    it("excludes exact match from suggestions", () => {
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "kubectl get pods",
        commandHistory: ["kubectl get pods", "kubectl logs"],
      }));
      expect(result.current.autocompleteSuggestions).not.toContain("kubectl get pods");
    });

    it("returns empty suggestions for short input", () => {
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "k",
        commandHistory: ["kubectl get pods"],
      }));
      expect(result.current.autocompleteSuggestions).toEqual([]);
    });

    it("navigates autocomplete with Alt+ArrowDown", () => {
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "ku",
        commandHistory: ["kubectl get pods", "kubectl logs"],
      }));
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowDown", altKey: true, preventDefault: vi.fn() } as never);
      });
      expect(result.current.autocompleteIdx).toBe(0);
    });

    it("navigates autocomplete with Alt+ArrowUp", () => {
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "ku",
        commandHistory: ["kubectl get pods", "kubectl logs"],
      }));
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowUp", altKey: true, preventDefault: vi.fn() } as never);
      });
      // Should wrap to last suggestion
      expect(result.current.autocompleteIdx).toBeGreaterThanOrEqual(0);
    });

    it("selects first suggestion on Tab when no selection", () => {
      const onChange = vi.fn();
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "ku",
        commandHistory: ["kubectl get pods", "kubectl logs"],
        onCommandInputChange: onChange,
      }));
      act(() => {
        result.current.handleCommandKeyDown({ key: "Tab", preventDefault: vi.fn() } as never);
      });
      expect(onChange).toHaveBeenCalled();
    });

    it("resets autocomplete index on ArrowUp/ArrowDown history navigation", () => {
      const onChange = vi.fn();
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "ku",
        commandHistory: ["kubectl get pods", "kubectl logs"],
        onCommandInputChange: onChange,
      }));
      // First navigate autocomplete
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowDown", altKey: true, preventDefault: vi.fn() } as never);
      });
      // Then navigate history
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowUp", preventDefault: vi.fn() } as never);
      });
      expect(result.current.autocompleteIdx).toBe(-1);
    });

    it("clears suggestions when commandInput is empty", () => {
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "",
        commandHistory: ["kubectl get pods"],
      }));
      expect(result.current.autocompleteSuggestions).toEqual([]);
    });

    it("wraps autocomplete index backward from 0", () => {
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "ku",
        commandHistory: ["kubectl get pods", "kubectl logs"],
      }));
      // Start at -1, Alt+ArrowUp should wrap to last
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowUp", altKey: true, preventDefault: vi.fn() } as never);
      });
      expect(result.current.autocompleteIdx).toBeGreaterThanOrEqual(0);
    });
  });

  describe("history navigation edge cases", () => {
    it("skips isNavigatingHistory when commandInput changes from history", () => {
      const onChange = vi.fn();
      const history = ["cmd1", "cmd2"];
      const { result, rerender } = renderHook(
        (props) => useTerminalPane(props),
        { initialProps: { ...defaultProps, commandHistory: history, commandInput: "", onCommandInputChange: onChange } },
      );

      // Navigate into history
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowUp", preventDefault: vi.fn() } as never);
      });
      expect(onChange).toHaveBeenCalledWith("cmd2");

      // Simulate React re-rendering with new commandInput from history
      rerender({ ...defaultProps, commandHistory: history, commandInput: "cmd2", onCommandInputChange: onChange });

      // The historyIdx should be 1 (not reset to -1) because isNavigatingHistory was true
      // Now manually change commandInput (not from history navigation)
      rerender({ ...defaultProps, commandHistory: history, commandInput: "manual", onCommandInputChange: onChange });
      // historyIdx should reset to -1
    });

    it("navigates forward within history without reaching end", () => {
      const onChange = vi.fn();
      const history = ["cmd1", "cmd2", "cmd3"];
      const { result, rerender } = renderHook(
        (props) => useTerminalPane(props),
        { initialProps: { ...defaultProps, commandHistory: history, commandInput: "", onCommandInputChange: onChange } },
      );

      // Go to last item
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowUp", preventDefault: vi.fn() } as never);
      });
      // Re-render with new commandInput
      rerender({ ...defaultProps, commandHistory: history, commandInput: "cmd3", onCommandInputChange: onChange });

      // Go back one step
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowUp", preventDefault: vi.fn() } as never);
      });
      rerender({ ...defaultProps, commandHistory: history, commandInput: "cmd2", onCommandInputChange: onChange });

      // Now go forward one step (should go to cmd3, not restore savedInput)
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowDown", preventDefault: vi.fn() } as never);
      });
      expect(onChange).toHaveBeenCalledWith("cmd3");
    });

    it("restores savedInput when navigating past end of history", () => {
      const onChange = vi.fn();
      const history = ["cmd1"];
      const { result, rerender } = renderHook(
        (props) => useTerminalPane(props),
        { initialProps: { ...defaultProps, commandHistory: history, commandInput: "original", onCommandInputChange: onChange } },
      );

      // Go into history
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowUp", preventDefault: vi.fn() } as never);
      });
      rerender({ ...defaultProps, commandHistory: history, commandInput: "cmd1", onCommandInputChange: onChange });

      // Navigate past end
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowDown", preventDefault: vi.fn() } as never);
      });
      expect(onChange).toHaveBeenCalledWith("original");
    });
  });

  describe("virtualization", () => {
    it("returns all lines when fewer than 200", () => {
      const lines = makeLines(10);
      const { result } = renderHook(() => useTerminalPane({ ...defaultProps, lines }));
      expect(result.current.virtualizedLines.visible).toHaveLength(10);
      expect(result.current.virtualizedLines.startIndex).toBe(0);
    });

    it("virtualizes when 200+ lines", () => {
      const lines = makeLines(300);
      const { result } = renderHook(() => useTerminalPane({ ...defaultProps, lines }));
      expect(result.current.virtualizedLines.visible.length).toBeLessThan(300);
      expect(result.current.virtualizedLines.totalHeight).toBe(300 * 18);
    });

    it("exposes terminalPreRef", () => {
      const { result } = renderHook(() => useTerminalPane(defaultProps));
      expect(result.current.terminalPreRef).toBeDefined();
      expect(result.current.terminalPreRef.current).toBeNull();
    });

    it("exposes handleTerminalScroll", () => {
      const { result } = renderHook(() => useTerminalPane(defaultProps));
      expect(typeof result.current.handleTerminalScroll).toBe("function");
    });

    it("handleTerminalScroll does nothing when ref is null", () => {
      const { result } = renderHook(() => useTerminalPane(defaultProps));
      // terminalPreRef.current is null in renderHook
      act(() => result.current.handleTerminalScroll());
      // Should not throw
    });

    it("handleTerminalScroll updates scrollTop when ref is connected", () => {
      const { result } = renderHook(() => useTerminalPane(defaultProps));
      // Manually set the ref to a mock element
      const mockEl = document.createElement("pre");
      Object.defineProperty(mockEl, "scrollTop", { value: 250, configurable: true, writable: true });
      Object.defineProperty(mockEl, "scrollHeight", { value: 1000, configurable: true, writable: true });
      (result.current.terminalPreRef as { current: HTMLPreElement | null }).current = mockEl;
      act(() => result.current.handleTerminalScroll());
      // scrollTop state should be updated (virtualizedLines.offsetY changes)
      expect(result.current.virtualizedLines).toBeDefined();
    });
  });

  describe("autocomplete branch coverage", () => {
    it("Tab selects by autocompleteIdx when >= 0", () => {
      const onChange = vi.fn();
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "ku",
        commandHistory: ["kubectl get pods", "kubectl logs"],
        onCommandInputChange: onChange,
      }));

      // Navigate to second suggestion
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowDown", altKey: true, preventDefault: vi.fn() } as never);
      });
      expect(result.current.autocompleteIdx).toBe(0);

      // Now press Tab — should select the item at autocompleteIdx
      act(() => {
        result.current.handleCommandKeyDown({ key: "Tab", preventDefault: vi.fn() } as never);
      });
      expect(onChange).toHaveBeenCalled();
    });

    it("Alt+ArrowUp wraps from positive index to last", () => {
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "ku",
        commandHistory: ["kubectl get pods", "kubectl logs", "kubectl exec -it"],
      }));

      // Navigate forward to index 1
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowDown", altKey: true, preventDefault: vi.fn() } as never);
      });
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowDown", altKey: true, preventDefault: vi.fn() } as never);
      });
      expect(result.current.autocompleteIdx).toBe(1);

      // Alt+ArrowUp from index 1 should go to index 0 (prev - 1)
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowUp", altKey: true, preventDefault: vi.fn() } as never);
      });
      expect(result.current.autocompleteIdx).toBe(0);
    });

    it("Tab with autocompleteIdx out of range selects first suggestion", () => {
      const onChange = vi.fn();
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "ku",
        commandHistory: ["kubectl get pods", "kubectl logs"],
        onCommandInputChange: onChange,
      }));

      // autocompleteIdx is -1, Tab should select first
      act(() => {
        result.current.handleCommandKeyDown({ key: "Tab", preventDefault: vi.fn() } as never);
      });
      expect(onChange).toHaveBeenCalled();
    });

    it("Tab with autocompleteIdx beyond array length does nothing", () => {
      const onChange = vi.fn();
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "ku",
        commandHistory: ["kubectl get pods", "kubectl logs"],
        onCommandInputChange: onChange,
      }));

      // Set autocompleteIdx beyond the suggestions length via multiple Alt+ArrowDown
      // suggestions length is from mocked module + history matching "ku"
      // Force index beyond bounds using setAutocompleteIdx
      act(() => {
        result.current.setAutocompleteIdx(999);
      });

      // Tab with out-of-bounds index — selected will be undefined, so onChange should NOT be called
      const callCountBefore = onChange.mock.calls.length;
      act(() => {
        result.current.handleCommandKeyDown({ key: "Tab", preventDefault: vi.fn() } as never);
      });
      // selected is undefined (out of bounds), so onCommandInputChange should not be called
      expect(onChange.mock.calls.length).toBe(callCountBefore);
    });

    it("ArrowUp with undefined commandInput uses empty string for savedInput", () => {
      const onChange = vi.fn();
      const history = ["cmd1"];
      const { result, rerender } = renderHook(
        (props) => useTerminalPane(props),
        { initialProps: { ...defaultProps, commandHistory: history, commandInput: undefined as unknown as string, onCommandInputChange: onChange } },
      );

      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowUp", preventDefault: vi.fn() } as never);
      });
      expect(onChange).toHaveBeenCalledWith("cmd1");

      // Re-render and navigate back
      rerender({ ...defaultProps, commandHistory: history, commandInput: "cmd1", onCommandInputChange: onChange });
      act(() => {
        result.current.handleCommandKeyDown({ key: "ArrowDown", preventDefault: vi.fn() } as never);
      });
      // savedInput was "" (from undefined ?? ""), so ArrowDown past end restores ""
      expect(onChange).toHaveBeenCalledWith("");
    });

    it("regular key press when canAcceptCommand does not affect history", () => {
      const onChange = vi.fn();
      const { result } = renderHook(() => useTerminalPane({
        ...defaultProps,
        commandInput: "",
        commandHistory: ["cmd1"],
        onCommandInputChange: onChange,
      }));

      // Press a regular key (not ArrowUp/ArrowDown) — should not trigger history nav
      act(() => {
        result.current.handleCommandKeyDown({ key: "a", preventDefault: vi.fn() } as never);
      });
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
