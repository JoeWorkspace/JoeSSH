// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XtermTerminal } from "./XtermTerminal";
import { DesktopTerminalSessions, type TerminalSessionBackend } from "./DesktopTerminalSessions";
import type { PtyDeps } from "./usePtySession";

type MockTerminalInstance = {
  dataDispose: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  emitData: (input: string) => void;
  onData: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  options: unknown;
  resize: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
};

const terminalMock = vi.hoisted(() => ({
  instances: [] as MockTerminalInstance[],
  resizeObservers: [] as { disconnect: ReturnType<typeof vi.fn>; trigger: (target: Element, width: number, height: number) => void }[],
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function Terminal(options: unknown) {
    let dataHandler: ((input: string) => void) | undefined;
    const dataDispose = vi.fn();
    const instance: MockTerminalInstance = {
      dataDispose,
      dispose: vi.fn(),
      emitData: (input: string) => dataHandler?.(input),
      onData: vi.fn((handler: (input: string) => void) => {
        dataHandler = handler;
        return { dispose: dataDispose };
      }),
      open: vi.fn(),
      options,
      resize: vi.fn(),
      write: vi.fn(),
    };
    terminalMock.instances.push(instance);
    return instance;
  }),
}));

class MockResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
  trigger: (target: Element, width: number, height: number) => void;

  constructor(callback: ResizeObserverCallback) {
    this.trigger = (target, width, height) => {
      Object.defineProperty(target, "clientWidth", { configurable: true, value: width });
      Object.defineProperty(target, "clientHeight", { configurable: true, value: height });
      callback([{ target, contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    };
    terminalMock.resizeObservers.push(this);
  }
}

function makeDeps(label: string, overrides: Partial<PtyDeps> = {}) {
  const unlisten = vi.fn();
  let dataSink: (b: number[]) => void = () => {};
  let exitSink: (c: number) => void = () => {};
  const deps: PtyDeps = {
    open: vi.fn().mockResolvedValue(`${label}-pty`),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(async (_id, onData, onExit) => {
      dataSink = onData;
      exitSink = onExit;
      return unlisten;
    }),
    ...overrides,
  };
  return {
    deps,
    emitData: (b: number[]) => dataSink(b),
    emitExit: (c: number) => exitSink(c),
    unlisten,
  };
}

beforeEach(() => {
  terminalMock.instances.length = 0;
  terminalMock.resizeObservers.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("XtermTerminal", () => {
  it("cleans StrictMode's discarded PTY without closing the retained session on tab changes", async () => {
    const first = makeDeps("first");
    const backend: TerminalSessionBackend = {
      ...first.deps,
      open: vi.fn().mockResolvedValueOnce("discarded-pty").mockResolvedValueOnce("retained-pty"),
    };
    const shared = {
      backend,
      sessionIds: ["first"],
      label: "Session terminal",
      fallback: "Loading",
      statusLabels: { opening: "Opening", open: "Connected", blocked: "Blocked", closed: "Exited", error: "Error", reconnect: "Reconnect" },
    };
    const { rerender, unmount } = render(<StrictMode><DesktopTerminalSessions {...shared} activeSessionId="first" /></StrictMode>);
    await waitFor(() => expect(first.deps.subscribe).toHaveBeenCalledWith("retained-pty", expect.any(Function), expect.any(Function)));
    expect(first.deps.close).toHaveBeenCalledWith("discarded-pty");
    expect(first.deps.close).not.toHaveBeenCalledWith("retained-pty");
    rerender(<StrictMode><DesktopTerminalSessions {...shared} activeSessionId={undefined} /></StrictMode>);
    rerender(<StrictMode><DesktopTerminalSessions {...shared} activeSessionId="first" /></StrictMode>);
    expect(backend.open).toHaveBeenCalledTimes(2);
    expect(first.deps.close).not.toHaveBeenCalledWith("retained-pty");
    unmount();
    expect(first.deps.close).toHaveBeenCalledWith("retained-pty");
  });

  it("retains each live session's terminal across tab switches and disposes only disconnected sessions", async () => {
    const first = makeDeps("first");
    const second = makeDeps("second");
    const owner = (ptyId: string) => ptyId === "first-pty" ? first.deps : second.deps;
    const backend: TerminalSessionBackend = {
      open: (sessionId, cols, rows) => (sessionId === "first" ? first.deps : second.deps).open(cols, rows),
      write: (ptyId, data) => owner(ptyId).write(ptyId, data),
      resize: (ptyId, cols, rows) => owner(ptyId).resize(ptyId, cols, rows),
      close: (ptyId) => owner(ptyId).close(ptyId),
      subscribe: (ptyId, onData, onExit) => owner(ptyId).subscribe(ptyId, onData, onExit),
    };
    const shared = {
      backend,
      label: "Session terminal",
      fallback: "Loading",
      statusLabels: { opening: "Opening", open: "Connected", blocked: "Blocked", closed: "Exited", error: "Error", reconnect: "Reconnect" },
    };
    const { rerender } = render(<DesktopTerminalSessions {...shared} sessionIds={["first"]} activeSessionId="first" />);
    await waitFor(() => expect(first.deps.subscribe).toHaveBeenCalledTimes(1));
    const firstTerminal = terminalMock.instances[0];

    rerender(<DesktopTerminalSessions {...shared} sessionIds={["first", "second"]} activeSessionId="second" />);
    await waitFor(() => expect(second.deps.subscribe).toHaveBeenCalledTimes(1));
    expect(first.deps.close).not.toHaveBeenCalled();
    expect(firstTerminal.dispose).not.toHaveBeenCalled();
    act(() => first.emitData([104, 105]));
    expect(firstTerminal.write).toHaveBeenCalledWith("hi");
    expect(screen.getAllByRole("status")).toHaveLength(1);

    rerender(<DesktopTerminalSessions {...shared} sessionIds={["first", "second"]} activeSessionId={undefined} />);
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<DesktopTerminalSessions {...shared} sessionIds={["first", "second"]} activeSessionId="first" />);
    expect(first.deps.open).toHaveBeenCalledTimes(1);
    expect(second.deps.open).toHaveBeenCalledTimes(1);
    expect(terminalMock.instances).toHaveLength(2);

    rerender(<DesktopTerminalSessions {...shared} sessionIds={["second"]} activeSessionId="second" />);
    expect(first.deps.close).toHaveBeenCalledWith("first-pty");
    expect(firstTerminal.dispose).toHaveBeenCalledTimes(1);
    expect(second.deps.close).not.toHaveBeenCalled();
    expect(second.deps.open).toHaveBeenCalledTimes(1);
  });

  it("uses the localized terminal label", () => {
    const first = makeDeps("first");

    render(<XtermTerminal deps={first.deps} label="Localized terminal" />);

    expect(screen.getByLabelText("Localized terminal")).toBeTruthy();
  });

  it("opens xterm and the PTY with the requested dimensions", async () => {
    const first = makeDeps("first");

    render(<XtermTerminal deps={first.deps} label="Localized terminal" cols={100} rows={32} />);

    await waitFor(() => expect(first.deps.open).toHaveBeenCalledWith(100, 32));
    expect(terminalMock.instances).toHaveLength(1);
    expect(terminalMock.instances[0]?.open).toHaveBeenCalledWith(screen.getByLabelText("Localized terminal"));
  });

  it("pipes PTY output into xterm and xterm input back to the PTY", async () => {
    const first = makeDeps("first");

    render(<XtermTerminal deps={first.deps} label="Localized terminal" />);
    await waitFor(() => expect(first.deps.subscribe).toHaveBeenCalledWith("first-pty", expect.any(Function), expect.any(Function)));

    act(() => first.emitData([104, 105]));
    expect(terminalMock.instances[0]?.write).toHaveBeenCalledWith("hi");

    act(() => terminalMock.instances[0]?.emitData("ls\n"));
    expect(first.deps.write).toHaveBeenCalledWith("first-pty", Array.from(new TextEncoder().encode("ls\n")));
  });

  it("shows native PTY command blocks as an assertive status without closing the terminal", async () => {
    const first = makeDeps("first", {
      write: vi.fn().mockRejectedValue("pty input blocked by desktop safety policy: rm -rf /"),
    });

    render(
      <XtermTerminal
        deps={first.deps}
        label="Localized terminal"
        statusLabels={{
          opening: "Opening terminal...",
          open: "Terminal connected",
          blocked: "Terminal input blocked by safety policy",
          closed: "Terminal exited",
          error: "Terminal failed to open",
          reconnect: "Reconnect",
        }}
      />,
    );
    await waitFor(() => expect(first.deps.subscribe).toHaveBeenCalledWith("first-pty", expect.any(Function), expect.any(Function)));

    act(() => terminalMock.instances[0]?.emitData("rm -rf /\n"));

    expect((await screen.findByRole("alert")).textContent).toContain("Terminal input blocked by safety policy: rm -rf /");
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  });

  it("disposes the old terminal and opens a new PTY when deps change", async () => {
    const first = makeDeps("first");
    const second = makeDeps("second");
    const { rerender } = render(<XtermTerminal deps={first.deps} label="Localized terminal" />);

    await waitFor(() => expect(first.deps.open).toHaveBeenCalledWith(80, 24));
    const oldTerm = terminalMock.instances[0];

    rerender(<XtermTerminal deps={second.deps} label="Localized terminal" />);

    await waitFor(() => expect(first.deps.close).toHaveBeenCalledWith("first-pty"));
    expect(first.unlisten).toHaveBeenCalled();
    expect(oldTerm?.dataDispose).toHaveBeenCalled();
    expect(oldTerm?.dispose).toHaveBeenCalled();
    await waitFor(() => expect(second.deps.open).toHaveBeenCalledWith(80, 24));
    expect(terminalMock.instances).toHaveLength(2);
  });

  it("resizes the existing terminal and PTY when the container changes size", async () => {
    const first = makeDeps("first");
    render(<XtermTerminal deps={first.deps} label="Localized terminal" cols={80} rows={24} />);

    await waitFor(() => expect(first.deps.open).toHaveBeenCalledWith(80, 24));
    const terminal = terminalMock.instances[0];
    const host = screen.getByLabelText("Localized terminal");

    act(() => {
      terminalMock.resizeObservers[0]?.trigger(host, 1000, 500);
    });

    expect(terminal?.resize).toHaveBeenCalledWith(123, 28);
    expect(first.deps.resize).toHaveBeenCalledWith("first-pty", 123, 28);
    expect(first.deps.open).toHaveBeenCalledTimes(1);
    expect(first.deps.close).not.toHaveBeenCalled();
    expect(terminalMock.instances).toHaveLength(1);

    act(() => {
      terminalMock.resizeObservers[0]?.trigger(host, 0, 0);
    });
    expect(first.deps.resize).toHaveBeenCalledTimes(1);
    expect(terminal?.resize).toHaveBeenLastCalledWith(123, 28);
  });

  it("shows exit status and reconnects the PTY without rebuilding xterm", async () => {
    const first = makeDeps("first");

    render(<XtermTerminal deps={first.deps} label="Localized terminal" />);
    await waitFor(() => expect(first.deps.subscribe).toHaveBeenCalledWith("first-pty", expect.any(Function), expect.any(Function)));

    act(() => first.emitExit(7));

    expect(await screen.findByText("Terminal exited (7)")).toBeTruthy();
    act(() => {
      screen.getByRole("button", { name: "Reconnect" }).click();
    });

    await waitFor(() => expect(first.deps.open).toHaveBeenCalledTimes(2));
    expect(first.deps.open).toHaveBeenLastCalledWith(80, 24);
    expect(terminalMock.instances).toHaveLength(1);
  });
});
