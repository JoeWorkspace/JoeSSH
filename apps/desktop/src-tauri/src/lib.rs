//! Tauri desktop shell: exposes the real `atlasterm-core` SSH/SFTP/forward
//! engine to the React frontend as IPC commands, breaking out of the browser
//! sandbox the web build runs in.
//!
//! VERIFICATION NOTE: launching the Tauri GUI requires a desktop/WebView2
//! runtime not available headless, and live SSH needs a real server. This
//! layer is verified by compiling the IPC surface (`cargo build`) and by the
//! `atlasterm-core` unit/integration tests it delegates to.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use atlasterm_core::security::{detect_dangerous_command, DangerousCommandAction};
use atlasterm_core::{
    probe_host_key, probe_tcp, validate_local_bind_addr, HostKeyPolicy, ProbeOutcome, PtyOutput,
    PtyWriter, SftpEntry, SshAuth, SshClient, SshConfig, TcpForwardHandle,
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use uuid::Uuid;

const KNOWN_HOSTS_FILE: &str = "known-hosts.json";
const KNOWN_HOSTS_FILE_VERSION: u8 = 1;
const HOST_KEY_VERIFICATION_FAILED: &str = "host key verification failed";
const HOST_KEY_CONFIRMATION_REQUIRED: &str = "host key confirmation required before authentication";
const HOST_KEY_STORAGE_UNAVAILABLE: &str = "known-host storage unavailable";
const SFTP_MAX_TRANSFER_BYTES: usize = 25 * 1024 * 1024;
const SFTP_TRANSFER_LIMIT_EXCEEDED: &str = "sftp transfer exceeds the desktop safety limit";
const SFTP_REMOTE_PATH_UNSAFE: &str = "sftp remote path is unsafe";
const SSH_EXEC_COMMAND_BLOCKED: &str = "ssh exec command blocked by desktop safety policy";
const PTY_COMMAND_BLOCKED: &str = "pty input blocked by desktop safety policy";
const PTY_COMMAND_BUFFER_MAX_BYTES: usize = 16 * 1024;
const THIRD_PARTY_NOTICES_RESOURCE: &str = "legal/THIRD-PARTY-NOTICES.txt";
const THIRD_PARTY_NOTICES_MAX_BYTES: u64 = 8 * 1024 * 1024;
const THIRD_PARTY_NOTICES_UNAVAILABLE: &str = "third-party license notices are unavailable";
const FORWARD_BIND_ADDR_UNSAFE: &str =
    "port forward bind address must use a loopback host such as 127.0.0.1, localhost, or [::1]";

/// Live SSH sessions and session-owned resources, keyed by ids handed back to
/// the frontend.
#[derive(Default)]
struct AppState {
    sessions: Mutex<HashMap<Uuid, Arc<SshClient>>>,
    forwards: Mutex<HashMap<Uuid, SessionResource<TcpForwardHandle>>>,
    ptys: Mutex<HashMap<Uuid, SessionResource<PtyWriter>>>,
    pty_input_buffers: Mutex<HashMap<Uuid, Vec<u8>>>,
    known_hosts: Mutex<()>,
}

struct SessionResource<T> {
    session_id: Uuid,
    value: T,
}

impl<T> SessionResource<T> {
    fn new(session_id: Uuid, value: T) -> Self {
        Self { session_id, value }
    }
}

/// Auth payload from the frontend (mirrors `SshAuth`).
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum AuthInput {
    Password {
        password: String,
    },
    PrivateKey {
        pem: String,
        passphrase: Option<String>,
    },
}

impl From<AuthInput> for SshAuth {
    fn from(input: AuthInput) -> Self {
        match input {
            AuthInput::Password { password } => SshAuth::Password(password),
            AuthInput::PrivateKey { pem, passphrase } => SshAuth::PrivateKey { pem, passphrase },
        }
    }
}

#[derive(Debug, Deserialize)]
struct ConnectInput {
    host: String,
    port: u16,
    username: String,
    auth: AuthInput,
    /// Optional user-entered SHA-256 host-key fingerprint. This is only an
    /// additional first-use constraint; saved pins are owned by native storage.
    pinned_fingerprint: Option<String>,
    /// Optional connect/handshake timeout in ms (defaults to 15s).
    #[serde(default)]
    connect_timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
struct ExecOutput {
    exit_status: u32,
    stdout: String,
}

#[derive(Debug, Serialize)]
struct ConnectOutput {
    session_id: String,
    fingerprint: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum KnownHostSource {
    Legacy,
    Tofu,
    Confirmed,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Serialize)]
struct KnownHostRecord {
    key: String,
    host: String,
    port: u16,
    fingerprint: String,
    first_seen_at_ms: Option<u64>,
    last_seen_at_ms: Option<u64>,
    source: KnownHostSource,
}

#[derive(Debug, Deserialize, Serialize)]
struct KnownHostsFile {
    version: u8,
    hosts: HashMap<String, KnownHostRecord>,
}

#[derive(Debug, Deserialize)]
struct HostKeyProbeInput {
    host: String,
    port: u16,
    #[serde(default)]
    connect_timeout_ms: Option<u64>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum HostKeyProbeStatus {
    Unknown,
    Match,
    Changed,
}

#[derive(Debug, Serialize)]
struct HostKeyProbeOutput {
    host: String,
    port: u16,
    status: HostKeyProbeStatus,
    presented_fingerprint: String,
    stored_fingerprint: Option<String>,
}

/// Open and authenticate an SSH session. Known hosts are verified against
/// app-data native persistence. Unknown hosts must provide the fingerprint that
/// the user confirmed in the pre-auth probe; direct IPC calls cannot silently
/// trust a first-use key. Returns a session id plus the server's SHA-256
/// fingerprint for display.
#[tauri::command]
async fn ssh_connect(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    input: ConnectInput,
) -> Result<ConnectOutput, String> {
    let _known_hosts_guard = state.known_hosts.lock().await;
    let known_hosts_path = known_hosts_path(&app)?;
    let host_key = known_host_key(&input.host, input.port);
    let known_hosts = read_known_hosts_file(&known_hosts_path)?;
    let stored_fingerprint = known_hosts
        .get(&host_key)
        .map(|record| record.fingerprint.clone());
    let manual_fingerprint = normalize_manual_fingerprint(input.pinned_fingerprint);
    let host_key_policy = host_key_policy_for(stored_fingerprint.clone(), manual_fingerprint)?;

    let config = SshConfig {
        host: input.host,
        port: input.port,
        username: input.username,
        auth: input.auth.into(),
        host_key_policy,
        connect_timeout_ms: input.connect_timeout_ms.unwrap_or(15_000),
    };
    let client = SshClient::connect(config)
        .await
        .map_err(sanitize_ssh_error)?;
    let fingerprint = client.server_fingerprint().map(|s| s.to_string());

    if stored_fingerprint.is_none() {
        let fingerprint = fingerprint
            .as_deref()
            .ok_or_else(|| HOST_KEY_VERIFICATION_FAILED.to_string())?;
        persist_known_host_if_first_use(
            &known_hosts_path,
            &host_key,
            fingerprint,
            KnownHostSource::Confirmed,
        )?;
    }

    let id = Uuid::new_v4();
    state.sessions.lock().await.insert(id, Arc::new(client));
    Ok(ConnectOutput {
        session_id: id.to_string(),
        fingerprint,
    })
}

#[tauri::command]
async fn ssh_host_key_probe(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    input: HostKeyProbeInput,
) -> Result<HostKeyProbeOutput, String> {
    let _known_hosts_guard = state.known_hosts.lock().await;
    let known_hosts_path = known_hosts_path(&app)?;
    let host = input.host.trim().to_string();
    let host_key = known_host_key(&host, input.port);
    let known_hosts = read_known_hosts_file(&known_hosts_path)?;
    let stored_fingerprint = known_hosts
        .get(&host_key)
        .map(|record| record.fingerprint.clone());
    let presented_fingerprint = probe_host_key(
        &host,
        input.port,
        input.connect_timeout_ms.unwrap_or(15_000),
    )
    .await
    .map_err(sanitize_ssh_error)?;
    let status = host_key_probe_status(stored_fingerprint.as_deref(), &presented_fingerprint);

    Ok(HostKeyProbeOutput {
        host,
        port: input.port,
        status,
        presented_fingerprint,
        stored_fingerprint,
    })
}

#[tauri::command]
async fn known_hosts_count(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<usize, String> {
    let _known_hosts_guard = state.known_hosts.lock().await;
    let path = known_hosts_path(&app)?;
    Ok(read_known_hosts_file(&path)?.len())
}

#[tauri::command]
async fn known_hosts_list(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<KnownHostRecord>, String> {
    let _known_hosts_guard = state.known_hosts.lock().await;
    let path = known_hosts_path(&app)?;
    Ok(sorted_known_host_records(read_known_hosts_file(&path)?))
}

#[tauri::command]
async fn known_hosts_remove(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    host_key: String,
) -> Result<(), String> {
    let _known_hosts_guard = state.known_hosts.lock().await;
    let path = known_hosts_path(&app)?;
    remove_known_host(&path, &host_key)
}

#[tauri::command]
async fn known_hosts_clear(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let _known_hosts_guard = state.known_hosts.lock().await;
    let path = known_hosts_path(&app)?;
    write_known_hosts_file(&path, &HashMap::new())
}

/// Run a one-shot remote command on an existing session.
#[tauri::command]
async fn ssh_exec(
    state: tauri::State<'_, AppState>,
    session_id: String,
    command: String,
) -> Result<ExecOutput, String> {
    ensure_safe_ssh_exec_command(&command)?;
    let client = session(&state, &session_id).await?;
    let (exit_status, stdout) = client.exec(&command).await.map_err(sanitize_ssh_error)?;
    Ok(ExecOutput {
        exit_status,
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
    })
}

/// List a remote directory over SFTP.
#[tauri::command]
async fn sftp_list(
    state: tauri::State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<SftpEntry>, String> {
    let path = normalize_sftp_remote_path(&path)?;
    let client = session(&state, &session_id).await?;
    let sftp = client.open_sftp().await.map_err(sanitize_ssh_error)?;
    sftp.list_dir(&path).await.map_err(sanitize_ssh_error)
}

/// Download a remote file's bytes (returned as a UTF-8 lossy string preview).
#[tauri::command]
async fn sftp_read(
    state: tauri::State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<u8>, String> {
    let path = normalize_sftp_remote_path(&path)?;
    let client = session(&state, &session_id).await?;
    let sftp = client.open_sftp().await.map_err(sanitize_ssh_error)?;
    let data = sftp
        .download_limited(&path, SFTP_MAX_TRANSFER_BYTES)
        .await
        .map_err(sanitize_sftp_transfer_error)?;
    Ok(data)
}

/// Upload bytes to a remote path over SFTP (creating/truncating it).
#[tauri::command]
async fn sftp_write(
    state: tauri::State<'_, AppState>,
    session_id: String,
    path: String,
    data: Vec<u8>,
) -> Result<(), String> {
    ensure_sftp_transfer_size(data.len())?;
    let path = normalize_sftp_remote_path(&path)?;
    let client = session(&state, &session_id).await?;
    let sftp = client.open_sftp().await.map_err(sanitize_ssh_error)?;
    sftp.upload(&path, &data).await.map_err(sanitize_ssh_error)
}

/// Start a local port forward tunneled through the SSH session.
/// Returns the forward id and the actually-bound local address.
#[tauri::command]
async fn forward_start(
    state: tauri::State<'_, AppState>,
    session_id: String,
    bind_addr: String,
    target_host: String,
    target_port: u16,
) -> Result<ForwardOutput, String> {
    ensure_forward_bind_addr(&bind_addr)?;
    let session_uuid = parse_id(&session_id)?;
    let client = session_by_id(&state, session_uuid).await?;
    let mut handle = Some(
        client
            .forward_local(&bind_addr, target_host, target_port)
            .await
            .map_err(sanitize_ssh_error)?,
    );
    let bound_addr = handle
        .as_ref()
        .expect("forward handle exists before registration")
        .bound_addr()
        .to_string();
    let id = Uuid::new_v4();
    let registered = {
        let sessions = state.sessions.lock().await;
        if sessions.contains_key(&session_uuid) {
            state.forwards.lock().await.insert(
                id,
                SessionResource::new(
                    session_uuid,
                    handle
                        .take()
                        .expect("forward handle is registered at most once"),
                ),
            );
            true
        } else {
            false
        }
    };
    if !registered {
        if let Some(mut handle) = handle {
            handle.shutdown();
        }
        return Err("session not found".to_string());
    }
    Ok(ForwardOutput {
        forward_id: id.to_string(),
        bound_addr,
    })
}

#[derive(Debug, Serialize)]
struct ForwardOutput {
    forward_id: String,
    bound_addr: String,
}

/// Stop a running forward.
#[tauri::command]
async fn forward_stop(state: tauri::State<'_, AppState>, forward_id: String) -> Result<(), String> {
    let id = parse_id(&forward_id)?;
    if let Some(mut resource) = state.forwards.lock().await.remove(&id) {
        resource.value.shutdown();
    }
    Ok(())
}

/// Close and drop an SSH session.
#[tauri::command]
async fn ssh_disconnect(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let id = parse_id(&session_id)?;
    state.sessions.lock().await.remove(&id);
    close_session_resources(&state, id).await;
    Ok(())
}

#[derive(Clone, Serialize)]
struct PtyOutputEvent {
    data: Vec<u8>,
}

/// Open an interactive PTY shell on a session. Spawns a background task that
/// pumps output to `pty://output/<pty_id>` events and an exit to
/// `pty://exit/<pty_id>`; returns the pty id used for writes/resizes/events.
#[tauri::command]
async fn pty_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<String, String> {
    let session_uuid = parse_id(&session_id)?;
    let client = session_by_id(&state, session_uuid).await?;
    let pty = client
        .open_shell(cols, rows)
        .await
        .map_err(sanitize_ssh_error)?;
    let (writer, mut reader) = pty.split();
    let mut writer = Some(writer);

    let pty_id = Uuid::new_v4();
    let registered = {
        let sessions = state.sessions.lock().await;
        if sessions.contains_key(&session_uuid) {
            state.ptys.lock().await.insert(
                pty_id,
                SessionResource::new(
                    session_uuid,
                    writer
                        .take()
                        .expect("pty writer is registered at most once"),
                ),
            );
            true
        } else {
            false
        }
    };
    if !registered {
        if let Some(writer) = writer {
            let _ = writer.close().await;
        }
        return Err("session not found".to_string());
    }
    state
        .pty_input_buffers
        .lock()
        .await
        .insert(pty_id, Vec::new());

    let output_event = format!("pty://output/{pty_id}");
    let exit_event = format!("pty://exit/{pty_id}");
    let app_handle = app.clone();
    tokio::spawn(async move {
        let mut exit_code = 0u32;
        while let Some(output) = reader.next_output().await {
            match output {
                PtyOutput::Data(data) => {
                    let _ = app_handle.emit(&output_event, PtyOutputEvent { data });
                }
                PtyOutput::Exit(code) => {
                    exit_code = code;
                    break;
                }
            }
        }
        let _ = app_handle.emit(&exit_event, exit_code);
        if let Some(state) = app_handle.try_state::<AppState>() {
            state.ptys.lock().await.remove(&pty_id);
            state.pty_input_buffers.lock().await.remove(&pty_id);
        }
    });

    Ok(pty_id.to_string())
}

/// Send stdin bytes to a PTY.
#[tauri::command]
async fn pty_write(
    state: tauri::State<'_, AppState>,
    pty_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let id = parse_id(&pty_id)?;
    {
        let ptys = state.ptys.lock().await;
        if !ptys.contains_key(&id) {
            return Err("pty not found".to_string());
        }
    }

    if let Err(error) = ensure_safe_pty_write(&state, id, &data).await {
        let ptys = state.ptys.lock().await;
        if let Some(writer) = ptys.get(&id) {
            let _ = writer.value.write(&[0x03]).await;
        }
        return Err(error);
    }

    let ptys = state.ptys.lock().await;
    let writer = ptys.get(&id).ok_or_else(|| "pty not found".to_string())?;
    writer.value.write(&data).await.map_err(sanitize_ssh_error)
}

/// Resize a PTY's terminal window.
#[tauri::command]
async fn pty_resize(
    state: tauri::State<'_, AppState>,
    pty_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let id = parse_id(&pty_id)?;
    let ptys = state.ptys.lock().await;
    let writer = ptys.get(&id).ok_or_else(|| "pty not found".to_string())?;
    writer
        .value
        .resize(cols, rows)
        .await
        .map_err(sanitize_ssh_error)
}

/// Close a PTY and drop its writer.
#[tauri::command]
async fn pty_close(state: tauri::State<'_, AppState>, pty_id: String) -> Result<(), String> {
    let id = parse_id(&pty_id)?;
    let resource = state.ptys.lock().await.remove(&id);
    state.pty_input_buffers.lock().await.remove(&id);
    if let Some(resource) = resource {
        let _ = resource.value.close().await;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
struct ProbeResult {
    outcome: &'static str,
    latency_ms: Option<u64>,
    message: Option<String>,
}

/// Test TCP reachability/latency to a host:port without opening a session.
#[tauri::command]
async fn test_connection(
    host: String,
    port: u16,
    timeout_ms: Option<u64>,
) -> Result<ProbeResult, String> {
    let addr = format!("{host}:{port}");
    let result = match probe_tcp(&addr, timeout_ms.unwrap_or(5_000)).await {
        ProbeOutcome::Reachable { latency_ms } => ProbeResult {
            outcome: "reachable",
            latency_ms: Some(latency_ms),
            message: None,
        },
        ProbeOutcome::TimedOut => ProbeResult {
            outcome: "timed_out",
            latency_ms: None,
            message: None,
        },
        ProbeOutcome::Unreachable { message } => ProbeResult {
            outcome: "unreachable",
            latency_ms: None,
            message: Some(message),
        },
    };
    Ok(result)
}

async fn session(
    state: &tauri::State<'_, AppState>,
    session_id: &str,
) -> Result<Arc<SshClient>, String> {
    let id = parse_id(session_id)?;
    session_by_id(state, id).await
}

async fn session_by_id(
    state: &tauri::State<'_, AppState>,
    id: Uuid,
) -> Result<Arc<SshClient>, String> {
    state
        .sessions
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| "session not found".to_string())
}

fn remove_resources_for_session<T>(
    resources: &mut HashMap<Uuid, SessionResource<T>>,
    session_id: Uuid,
) -> Vec<SessionResource<T>> {
    let ids = resource_ids_for_session(resources, session_id);
    ids.into_iter()
        .filter_map(|id| resources.remove(&id))
        .collect()
}

fn resource_ids_for_session<T>(
    resources: &HashMap<Uuid, SessionResource<T>>,
    session_id: Uuid,
) -> Vec<Uuid> {
    resources
        .iter()
        .filter_map(|(id, resource)| (resource.session_id == session_id).then_some(*id))
        .collect::<Vec<_>>()
}

async fn close_session_resources(state: &tauri::State<'_, AppState>, session_id: Uuid) {
    let mut forwards = {
        let mut forwards = state.forwards.lock().await;
        remove_resources_for_session(&mut forwards, session_id)
    };
    for resource in &mut forwards {
        resource.value.shutdown();
    }

    let (pty_ids, ptys) = {
        let mut ptys = state.ptys.lock().await;
        let ids = resource_ids_for_session(&ptys, session_id);
        let resources = ids
            .iter()
            .filter_map(|id| ptys.remove(id))
            .collect::<Vec<_>>();
        (ids, resources)
    };
    {
        let mut buffers = state.pty_input_buffers.lock().await;
        for id in pty_ids {
            buffers.remove(&id);
        }
    }
    for resource in ptys {
        let _ = resource.value.close().await;
    }
}

fn parse_id(value: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|_| "invalid id".to_string())
}

#[tauri::command]
fn third_party_notices(app: tauri::AppHandle) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| THIRD_PARTY_NOTICES_UNAVAILABLE.to_string())?;
    read_bundled_third_party_notices(&resource_dir)
}

fn read_bundled_third_party_notices(resource_dir: &Path) -> Result<String, String> {
    let root = std::fs::canonicalize(resource_dir)
        .map_err(|_| THIRD_PARTY_NOTICES_UNAVAILABLE.to_string())?;
    let path = resource_dir.join(THIRD_PARTY_NOTICES_RESOURCE);
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| THIRD_PARTY_NOTICES_UNAVAILABLE.to_string())?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > THIRD_PARTY_NOTICES_MAX_BYTES
    {
        return Err(THIRD_PARTY_NOTICES_UNAVAILABLE.to_string());
    }
    let canonical_path =
        std::fs::canonicalize(&path).map_err(|_| THIRD_PARTY_NOTICES_UNAVAILABLE.to_string())?;
    if !canonical_path.starts_with(&root) {
        return Err(THIRD_PARTY_NOTICES_UNAVAILABLE.to_string());
    }
    let bytes =
        std::fs::read(canonical_path).map_err(|_| THIRD_PARTY_NOTICES_UNAVAILABLE.to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| THIRD_PARTY_NOTICES_UNAVAILABLE.to_string())?;
    if text.trim().is_empty() || text.contains('\0') {
        return Err(THIRD_PARTY_NOTICES_UNAVAILABLE.to_string());
    }
    Ok(text)
}

/// Build and run the Tauri application.
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            ssh_connect,
            ssh_host_key_probe,
            ssh_exec,
            known_hosts_count,
            known_hosts_list,
            known_hosts_remove,
            known_hosts_clear,
            sftp_list,
            sftp_read,
            sftp_write,
            forward_start,
            forward_stop,
            ssh_disconnect,
            pty_open,
            pty_write,
            pty_resize,
            pty_close,
            test_connection,
            third_party_notices,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JoeSSH desktop shell");
}

fn known_hosts_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(KNOWN_HOSTS_FILE))
        .map_err(|_| HOST_KEY_STORAGE_UNAVAILABLE.to_string())
}

fn known_host_key(host: &str, port: u16) -> String {
    format!("{}:{port}", host.trim().to_ascii_lowercase())
}

fn normalize_manual_fingerprint(fingerprint: Option<String>) -> Option<String> {
    fingerprint
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn host_key_policy_for(
    stored_fingerprint: Option<String>,
    manual_fingerprint: Option<String>,
) -> Result<HostKeyPolicy, String> {
    match stored_fingerprint {
        Some(stored) => Ok(HostKeyPolicy::TrustOnFirstUse {
            stored: Some(stored),
        }),
        None => match manual_fingerprint {
            Some(manual) => Ok(HostKeyPolicy::Pinned(manual)),
            None => Err(HOST_KEY_CONFIRMATION_REQUIRED.to_string()),
        },
    }
}

fn host_key_probe_status(
    stored_fingerprint: Option<&str>,
    presented_fingerprint: &str,
) -> HostKeyProbeStatus {
    match stored_fingerprint {
        None => HostKeyProbeStatus::Unknown,
        Some(stored) if stored == presented_fingerprint => HostKeyProbeStatus::Match,
        Some(_) => HostKeyProbeStatus::Changed,
    }
}

fn read_known_hosts_file(path: &Path) -> Result<HashMap<String, KnownHostRecord>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => parse_known_hosts_file(&text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(_) => Err(HOST_KEY_STORAGE_UNAVAILABLE.to_string()),
    }
}

fn write_known_hosts_file(
    path: &Path,
    known_hosts: &HashMap<String, KnownHostRecord>,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| HOST_KEY_STORAGE_UNAVAILABLE.to_string())?;
    std::fs::create_dir_all(parent).map_err(|_| HOST_KEY_STORAGE_UNAVAILABLE.to_string())?;
    let file = KnownHostsFile {
        version: KNOWN_HOSTS_FILE_VERSION,
        hosts: known_hosts.clone(),
    };
    let json = serde_json::to_string_pretty(&file)
        .map_err(|_| HOST_KEY_STORAGE_UNAVAILABLE.to_string())?;
    std::fs::write(path, format!("{json}\n"))
        .map_err(|_| HOST_KEY_STORAGE_UNAVAILABLE.to_string())?;
    harden_known_hosts_file_permissions(path)
}

