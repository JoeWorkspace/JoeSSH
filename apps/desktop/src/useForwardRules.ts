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

type ForwardSession = {
  runtime: Record<string, ForwardRuntime>;
  inFlight: Set<string>;
  stop?: ForwardStopFn;
};

type ForwardSessionsOptions = {
  sessionId?: string;
  liveSessionIds: readonly string[];
};

const PREVIEW_SESSION = "preview";
const EMPTY_RUNTIME: Record<string, ForwardRuntime> = {};

function disposeSession(session: ForwardSession) {
  for (const rule of Object.values(session.runtime)) {
    if (rule.forwardId && session.stop) {
      void session.stop(rule.forwardId).catch(() => undefined);
    }
  }
}

// Session ownership outlives tab selection. Removed sessions invalidate pending
// operations; a late start is stopped instead of becoming an orphaned listener.
export function useForwardRules(start?: ForwardStartFn, stop?: ForwardStopFn, options?: ForwardSessionsOptions) {
  const sessionsRef = useRef(new Map<string, ForwardSession>());
  const mountedRef = useRef(true);
  const [, refresh] = useState(0);
  const sessionId = options?.sessionId ?? PREVIEW_SESSION;
  const liveSessionIds = options?.liveSessionIds;
  const liveIdsRef = useRef(new Set<string>());
  liveIdsRef.current = new Set(liveSessionIds ?? [PREVIEW_SESSION]);
  const active = start !== undefined && stop !== undefined;

  useEffect(() => {
    for (const [id, session] of sessionsRef.current) {
      if (!liveIdsRef.current.has(id)) {
        sessionsRef.current.delete(id);
        disposeSession(session);
      }
    }
  }, [liveSessionIds]);

  useEffect(() => {
    mountedRef.current = true;
    const sessions = sessionsRef.current;
    return () => {
      mountedRef.current = false;
      for (const session of sessions.values()) disposeSession(session);
      sessions.clear();
    };
  }, []);

  const getSession = useCallback(() => {
    if (!mountedRef.current || !liveIdsRef.current.has(sessionId)) return undefined;
    let session = sessionsRef.current.get(sessionId);
    if (!session) {
      session = { runtime: {}, inFlight: new Set(), stop };
      sessionsRef.current.set(sessionId, session);
    }
    session.stop = stop;
    return session;
  }, [sessionId, stop]);

  const isCurrent = useCallback((session: ForwardSession) =>
    mountedRef.current && liveIdsRef.current.has(sessionId) && sessionsRef.current.get(sessionId) === session,
  [sessionId]);

  const update = useCallback((session: ForwardSession, id: string, rule: ForwardRuntime) => {
    if (!isCurrent(session)) return;
    session.runtime = { ...session.runtime, [id]: rule };
    refresh((version) => version + 1);
  }, [isCurrent]);

  const startRule = useCallback(
    async (id: string, bindAddr: string, targetHost: string, targetPort: number) => {
      const session = getSession();
      if (!session || session.inFlight.has(id) || session.runtime[id]?.active) return;
      if (!start) {
        update(session, id, { active: true });
        return;
      }
      session.inFlight.add(id);
      update(session, id, { active: false, pending: true });
      try {
        const { forward_id, bound_addr } = await start(bindAddr, targetHost, targetPort);
        if (!isCurrent(session)) {
          if (stop) await stop(forward_id).catch(() => undefined);
          return;
        }
        update(session, id, { active: true, forwardId: forward_id, boundAddr: bound_addr });
      } catch (error) {
        update(session, id, { active: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        session.inFlight.delete(id);
      }
    },
    [getSession, isCurrent, start, stop, update],
  );

  const stopRule = useCallback(
    async (id: string) => {
      const session = getSession();
      if (!session || session.inFlight.has(id)) return;
      const current = session.runtime[id];
      session.inFlight.add(id);
      update(session, id, { ...current, active: current?.active ?? false, pending: true, error: undefined });
      if (stop && current?.forwardId) {
        try {
          await stop(current.forwardId);
        } catch (error) {
          update(session, id, { ...current, active: true, error: error instanceof Error ? error.message : String(error) });
          session.inFlight.delete(id);
          return;
        }
      }
      update(session, id, { active: false });
      session.inFlight.delete(id);
    },
    [getSession, stop, update],
  );

  const runtime = liveIdsRef.current.has(sessionId)
    ? sessionsRef.current.get(sessionId)?.runtime ?? EMPTY_RUNTIME
    : EMPTY_RUNTIME;
  return { runtime, active, startRule, stopRule };
}
