import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { Translator } from "@atlasterm/i18n";
import {
  forwardStart,
  forwardStop,
  ptyClose,
  ptyOpen,
  ptyResize,
  ptyWrite,
  sftpList,
  sftpRead,
  sftpWrite,
} from "./ipc";
import { useSftpDirectory } from "./useSftpDirectory";
import { useSftpTransfer } from "./useSftpTransfer";
import { useForwardRules } from "./useForwardRules";
import type { XtermTerminalSearch } from "./XtermTerminal";
import { PanelLoadingState } from "./PanelLoadingState";

const Terminal = lazy(() =>
  import("./XtermTerminal").then((module) => ({
    default: module.XtermTerminal,
  })),
);

export type SessionControls = {
  directory: ReturnType<typeof useSftpDirectory>;
  transfer: ReturnType<typeof useSftpTransfer>;
  forwards: ReturnType<typeof useForwardRules>;
  prepareInput: (text: string) => boolean;
};

// Mounted for the lifetime of one logical tab's live SSH connection. Changing
// which tab is visible only changes presentation; it cannot close its resources.
export const DesktopSessionRuntime = memo(function DesktopSessionRuntime({
  sessionId,
  active,
  target,
  t,
  search,
  onControlsChange,
  transferLimitMessage,
}: {
  sessionId: string;
  active: boolean;
  target: string;
  t: Translator;
  search?: XtermTerminalSearch;
  onControlsChange: (
    sessionId: string,
    controls: SessionControls | undefined,
  ) => void;
  transferLimitMessage?: string;
}) {
  const alive = useRef(false);
  const sendRef = useRef<(text: string) => boolean>(() => false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, [sessionId]);
  const deps = useMemo(
    () => ({
      pty: {
        open: (
          cols: number,
          rows: number,
          events: Parameters<typeof ptyOpen>[3],
        ) => ptyOpen(sessionId, cols, rows, events),
        close: ptyClose,
        write: ptyWrite,
        resize: ptyResize,
      },
      list: (path: string) => sftpList(sessionId, path),
      read: (path: string) => sftpRead(sessionId, path),
      write: (path: string, data: number[]) => sftpWrite(sessionId, path, data),
      start: (bind: string, host: string, port: number) =>
        forwardStart(sessionId, bind, host, port),
    }),
    [sessionId],
  );
  const directory = useSftpDirectory(deps.list);
  const limitMessage = useCallback(
    () => transferLimitMessage ?? "Transfer exceeds the desktop safety limit.",
    [transferLimitMessage],
  );
  const transfer = useSftpTransfer(deps.read, deps.write, { limitMessage });
  const forwards = useForwardRules(deps.start, forwardStop);
  const prepareInput = useCallback(
    (text: string) => alive.current && sendRef.current(text),
    [],
  );
  const onInputReady = useCallback((send: (text: string) => boolean) => {
    sendRef.current = send;
  }, []);
  // Publish snapshots after commit. The consumer compares fields so its render
  // never changes the stable native callbacks or this tab's resource lifecycle.
  useEffect(() => {
    onControlsChange(sessionId, {
      directory,
      transfer,
      forwards,
      prepareInput,
    });
  });
  useEffect(
    () => () => onControlsChange(sessionId, undefined),
    [sessionId, onControlsChange],
  );
  return (
    <div
      className="terminal-pane terminal-pane--xterm terminal-session-runtime"
      hidden={!active}
      style={active ? undefined : { display: "none" }}
    >
      <div className="terminal-session-target" title={target}>
        {target}
      </div>
      <Suspense fallback={<PanelLoadingState t={t} />}>
        <Terminal
          key={sessionId}
          deps={deps.pty}
          active={active}
          label={t("desktop.xtermTerminalLabel")}
          onInputReady={onInputReady}
          search={active ? search : undefined}
          statusLabels={{
            opening: t("desktop.ptyOpening"),
            open: t("desktop.ptyOpen"),
            blocked: t("desktop.ptyBlocked"),
            closed: t("desktop.ptyClosed"),
            error: t("desktop.ptyError"),
            reconnect: t("desktop.ptyReconnect"),
          }}
        />
      </Suspense>
    </div>
  );
});

export function equalSessionControls(
  a: SessionControls | undefined,
  b: SessionControls,
) {
  if (!a || a.prepareInput !== b.prepareInput) return false;
  return (["directory", "transfer", "forwards"] as const).every((key) => {
    const left = a[key] as Record<string, unknown>;
    const right = b[key] as Record<string, unknown>;
    return Object.keys(right).every((field) =>
      Object.is(left[field], right[field]),
    );
  });
}