fn harden_known_hosts_file_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|_| HOST_KEY_STORAGE_UNAVAILABLE.to_string())?;
    }

    #[cfg(not(unix))]
    {
        let _ = path;
    }

    Ok(())
}

fn persist_known_host_if_first_use(
    path: &Path,
    host_key: &str,
    fingerprint: &str,
    source: KnownHostSource,
) -> Result<(), String> {
    let mut known_hosts = read_known_hosts_file(path)?;
    let now = current_unix_ms();
    match known_hosts.get_mut(host_key) {
        Some(stored) if stored.fingerprint == fingerprint => {
            stored.last_seen_at_ms = Some(now);
            write_known_hosts_file(path, &known_hosts)
        }
        Some(_) => Err(HOST_KEY_VERIFICATION_FAILED.to_string()),
        None => {
            known_hosts.insert(
                host_key.to_string(),
                known_host_record(host_key, fingerprint, now, source),
            );
            write_known_hosts_file(path, &known_hosts)
        }
    }
}

fn parse_known_hosts_file(text: &str) -> Result<HashMap<String, KnownHostRecord>, String> {
    let value = serde_json::from_str::<serde_json::Value>(text)
        .map_err(|_| HOST_KEY_STORAGE_UNAVAILABLE.to_string())?;

    if value.get("hosts").is_some() {
        let file = serde_json::from_value::<KnownHostsFile>(value)
            .map_err(|_| HOST_KEY_STORAGE_UNAVAILABLE.to_string())?;
        if file.version != KNOWN_HOSTS_FILE_VERSION {
            return Err(HOST_KEY_STORAGE_UNAVAILABLE.to_string());
        }
        return Ok(file.hosts);
    }

    let legacy = serde_json::from_str::<HashMap<String, String>>(text)
        .map_err(|_| HOST_KEY_STORAGE_UNAVAILABLE.to_string())?;
    Ok(legacy
        .into_iter()
        .map(|(host_key, fingerprint)| {
            let record = known_host_record(&host_key, &fingerprint, 0, KnownHostSource::Legacy);
            (host_key, record)
        })
        .collect())
}

