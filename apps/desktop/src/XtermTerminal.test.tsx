// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XtermTerminal } from "./XtermTerminal";
import type { PtyDeps } from "./usePtySession";

type MockTerminalInstance = {
  dataDispose: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  emitData: (input: string) => void;
  clearSelection: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  options: unknown;
  resize: ReturnType<typeof vi.fn>;
  scrollToLine: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
};

const terminalMock = vi.hoisted(() => ({
  instances: [] as MockTerminalInstance[],
  nextBufferLines: [] as string[],
  resizeObservers: [] as {
    disconnect: ReturnType<typeof vi.fn>;
    trigger: (target: Element, width: number, height: number) => void;
  }[],
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function Terminal(options: unknown) {
    let dataHandler: ((input: string) => void) | undefined;
    const bufferLines = [...terminalMock.nextBufferLines];
    const dataDispose = vi.fn();
    const instance: MockTerminalInstance = {
      clearSelection: vi.fn(),
      dataDispose,
      dispose: vi.fn(),
      emitData: (input: string) => dataHandler?.(input),
      focus: vi.fn(),
      onData: vi.fn((handler: (input: string) => void) => {
        dataHandler = handler;
        return { dispose: dataDispose };
      }),
      open: vi.fn(),
      options,
      resize: vi.fn(),
      scrollToLine: vi.fn(),
      select: vi.fn(),
      write: vi.fn((_text: string, callback?: () => void) => callback?.()),
    };
    Object.assign(instance, {
      buffer: {
        active: {
          get length() {
            return bufferLines.length;
          },
          getLine: (line: number) =>
            bufferLines[line] === undefined
              ? undefined
              : {
                  translateToString: () => bufferLines[line],
                },
        },
      },
    });
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
      Object.defineProperty(target, "clientWidth", {
        configurable: true,
        value: width,
      });
      Object.defineProperty(target, "clientHeight", {
        configurable: true,
        value: height,
      });
      callback(
        [{ target, contentRect: { width, height } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
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
  terminalMock.nextBufferLines = [];
  terminalMock.resizeObservers.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("XtermTerminal", () => {
  it("uses the localized terminal label", () => {
    const first = makeDeps("first");

    render(<XtermTerminal deps={first.deps} label="Localized terminal" />);

    expect(screen.getByLabelText("Localized terminal")).toBeTruthy();
  });

  it("opens xterm and the PTY with the requested dimensions", async () => {
    const first = makeDeps("first");

    render(
      <XtermTerminal
        deps={first.deps}
        label="Localized terminal"
        cols={100}
        rows={32}
      />,
    );

    await waitFor(() => expect(first.deps.open).toHaveBeenCalledWith(100, 32));
    expect(terminalMock.instances).toHaveLength(1);
    expect(terminalMock.instances[0]?.open).toHaveBeenCalledWith(
      screen.getByLabelText("Localized terminal"),
    );
  });

  it("pipes PTY output into xterm and xterm input back to the PTY", async () => {
    const first = makeDeps("first");

    render(<XtermTerminal deps={first.deps} label="Localized terminal" />);
    await waitFor(() =>
      expect(first.deps.subscribe).toHaveBeenCalledWith(
        "first-pty",
        expect.any(Function),
        expect.any(Function),
      ),
    );

    act(() => first.emitData([104, 105]));
    expect(terminalMock.instances[0]?.write).toHaveBeenCalledWith(
      "hi",
      expect.any(Function),
    );

    act(() => terminalMock.instances[0]?.emitData("ls\n"));
    expect(first.deps.write).toHaveBeenCalledWith(
      "first-pty",
      Array.from(new TextEncoder().encode("ls\n")),
    );
  });

  it("shows native PTY command blocks as an assertive status without closing the terminal", async () => {
    const first = makeDeps("first", {
      write: vi
        .fn()
        .mockRejectedValue(
          "pty input blocked by desktop safety policy: rm -rf /",
        ),
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
    await waitFor(() =>
      expect(first.deps.subscribe).toHaveBeenCalledWith(
        "first-pty",
        expect.any(Function),
        expect.any(Function),
      ),
    );

    act(() => terminalMock.instances[0]?.emitData("rm -rf /\n"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Terminal input blocked by safety policy: rm -rf /",
    );
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  });

  it("disposes the old terminal and opens a new PTY when deps change", async () => {
    const first = makeDeps("first");
    const second = makeDeps("second");
    const { rerender } = render(
      <XtermTerminal deps={first.deps} label="Localized terminal" />,
    );

    await waitFor(() => expect(first.deps.open).toHaveBeenCalledWith(80, 24));
    const oldTerm = terminalMock.instances[0];

    rerender(<XtermTerminal deps={second.deps} label="Localized terminal" />);

    await waitFor(() =>
      expect(first.deps.close).toHaveBeenCalledWith("first-pty"),
    );
    expect(first.unlisten).toHaveBeenCalled();
    expect(oldTerm?.dataDispose).toHaveBeenCalled();
    expect(oldTerm?.dispose).toHaveBeenCalled();
    await waitFor(() => expect(second.deps.open).toHaveBeenCalledWith(80, 24));
    expect(terminalMock.instances).toHaveLength(2);
  });

  it("resizes the existing terminal and PTY when the container changes size", async () => {
    const first = makeDeps("first");
    render(
      <XtermTerminal
        deps={first.deps}
        label="Localized terminal"
        cols={80}
        rows={24}
      />,
    );

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
  });

  it("shows exit status and reconnects the PTY without rebuilding xterm", async () => {
    const first = makeDeps("first");

    render(<XtermTerminal deps={first.deps} label="Localized terminal" />);
    await waitFor(() =>
      expect(first.deps.subscribe).toHaveBeenCalledWith(
        "first-pty",
        expect.any(Function),
        expect.any(Function),
      ),
    );

    act(() => first.emitExit(7));

    expect(await screen.findByText("Terminal exited (7)")).toBeTruthy();
    act(() => {
      screen.getByRole("button", { name: "Reconnect" }).click();
    });

    await waitFor(() => expect(first.deps.open).toHaveBeenCalledTimes(2));
    expect(first.deps.open).toHaveBeenLastCalledWith(80, 24);
    expect(terminalMock.instances).toHaveLength(1);
  });

  it("searches the live xterm buffer and supports next/previous navigation", async () => {
    terminalMock.nextBufferLines = [
      "first needle",
      "nothing",
      "second needle and needle",
    ];
    const first = makeDeps("first");
    const onClose = vi.fn();
    const onQueryChange = vi.fn();

    render(
      <XtermTerminal
        deps={first.deps}
        label="Localized terminal"
        search={{
          closeLabel: "Close search",
          matchesLabel: (count) => `${count} matches`,
          nextLabel: "Next match",
          onClose,
          onQueryChange,
          open: true,
          placeholder: "Search terminal",
          previousLabel: "Previous match",
          query: "needle",
        }}
      />,
    );

    await waitFor(() =>
      expect(terminalMock.instances[0]?.select).toHaveBeenCalledWith(6, 0, 6),
    );
    expect(screen.getByText("1/3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    await waitFor(() =>
      expect(terminalMock.instances[0]?.select).toHaveBeenLastCalledWith(
        7,
        2,
        6,
      ),
    );
    expect(screen.getByText("2/3")).toBeTruthy();

    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Search terminal" }),
      {
      key: "Escape",
      },
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("injects a prepared command into the live PTY and focuses xterm", async () => {
    const first = makeDeps("first");
    const onPreparedInputConsumed = vi.fn();

    render(
      <XtermTerminal
        deps={first.deps}
        label="Localized terminal"
        onPreparedInputConsumed={onPreparedInputConsumed}
        preparedInput="kubectl get pods"
      />,
    );

    await waitFor(() =>
      expect(first.deps.write).toHaveBeenCalledWith(
        "first-pty",
        Array.from(new TextEncoder().encode("kubectl get pods")),
      ),
    );
    expect(terminalMock.instances[0]?.focus).toHaveBeenCalled();
    expect(onPreparedInputConsumed).toHaveBeenCalledOnce();
  });
});
