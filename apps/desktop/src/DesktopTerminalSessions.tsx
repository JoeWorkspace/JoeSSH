import { lazy, Suspense, useMemo, type ReactNode } from "react";
import type { PtyDeps } from "./usePtySession";
import type { XtermTerminalStatusLabels } from "./XtermTerminal";

const LazyXtermTerminal = lazy(() =>
  import("./XtermTerminal").then((module) => ({ default: module.XtermTerminal })),
);

export type TerminalSessionBackend = Omit<PtyDeps, "open"> & {
  open: (sessionId: string, cols: number, rows: number) => Promise<string>;
};

type SessionTerminalProps = {
  sessionId: string;
  active: boolean;
  backend: TerminalSessionBackend;
  label: string;
  statusLabels: XtermTerminalStatusLabels;
  fallback: ReactNode;
};

function SessionTerminal({ sessionId, active, backend, label, statusLabels, fallback }: SessionTerminalProps) {
  const deps = useMemo<PtyDeps>(() => ({
    ...backend,
    open: (cols, rows) => backend.open(sessionId, cols, rows),
  }), [backend, sessionId]);

  return (
    <div
      className="terminal-pane terminal-pane--xterm"
      hidden={!active}
      style={active ? undefined : { display: "none" }}
    >
      <Suspense fallback={fallback}>
        <LazyXtermTerminal deps={deps} label={label} statusLabels={statusLabels} />
      </Suspense>
    </div>
  );
}

// A tab selection changes visibility only. Removing a disconnected session is
// what unmounts its terminal and closes its PTY.
export function DesktopTerminalSessions({
  sessionIds,
  activeSessionId,
  ...props
}: Omit<SessionTerminalProps, "sessionId" | "active"> & {
  sessionIds: readonly string[];
  activeSessionId?: string;
}) {
  return sessionIds.map((sessionId) => (
    <SessionTerminal key={sessionId} sessionId={sessionId} active={sessionId === activeSessionId} {...props} />
  ));
}
