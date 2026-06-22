import { describe, expect, it } from "vitest";
import { createTerminalSession, submitTerminalCommand } from "./terminalExecutor";

function createSession() {
  return createTerminalSession({
    host: "prod-edge-01",
    lines: [
      "atlas@prod-edge-01:~$ uptime",
      "up 19 hours",
      "atlas@prod-edge-01:~$ tail -f /var/log/joessh/session.log",
    ],
    prompt: "atlas@prod-edge-01:~$",
  });
}

describe("terminal executor", () => {
  it("creates structured terminal lines with stable ids", () => {
    const session = createSession();

    expect(session.lines).toEqual([
      { id: "terminal-line-1", kind: "command", text: "atlas@prod-edge-01:~$ uptime" },
      { id: "terminal-line-2", kind: "output", text: "up 19 hours" },
      {
        id: "terminal-line-3",
        kind: "command",
        text: "atlas@prod-edge-01:~$ tail -f /var/log/joessh/session.log",
      },
    ]);
    expect(session.nextLineId).toBe(4);
  });

  it("ignores blank commands without changing the session", async () => {
    const session = createSession();
    const result = await submitTerminalCommand(session, "   ", "[local] accepted");

    expect(result.event).toEqual({ type: "ignored" });
    expect(result.session).toBe(session);
  });

  it("appends allowed commands and output with unique ids for repeated command text", async () => {
    const first = (await submitTerminalCommand(createSession(), "whoami", "[local] accepted")).session;
    const result = await submitTerminalCommand(first, "whoami", "[local] accepted");

    expect(result.event).toEqual({
      displayCommand: "whoami",
      output: "[local] accepted",
      type: "accepted",
    });
    expect(result.session.lines.slice(-4)).toEqual([
      { id: "terminal-line-4", kind: "command", text: "atlas@prod-edge-01:~$ whoami" },
      { id: "terminal-line-5", kind: "output", text: "[local] accepted" },
      { id: "terminal-line-6", kind: "command", text: "atlas@prod-edge-01:~$ whoami" },
      { id: "terminal-line-7", kind: "output", text: "[local] accepted" },
    ]);
  });

  it("redacts secret-like command tokens before appending session lines", async () => {
    const result = await submitTerminalCommand(
      createSession(),
      "whoami token=abc123 --api-key live-key --password='hunter two'",
      "[local] accepted",
    );
    const sessionText = result.session.lines.map((line) => line.text).join("\n");

    expect(sessionText).toContain("whoami token=<redacted> --api-key <redacted> --password=<redacted>");
    expect(sessionText).not.toContain("abc123");
    expect(sessionText).not.toContain("live-key");
    expect(sessionText).not.toContain("hunter two");
  });

  it("redacts URL and auth-header secrets before appending session lines", async () => {
    const result = await submitTerminalCommand(
      createSession(),
      "curl -H 'Authorization: Bearer tok-9f8e7d' postgres://atlas:hunter2@db.internal:5432/app",
      "[local] accepted",
    );
    const sessionText = result.session.lines.map((line) => line.text).join("\n");

    expect(sessionText).toContain("Authorization: Bearer <redacted>");
    expect(sessionText).toContain("postgres://atlas:<redacted>@db.internal:5432/app");
    expect(sessionText).not.toContain("tok-9f8e7d");
    expect(sessionText).not.toContain("hunter2");
    // History must not retain the raw secret either.
    expect(result.session.history.join("\n")).not.toContain("hunter2");
  });

  it("classifies timestamp-prefixed lines as system kind", () => {
    const session = createTerminalSession({
      host: "test-host",
      lines: [
        "atlas@prod-edge-01:~$ tail -f /var/log/joessh/session.log",
        "2026-05-24T02:17:14Z auth policy=jit role=incident-commander expires=00:42:18",
        "[WARN] connection reset by peer",
        "up 19 hours",
      ],
      prompt: "atlas@prod-edge-01:~$",
    });

    expect(session.lines[0].kind).toBe("command");
    expect(session.lines[1].kind).toBe("system"); // timestamp prefix
    expect(session.lines[2].kind).toBe("system"); // bracket prefix
    expect(session.lines[3].kind).toBe("output");
  });

  it("blocks dangerous commands without appending them to the session", async () => {
    const session = createSession();
    const result = await submitTerminalCommand(session, "sudo rm -rf /", "[local] accepted");

    expect(result.event).toEqual({
      displayCommand: "sudo rm -rf /",
      pattern: "rm -rf /",
      reasonKey: "desktop.safetyReasonRmRoot",
      type: "blocked",
    });
    expect(result.session).toBe(session);
    expect(result.session.lines.map((line) => line.text).join("\n")).not.toContain("sudo rm -rf /");
  });

  it("uses the remote runner's real output for allowed commands when provided", async () => {
    const runRemote = async (command: string) => `REMOTE(${command})`;
    const result = await submitTerminalCommand(createSession(), "whoami", "[local] accepted", runRemote);

    expect(result.event).toEqual({ displayCommand: "whoami", output: "REMOTE(whoami)", type: "accepted" });
    expect(result.session.lines.slice(-1)[0]).toEqual({
      id: "terminal-line-5",
      kind: "output",
      text: "REMOTE(whoami)",
    });
  });

  it("surfaces the remote runner error message instead of crashing", async () => {
    const runRemote = async () => {
      throw new Error("session not found");
    };
    const result = await submitTerminalCommand(createSession(), "whoami", "[local] accepted", runRemote);

    expect(result.event).toMatchObject({ type: "accepted", output: "session not found" });
  });

  it("never invokes the remote runner for blocked commands", async () => {
    let called = false;
    const runRemote = async () => {
      called = true;
      return "should not run";
    };
    const result = await submitTerminalCommand(createSession(), "sudo rm -rf /", "[local] accepted", runRemote);

    expect(result.event.type).toBe("blocked");
    expect(called).toBe(false);
  });
});