fn known_host_record(
    host_key: &str,
    fingerprint: &str,
    timestamp_ms: u64,
    source: KnownHostSource,
) -> KnownHostRecord {
    let (host, port) = split_known_host_key(host_key);
    let timestamp = (timestamp_ms > 0).then_some(timestamp_ms);
    KnownHostRecord {
        key: host_key.to_string(),
        host,
        port,
        fingerprint: fingerprint.to_string(),
        first_seen_at_ms: timestamp,
        last_seen_at_ms: timestamp,
        source,
    }
}

fn split_known_host_key(host_key: &str) -> (String, u16) {
    match host_key.rsplit_once(':') {
        Some((host, port)) => (host.to_string(), port.parse::<u16>().unwrap_or(22)),
        None => (host_key.to_string(), 22),
    }
}

fn sorted_known_host_records(
    known_hosts: HashMap<String, KnownHostRecord>,
) -> Vec<KnownHostRecord> {
    let mut records = known_hosts.into_values().collect::<Vec<_>>();
    records.sort_by(|a, b| a.host.cmp(&b.host).then(a.port.cmp(&b.port)));
    records
}

fn remove_known_host(path: &Path, host_key: &str) -> Result<(), String> {
    let mut known_hosts = read_known_hosts_file(path)?;
    known_hosts.remove(host_key);
    write_known_hosts_file(path, &known_hosts)
}

