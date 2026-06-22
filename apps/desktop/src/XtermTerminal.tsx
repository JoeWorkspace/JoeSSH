import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@atlasterm/ui";
import { usePtySession, type PtyDeps } from "./usePtySession";

const decoder = new TextDecoder();
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
    cols: Math.max(MIN_COLS, Math.floor(Math.max(0, width - TERMINAL_PADDING_PX) / DEFAULT_CELL_WIDTH_PX)),
    rows: Math.max(MIN_ROWS, Math.floor(Math.max(0, height - TERMINAL_PADDING_PX) / DEFAULT_CELL_HEIGHT_PX)),
  };
}

/// Interactive xterm.js terminal bound to a real PTY (desktop runtime).
///
export function XtermTerminal({
  deps,
  label,
  cols = 80,
  rows = 24,
  statusLabels = defaultStatusLabels,
}: {
  deps: PtyDeps;
  label: string;
  cols?: number;
  rows?: number;
  statusLabels?: XtermTerminalStatusLabels;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const dimensionsRef = useRef<TerminalDimensions>({ cols, rows });
  const pty = usePtySession(deps, (bytes) => {
    termRef.current?.write(decoder.decode(new Uint8Array(bytes)));
  });
  const { close, open, resize, write } = pty;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const fallbackDimensions = { cols, rows };
    const initialDimensions = measureTerminalDimensions(container, fallbackDimensions);
    dimensionsRef.current = initialDimensions;
    const term = new Terminal({ ...initialDimensions, convertEol: false, fontFamily: "monospace", fontSize: 13 });
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
        applyDimensions(measureTerminalDimensions(target instanceof HTMLElement ? target : container, fallbackDimensions));
      });
      observer.observe(container);
      disconnectResize = () => observer.disconnect();
    } else {
      const handleWindowResize = () => {
        applyDimensions(measureTerminalDimensions(container, fallbackDimensions));
      };
      window.addEventListener("resize", handleWindowResize);
      disconnectResize = () => window.removeEventListener("resize", handleWindowResize);
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

  return (
    <div className="xterm-shell">
      <div className="xterm-host" ref={containerRef} aria-label={label} />
      <div className="xterm-status-bar" role={pty.blockedReason !== null ? "alert" : "status"} aria-live={pty.blockedReason !== null ? "assertive" : "polite"}>
        <span>{statusText}</span>
        {pty.status === "closed" || pty.status === "error" ? (
          <Button size="sm" variant="ghost" onClick={() => { void open(dimensionsRef.current.cols, dimensionsRef.current.rows); }}>
            {statusLabels.reconnect}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
