import { useCallback, useEffect, useRef, useState } from "react";
import type { Unlisten } from "./ipc";

export type PtyStatus = "idle" | "opening" | "open" | "closed" | "error";

export type PtyDeps = {
  open: (cols: number, rows: number) => Promise<string>;
  write: (ptyId: string, data: number[]) => Promise<void>;
  resize: (ptyId: string, cols: number, rows: number) => Promise<void>;
  close: (ptyId: string) => Promise<void>;
  subscribe: (
    ptyId: string,
    onData: (bytes: number[]) => void,
    onExit: (code: number) => void,
  ) => Promise<Unlisten>;
};

const PTY_COMMAND_BLOCKED_PREFIX = "pty input blocked by desktop safety policy";

/// Drives an interactive PTY's lifecycle. IPC is injected (the desktop wires
/// real `pty*` calls); `onData` is the sink for output bytes (xterm.write).
/// Inactive when `deps` is undefined so the pane keeps its line fallback.
export function usePtySession(deps: PtyDeps | undefined, onData: (bytes: number[]) => void) {
  const [status, setStatus] = useState<PtyStatus>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<Unlisten | null>(null);
  const generationRef = useRef(0);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const resetRefs = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
    const ptyId = ptyIdRef.current;
    ptyIdRef.current = null;
    return ptyId;
  }, []);

  const open = useCallback(
    async (cols: number, rows: number) => {
      if (!deps || ptyIdRef.current) return;
      const generation = generationRef.current;
      setStatus("opening");
      setExitCode(null);
      setBlockedReason(null);
      try {
        const ptyId = await deps.open(cols, rows);
        if (generationRef.current !== generation) {
          void deps.close(ptyId);
          return;
        }

        ptyIdRef.current = ptyId;
        const isCurrentPty = () => generationRef.current === generation && ptyIdRef.current === ptyId;
        const unlisten = await deps.subscribe(
          ptyId,
          (bytes) => {
            if (isCurrentPty()) onDataRef.current(bytes);
          },
          (code) => {
            if (!isCurrentPty()) return;
            resetRefs();
            setExitCode(code);
            setBlockedReason(null);
            setStatus("closed");
          },
        );
        if (generationRef.current !== generation || ptyIdRef.current !== ptyId) {
          unlisten();
          if (ptyIdRef.current === ptyId) {
            ptyIdRef.current = null;
            void deps.close(ptyId);
          }
          return;
        }

        unlistenRef.current = unlisten;
        setStatus("open");
      } catch {
        if (generationRef.current === generation) {
          const ptyId = resetRefs();
          if (ptyId) void deps.close(ptyId);
          setExitCode(null);
          setBlockedReason(null);
          setStatus("error");
        }
      }
    },
    [deps, resetRefs],
  );

  const write = useCallback(
    (data: number[]) => {
      const ptyId = ptyIdRef.current;
      if (!deps || !ptyId) return;
      const generation = generationRef.current;
      void deps.write(ptyId, data).then(
        () => {
          if (generationRef.current === generation && ptyIdRef.current === ptyId) {
            setBlockedReason(null);
          }
        },
        (error: unknown) => {
          if (generationRef.current !== generation || ptyIdRef.current !== ptyId) {
            return;
          }

          const reason = ptyCommandBlockedReason(error);
          if (reason !== null) {
            setBlockedReason(reason);
            return;
          }

          setStatus("error");
        },
      );
    },
    [deps],
  );

  const resize = useCallback(
    (cols: number, rows: number) => {
      if (deps && ptyIdRef.current) void deps.resize(ptyIdRef.current, cols, rows);
    },
    [deps],
  );

  const close = useCallback(() => {
    generationRef.current += 1;
    const ptyId = resetRefs();
    if (deps && ptyId) void deps.close(ptyId);
    setExitCode(null);
    setBlockedReason(null);
    setStatus("closed");
  }, [deps, resetRefs]);

  // Tear down on unmount or when the active backend/session changes.
  useEffect(() => {
    setStatus("idle");
    setExitCode(null);
    setBlockedReason(null);
    return () => {
      generationRef.current += 1;
      const ptyId = resetRefs();
      if (deps && ptyId) void deps.close(ptyId);
    };
  }, [deps, resetRefs]);

  return { status, exitCode, blockedReason, active: deps !== undefined, open, write, resize, close };
}

function ptyCommandBlockedReason(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message === PTY_COMMAND_BLOCKED_PREFIX) {
    return "";
  }
  if (message.startsWith(`${PTY_COMMAND_BLOCKED_PREFIX}: `)) {
    return message.slice(PTY_COMMAND_BLOCKED_PREFIX.length + 2);
  }

  return null;
}