fn current_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn sanitize_ssh_error(error: atlasterm_core::SshError) -> String {
    match error {
        atlasterm_core::SshError::HostKeyRejected(_) => HOST_KEY_VERIFICATION_FAILED.to_string(),
        atlasterm_core::SshError::AuthFailed => "authentication failed".to_string(),
        atlasterm_core::SshError::TimedOut => "connection timed out".to_string(),
        atlasterm_core::SshError::OutputLimitExceeded { .. } => {
            "command output exceeded desktop safety limit".to_string()
        }
        atlasterm_core::SshError::Connect(_) => "connection failed".to_string(),
        atlasterm_core::SshError::Session(_) => "session error".to_string(),
    }
}

fn sanitize_sftp_transfer_error(error: atlasterm_core::SshError) -> String {
    match error {
        atlasterm_core::SshError::OutputLimitExceeded { .. } => {
            SFTP_TRANSFER_LIMIT_EXCEEDED.to_string()
        }
        other => sanitize_ssh_error(other),
    }
}

fn ensure_sftp_transfer_size(size_bytes: usize) -> Result<(), String> {
    if size_bytes > SFTP_MAX_TRANSFER_BYTES {
        return Err(SFTP_TRANSFER_LIMIT_EXCEEDED.to_string());
    }
    Ok(())
}

