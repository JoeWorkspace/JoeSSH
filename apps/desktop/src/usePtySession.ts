import { useCallback, useEffect, useRef, useState } from "react";

export type PtyStatus = "idle" | "opening" | "open" | "closed" | "error";
export type PtyEvents = {
  onData: (bytes: number[]) => void | Promise<void>;
  onExit: (code: number) => void;
  onError: () => void;
  signal: AbortSignal;
};
export type PtyDeps = {
  open: (cols: number, rows: number, events: PtyEvents) => Promise<string>;
  write: (ptyId: string, data: number[]) => Promise<void>;
  resize: (ptyId: string, cols: number, rows: number) => Promise<void>;
  close: (ptyId: string) => Promise<void>;
};

export const PTY_INPUT_CHUNK_BYTES = 16 * 1024;
export const PTY_PENDING_INPUT_BYTES = 128 * 1024;
const PTY_COMMAND_BLOCKED_PREFIX = "pty input blocked by desktop safety policy";
type Attempt = {
  number: number;
  controller: AbortController;
  id: string | null;
  ended: boolean;
  busy: boolean;
  queue: number[][];
  pendingBytes: number;
};

export function usePtySession(
  deps: PtyDeps | undefined,
  onData: (bytes: number[]) => void | Promise<void>,
) {
  const [status, setStatus] = useState<PtyStatus>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [attemptNumber, setAttemptNumber] = useState(0);
  const attemptRef = useRef<Attempt | null>(null);
  const counter = useRef(0);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const reset = useCallback(() => {
    const attempt = attemptRef.current;
    attemptRef.current = null;
    if (attempt) {
      attempt.ended = true;
      attempt.controller.abort();
      attempt.queue = [];
      attempt.pendingBytes = 0;
    }
    return attempt?.id;
  }, []);

  const close = useCallback(() => {
    const id = reset();
    if (deps && id) void deps.close(id).catch(() => {});
    setStatus("closed");
    setBlockedReason(null);
  }, [deps, reset]);

  useEffect(() => {
    setStatus("idle");
    setExitCode(null);
    setBlockedReason(null);
    return () => {
      const id = reset();
      if (deps && id) void deps.close(id).catch(() => {});
    };
  }, [deps, reset]);

  const open = useCallback(
    async (cols: number, rows: number) => {
      if (!deps || (attemptRef.current && !attemptRef.current.ended)) return;
      const attempt: Attempt = {
        number: ++counter.current,
        controller: new AbortController(),
        id: null,
        ended: false,
        busy: false,
        queue: [],
        pendingBytes: 0,
      };
      attemptRef.current = attempt;
      setAttemptNumber(attempt.number);
      setStatus("opening");
      setExitCode(null);
      setBlockedReason(null);
      const current = () => attemptRef.current === attempt && !attempt.ended;
      try {
        const id = await deps.open(cols, rows, {
          signal: attempt.controller.signal,
          onData: (bytes) => {
            if (current()) return onDataRef.current(bytes);
          },
          onError: () => {
            if (current()) {
              const id = reset();
              if (id) void deps.close(id).catch(() => {});
              setStatus("error");
            }
          },
          onExit: (code) => {
            if (!current()) return;
            attempt.ended = true;
            attempt.id = null;
            attempt.queue = [];
            attempt.pendingBytes = 0;
            attempt.controller.abort();
            setExitCode(code);
            setBlockedReason(null);
            setStatus("closed");
          },
        });
        if (!current()) {
          void deps.close(id).catch(() => {});
          return;
        }
        attempt.id = id;
        setStatus("open");
      } catch {
        if (current()) {
          reset();
          setStatus("error");
        }
      }
    },
    [deps, reset],
  );

  const write = useCallback(
    (data: number[]): boolean => {
      const attempt = attemptRef.current;
      if (!deps || !attempt?.id || attempt.ended) return false;
      if (attempt.pendingBytes + data.length > PTY_PENDING_INPUT_BYTES) {
        setBlockedReason("Input queue is full; this input was not sent.");
        return false;
      }
      setBlockedReason(null);
      for (
        let offset = 0;
        offset < data.length;
        offset += PTY_INPUT_CHUNK_BYTES
      ) {
        attempt.queue.push(data.slice(offset, offset + PTY_INPUT_CHUNK_BYTES));
      }
      attempt.pendingBytes += data.length;
      if (attempt.busy) return true;
      attempt.busy = true;
      void (async () => {
        try {
          while (
            attempt.queue.length &&
            attemptRef.current === attempt &&
            !attempt.ended
          ) {
            const chunk = attempt.queue.shift();
            if (!chunk || !attempt.id) break;
            await deps.write(attempt.id, chunk);
            attempt.pendingBytes -= chunk.length;
          }
        } catch (error) {
          if (attemptRef.current !== attempt || attempt.ended) return;
          attempt.queue = [];
          attempt.pendingBytes = 0;
          const message =
            error instanceof Error ? error.message : String(error);
          if (message.startsWith(PTY_COMMAND_BLOCKED_PREFIX)) {
            setBlockedReason(
              message
                .slice(PTY_COMMAND_BLOCKED_PREFIX.length)
                .replace(/^: /, ""),
            );
          } else {
            const id = reset();
            if (id) void deps.close(id).catch(() => {});
            setExitCode(null);
            setBlockedReason(null);
            setStatus("error");
          }
        } finally {
          attempt.busy = false;
        }
      })();
      return true;
    },
    [deps, reset],
  );

  const resize = useCallback(
    (cols: number, rows: number) => {
      const attempt = attemptRef.current;
      if (deps && attempt?.id && !attempt.ended)
        void deps.resize(attempt.id, cols, rows).catch(() => {});
    },
    [deps],
  );

  return {
    status,
    exitCode,
    blockedReason,
    attemptNumber,
    active: deps !== undefined,
    open,
    write,
    resize,
    close,
  };
}
