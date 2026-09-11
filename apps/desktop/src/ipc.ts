// Desktop IPC bridge to the Rust core (Tauri commands).
//
// Runtime-detected so the same React bundle runs both as the Tauri desktop app
// (real SSH/SFTP/forward via `invoke`) and as the sandboxed web preview (which
// keeps the existing static/demo data). No `@tauri-apps/api` import keeps the
// web build and unit tests dependency-free; we call the injected global that
// Tauri v2 exposes in the desktop webview.

type TauriInvoke = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

interface TauriInternals {
  invoke: TauriInvoke;
  unregisterCallback?: (id: number) => void;
}

function getTauriInvoke(): TauriInvoke | undefined {
  if (typeof window === "undefined") return undefined;
  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
  ).__TAURI_INTERNALS__;
  return internals?.invoke;
}

/// True when running inside the Tauri desktop shell (real backend available).
export function isDesktopRuntime(): boolean {
  return getTauriInvoke() !== undefined;
}

async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const tauriInvoke = getTauriInvoke();
  if (!tauriInvoke) {
    throw new Error(
      `IPC command "${cmd}" is unavailable outside the desktop runtime`,
    );
  }
  return (await tauriInvoke(cmd, args)) as T;
}

export type SshAuthInput =
  | { kind: "password"; password: string }
  | { kind: "private_key"; pem: string; passphrase?: string };

export interface SshConnectInput {
  host: string;
  port: number;
  username: string;
  auth: SshAuthInput;
  pinnedFingerprint?: string;
}

export type HostKeyProbeStatus = "unknown" | "match" | "changed";

export interface HostKeyProbeOutput {
  host: string;
  port: number;
  status: HostKeyProbeStatus;
  presented_fingerprint: string;
  stored_fingerprint: string | null;
}

export type KnownHostSource = "legacy" | "tofu" | "confirmed";

export interface KnownHostEntry {
  key: string;
  host: string;
  port: number;
  fingerprint: string;
  first_seen_at_ms: number | null;
  last_seen_at_ms: number | null;
  source: KnownHostSource;
}

export interface ExecOutput {
  exit_status: number;
  stdout: string;
}

export interface SftpEntry {
  name: string;
  is_dir: boolean;
  size: number | null;
}

export interface ForwardOutput {
  forward_id: string;
  bound_addr: string;
}

export interface ConnectOutput {
  session_id: string;
  fingerprint: string | null;
}

export function sshConnect(input: SshConnectInput): Promise<ConnectOutput> {
  return invoke<ConnectOutput>("ssh_connect", {
    input: {
      host: input.host,
      port: input.port,
      username: input.username,
      auth: input.auth,
      pinned_fingerprint: input.pinnedFingerprint ?? null,
    },
  });
}

export function sshHostKeyProbe(
  host: string,
  port: number,
  connectTimeoutMs?: number,
): Promise<HostKeyProbeOutput> {
  return invoke<HostKeyProbeOutput>("ssh_host_key_probe", {
    input: {
      host,
      port,
      connect_timeout_ms: connectTimeoutMs ?? null,
    },
  });
}

export function knownHostsCount(): Promise<number> {
  return invoke<number>("known_hosts_count");
}

export function knownHostsList(): Promise<KnownHostEntry[]> {
  return invoke<KnownHostEntry[]>("known_hosts_list");
}

export function knownHostsRemove(hostKey: string): Promise<void> {
  return invoke<void>("known_hosts_remove", { hostKey });
}

export function knownHostsClear(): Promise<void> {
  return invoke<void>("known_hosts_clear");
}

export function sshExec(
  sessionId: string,
  command: string,
): Promise<ExecOutput> {
  return invoke<ExecOutput>("ssh_exec", { sessionId, command });
}

export function sftpList(
  sessionId: string,
  path: string,
): Promise<SftpEntry[]> {
  return invoke<SftpEntry[]>("sftp_list", { sessionId, path });
}

export function sftpRead(sessionId: string, path: string): Promise<number[]> {
  return invoke<number[]>("sftp_read", { sessionId, path });
}

export function sftpWrite(
  sessionId: string,
  path: string,
  data: number[],
): Promise<void> {
  return invoke<void>("sftp_write", { sessionId, path, data });
}

export function forwardStart(
  sessionId: string,
  bindAddr: string,
  targetHost: string,
  targetPort: number,
): Promise<ForwardOutput> {
  return invoke<ForwardOutput>("forward_start", {
    sessionId,
    bindAddr,
    targetHost,
    targetPort,
  });
}

export function forwardStop(forwardId: string): Promise<void> {
  return invoke<void>("forward_stop", { forwardId });
}

export function sshDisconnect(sessionId: string): Promise<void> {
  return invoke<void>("ssh_disconnect", { sessionId });
}

export interface ProbeResult {
  outcome: "reachable" | "timed_out" | "unreachable";
  latency_ms: number | null;
  message: string | null;
}

/// Test TCP reachability/latency to a host:port (no session needed).
export function testConnection(
  host: string,
  port: number,
  timeoutMs?: number,
): Promise<ProbeResult> {
  return invoke<ProbeResult>("test_connection", { host, port, timeoutMs });
}

/** Read the third-party notices embedded in this exact desktop app build. */
export function thirdPartyNotices(): Promise<string> {
  return invoke<string>("third_party_notices");
}

// --- Interactive PTY (desktop runtime only) ---

export type PtyEvent =
  | { kind: "data"; pty_id: string; sequence: number; data: number[] }
  | { kind: "exited"; code: number }
  | { kind: "failed" };

export async function ptyOpen(
  sessionId: string,
  cols: number,
  rows: number,
  events: import("./usePtySession").PtyEvents,
): Promise<string> {
  const { Channel } = await import("@tauri-apps/api/core");
  if (events.signal.aborted) throw new Error("PTY opening cancelled");
  const channel = new Channel<PtyEvent>((event) => {
    if (events.signal.aborted) return;
    if (event.kind === "data") {
      void Promise.resolve(events.onData(event.data))
        .then(() => {
          if (!events.signal.aborted)
            return invoke<void>("pty_output_ack", {
              ptyId: event.pty_id,
              sequence: event.sequence,
            });
        })
        .catch(() => {
          if (!events.signal.aborted) events.onError();
        });
    } else if (event.kind === "exited") events.onExit(event.code);
    else events.onError();
  });
  const dispose = () => {
    channel.onmessage = () => {};
    const internals = (
      window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
    ).__TAURI_INTERNALS__;
    internals?.unregisterCallback?.(channel.id);
  };
  events.signal.addEventListener("abort", dispose, { once: true });
  try {
    return await invoke<string>("pty_open", {
      sessionId,
      cols,
      rows,
      onEvent: channel,
    });
  } catch (error) {
    dispose();
    events.signal.removeEventListener("abort", dispose);
    throw error;
  }
}

export function ptyWrite(ptyId: string, data: number[]): Promise<void> {
  return invoke<void>("pty_write", { ptyId, data });
}

export function ptyResize(
  ptyId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke<void>("pty_resize", { ptyId, cols, rows });
}

export function ptyClose(ptyId: string): Promise<void> {
  return invoke<void>("pty_close", { ptyId });
}
