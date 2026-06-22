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
  const inFlightRules = useRef(new Set<string>());
  const active = start !== undefined && stop !== undefined;

  useEffect(() => {
    inFlightRules.current.clear();
    setRuntime({});
  }, [start, stop]);

  const startRule = useCallback(
    async (id: string, bindAddr: string, targetHost: string, targetPort: number) => {
      if (inFlightRules.current.has(id)) return;
      if (!start) {
        setRuntime((prev) => ({ ...prev, [id]: { active: true } }));
        return;
      }
      inFlightRules.current.add(id);
      setRuntime((prev) => ({ ...prev, [id]: { ...prev[id], active: false, pending: true, error: undefined } }));
      try {
        const { forward_id, bound_addr } = await start(bindAddr, targetHost, targetPort);
        setRuntime((prev) => ({ ...prev, [id]: { active: true, forwardId: forward_id, boundAddr: bound_addr } }));
      } catch (error) {
        setRuntime((prev) => ({ ...prev, [id]: { active: false, error: error instanceof Error ? error.message : String(error) } }));
      } finally {
        inFlightRules.current.delete(id);
      }
    },
    [start],
  );

  const stopRule = useCallback(
    async (id: string) => {
      if (inFlightRules.current.has(id)) return;
      const current = runtime[id];
      inFlightRules.current.add(id);
      setRuntime((prev) => ({ ...prev, [id]: { ...prev[id], pending: true, error: undefined } }));
      if (stop && current?.forwardId) {
        try {
          await stop(current.forwardId);
        } catch (error) {
          setRuntime((prev) => ({ ...prev, [id]: { ...current, active: true, error: error instanceof Error ? error.message : String(error) } }));
          inFlightRules.current.delete(id);
          return;
        }
      }
      setRuntime((prev) => ({ ...prev, [id]: { active: false } }));
      inFlightRules.current.delete(id);
    },
    [stop, runtime],
  );

  return { runtime, active, startRule, stopRule };
}
