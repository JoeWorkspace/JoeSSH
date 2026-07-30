import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button, IconButton } from "@atlasterm/ui";
import { usePtySession, type PtyDeps } from "./usePtySession";

const encoder = new TextEncoder();
const DEFAULT_CELL_WIDTH_PX = 8;
const DEFAULT_CELL_HEIGHT_PX = 17;
const TERMINAL_PADDING_PX = 16;
const MIN_COLS = 20;
const MIN_ROWS = 6;

type TerminalDimensions = {
  cols: number;
  rows: number;
};

export type XtermTerminalStatusLabels = {
  opening: string;
  open: string;
  blocked: string;
  closed: string;
  error: string;
  reconnect: string;
};

export type XtermTerminalSearch = {
  closeLabel: string;
  matchesLabel: (count: number) => string;
  nextLabel: string;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  open: boolean;
  placeholder: string;
  previousLabel: string;
  query: string;
};

type TerminalSearchMatch = {
  column: number;
  line: number;
  length: number;
};

const defaultStatusLabels: XtermTerminalStatusLabels = {
  opening: "Opening terminal...",
  open: "Terminal connected",
  blocked: "Terminal input blocked by safety policy",
  closed: "Terminal exited",
  error: "Terminal failed to open",
  reconnect: "Reconnect",
};

export function measureTerminalDimensions(
  container: HTMLElement,
  fallback: TerminalDimensions,
): TerminalDimensions {
  const rect = container.getBoundingClientRect();
  const width = rect.width || container.clientWidth;
  const height = rect.height || container.clientHeight;

  if (width <= 0 || height <= 0) {
    return fallback;
  }

  return {
    cols: Math.max(
      MIN_COLS,
      Math.floor(
        Math.max(0, width - TERMINAL_PADDING_PX) / DEFAULT_CELL_WIDTH_PX,
      ),
    ),
    rows: Math.max(
      MIN_ROWS,
      Math.floor(
        Math.max(0, height - TERMINAL_PADDING_PX) / DEFAULT_CELL_HEIGHT_PX,
      ),
    ),
  };
}

