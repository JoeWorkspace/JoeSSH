import type { TranslationKey } from "@atlasterm/i18n";

export type TerminalLineKind = "command" | "output" | "system";

export type TerminalLine = {
  id: string;
  kind: TerminalLineKind;
  text: string;
};

export type TerminalSession = {
  host: string;
  lines: TerminalLine[];
  nextLineId: number;
  prompt: string;
  history: string[];
  historyIndex: number;
};

export type TerminalExecutorEvent =
  | { type: "ignored" }
  | { type: "accepted"; displayCommand: string; output: string }
  | { type: "blocked"; displayCommand: string; pattern: string; reasonKey: TranslationKey };

export type SubmitTerminalCommandResult = {
  event: TerminalExecutorEvent;
  session: TerminalSession;
};

export function createTerminalSession({
  host,
  lines,
  prompt,
}: {
  host: string;
  lines: readonly string[];
  prompt: string;
}): TerminalSession {
  const sessionLines = lines.map((text, index) => ({
    id: createLineId(index + 1),
    kind: inferLineKind(text),
    text,
  }));

  return {
    host,
    lines: sessionLines,
    nextLineId: sessionLines.length + 1,
    prompt,
    history: [],
    historyIndex: -1,
  };
}

export async function submitTerminalCommand(
  session: TerminalSession,
  command: string,
  acceptedOutput: string,
  runRemote?: (command: string) => Promise<string>,
): Promise<SubmitTerminalCommandResult> {
  const { interceptTerminalCommand } = await import("./safety");
  const decision = interceptTerminalCommand(command);

  if (decision.action === "ignore") {
    return {
      event: { type: "ignored" },
      session,
    };
  }

  if (decision.action === "block") {
    return {
      event: {
        displayCommand: decision.displayCommand,
        pattern: decision.match.pattern,
        reasonKey: decision.match.reasonKey,
        type: "blocked",
      },
      session,
    };
  }

  // Only reached for allowed commands. When a remote runner is wired (desktop
  // runtime with a live SSH session), use its real output; otherwise fall back
  // to the caller-supplied simulated output (web preview / no session).
  let output = acceptedOutput;
  if (runRemote) {
    try {
      output = await runRemote(decision.command);
    } catch (error) {
      output = error instanceof Error ? error.message : String(error);
    }
  }

  const appendedLines = [
    { kind: "command" as const, text: `${session.prompt} ${decision.displayCommand}` },
    ...splitOutputLines(output).map((text) => ({ kind: "output" as const, text })),
  ];

  return {
    event: {
      displayCommand: decision.displayCommand,
      output,
      type: "accepted",
    },
    session: {
      ...appendTerminalLines(session, appendedLines),
      history: [...session.history, decision.displayCommand],
      historyIndex: -1,
    },
  };
}

function appendTerminalLines(
  session: TerminalSession,
  lines: readonly { kind: TerminalLineKind; text: string }[],
): TerminalSession {
  let nextLineId = session.nextLineId;
  const appendedLines = lines.map((line) => ({
    ...line,
    id: createLineId(nextLineId++),
  }));

  return {
    ...session,
    lines: [...session.lines, ...appendedLines],
    nextLineId,
  };
}

function createLineId(index: number): string {
  return `terminal-line-${index}`;
}

function inferLineKind(line: string): TerminalLineKind {
  if (line.includes(":~$")) {
    return "command";
  }

  if (line.startsWith("[") || /^\d{4}-\d{2}-\d{2}T/.test(line)) {
    return "system";
  }

  return "output";
}

function splitOutputLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line.trim().length > 0);
}
