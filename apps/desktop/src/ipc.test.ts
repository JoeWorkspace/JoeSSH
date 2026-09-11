// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forwardStart,
  forwardStop,
  isDesktopRuntime,
  knownHostsClear,
  knownHostsCount,
  knownHostsList,
  knownHostsRemove,
  ptyClose,
  ptyOpen,
  ptyResize,
  ptyWrite,
  sftpList,
  sftpRead,
  sftpWrite,
  sshConnect,
  sshDisconnect,
  sshExec,
  sshHostKeyProbe,
  testConnection,
  thirdPartyNotices,
} from "./ipc";

type InvokeMock = ReturnType<typeof vi.fn>;

const callbacks = new Map<number, (message: unknown) => void>();
let nextCallback = 0;
function installTauri(invoke: InvokeMock) {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke,
      transformCallback: (callback: (message: unknown) => void) => {
        const id = ++nextCallback;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
    },
  });
}
function ptyEvents() {
  return {
    onData: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    signal: new AbortController().signal,
  };
}

function clearTauri() {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
}

afterEach(() => {
  clearTauri();
  vi.restoreAllMocks();
});

describe("desktop IPC bridge", () => {
  it("reports no desktop runtime when the Tauri global is absent", () => {
    expect(isDesktopRuntime()).toBe(false);
  });

  it("reports no desktop runtime when the Tauri global is present but has no invoke", () => {
    (
      window as unknown as { __TAURI_INTERNALS__?: unknown }
    ).__TAURI_INTERNALS__ = {};
    expect(isDesktopRuntime()).toBe(false);
  });

  it("reports no desktop runtime in a non-window (SSR) environment", () => {
    const originalWindow = globalThis.window;
    // Simulate SSR by removing the global window.
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(isDesktopRuntime()).toBe(false);
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it("reports desktop runtime when the Tauri global is present", () => {
    installTauri(vi.fn());
    expect(isDesktopRuntime()).toBe(true);
  });

  it("throws a clear error when invoking a command outside the desktop runtime", async () => {
    await expect(sshExec("s1", "ls")).rejects.toThrow(
      /unavailable outside the desktop runtime/,
    );
  });

  it("maps ssh_connect args without a renderer-supplied known-host pin by default", async () => {
    const invoke = vi.fn().mockResolvedValue({
      session_id: "session-123",
      fingerprint: "SHA256:zz",
    });
    installTauri(invoke);

    const result = await sshConnect({
      host: "example.com",
      port: 22,
      username: "lin",
      auth: { kind: "password", password: "secret" },
    });

    expect(result).toEqual({
      session_id: "session-123",
      fingerprint: "SHA256:zz",
    });
    expect(invoke).toHaveBeenCalledWith("ssh_connect", {
      input: {
        host: "example.com",
        port: 22,
        username: "lin",
        auth: { kind: "password", password: "secret" },
        pinned_fingerprint: null,
      },
    });
  });

  it("forwards a manual first-use pinned fingerprint when provided", async () => {
    const invoke = vi.fn().mockResolvedValue("s");
    installTauri(invoke);

    await sshConnect({
      host: "h",
      port: 2222,
      username: "u",
      auth: { kind: "private_key", pem: "KEY", passphrase: "pp" },
      pinnedFingerprint: "SHA256:abc",
    });

    expect(invoke).toHaveBeenCalledWith("ssh_connect", {
      input: {
        host: "h",
        port: 2222,
        username: "u",
        auth: { kind: "private_key", pem: "KEY", passphrase: "pp" },
        pinned_fingerprint: "SHA256:abc",
      },
    });
  });

  it("maps known-host management wrappers to native IPC commands", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    installTauri(invoke);

    invoke.mockResolvedValueOnce(2);
    await expect(knownHostsCount()).resolves.toBe(2);
    expect(invoke).toHaveBeenLastCalledWith("known_hosts_count", undefined);

    invoke.mockResolvedValueOnce([
      {
        key: "example.com:22",
        host: "example.com",
        port: 22,
        fingerprint: "SHA256:abc",
        first_seen_at_ms: 1,
        last_seen_at_ms: 2,
        source: "confirmed",
      },
    ]);
    await expect(knownHostsList()).resolves.toEqual([
      {
        key: "example.com:22",
        host: "example.com",
        port: 22,
        fingerprint: "SHA256:abc",
        first_seen_at_ms: 1,
        last_seen_at_ms: 2,
        source: "confirmed",
      },
    ]);
    expect(invoke).toHaveBeenLastCalledWith("known_hosts_list", undefined);

    await knownHostsRemove("example.com:22");
    expect(invoke).toHaveBeenLastCalledWith("known_hosts_remove", {
      hostKey: "example.com:22",
    });

    await knownHostsClear();
    expect(invoke).toHaveBeenLastCalledWith("known_hosts_clear", undefined);
  });

  it("maps ssh_host_key_probe args before authentication", async () => {
    const invoke = vi.fn().mockResolvedValue({
      host: "example.com",
      port: 22,
      status: "unknown",
      presented_fingerprint: "SHA256:abc",
      stored_fingerprint: null,
    });
    installTauri(invoke);

    await expect(sshHostKeyProbe("example.com", 22, 3000)).resolves.toEqual({
      host: "example.com",
      port: 22,
      status: "unknown",
      presented_fingerprint: "SHA256:abc",
      stored_fingerprint: null,
    });
    expect(invoke).toHaveBeenCalledWith("ssh_host_key_probe", {
      input: {
        host: "example.com",
        port: 22,
        connect_timeout_ms: 3000,
      },
    });
  });

  it("maps the remaining command wrappers to their commands and args", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    installTauri(invoke);

    invoke.mockResolvedValueOnce({ exit_status: 0, stdout: "ok" });
    await expect(sshExec("s1", "whoami")).resolves.toEqual({
      exit_status: 0,
      stdout: "ok",
    });
    expect(invoke).toHaveBeenLastCalledWith("ssh_exec", {
      sessionId: "s1",
      command: "whoami",
    });

    invoke.mockResolvedValueOnce([{ name: "f", is_dir: false, size: 10 }]);
    await expect(sftpList("s1", "/srv")).resolves.toEqual([
      { name: "f", is_dir: false, size: 10 },
    ]);
    expect(invoke).toHaveBeenLastCalledWith("sftp_list", {
      sessionId: "s1",
      path: "/srv",
    });

    invoke.mockResolvedValueOnce([1, 2, 3]);
    await expect(sftpRead("s1", "/srv/a")).resolves.toEqual([1, 2, 3]);
    expect(invoke).toHaveBeenLastCalledWith("sftp_read", {
      sessionId: "s1",
      path: "/srv/a",
    });

    invoke.mockResolvedValueOnce(undefined);
    await sftpWrite("s1", "/srv/b", [4, 5, 6]);
    expect(invoke).toHaveBeenLastCalledWith("sftp_write", {
      sessionId: "s1",
      path: "/srv/b",
      data: [4, 5, 6],
    });

    invoke.mockResolvedValueOnce({
      forward_id: "fwd1",
      bound_addr: "127.0.0.1:5432",
    });
    await expect(
      forwardStart("s1", "127.0.0.1:0", "db", 5432),
    ).resolves.toEqual({
      forward_id: "fwd1",
      bound_addr: "127.0.0.1:5432",
    });
    expect(invoke).toHaveBeenLastCalledWith("forward_start", {
      sessionId: "s1",
      bindAddr: "127.0.0.1:0",
      targetHost: "db",
      targetPort: 5432,
    });

    await forwardStop("fwd1");
    expect(invoke).toHaveBeenLastCalledWith("forward_stop", {
      forwardId: "fwd1",
    });

    await sshDisconnect("s1");
    expect(invoke).toHaveBeenLastCalledWith("ssh_disconnect", {
      sessionId: "s1",
    });

    invoke.mockResolvedValueOnce({
      outcome: "reachable",
      latency_ms: 12,
      message: null,
    });
    await expect(testConnection("db.internal", 5432, 3000)).resolves.toEqual({
      outcome: "reachable",
      latency_ms: 12,
      message: null,
    });
    expect(invoke).toHaveBeenLastCalledWith("test_connection", {
      host: "db.internal",
      port: 5432,
      timeoutMs: 3000,
    });

    invoke.mockResolvedValueOnce("Dependency fixture\nMIT License\n");
    await expect(thirdPartyNotices()).resolves.toBe(
      "Dependency fixture\nMIT License\n",
    );
    expect(invoke).toHaveBeenLastCalledWith("third_party_notices", undefined);
  });

  it("maps the PTY command wrappers to their commands and args", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    installTauri(invoke);

    invoke.mockResolvedValueOnce("pty-1");
    await expect(ptyOpen("s1", 80, 24, ptyEvents())).resolves.toBe("pty-1");
    expect(invoke).toHaveBeenLastCalledWith("pty_open", {
      sessionId: "s1",
      cols: 80,
      rows: 24,
      onEvent: expect.any(Object),
    });

    await ptyWrite("pty-1", [104, 105]);
    expect(invoke).toHaveBeenLastCalledWith("pty_write", {
      ptyId: "pty-1",
      data: [104, 105],
    });

    await ptyResize("pty-1", 120, 40);
    expect(invoke).toHaveBeenLastCalledWith("pty_resize", {
      ptyId: "pty-1",
      cols: 120,
      rows: 40,
    });

    await ptyClose("pty-1");
    expect(invoke).toHaveBeenLastCalledWith("pty_close", { ptyId: "pty-1" });
  });

  it("registers one ordered Channel before invoke and releases it on cancellation", async () => {
    let callback: ((message: unknown) => void) | undefined;
    const invoke = vi.fn(
      async (command: string, args: Record<string, unknown>) => {
        if (command !== "pty_open") return;
        const channel = args.onEvent as { id: number };
        callback = callbacks.get(channel.id);
        expect(callback).toBeDefined();
        // The SDK must reorder an early exit that arrives before the first chunk.
        callback?.({ index: 1, message: { kind: "exited", code: 7 } });
        callback?.({
          index: 0,
          message: {
            kind: "data",
            pty_id: "pty-9",
            sequence: 1,
            data: [1, 2, 3],
          },
        });
        return "pty-9";
      },
    );
    installTauri(invoke);
    const controller = new AbortController();
    const events = { ...ptyEvents(), signal: controller.signal };
    const before = callbacks.size;
    await expect(ptyOpen("s1", 80, 24, events)).resolves.toBe("pty-9");
    expect(events.onData).toHaveBeenCalledWith([1, 2, 3]);
    expect(events.onExit).toHaveBeenCalledWith(7);
    controller.abort();
    expect(callbacks.size).toBe(before);
    callback?.({ index: 2, message: { kind: "data", data: [9] } });
    expect(events.onData).toHaveBeenCalledTimes(1);
  });

  it("returns output credit only after the terminal consumes the bytes", async () => {
    let consume!: () => void;
    const consumed = new Promise<void>((resolve) => {
      consume = resolve;
    });
    const invoke = vi.fn(
      async (command: string, args: Record<string, unknown>) => {
        if (command === "pty_open") {
          const callback = callbacks.get((args.onEvent as { id: number }).id);
        if (!callback) throw new Error("Missing Channel callback");
          callback({
            index: 0,
            message: { kind: "data", pty_id: "pty-1", sequence: 1, data: [65] },
          });
          return "pty-1";
        }
      },
    );
    installTauri(invoke);
    await ptyOpen("s1", 80, 24, { ...ptyEvents(), onData: () => consumed });
    expect(invoke).not.toHaveBeenCalledWith(
      "pty_output_ack",
      expect.anything(),
    );
    consume();
    await consumed;
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith("pty_output_ack", {
      ptyId: "pty-1",
      sequence: 1,
    });
  });
});
