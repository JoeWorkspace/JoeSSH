import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const backend = useMemo(() => ({ start, stop, live: false }), [start, stop]);
  const active = start !== undefined && stop !== undefined;

  // Native completions can precede React's next commit. Keep the owned ids
  // current immediately so another callback or cleanup cannot lose a listener.
  const updateRuntime = useCallback(
    (update: (previous: Record<string, ForwardRuntime>) => Record<string, ForwardRuntime>) => {
      runtimeRef.current = update(runtimeRef.current);
      setRuntime(runtimeRef.current);
    },
    [],
  );

  useEffect(() => {
    backend.live = true;
    backendSeq.current += 1;
    const operations = inFlightRules.current;
    operations.clear();
    runtimeRef.current = {};
    setRuntime(runtimeRef.current);
    return () => {
      backend.live = false;
      backendSeq.current += 1;
      operations.clear();
      if (!stop) return;
      const activeForwardIds = Object.values(runtimeRef.current)
        .filter((entry) => entry.active && entry.forwardId)
        .map((entry) => entry.forwardId as string);
      for (const forwardId of activeForwardIds) {
        void stop(forwardId).catch(() => {});
      }
    };
  }, [backend, stop]);

  const startRule = useCallback(
    async (
      id: string,
      bindAddr: string,
      targetHost: string,
      targetPort: number,
    ) => {
      if (!backend.live || inFlightRules.current.has(id) || runtimeRef.current[id]?.active) return;
      if (!start) {
        updateRuntime((prev) => ({ ...prev, [id]: { active: true } }));
        return;
      }
      const requestSeq = backendSeq.current;
      const operationId = operationCounter.current + 1;
      operationCounter.current = operationId;
      inFlightRules.current.set(id, operationId);
      updateRuntime((prev) => ({
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
        updateRuntime((prev) => ({
          ...prev,
          [id]: { active: true, forwardId: forward_id, boundAddr: bound_addr },
        }));
      } catch (error) {
        if (backendSeq.current !== requestSeq) return;
        updateRuntime((prev) => ({
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
    [backend, start, stop, updateRuntime],
  );

  const stopRule = useCallback(
    async (id: string) => {
      if (!backend.live || inFlightRules.current.has(id)) return;
      const requestSeq = backendSeq.current;
      const current = runtimeRef.current[id];
      const operationId = operationCounter.current + 1;
      operationCounter.current = operationId;
      inFlightRules.current.set(id, operationId);
      updateRuntime((prev) => ({
        ...prev,
        [id]: { ...prev[id], pending: true, error: undefined },
      }));
      if (stop && current?.forwardId) {
        try {
          await stop(current.forwardId);
        } catch (error) {
          if (backendSeq.current !== requestSeq) return;
          updateRuntime((prev) => ({
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
      updateRuntime((prev) => ({ ...prev, [id]: { active: false } }));
      if (inFlightRules.current.get(id) === operationId) {
        inFlightRules.current.delete(id);
      }
    },
    [backend, stop, updateRuntime],
  );

  return { runtime, active, startRule, stopRule };
}
