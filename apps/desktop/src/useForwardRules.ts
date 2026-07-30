import { useCallback, useEffect, useRef, useState } from "react";

export type ForwardStartFn = (
  bindAddr: string,
  targetHost: string,
  targetPort: number,
) => Promise<{ forward_id: string; bound_addr: string }>;
export type ForwardStopFn = (forwardId: string) => Promise<void>;

export type ForwardRuntime = {
  active: boolean;
  forwardId?: string;
  boundAddr?: string;
  error?: string;
  pending?: boolean;
};

/// Tracks the live runtime state of port-forward rules. `start`/`stop` are
/// injected (the desktop runtime wires the real `forward_start`/`forward_stop`
/// IPC); when they are undefined the hook just toggles local state so the
/// web preview stays interactive without a backend.
export function useForwardRules(start?: ForwardStartFn, stop?: ForwardStopFn) {
  const [runtime, setRuntime] = useState<Record<string, ForwardRuntime>>({});
  const inFlightRules = useRef(new Map<string, number>());
  const operationCounter = useRef(0);
  const runtimeRef = useRef(runtime);
  const backendSeq = useRef(0);
  const active = start !== undefined && stop !== undefined;

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  useEffect(() => {
    backendSeq.current += 1;
    inFlightRules.current.clear();
    setRuntime({});
    return () => {
      if (!stop) return;
      const activeForwardIds = Object.values(runtimeRef.current)
        .filter((entry) => entry.active && entry.forwardId)
        .map((entry) => entry.forwardId as string);
      for (const forwardId of activeForwardIds) {
        void stop(forwardId).catch(() => {});
      }
    };
  }, [start, stop]);

  const startRule = useCallback(
    async (
      id: string,
      bindAddr: string,
      targetHost: string,
      targetPort: number,
    ) => {
      if (inFlightRules.current.has(id)) return;
      if (!start) {
        setRuntime((prev) => ({ ...prev, [id]: { active: true } }));
        return;
      }
      const requestSeq = backendSeq.current;
      const operationId = operationCounter.current + 1;
      operationCounter.current = operationId;
      inFlightRules.current.set(id, operationId);
      setRuntime((prev) => ({
        ...prev,
        [id]: { ...prev[id], active: false, pending: true, error: undefined },
      }));
      try {
        const { forward_id, bound_addr } = await start(
          bindAddr,
          targetHost,
          targetPort,
        );
        if (backendSeq.current !== requestSeq) {
          if (stop) {
            void stop(forward_id).catch(() => {});
          }
          return;
        }
        setRuntime((prev) => ({
          ...prev,
          [id]: { active: true, forwardId: forward_id, boundAddr: bound_addr },
        }));
      } catch (error) {
        if (backendSeq.current !== requestSeq) return;
        setRuntime((prev) => ({
          ...prev,
          [id]: {
            active: false,
            error: error instanceof Error ? error.message : String(error),
          },
        }));
      } finally {
        if (inFlightRules.current.get(id) === operationId) {
          inFlightRules.current.delete(id);
        }
      }
    },
    [start, stop],
  );

  const stopRule = useCallback(
    async (id: string) => {
      if (inFlightRules.current.has(id)) return;
      const requestSeq = backendSeq.current;
      const current = runtime[id];
      const operationId = operationCounter.current + 1;
      operationCounter.current = operationId;
      inFlightRules.current.set(id, operationId);
      setRuntime((prev) => ({
        ...prev,
        [id]: { ...prev[id], pending: true, error: undefined },
      }));
      if (stop && current?.forwardId) {
        try {
          await stop(current.forwardId);
        } catch (error) {
          if (backendSeq.current !== requestSeq) return;
          setRuntime((prev) => ({
            ...prev,
            [id]: {
              ...current,
              active: true,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
          if (inFlightRules.current.get(id) === operationId) {
            inFlightRules.current.delete(id);
          }
          return;
        }
      }
      if (backendSeq.current !== requestSeq) return;
      setRuntime((prev) => ({ ...prev, [id]: { active: false } }));
      if (inFlightRules.current.get(id) === operationId) {
        inFlightRules.current.delete(id);
      }
    },
    [stop, runtime],
  );

  return { runtime, active, startRule, stopRule };
}
