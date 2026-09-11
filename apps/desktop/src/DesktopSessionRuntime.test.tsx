// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@atlasterm/i18n";
import {
  DesktopSessionRuntime,
  type SessionControls,
} from "./DesktopSessionRuntime";

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
    }: {
      deps: Parameters<typeof usePtySession>[0];
    }) {
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
});
describe("desktop session ownership", () => {
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