/// Interactive xterm.js terminal bound to a real PTY (desktop runtime).
///
export function XtermTerminal({
  deps,
  label,
  cols = 80,
  rows = 24,
  onPreparedInputConsumed,
  preparedInput,
  search,
  statusLabels = defaultStatusLabels,
}: {
  deps: PtyDeps;
  label: string;
  cols?: number;
  rows?: number;
  onPreparedInputConsumed?: () => void;
  preparedInput?: string;
  search?: XtermTerminalSearch;
  statusLabels?: XtermTerminalStatusLabels;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const dimensionsRef = useRef<TerminalDimensions>({ cols, rows });
  const decoderRef = useRef(new TextDecoder());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [bufferVersion, setBufferVersion] = useState(0);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const pty = usePtySession(deps, (bytes) => {
    termRef.current?.write(
      decoderRef.current.decode(new Uint8Array(bytes), { stream: true }),
      () => setBufferVersion((version) => version + 1),
    );
  });
  const { close, open, resize, write } = pty;
  const searchMatches = useMemo(() => {
    void bufferVersion;
    void pty.status;
    const rawQuery = search?.query ?? "";
    const query = rawQuery.trim()
      ? rawQuery.toLocaleLowerCase()
      : "";
    const terminal = termRef.current;
    if (!search?.open || !query || !terminal) return [];

    const matches: TerminalSearchMatch[] = [];
    const buffer = terminal.buffer.active;
    for (let line = 0; line < buffer.length; line += 1) {
      const text =
        buffer.getLine(line)?.translateToString(true).toLocaleLowerCase() ?? "";
      let column = text.indexOf(query);
      while (column >= 0) {
        matches.push({ column, line, length: query.length });
        column = text.indexOf(query, column + Math.max(query.length, 1));
      }
    }
    return matches;
  }, [bufferVersion, pty.status, search?.open, search?.query]);

  useEffect(() => {
    setCurrentSearchIndex(0);
  }, [search?.query]);

  useEffect(() => {
    if (!search?.open) {
      termRef.current?.clearSelection();
      return;
    }
    searchInputRef.current?.focus();
  }, [search?.open]);

  useEffect(() => {
    const terminal = termRef.current;
    if (!terminal || searchMatches.length === 0) {
      terminal?.clearSelection();
      return;
    }

    const nextIndex = Math.min(currentSearchIndex, searchMatches.length - 1);
    if (nextIndex !== currentSearchIndex) {
      setCurrentSearchIndex(nextIndex);
      return;
    }
    const match = searchMatches[nextIndex];
    terminal.select(match.column, match.line, match.length);
    terminal.scrollToLine(match.line);
  }, [currentSearchIndex, searchMatches]);

  useEffect(() => {
    if (!preparedInput || pty.status !== "open") return;
    write(Array.from(encoder.encode(preparedInput)));
    termRef.current?.focus();
    onPreparedInputConsumed?.();
  }, [onPreparedInputConsumed, preparedInput, pty.status, write]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    decoderRef.current = new TextDecoder();
    const fallbackDimensions = { cols, rows };
    const initialDimensions = measureTerminalDimensions(
      container,
      fallbackDimensions,
    );
    dimensionsRef.current = initialDimensions;
    const term = new Terminal({
      ...initialDimensions,
      convertEol: false,
      fontFamily: "monospace",
      fontSize: 13,
    });
    termRef.current = term;
    term.open(container);
    const dataSub = term.onData((input) => {
      write(Array.from(encoder.encode(input)));
    });
    void open(initialDimensions.cols, initialDimensions.rows);

    const applyDimensions = (next: TerminalDimensions) => {
      const current = dimensionsRef.current;
      if (current.cols === next.cols && current.rows === next.rows) {
        return;
      }

      dimensionsRef.current = next;
      term.resize(next.cols, next.rows);
      resize(next.cols, next.rows);
    };

    let disconnectResize: (() => void) | undefined;
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        const target = entries[0]?.target;
        applyDimensions(
          measureTerminalDimensions(
            target instanceof HTMLElement ? target : container,
            fallbackDimensions,
          ),
        );
      });
      observer.observe(container);
      disconnectResize = () => observer.disconnect();
    } else {
      const handleWindowResize = () => {
        applyDimensions(
          measureTerminalDimensions(container, fallbackDimensions),
        );
      };
      window.addEventListener("resize", handleWindowResize);
      disconnectResize = () =>
        window.removeEventListener("resize", handleWindowResize);
    }

    return () => {
      disconnectResize?.();
      dataSub.dispose();
      close();
      term.dispose();
      termRef.current = null;
    };
  }, [close, cols, open, resize, rows, write]);

  const statusText =
    pty.blockedReason !== null
      ? pty.blockedReason
        ? `${statusLabels.blocked}: ${pty.blockedReason}`
        : statusLabels.blocked
      : pty.status === "opening"
        ? statusLabels.opening
        : pty.status === "open"
          ? statusLabels.open
          : pty.status === "error"
            ? statusLabels.error
            : pty.status === "closed" && pty.exitCode !== null
              ? `${statusLabels.closed} (${pty.exitCode})`
              : statusLabels.closed;

  const goToSearchMatch = (direction: 1 | -1) => {
    if (searchMatches.length === 0) return;
    setCurrentSearchIndex((current) => {
      const next = current + direction;
      if (next < 0) return searchMatches.length - 1;
      if (next >= searchMatches.length) return 0;
      return next;
    });
  };

  return (
    <div className={`xterm-shell${search?.open ? " is-searching" : ""}`}>
      {search?.open ? (
        <div
          aria-label={search.placeholder}
          className="terminal-search-bar"
          role="search"
        >
          <Search aria-hidden="true" size={14} />
          <input
            aria-label={search.placeholder}
            onChange={(event) =>
              search.onQueryChange(event.currentTarget.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                search.onClose();
              } else if (event.key === "Enter") {
                event.preventDefault();
                goToSearchMatch(event.shiftKey ? -1 : 1);
              }
            }}
            placeholder={search.placeholder}
            ref={searchInputRef}
            value={search.query}
          />
          <span className="terminal-search-count">
            {searchMatches.length > 0
              ? `${currentSearchIndex + 1}/${searchMatches.length}`
              : search.matchesLabel(0)}
          </span>
          <IconButton
            disabled={searchMatches.length === 0}
            label={search.previousLabel}
            onClick={() => goToSearchMatch(-1)}
          >
            <ChevronUp size={14} />
          </IconButton>
          <IconButton
            disabled={searchMatches.length === 0}
            label={search.nextLabel}
            onClick={() => goToSearchMatch(1)}
          >
            <ChevronDown size={14} />
          </IconButton>
          <IconButton label={search.closeLabel} onClick={search.onClose}>
            <X size={14} />
          </IconButton>
        </div>
      ) : null}
      <div className="xterm-host" ref={containerRef} aria-label={label} />
      <div
        className="xterm-status-bar"
        role={pty.blockedReason !== null ? "alert" : "status"}
        aria-live={pty.blockedReason !== null ? "assertive" : "polite"}
      >
        <span>{statusText}</span>
        {pty.status === "closed" || pty.status === "error" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void open(dimensionsRef.current.cols, dimensionsRef.current.rows);
            }}
          >
            {statusLabels.reconnect}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