fn normalize_sftp_remote_path(path: &str) -> Result<String, String> {
    if path.trim().is_empty() || path.chars().any(is_unsafe_sftp_path_char) {
        return Err(SFTP_REMOTE_PATH_UNSAFE.to_string());
    }

    // Preserve whitespace in real file names; trimming could select a different
    // remote file for download or overwrite.
    let absolute = path.starts_with('/');
    let mut parts = Vec::new();
    for segment in path.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return Err(SFTP_REMOTE_PATH_UNSAFE.to_string());
        }
        parts.push(segment);
    }

    if absolute {
        Ok(if parts.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", parts.join("/"))
        })
    } else if parts.is_empty() {
        Ok(".".to_string())
    } else {
        Ok(parts.join("/"))
    }
}

fn is_unsafe_sftp_path_char(ch: char) -> bool {
    let code = ch as u32;
    ch == '\\'
        || matches!(
            code,
            0x00..=0x1f
                | 0x7f..=0x9f
                | 0x00ad
                | 0x061c
                | 0x200b..=0x200f
                | 0x202a..=0x202e
                | 0x2060..=0x206f
                | 0xfeff
        )
}

fn ensure_forward_bind_addr(bind_addr: &str) -> Result<(), String> {
    validate_local_bind_addr(bind_addr).map_err(|_| FORWARD_BIND_ADDR_UNSAFE.to_string())
}

