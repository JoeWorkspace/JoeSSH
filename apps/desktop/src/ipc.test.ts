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
  onPtyOutput,
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
} from "./ipc";

type InvokeMock = ReturnType<typeof vi.fn>;

// Records the latest handler registered per event name, so tests can drive
// the mocked Tauri event listeners.
const listenHandlers: Record<string, (event: unknown) => void> = {};
let unlistenCalls = 0;
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: unknown) => void) => {
    listenHandlers[name] = handler;
    return () => { unlistenCalls += 1; };
  },
}));

function installTauri(invoke: InvokeMock) {
  (window as unknown as { __TAURI_INTERNALS__?: { invoke: InvokeMock } }).__TAURI_INTERNALS__ = {
    invoke,
  };
}

function clearTauri() {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
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
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
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
    await expect(sshExec("s1", "ls")).rejects.toThrow(/unavailable outside the desktop runtime/);
  });

  it("maps ssh_connect args without a renderer-supplied known-host pin by default", async () => {
    const invoke = vi.fn().mockResolvedValue({ session_id: "session-123", fingerprint: "SHA256:zz" });
    installTauri(invoke);

    const result = await sshConnect({
      host: "example.com",
      port: 22,
      username: "lin",
      auth: { kind: "password", password: "secret" },
    });

    expect(result).toEqual({ session_id: "session-123", fingerprint: "SHA256:zz" });
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
    expect(invoke).toHaveBeenLastCalledWith("known_hosts_remove", { hostKey: "example.com:22" });

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
    await expect(sshExec("s1", "whoami")).resolves.toEqual({ exit_status: 0, stdout: "ok" });
    expect(invoke).toHaveBeenLastCalledWith("ssh_exec", { sessionId: "s1", command: "whoami" });

    invoke.mockResolvedValueOnce([{ name: "f", is_dir: false, size: 10 }]);
    await expect(sftpList("s1", "/srv")).resolves.toEqual([{ name: "f", is_dir: false, size: 10 }]);
    expect(invoke).toHaveBeenLastCalledWith("sftp_list", { sessionId: "s1", path: "/srv" });

    invoke.mockResolvedValueOnce([1, 2, 3]);
    await expect(sftpRead("s1", "/srv/a")).resolves.toEqual([1, 2, 3]);
    expect(invoke).toHaveBeenLastCalledWith("sftp_read", { sessionId: "s1", path: "/srv/a" });

    invoke.mockResolvedValueOnce(undefined);
    await sftpWrite("s1", "/srv/b", [4, 5, 6]);
    expect(invoke).toHaveBeenLastCalledWith("sftp_write", { sessionId: "s1", path: "/srv/b", data: [4, 5, 6] });

    invoke.mockResolvedValueOnce({ forward_id: "fwd1", bound_addr: "127.0.0.1:5432" });
    await expect(forwardStart("s1", "127.0.0.1:0", "db", 5432)).resolves.toEqual({
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
    expect(invoke).toHaveBeenLastCalledWith("forward_stop", { forwardId: "fwd1" });

    await sshDisconnect("s1");
    expect(invoke).toHaveBeenLastCalledWith("ssh_disconnect", { sessionId: "s1" });

    invoke.mockResolvedValueOnce({ outcome: "reachable", latency_ms: 12, message: null });
    await expect(testConnection("db.internal", 5432, 3000)).resolves.toEqual({ outcome: "reachable", latency_ms: 12, message: null });
    expect(invoke).toHaveBeenLastCalledWith("test_connection", { host: "db.internal", port: 5432, timeoutMs: 3000 });
  });

  it("maps the PTY command wrappers to their commands and args", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    installTauri(invoke);

    invoke.mockResolvedValueOnce("pty-1");
    await expect(ptyOpen("s1", 80, 24)).resolves.toBe("pty-1");
    expect(invoke).toHaveBeenLastCalledWith("pty_open", { sessionId: "s1", cols: 80, rows: 24 });

    await ptyWrite("pty-1", [104, 105]);
    expect(invoke).toHaveBeenLastCalledWith("pty_write", { ptyId: "pty-1", data: [104, 105] });

    await ptyResize("pty-1", 120, 40);
    expect(invoke).toHaveBeenLastCalledWith("pty_resize", { ptyId: "pty-1", cols: 120, rows: 40 });

    await ptyClose("pty-1");
    expect(invoke).toHaveBeenLastCalledWith("pty_close", { ptyId: "pty-1" });
  });

  it("onPtyOutput is a no-op (returns an unlisten) outside the desktop runtime", async () => {
    const unlisten = await onPtyOutput("pty-1", () => {}, () => {});
    expect(typeof unlisten).toBe("function");
    expect(() => unlisten()).not.toThrow();
  });

  it("onPtyOutput subscribes to output/exit events and unlistens in the desktop runtime", async () => {
    installTauri(vi.fn());
    const onData = vi.fn();
    const onExit = vi.fn();
    const unlisten = await onPtyOutput("pty-9", onData, onExit);

    // The mocked listen (see vi.mock below) records handlers per event name.
    listenHandlers["pty://output/pty-9"]({ payload: { data: [1, 2, 3] } });
    listenHandlers["pty://exit/pty-9"]({ payload: 7 });
    expect(onData).toHaveBeenCalledWith([1, 2, 3]);
    expect(onExit).toHaveBeenCalledWith(7);

    unlisten();
    expect(unlistenCalls).toBe(2);
  });
});
