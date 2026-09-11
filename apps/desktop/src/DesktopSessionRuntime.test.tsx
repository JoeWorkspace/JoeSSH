// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@atlasterm/i18n";
import {
  DesktopSessionRuntime,
  equalSessionControls,
  type SessionControls,
} from "./DesktopSessionRuntime";
import { SFTP_TRANSFER_MAX_BYTES } from "./useSftpTransfer";

const terminal = vi.hoisted(() => ({
  ready: undefined as undefined | ((send: (text: string) => boolean) => void),
  active: false,
  search: undefined as unknown,
}));

const native = vi.hoisted(() => ({
  forwardStart: vi.fn(async (session: string) => ({
    forward_id: session + "-forward",
    bound_addr: "127.0.0.1:1",
  })),
  forwardStop: vi.fn(async () => {}),
  sftpList: vi.fn(async () => []),
  sftpRead: vi.fn(async () => []),
  sftpWrite: vi.fn(async () => {}),
  ptyOpen: vi.fn(async (session: string) => session + "-pty"),
  ptyClose: vi.fn(async () => {}),
  ptyWrite: vi.fn(async () => {}),
  ptyResize: vi.fn(async () => {}),
}));
vi.mock("./ipc", () => native);
// Real hooks and runtime ownership; xterm DOM behavior is covered separately.
vi.mock("./XtermTerminal", async () => {
  const { useEffect } = await import("react");
  const { usePtySession } = await import("./usePtySession");
  return {
    XtermTerminal: function Terminal({
      deps,
      active,
      search,
      onInputReady,
    }: {
      deps: Parameters<typeof usePtySession>[0];
      active: boolean;
      search?: unknown;
      onInputReady: (send: (text: string) => boolean) => void;
    }) {
      terminal.ready = onInputReady;
      terminal.active = active;
      terminal.search = search;
      const { open, close } = usePtySession(deps, () => {});
      useEffect(() => {
        void open(80, 24);
        return close;
      }, [open, close]);
      return null;
    },
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  terminal.ready = undefined;
});
describe("desktop session ownership", () => {
  it("publishes bound transfers and rejects input before readiness and after disconnect", async () => {
    let current: SessionControls | undefined;
    const update = (_id: string, value: SessionControls | undefined) => {
      current = value;
    };
    const getControls = (): SessionControls => {
      if (!current) throw new Error("Missing session controls");
      return current;
    };
    const view = (active: boolean, transferLimitMessage?: string) => (
      <DesktopSessionRuntime
        sessionId="original-host"
        active={active}
        target="alice@original-host:22"
        t={createTranslator("en")}
        onControlsChange={update}
        transferLimitMessage={transferLimitMessage}
      />
    );
    const { container, rerender, unmount } = render(view(true));
    await waitFor(() => expect(native.ptyOpen).toHaveBeenCalledOnce());
    expect(getControls().prepareInput("pwd\n")).toBe(false);
    const send = vi.fn(() => true);
    act(() => terminal.ready?.(send));
    expect(getControls().prepareInput("pwd\n")).toBe(true);
    expect(send).toHaveBeenCalledExactlyOnceWith("pwd\n");
    const snapshot = getControls();
    expect(equalSessionControls(undefined, snapshot)).toBe(false);
    expect(equalSessionControls({ ...snapshot }, snapshot)).toBe(true);
    expect(
      equalSessionControls(
        { ...snapshot, prepareInput: () => false },
        snapshot,
      ),
    ).toBe(false);
    await act(async () => {
      expect(await getControls().transfer.download("/srv/log")).toEqual([]);
      expect(await getControls().transfer.upload("/srv/input", [65])).toBe(
        true,
      );
    });
    expect(native.sftpRead).toHaveBeenCalledExactlyOnceWith(
      "original-host",
      "/srv/log",
    );
    expect(native.sftpWrite).toHaveBeenCalledExactlyOnceWith(
      "original-host",
      "/srv/input",
      [65],
    );
    act(() => getControls().directory.open("/srv"));
    await waitFor(() =>
      expect(native.sftpList).toHaveBeenCalledWith("original-host", "/srv"),
    );
    expect(equalSessionControls(snapshot, getControls())).toBe(false);
    await act(async () => {
      await getControls().transfer.download("/oversized", {
        knownSizeBytes: SFTP_TRANSFER_MAX_BYTES + 1,
      });
    });
    expect(getControls().transfer.status).toEqual({
      phase: "error",
      message: "Transfer exceeds the desktop safety limit.",
    });
    rerender(view(false, "File too large"));
    expect(terminal.active).toBe(false);
    expect(terminal.search).toBeUndefined();
    expect(
      container
        .querySelector(".terminal-session-runtime")
        ?.hasAttribute("hidden"),
    ).toBe(true);
    expect(
      container
        .querySelector(".terminal-session-target")
        ?.getAttribute("title"),
    ).toBe("alice@original-host:22");
    await act(async () => {
      await getControls().transfer.download("/oversized", {
        knownSizeBytes: SFTP_TRANSFER_MAX_BYTES + 1,
      });
    });
    expect(getControls().transfer.status).toEqual({
      phase: "error",
      message: "File too large",
    });
    expect(native.sftpRead).toHaveBeenCalledTimes(1);
    const disconnected = getControls();
    unmount();
    expect(current).toBeUndefined();
    expect(disconnected.prepareInput("dangerous stale input\n")).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([2, 8])(
    "keeps %i native sessions and forwards across 100 tab switches and unrelated disconnects",
    async (count) => {
      const controls = new Map<string, SessionControls>();
      const update = (id: string, value: SessionControls | undefined) => {
        if (value) controls.set(id, value);
        else controls.delete(id);
      };
      const getPrimary = () => {
        const control = controls.get("0");
        if (!control) throw new Error("Primary session controls are missing");
        return control;
      };
      const t = createTranslator("en");
      const view = (active: number, connected = count) => (
        <>
          {Array.from({ length: connected }, (_, index) => (
            <DesktopSessionRuntime
              key={index}
              sessionId={String(index)}
              active={active === index}
              target={String(index)}
              t={t}
              onControlsChange={update}
            />
          ))}
        </>
      );
      const { rerender, unmount } = render(view(0));
      await waitFor(() => expect(native.ptyOpen).toHaveBeenCalledTimes(count));
      await act(async () => {
        await getPrimary().forwards.startRule("db", "127.0.0.1:0", "db", 5432);
      });
      const directory = getPrimary().directory;
      act(() => directory.open("/srv"));
      for (let index = 0; index < 100; index++) rerender(view(index % count));
      expect(getPrimary().directory.path).toBe("/srv");
      expect(getPrimary().forwards.runtime.db.forwardId).toBe("0-forward");
      expect(native.ptyOpen).toHaveBeenCalledTimes(count);
      expect(native.ptyClose).not.toHaveBeenCalled();
      expect(native.forwardStop).not.toHaveBeenCalled();
      rerender(view(0, count - 1));
      expect(native.ptyClose).toHaveBeenCalledWith(String(count - 1) + "-pty");
      expect(native.forwardStop).not.toHaveBeenCalled();
      unmount();
      expect(native.forwardStop).toHaveBeenCalledWith("0-forward");
      expect(controls.size).toBe(0);
    },
  );
});
