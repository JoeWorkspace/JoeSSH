import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { TerminalLine } from "./terminalExecutor";

interface UseTerminalPaneOptions {
  lines: TerminalLine[];
  active: boolean;
  commandInput?: string;
  commandHistory?: string[];
  onCommandInputChange?: (value: string) => void;
  onCommandSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  searchQuery?: string;
}

const LINE_HEIGHT = 18;
const OVERSCAN = 10;

export function useTerminalPane({
  lines,
  active,
  commandInput,
  commandHistory = [],
  onCommandInputChange,
  onCommandSubmit,
  searchQuery,
}: UseTerminalPaneOptions) {
  // --- Search match navigation ---
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const matchIndices = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    return lines.reduce<number[]>((acc, line, i) => {
      if (line.text.toLowerCase().includes(q)) acc.push(i);
      return acc;
    }, []);
  }, [lines, searchQuery]);
  const totalMatches = matchIndices.length;

  const goToMatch = useCallback((direction: 1 | -1) => {
    if (totalMatches === 0) return;
    setCurrentMatchIdx((prev) => {
      const next = prev + direction;
      if (next < 0) return totalMatches - 1;
      if (next >= totalMatches) return 0;
      return next;
    });
  }, [totalMatches]);

  useEffect(() => { setCurrentMatchIdx(0); }, [searchQuery]);

  // Re-clamp when the match set shrinks for the same query (e.g. switching
  // connections changes `lines` but not `searchQuery`), so the counter and
  // highlight never point past the end of matchIndices.
  useEffect(() => {
    setCurrentMatchIdx((prev) => (prev >= totalMatches ? 0 : prev));
  }, [totalMatches]);

  const matchCount = useMemo(() => {
    if (!searchQuery) return 0;
    const q = searchQuery.toLowerCase();
    return lines.filter((line) => line.text.toLowerCase().includes(q)).length;
  }, [lines, searchQuery]);

  // --- Command history navigation ---
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [savedInput, setSavedInput] = useState("");
  const isNavigatingHistory = useRef(false);
  const canAcceptCommand = active && onCommandInputChange && onCommandSubmit;

  useEffect(() => {
    if (isNavigatingHistory.current) {
      isNavigatingHistory.current = false;
      return;
    }
    setHistoryIdx(-1);
  }, [commandInput]);

  // --- Autocomplete ---
  const [autocompleteIdx, setAutocompleteIdx] = useState(-1);
  const [autocompleteCommands, setAutocompleteCommands] = useState<readonly string[]>([]);

  useEffect(() => {
    if (commandInput && commandInput.length >= 2 && autocompleteCommands.length === 0) {
      import("./autocompleteCommands").then((m) => setAutocompleteCommands(m.terminalAutocompleteCommands));
    }
  }, [commandInput, autocompleteCommands.length]);

  const autocompleteSuggestions = useMemo(() => {
    if (!commandInput || commandInput.length < 2) return [];
    const q = commandInput.toLowerCase();
    const fromHistory = commandHistory.filter((cmd) => cmd.toLowerCase().startsWith(q) && cmd !== commandInput);
    const fromCommands = autocompleteCommands.filter((cmd) => cmd.toLowerCase().startsWith(q) && cmd !== commandInput);
    const combined = [...new Set([...fromHistory, ...fromCommands])];
    return combined.slice(0, 6);
  }, [commandInput, commandHistory, autocompleteCommands]);

  const handleCommandKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (autocompleteSuggestions.length > 0 && event.key === "Tab") {
      event.preventDefault();
      const selected = autocompleteIdx >= 0 ? autocompleteSuggestions[autocompleteIdx] : autocompleteSuggestions[0];
      if (selected) {
        onCommandInputChange?.(selected);
        setAutocompleteIdx(-1);
      }
      return;
    }

    if (autocompleteSuggestions.length > 0 && event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      setAutocompleteIdx((prev) => (prev + 1) % autocompleteSuggestions.length);
      return;
    }

    if (autocompleteSuggestions.length > 0 && event.key === "ArrowUp" && event.altKey) {
      event.preventDefault();
      setAutocompleteIdx((prev) => (prev <= 0 ? autocompleteSuggestions.length - 1 : prev - 1));
      return;
    }

    if (!canAcceptCommand || commandHistory.length === 0) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setAutocompleteIdx(-1);
      const next = historyIdx < 0 ? commandHistory.length - 1 : Math.max(0, historyIdx - 1);
      if (historyIdx < 0) setSavedInput(commandInput ?? "");
      setHistoryIdx(next);
      isNavigatingHistory.current = true;
      onCommandInputChange?.(commandHistory[next]);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setAutocompleteIdx(-1);
      if (historyIdx < 0) return;
      const next = historyIdx + 1;
      if (next >= commandHistory.length) {
        setHistoryIdx(-1);
        isNavigatingHistory.current = true;
        onCommandInputChange?.(savedInput);
      } else {
        setHistoryIdx(next);
        isNavigatingHistory.current = true;
        onCommandInputChange?.(commandHistory[next]);
      }
    }
  }, [canAcceptCommand, commandHistory, historyIdx, commandInput, onCommandInputChange, savedInput, autocompleteSuggestions, autocompleteIdx]);

  // --- Virtualization ---
  const terminalPreRef = useRef<HTMLPreElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    if (terminalPreRef.current) {
      terminalPreRef.current.scrollTop = terminalPreRef.current.scrollHeight;
    }
  }, [lines]);

  const handleTerminalScroll = useCallback(() => {
    if (terminalPreRef.current) {
      setScrollTop(terminalPreRef.current.scrollTop);
    }
  }, []);

  // Scroll the active search match into view. In the virtualized branch the
  // matched line may be outside the rendered slice (so the per-line
  // scrollIntoView ref never mounts); driving scrollTop here both reveals it
  // and triggers the slice recompute that renders it.
  useEffect(() => {
    const el = terminalPreRef.current;
    if (!el || totalMatches === 0) return;
    const lineTop = matchIndices[currentMatchIdx] * LINE_HEIGHT;
    const lineBottom = lineTop + LINE_HEIGHT;
    if (lineTop < el.scrollTop) {
      el.scrollTop = lineTop;
    } else if (lineBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = lineBottom - el.clientHeight;
    }
    setScrollTop(el.scrollTop);
  }, [currentMatchIdx, matchIndices, totalMatches]);

  useEffect(() => {
    const el = terminalPreRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const virtualizedLines = useMemo(() => {
    if (lines.length < 200) return { visible: lines, startIndex: 0, totalHeight: lines.length * LINE_HEIGHT, offsetY: 0 };
    const startIndex = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
    const endIndex = Math.min(lines.length, Math.ceil((scrollTop + containerHeight) / LINE_HEIGHT) + OVERSCAN);
    return {
      visible: lines.slice(startIndex, endIndex),
      startIndex,
      totalHeight: lines.length * LINE_HEIGHT,
      offsetY: startIndex * LINE_HEIGHT,
    };
  }, [lines, scrollTop, containerHeight]);

  return {
    // Search
    currentMatchIdx,
    matchIndices,
    totalMatches,
    matchCount,
    goToMatch,
    // Command input
    canAcceptCommand,
    autocompleteIdx,
    setAutocompleteIdx,
    autocompleteSuggestions,
    handleCommandKeyDown,
    // Virtualization
    terminalPreRef,
    virtualizedLines,
    handleTerminalScroll,
    // Constants
    LINE_HEIGHT,
  };
}
