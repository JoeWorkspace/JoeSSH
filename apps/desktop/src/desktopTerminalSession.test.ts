import { describe, expect, it } from "vitest";
import type { TranslationKey, Translator } from "@atlasterm/i18n";
import { createConnectionTerminalSession, formatSshCommand, PRIMARY_TERMINAL_PROMPT } from "./desktopTerminalSession";
import { createTerminalSession } from "./terminalExecutor";

function createRecordingTranslator() {
  const calls: Array<{ key: TranslationKey; values?: Record<string, string | number> }> = [];
  const t: Translator = (key, values) => {
    calls.push({ key, values });
    return values ? `${key}:${JSON.stringify(values)}` : key;
  };

  return { calls, t };
}

describe("desktop terminal sessions", () => {
  it("formats copied SSH commands from the host", () => {
    expect(formatSshCommand({ host: "10.48.12.11" })).toBe("ssh 10.48.12.11");
    expect(formatSshCommand({ host: "atlas@prod-edge-01:2200" })).toBe("ssh -p 2200 atlas@prod-edge-01");
    expect(formatSshCommand({ host: "prod-edge-01", port: 2222, username: "release" })).toBe("ssh -p 2222 release@prod-edge-01");
  });

  it("builds translated bootstrap output for non-primary connections", () => {
    const { calls, t } = createRecordingTranslator();
    const session = createConnectionTerminalSession(
      { name: "staging-api", host: "stg-api.atlas", group: "Staging", status: "online" },
      t,
    );

    expect(session.prompt).toBe("atlas@staging-api:~$");
    expect(session.lines.map((line) => line.text)).toEqual([
      "atlas@staging-api:~$ ssh stg-api.atlas",
      'desktop.terminalSessionConnected:{"name":"staging-api","group":"desktop.groupStaging"}',
      "desktop.terminalSessionReady",
    ]);
    expect(calls).toEqual([
      { key: "desktop.groupStaging", values: undefined },
      { key: "desktop.terminalSessionConnected", values: { name: "staging-api", group: "desktop.groupStaging" } },
      { key: "desktop.terminalSessionReady", values: undefined },
    ]);
  });

  it("uses dedicated translated MFA output for locked connections", () => {
    const { calls, t } = createRecordingTranslator();
    const session = createConnectionTerminalSession(
      { name: "db-replica-03", host: "db3.internal", group: "Data", status: "locked" },
      t,
    );

    expect(session.lines.at(-1)?.text).toBe("desktop.terminalSessionMfaRequired");
    expect(calls.map((call) => call.key)).toEqual([
      "desktop.groupData",
      "desktop.terminalSessionConnected",
      "desktop.terminalSessionMfaRequired",
    ]);
  });

  it("labels sample profiles without claiming a connected session", () => {
    const { calls, t } = createRecordingTranslator();
    const session = createConnectionTerminalSession(
      { name: "prod-edge-01", host: "10.48.12.11", group: "Production", status: "sample" },
      t,
    );

    expect(session.lines.map((line) => line.text)).toEqual([
      "atlas@prod-edge-01:~$ ssh 10.48.12.11",
      "desktop.terminalSessionSample",
      "desktop.terminalSessionConnectRequired",
    ]);
    expect(calls.map((call) => call.key)).toEqual([
      "desktop.terminalSessionSample",
      "desktop.terminalSessionConnectRequired",
    ]);
  });

  it("keeps the primary demo session stable", () => {
    const { t } = createRecordingTranslator();
    const primarySession = createTerminalSession({
      host: "prod-edge-01",
      lines: ["atlas@prod-edge-01:~$ uptime"],
      prompt: PRIMARY_TERMINAL_PROMPT,
    });

    expect(createConnectionTerminalSession(
      { name: "prod-edge-01", host: "10.48.12.11", group: "Production", status: "online" },
      t,
      primarySession,
    )).toBe(primarySession);
  });

  it("does not reuse the primary demo transcript for sample no-session state", () => {
    const { t } = createRecordingTranslator();
    const primarySession = createTerminalSession({
      host: "prod-edge-01",
      lines: ["atlas@prod-edge-01:~$ uptime"],
      prompt: PRIMARY_TERMINAL_PROMPT,
    });

    expect(createConnectionTerminalSession(
      { name: "prod-edge-01", host: "10.48.12.11", group: "Production", status: "sample" },
      t,
      primarySession,
    )).not.toBe(primarySession);
  });
});
