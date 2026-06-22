import type { Translator } from "@atlasterm/i18n";
import { desktopGroupLabel } from "./desktopGroups";
import { createTerminalSession, type TerminalSession } from "./terminalExecutor";

export const PRIMARY_TERMINAL_PROMPT = "atlas@prod-edge-01:~$";

type TerminalSessionConnection = {
  group: string;
  host: string;
  name: string;
  status?: string;
};

export function formatSshCommand(connection: Pick<TerminalSessionConnection, "host">): string {
  return `ssh ${connection.host}`;
}

export function createConnectionTerminalSession(
  connection: TerminalSessionConnection,
  t: Translator,
  primarySession?: TerminalSession,
): TerminalSession {
  if (primarySession && connection.name === primarySession.host && connection.status !== "sample") {
    return primarySession;
  }

  const bootstrapLines = connection.status === "sample"
    ? [
        `${getConnectionPrompt(connection.name)} ${formatSshCommand(connection)}`,
        t("desktop.terminalSessionSample"),
        t("desktop.terminalSessionConnectRequired"),
      ]
    : [
        `${getConnectionPrompt(connection.name)} ${formatSshCommand(connection)}`,
        t("desktop.terminalSessionConnected", { name: connection.name, group: desktopGroupLabel(connection.group, t) }),
        connection.status === "locked" ? t("desktop.terminalSessionMfaRequired") : t("desktop.terminalSessionReady"),
      ];

  return createTerminalSession({
    host: connection.name,
    lines: bootstrapLines,
    prompt: getConnectionPrompt(connection.name),
  });
}

function getConnectionPrompt(connectionName: string) {
  return `atlas@${connectionName}:~$`;
}
