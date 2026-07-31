import { describe, expect, it } from "vitest";

import { parseDesktopLaunchIntent } from "./desktopLaunchIntent";

describe("Desktop public launch intents", () => {
  it.each(["sftp", "forwarding", "settings"] as const)(
    "opens the implemented %s panel shortcut",
    (panel) => {
      expect(parseDesktopLaunchIntent(`?panel=${panel}`)).toEqual({
        connect: false,
        panel,
      });
    },
  );

  it("opens the implemented quick-connect shortcut", () => {
    expect(parseDesktopLaunchIntent("?action=connect")).toEqual({
      connect: true,
      panel: null,
    });
  });

  it.each([
    "?panel=team",
    "?panel=inspector",
    "?panel=SFTP",
    "?panel=sftp&panel=settings",
    "?action=connect&action=connect",
    "?action=unknown",
  ])("ignores unsupported or ambiguous intent %s", (search) => {
    expect(parseDesktopLaunchIntent(search)).toEqual({
      connect: false,
      panel: null,
    });
  });

  it("can combine one implemented panel with quick connect", () => {
    expect(
      parseDesktopLaunchIntent("?panel=sftp&action=connect&lang=zh-CN"),
    ).toEqual({
      connect: true,
      panel: "sftp",
    });
  });
});