fn ensure_safe_ssh_exec_command(command: &str) -> Result<(), String> {
    let Some(detected) = detect_dangerous_command(command) else {
        return Ok(());
    };

    match detected.action {
        DangerousCommandAction::Warn => Ok(()),
        DangerousCommandAction::Block => {
            Err(format!("{SSH_EXEC_COMMAND_BLOCKED}: {}", detected.pattern))
        }
    }
}

async fn ensure_safe_pty_write(
    state: &tauri::State<'_, AppState>,
    pty_id: Uuid,
    data: &[u8],
) -> Result<(), String> {
    let mut buffers = state.pty_input_buffers.lock().await;
    let buffer = buffers.entry(pty_id).or_default();
    apply_pty_input_safety(buffer, data)
}

fn apply_pty_input_safety(buffer: &mut Vec<u8>, data: &[u8]) -> Result<(), String> {
    for byte in data {
        match *byte {
            b'\r' | b'\n' => {
                let command = String::from_utf8_lossy(buffer);
                if let Some(detected) = detect_dangerous_command(&command) {
                    if detected.action == DangerousCommandAction::Block {
                        buffer.clear();
                        return Err(format!("{PTY_COMMAND_BLOCKED}: {}", detected.pattern));
                    }
                }
                buffer.clear();
            }
            0x03 | 0x15 => {
                buffer.clear();
            }
            0x08 | 0x7f => {
                buffer.pop();
            }
            byte if byte.is_ascii_control() && byte != b'\t' => {}
            byte => {
                buffer.push(byte);
                if buffer.len() > PTY_COMMAND_BUFFER_MAX_BYTES {
                    buffer.clear();
                    return Err(format!(
                        "{PTY_COMMAND_BLOCKED}: input line exceeds safety limit"
                    ));
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_known_hosts_path() -> PathBuf {
        std::env::temp_dir()
            .join(format!("joessh-known-hosts-{}", Uuid::new_v4()))
            .join(KNOWN_HOSTS_FILE)
    }

    #[test]
    fn reads_only_non_empty_bundled_third_party_notices() {
        let root = std::env::temp_dir().join(format!("joessh-legal-{}", Uuid::new_v4()));
        let path = root.join(THIRD_PARTY_NOTICES_RESOURCE);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "Dependency fixture\nMIT License\n").unwrap();

        assert_eq!(
            read_bundled_third_party_notices(&root).unwrap(),
            "Dependency fixture\nMIT License\n"
        );

        std::fs::write(&path, " \n").unwrap();
        assert_eq!(
            read_bundled_third_party_notices(&root).unwrap_err(),
            THIRD_PARTY_NOTICES_UNAVAILABLE
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn remove_resources_for_session_removes_only_owned_resources() {
        let session_a = Uuid::new_v4();
        let session_b = Uuid::new_v4();
        let resource_a1 = Uuid::new_v4();
        let resource_a2 = Uuid::new_v4();
        let resource_b = Uuid::new_v4();
        let mut resources = HashMap::from([
            (resource_a1, SessionResource::new(session_a, "a1")),
            (resource_b, SessionResource::new(session_b, "b")),
            (resource_a2, SessionResource::new(session_a, "a2")),
        ]);

        let mut removed = remove_resources_for_session(&mut resources, session_a)
            .into_iter()
            .map(|resource| resource.value)
            .collect::<Vec<_>>();
        removed.sort_unstable();

        assert_eq!(removed, ["a1", "a2"]);
        assert_eq!(resources.len(), 1);
        assert_eq!(
            resources.get(&resource_b).map(|resource| resource.value),
            Some("b")
        );
    }

    #[test]
    fn known_host_key_normalizes_host_case_and_space() {
        assert_eq!(known_host_key(" Example.COM ", 2222), "example.com:2222");
    }

    #[test]
    fn host_key_policy_uses_native_pin_before_renderer_pin() {
        let policy = host_key_policy_for(
            Some("SHA256:native".to_string()),
            Some("SHA256:renderer".to_string()),
        )
        .unwrap();
        match policy {
            HostKeyPolicy::TrustOnFirstUse { stored } => {
                assert_eq!(stored.as_deref(), Some("SHA256:native"));
            }
            other => panic!("unexpected policy: {other:?}"),
        }
    }

    #[test]
    fn host_key_policy_allows_manual_pin_only_on_first_use() {
        let policy = host_key_policy_for(None, Some("SHA256:manual".to_string())).unwrap();
        match policy {
            HostKeyPolicy::Pinned(pin) => assert_eq!(pin, "SHA256:manual"),
            other => panic!("unexpected policy: {other:?}"),
        }
    }

    #[test]
    fn host_key_policy_requires_confirmation_for_unknown_hosts() {
        assert_eq!(
            host_key_policy_for(None, None).unwrap_err(),
            HOST_KEY_CONFIRMATION_REQUIRED
        );
    }

    #[test]
    fn host_key_probe_status_classifies_unknown_match_and_changed() {
        assert_eq!(
            host_key_probe_status(None, "SHA256:new"),
            HostKeyProbeStatus::Unknown
        );
        assert_eq!(
            host_key_probe_status(Some("SHA256:pinned"), "SHA256:pinned"),
            HostKeyProbeStatus::Match
        );
        assert_eq!(
            host_key_probe_status(Some("SHA256:pinned"), "SHA256:changed"),
            HostKeyProbeStatus::Changed
        );
    }

    #[test]
    fn sftp_transfer_size_guard_rejects_oversized_payloads() {
        assert!(ensure_sftp_transfer_size(SFTP_MAX_TRANSFER_BYTES).is_ok());
        assert_eq!(
            ensure_sftp_transfer_size(SFTP_MAX_TRANSFER_BYTES + 1).unwrap_err(),
            SFTP_TRANSFER_LIMIT_EXCEEDED
        );
    }

    #[test]
    fn sftp_transfer_errors_use_sftp_limit_copy() {
        assert_eq!(
            sanitize_sftp_transfer_error(atlasterm_core::SshError::OutputLimitExceeded {
                limit: SFTP_MAX_TRANSFER_BYTES,
            }),
            SFTP_TRANSFER_LIMIT_EXCEEDED
        );
    }

    #[test]
    fn sftp_remote_path_guard_normalizes_posix_paths() {
        assert_eq!(normalize_sftp_remote_path("/").unwrap(), "/");
        assert_eq!(
            normalize_sftp_remote_path("////srv//logs/./").unwrap(),
            "/srv/logs"
        );
        assert_eq!(normalize_sftp_remote_path(".").unwrap(), ".");
        assert_eq!(
            normalize_sftp_remote_path("logs/audit.log").unwrap(),
            "logs/audit.log"
        );
    }

    #[test]
    fn sftp_remote_path_guard_preserves_distinct_remote_file_names() {
        for path in ["/srv/report.txt ", " report.txt ", " reports /report.txt "] {
            assert_eq!(normalize_sftp_remote_path(path).unwrap(), path);
        }
        assert_ne!(
            normalize_sftp_remote_path("/srv/report.txt ").unwrap(),
            normalize_sftp_remote_path("/srv/report.txt").unwrap()
        );
    }

    #[test]
    fn sftp_remote_path_guard_rejects_unsafe_paths() {
        for path in [
            "",
            "   ",
            "\t/srv",
            "/srv\n",
            "../etc/passwd",
            "/srv/../etc/passwd",
            "/srv\\logs",
            "/srv/bad\u{0000}name",
            "/srv/bad\u{0008}name",
            "/srv/\u{202e}hidden",
            "/srv/\u{200f}hidden",
        ] {
            assert_eq!(
                normalize_sftp_remote_path(path).unwrap_err(),
                SFTP_REMOTE_PATH_UNSAFE
            );
        }
    }

    #[test]
    fn ssh_exec_native_safety_blocks_destructive_commands() {
        let error = ensure_safe_ssh_exec_command("sudo rm -rf /").unwrap_err();

        assert!(error.starts_with(SSH_EXEC_COMMAND_BLOCKED));
        assert!(error.contains("rm -rf /"));
    }

    #[test]
    fn ssh_exec_native_safety_allows_normal_and_warn_commands() {
        assert!(ensure_safe_ssh_exec_command("whoami").is_ok());
        assert!(ensure_safe_ssh_exec_command("curl https://example.com/status").is_ok());
    }

    #[test]
    fn pty_input_safety_blocks_destructive_line_across_chunks() {
        let mut buffer = Vec::new();

        apply_pty_input_safety(&mut buffer, b"sudo rm -r").unwrap();
        let error = apply_pty_input_safety(&mut buffer, b"f /\n").unwrap_err();

        assert!(error.starts_with(PTY_COMMAND_BLOCKED));
        assert!(error.contains("rm -rf /"));
        assert!(buffer.is_empty());
    }

    #[test]
    fn pty_input_safety_allows_normal_lines_and_clears_on_submit() {
        let mut buffer = Vec::new();

        apply_pty_input_safety(&mut buffer, b"whoami\n").unwrap();

        assert!(buffer.is_empty());
    }

    #[test]
    fn pty_input_safety_tracks_basic_line_editing() {
        let mut buffer = Vec::new();

        apply_pty_input_safety(&mut buffer, b"sudo rm -rf /").unwrap();
        apply_pty_input_safety(&mut buffer, &[0x15]).unwrap();
        apply_pty_input_safety(&mut buffer, b"whoamix").unwrap();
        apply_pty_input_safety(&mut buffer, &[0x7f]).unwrap();
        apply_pty_input_safety(&mut buffer, b"\n").unwrap();

        assert!(buffer.is_empty());
    }

    #[test]
    fn pty_input_safety_rejects_unbounded_pending_line() {
        let mut buffer = Vec::new();
        let data = vec![b'a'; PTY_COMMAND_BUFFER_MAX_BYTES + 1];

        let error = apply_pty_input_safety(&mut buffer, &data).unwrap_err();

        assert!(error.contains("input line exceeds safety limit"));
        assert!(buffer.is_empty());
    }

    #[test]
    fn forward_bind_addr_guard_allows_loopback_only() {
        assert!(ensure_forward_bind_addr("127.0.0.1:0").is_ok());
        assert!(ensure_forward_bind_addr("localhost:5432").is_ok());
        assert!(ensure_forward_bind_addr("[::1]:9000").is_ok());

        assert_eq!(
            ensure_forward_bind_addr("0.0.0.0:5432").unwrap_err(),
            FORWARD_BIND_ADDR_UNSAFE
        );
        assert_eq!(
            ensure_forward_bind_addr("192.168.1.10:5432").unwrap_err(),
            FORWARD_BIND_ADDR_UNSAFE
        );
    }

    #[test]
    fn known_hosts_file_round_trips_native_pins() {
        let path = temp_known_hosts_path();
        let mut known_hosts = HashMap::new();
        known_hosts.insert(
            "example.com:22".to_string(),
            known_host_record(
                "example.com:22",
                "SHA256:abc",
                1_700_000_000_000,
                KnownHostSource::Confirmed,
            ),
        );

        write_known_hosts_file(&path, &known_hosts).unwrap();

        assert_eq!(read_known_hosts_file(&path).unwrap(), known_hosts);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn known_hosts_file_migrates_legacy_pin_map() {
        let path = temp_known_hosts_path();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"example.com:2200":"SHA256:legacy"}"#).unwrap();

        let known_hosts = read_known_hosts_file(&path).unwrap();
        let record = known_hosts.get("example.com:2200").unwrap();

        assert_eq!(record.key, "example.com:2200");
        assert_eq!(record.host, "example.com");
        assert_eq!(record.port, 2200);
        assert_eq!(record.fingerprint, "SHA256:legacy");
        assert_eq!(record.first_seen_at_ms, None);
        assert_eq!(record.last_seen_at_ms, None);
        assert_eq!(record.source, KnownHostSource::Legacy);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn known_hosts_file_fails_closed_on_corrupt_json() {
        let path = temp_known_hosts_path();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{broken").unwrap();

        assert_eq!(
            read_known_hosts_file(&path).unwrap_err(),
            HOST_KEY_STORAGE_UNAVAILABLE
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn first_use_persistence_rejects_existing_mismatch() {
        let path = temp_known_hosts_path();
        persist_known_host_if_first_use(
            &path,
            "example.com:22",
            "SHA256:abc",
            KnownHostSource::Confirmed,
        )
        .unwrap();

        assert_eq!(
            persist_known_host_if_first_use(
                &path,
                "example.com:22",
                "SHA256:evil",
                KnownHostSource::Confirmed,
            )
            .unwrap_err(),
            HOST_KEY_VERIFICATION_FAILED
        );
        assert_eq!(
            read_known_hosts_file(&path)
                .unwrap()
                .get("example.com:22")
                .map(|record| record.fingerprint.as_str()),
            Some("SHA256:abc")
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn first_use_persistence_records_audit_metadata_and_updates_last_seen() {
        let path = temp_known_hosts_path();
        persist_known_host_if_first_use(
            &path,
            "example.com:22",
            "SHA256:abc",
            KnownHostSource::Confirmed,
        )
        .unwrap();
        let first = read_known_hosts_file(&path)
            .unwrap()
            .get("example.com:22")
            .cloned()
            .unwrap();

        assert_eq!(first.source, KnownHostSource::Confirmed);
        assert!(first.first_seen_at_ms.is_some());
        assert!(first.last_seen_at_ms.is_some());
        assert_eq!(first.first_seen_at_ms, first.last_seen_at_ms);

        persist_known_host_if_first_use(
            &path,
            "example.com:22",
            "SHA256:abc",
            KnownHostSource::Confirmed,
        )
        .unwrap();
        let second = read_known_hosts_file(&path)
            .unwrap()
            .get("example.com:22")
            .cloned()
            .unwrap();

        assert_eq!(second.first_seen_at_ms, first.first_seen_at_ms);
        assert!(second.last_seen_at_ms >= first.last_seen_at_ms);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn remove_known_host_deletes_only_the_selected_pin() {
        let path = temp_known_hosts_path();
        persist_known_host_if_first_use(&path, "a.example:22", "SHA256:a", KnownHostSource::Tofu)
            .unwrap();
        persist_known_host_if_first_use(&path, "b.example:22", "SHA256:b", KnownHostSource::Tofu)
            .unwrap();

        remove_known_host(&path, "a.example:22").unwrap();
        let known_hosts = read_known_hosts_file(&path).unwrap();

        assert!(!known_hosts.contains_key("a.example:22"));
        assert!(known_hosts.contains_key("b.example:22"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn ssh_errors_are_sanitized_before_reaching_renderer() {
        assert_eq!(
            sanitize_ssh_error(atlasterm_core::SshError::Connect(
                "failed to connect to alice@example.com with token abc".to_string()
            )),
            "connection failed"
        );
        assert_eq!(
            sanitize_ssh_error(atlasterm_core::SshError::Session(
                "could not read /home/alice/.ssh/id_ed25519".to_string()
            )),
            "session error"
        );
        assert_eq!(
            sanitize_ssh_error(atlasterm_core::SshError::OutputLimitExceeded { limit: 1024 }),
            "command output exceeded desktop safety limit"
        );
    }
}
