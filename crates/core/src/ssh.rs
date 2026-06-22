//! Real SSH client built on [`russh`] 0.61.
//!
//! [`SshClient::connect`] performs a genuine SSH transport handshake, verifies
//! the server host key against a caller-supplied policy (TOFU / known-hosts),
//! authenticates with a password or private key, and can run a remote command
//! via [`SshClient::exec`]. The interactive PTY shell (Foundation 3), SFTP
//! (Foundation 4), and `direct-tcpip` forward bridge (Foundation 5) build on
//! the same authenticated [`russh::client::Handle`].
//!
//! NOTE ON VERIFICATION: a full handshake requires a live SSH server, which is
//! not available in the headless build/CI environment. The unit tests here
//! cover the parts that are deterministic without a server — host-key
//! fingerprint formatting, host-key policy decisions, and auth-method
//! selection. End-to-end connect/exec is exercised manually / in environments
//! with an SSH daemon.

use std::sync::Arc;

use russh::client::{self, Handle};
use russh::keys::{HashAlg, PublicKey};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const SSH_EXEC_MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const SFTP_READ_CHUNK_BYTES: usize = 64 * 1024;
const UNSAFE_SFTP_ENTRY_FORMAT_RANGES: &[(u32, u32)] = &[
    (0x00ad, 0x00ad),
    (0x061c, 0x061c),
    (0x200b, 0x200f),
    (0x202a, 0x202e),
    (0x2060, 0x206f),
    (0xfeff, 0xfeff),
];

#[derive(Debug, Error)]
pub enum SshError {
    #[error("connection failed: {0}")]
    Connect(String),
    #[error("host key rejected: {0}")]
    HostKeyRejected(String),
    #[error("authentication failed")]
    AuthFailed,
    #[error("connection timed out")]
    TimedOut,
    #[error("command output exceeded {limit} byte safety limit")]
    OutputLimitExceeded { limit: usize },
    #[error("session error: {0}")]
    Session(String),
}

/// What to do with the server's host key during the handshake.
#[derive(Debug, Clone)]
pub enum HostKeyPolicy {
    /// Accept any key (INSECURE — local testing only).
    AcceptAny,
    /// Accept only if the SHA-256 fingerprint matches this pinned value
    /// (the value `known_hosts`/TOFU stored for this host).
    Pinned(String),
    /// Trust-on-first-use: accept if nothing is stored yet (`None`) or the
    /// presented key matches `stored`; reject on a mismatch. The caller
    /// persists the captured fingerprint after a successful first connect.
    TrustOnFirstUse { stored: Option<String> },
}

/// Credentials for authenticating the SSH session.
#[derive(Debug, Clone)]
pub enum SshAuth {
    Password(String),
    /// PEM-encoded private key plus optional passphrase.
    PrivateKey {
        pem: String,
        passphrase: Option<String>,
    },
}

/// Connection parameters for a single SSH session.
#[derive(Debug, Clone)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub host_key_policy: HostKeyPolicy,
    /// Abort the TCP+handshake if it does not complete within this many ms.
    pub connect_timeout_ms: u64,
}

/// Format a public key's SHA-256 fingerprint the way OpenSSH does
/// (`SHA256:<base64-no-padding>`), for display and known-hosts pinning.
pub fn fingerprint_sha256(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

/// Decide whether a presented host key is acceptable under `policy`.
/// Pure and synchronously testable (no network).
pub fn host_key_allowed(policy: &HostKeyPolicy, presented_fingerprint: &str) -> bool {
    match policy {
        HostKeyPolicy::AcceptAny => true,
        HostKeyPolicy::Pinned(expected) => expected == presented_fingerprint,
        HostKeyPolicy::TrustOnFirstUse { stored } => matches!(
            crate::known_hosts::tofu_decision(stored.as_deref(), presented_fingerprint),
            crate::known_hosts::TofuVerdict::FirstUse | crate::known_hosts::TofuVerdict::Match
        ),
    }
}

/// russh client handler that enforces the host-key policy at handshake time
/// and captures the presented fingerprint for TOFU persistence.
struct ClientHandler {
    policy: HostKeyPolicy,
    captured_fingerprint: Arc<std::sync::Mutex<Option<String>>>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let presented = fingerprint_sha256(server_public_key);
        if let Ok(mut slot) = self.captured_fingerprint.lock() {
            *slot = Some(presented.clone());
        }
        Ok(host_key_allowed(&self.policy, &presented))
    }
}

/// A connected, authenticated SSH session.
pub struct SshClient {
    handle: Arc<Handle<ClientHandler>>,
    server_fingerprint: Option<String>,
}

impl SshClient {
    /// Open a TCP connection, run the SSH handshake (verifying the host key via
    /// `config.host_key_policy`), and authenticate.
    pub async fn connect(config: SshConfig) -> Result<Self, SshError> {
        let russh_config = Arc::new(client::Config::default());
        let captured_fingerprint = Arc::new(std::sync::Mutex::new(None));
        let handler = ClientHandler {
            policy: config.host_key_policy.clone(),
            captured_fingerprint: Arc::clone(&captured_fingerprint),
        };

        let mut handle = tokio::time::timeout(
            std::time::Duration::from_millis(config.connect_timeout_ms),
            client::connect(russh_config, (config.host.as_str(), config.port), handler),
        )
        .await
        .map_err(|_| SshError::TimedOut)?
        .map_err(|e| match e {
            // The handler returns Ok(false) for a rejected key, which russh
            // surfaces as an unknown-key error during the handshake.
            russh::Error::UnknownKey => {
                SshError::HostKeyRejected("server host key did not match policy".into())
            }
            other => SshError::Connect(other.to_string()),
        })?;

        let authenticated = match &config.auth {
            SshAuth::Password(password) => handle
                .authenticate_password(&config.username, password)
                .await
                .map_err(|e| SshError::Session(e.to_string()))?,
            SshAuth::PrivateKey { pem, passphrase } => {
                let key = russh::keys::decode_secret_key(pem, passphrase.as_deref())
                    .map_err(|e| SshError::Session(e.to_string()))?;
                let hash_alg = handle
                    .best_supported_rsa_hash()
                    .await
                    .ok()
                    .flatten()
                    .flatten();
                let key_with_alg = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg);
                handle
                    .authenticate_publickey(&config.username, key_with_alg)
                    .await
                    .map_err(|e| SshError::Session(e.to_string()))?
            }
        };

        if !authenticated.success() {
            return Err(SshError::AuthFailed);
        }

        let server_fingerprint = captured_fingerprint
            .lock()
            .ok()
            .and_then(|slot| slot.clone());
        Ok(Self {
            handle: Arc::new(handle),
            server_fingerprint,
        })
    }

    /// The SHA-256 fingerprint the server presented during the handshake
    /// (`SHA256:…`), for TOFU persistence. `None` only if capture failed.
    pub fn server_fingerprint(&self) -> Option<&str> {
        self.server_fingerprint.as_deref()
    }

    /// Run a single remote command, returning (exit_status, stdout_bytes).
    pub async fn exec(&self, command: &str) -> Result<(u32, Vec<u8>), SshError> {
        let mut channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| SshError::Session(e.to_string()))?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| SshError::Session(e.to_string()))?;

        let mut stdout = Vec::new();
        let mut exit_status = 0u32;

        while let Some(msg) = channel.wait().await {
            match msg {
                russh::ChannelMsg::Data { ref data } => {
                    if exec_output_would_exceed_limit(
                        stdout.len(),
                        data.len(),
                        SSH_EXEC_MAX_OUTPUT_BYTES,
                    ) {
                        return Err(SshError::OutputLimitExceeded {
                            limit: SSH_EXEC_MAX_OUTPUT_BYTES,
                        });
                    }
                    stdout.write_all(data).await.ok();
                }
                russh::ChannelMsg::ExitStatus { exit_status: code } => {
                    exit_status = code;
                }
                russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
                _ => {}
            }
        }

        Ok((exit_status, stdout))
    }

    /// Open an interactive shell over a pseudo-terminal.
    ///
    /// Requests a PTY (`xterm-256color`) of the given size, starts the login
    /// shell, and returns a [`PtySession`] for streaming stdin/stdout. This is
    /// what the desktop terminal pane drives instead of the prior simulator.
    pub async fn open_shell(&self, cols: u32, rows: u32) -> Result<PtySession, SshError> {
        let channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| SshError::Session(e.to_string()))?;
        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await
            .map_err(|e| SshError::Session(e.to_string()))?;
        channel
            .request_shell(true)
            .await
            .map_err(|e| SshError::Session(e.to_string()))?;
        Ok(PtySession { channel })
    }

    /// Start a local port forward tunneled through this SSH session.
    ///
    /// Binds `bind_addr` locally; every accepted connection is proxied through
    /// an SSH `direct-tcpip` channel to `target_host:target_port` (resolved on
    /// the *remote* side). This is the real `ssh -L` behaviour, replacing the
    /// plain-TCP [`crate::tcp_forward`] target dial with an SSH channel.
    pub async fn forward_local(
        &self,
        bind_addr: &str,
        target_host: String,
        target_port: u16,
    ) -> Result<crate::tcp_forward::TcpForwardHandle, SshError> {
        // Refuse to bind a local forward to a wildcard / non-loopback address,
        // which would expose the tunnel to the whole network.
        crate::forward::validate_local_bind_addr(bind_addr)
            .map_err(|e| SshError::Session(e.to_string()))?;
        let handle = self.handle.clone();
        crate::tcp_forward::spawn_forward_with_dialer(bind_addr, move |peer| {
            let handle = handle.clone();
            let target_host = target_host.clone();
            async move {
                let channel = handle
                    .channel_open_direct_tcpip(
                        target_host,
                        target_port as u32,
                        peer.ip().to_string(),
                        peer.port() as u32,
                    )
                    .await
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::ConnectionRefused, e))?;
                Ok(channel.into_stream())
            }
        })
        .await
        .map_err(|e| SshError::Session(e.to_string()))
    }

    /// Open the SFTP subsystem over a fresh channel on this session.
    ///
    /// Returns a live [`SftpClient`] backed by `russh-sftp`. Used by the SFTP
    /// panel for real directory listing and file upload/download.
    pub async fn open_sftp(&self) -> Result<SftpClient, SshError> {
        let channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| SshError::Session(e.to_string()))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| SshError::Session(e.to_string()))?;
        let session = russh_sftp::client::SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| SshError::Session(e.to_string()))?;
        Ok(SftpClient { session })
    }
}

fn exec_output_would_exceed_limit(current_len: usize, chunk_len: usize, max_len: usize) -> bool {
    current_len > max_len || chunk_len > max_len.saturating_sub(current_len)
}

/// A single remote directory entry for the SFTP panel.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SftpEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

/// A live SFTP session over an SSH subsystem channel.
pub struct SftpClient {
    session: russh_sftp::client::SftpSession,
}

impl SftpClient {
    /// List a remote directory.
    pub async fn list_dir(&self, path: &str) -> Result<Vec<SftpEntry>, SshError> {
        let dir = self
            .session
            .read_dir(path)
            .await
            .map_err(|e| SshError::Session(e.to_string()))?;
        Ok(dir
            .filter_map(|entry| {
                let name = entry.file_name();
                is_safe_sftp_entry_name(&name).then(|| SftpEntry {
                    name,
                    is_dir: entry.file_type().is_dir(),
                    size: entry.metadata().size,
                })
            })
            .collect())
    }

    /// Download a remote file's full contents.
    pub async fn download(&self, remote_path: &str) -> Result<Vec<u8>, SshError> {
        self.session
            .read(remote_path)
            .await
            .map_err(|e| SshError::Session(e.to_string()))
    }

    /// Download a remote file while enforcing a hard byte limit before and
    /// during the read. This avoids buffering an unexpectedly large file before
    /// callers can apply their own safety cap.
    pub async fn download_limited(
        &self,
        remote_path: &str,
        max_bytes: usize,
    ) -> Result<Vec<u8>, SshError> {
        let metadata = self
            .session
            .metadata(remote_path)
            .await
            .map_err(|e| SshError::Session(e.to_string()))?;
        if let Some(size) = metadata.size {
            ensure_sftp_download_size(size, max_bytes)?;
        }

        let mut file = self
            .session
            .open(remote_path)
            .await
            .map_err(|e| SshError::Session(e.to_string()))?;
        let capacity = metadata
            .size
            .map(|size| size.min(max_bytes as u64) as usize)
            .unwrap_or(0);
        let mut buffer = Vec::with_capacity(capacity);
        let mut chunk = vec![0; SFTP_READ_CHUNK_BYTES.max(1)];

        loop {
            if buffer.len() == max_bytes {
                let mut extra = [0_u8; 1];
                let read = file
                    .read(&mut extra)
                    .await
                    .map_err(|e| SshError::Session(e.to_string()))?;
                if read == 0 {
                    return Ok(buffer);
                }
                return Err(SshError::OutputLimitExceeded { limit: max_bytes });
            }

            let remaining = max_bytes - buffer.len();
            let read_len = remaining.min(chunk.len());
            let read = file
                .read(&mut chunk[..read_len])
                .await
                .map_err(|e| SshError::Session(e.to_string()))?;
            if read == 0 {
                return Ok(buffer);
            }

            ensure_sftp_download_capacity(buffer.len(), read, max_bytes)?;
            buffer.extend_from_slice(&chunk[..read]);
        }
    }

    /// Upload bytes to a remote path (creating/truncating it).
    pub async fn upload(&self, remote_path: &str, data: &[u8]) -> Result<(), SshError> {
        self.session
            .write(remote_path, data)
            .await
            .map_err(|e| SshError::Session(e.to_string()))
    }
}

/// Output emitted by a [`PtySession`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyOutput {
    /// A chunk of terminal output (stdout or stderr; PTYs merge them).
    Data(Vec<u8>),
    /// The remote shell exited with the given status; the session is over.
    Exit(u32),
}

/// An interactive PTY shell. `split()` separates the write side (stdin /
/// resize / close — `Send + Sync + 'static`, safe to hold in app state) from
/// the read side (an output stream pumped by a background task), so input and
/// output can flow concurrently.
pub struct PtySession {
    channel: russh::Channel<client::Msg>,
}

/// Write side of a PTY: send stdin, resize, and close.
pub struct PtyWriter {
    write: russh::ChannelWriteHalf<client::Msg>,
}

/// Read side of a PTY: await output events until the shell closes.
pub struct PtyReader {
    read: russh::ChannelReadHalf,
}

impl PtySession {
    /// Split into independent write and read halves.
    pub fn split(self) -> (PtyWriter, PtyReader) {
        let (read, write) = self.channel.split();
        (PtyWriter { write }, PtyReader { read })
    }

    /// Send bytes to the shell's stdin (single-half convenience for tests).
    pub async fn write(&self, data: &[u8]) -> Result<(), SshError> {
        self.channel
            .data(data)
            .await
            .map_err(|e| SshError::Session(e.to_string()))
    }

    /// Tell the remote PTY the terminal was resized.
    pub async fn resize(&self, cols: u32, rows: u32) -> Result<(), SshError> {
        self.channel
            .window_change(cols, rows, 0, 0)
            .await
            .map_err(|e| SshError::Session(e.to_string()))
    }
}

impl PtyWriter {
    /// Send bytes to the shell's stdin (keystrokes / pasted input).
    pub async fn write(&self, data: &[u8]) -> Result<(), SshError> {
        self.write
            .data_bytes(data.to_vec())
            .await
            .map_err(|e| SshError::Session(e.to_string()))
    }

    /// Tell the remote PTY the terminal was resized.
    pub async fn resize(&self, cols: u32, rows: u32) -> Result<(), SshError> {
        self.write
            .window_change(cols, rows, 0, 0)
            .await
            .map_err(|e| SshError::Session(e.to_string()))
    }

    /// Close the PTY channel.
    pub async fn close(&self) -> Result<(), SshError> {
        self.write
            .close()
            .await
            .map_err(|e| SshError::Session(e.to_string()))
    }
}

impl PtyReader {
    /// Await the next output event, or `None` once the channel closes.
    pub async fn next_output(&mut self) -> Option<PtyOutput> {
        while let Some(msg) = self.read.wait().await {
            match msg {
                russh::ChannelMsg::Data { ref data } => {
                    return Some(PtyOutput::Data(data.to_vec()));
                }
                russh::ChannelMsg::ExtendedData { ref data, .. } => {
                    return Some(PtyOutput::Data(data.to_vec()));
                }
                russh::ChannelMsg::ExitStatus { exit_status } => {
                    return Some(PtyOutput::Exit(exit_status));
                }
                russh::ChannelMsg::Eof | russh::ChannelMsg::Close => return None,
                _ => {}
            }
        }
        None
    }
}

/// Probe the server host key without authenticating or persisting trust.
///
/// This performs the SSH transport handshake, captures the presented SHA-256
/// host-key fingerprint, sends a disconnect message, and returns the
/// fingerprint for a caller-controlled confirmation flow.
pub async fn probe_host_key(
    host: &str,
    port: u16,
    connect_timeout_ms: u64,
) -> Result<String, SshError> {
    let russh_config = Arc::new(client::Config::default());
    let captured_fingerprint = Arc::new(std::sync::Mutex::new(None));
    let handler = ClientHandler {
        policy: HostKeyPolicy::AcceptAny,
        captured_fingerprint: Arc::clone(&captured_fingerprint),
    };

    let handle = tokio::time::timeout(
        std::time::Duration::from_millis(connect_timeout_ms),
        client::connect(russh_config, (host, port), handler),
    )
    .await
    .map_err(|_| SshError::TimedOut)?
    .map_err(|e| SshError::Connect(e.to_string()))?;

    let fingerprint = captured_fingerprint
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
        .ok_or_else(|| SshError::HostKeyRejected("server host key was not captured".into()));

    let _ = handle
        .disconnect(
            russh::Disconnect::ByApplication,
            "JoeSSH host key probe",
            "",
        )
        .await;

    fingerprint
}

fn ensure_sftp_download_size(size_bytes: u64, max_bytes: usize) -> Result<(), SshError> {
    if size_bytes > max_bytes as u64 {
        return Err(SshError::OutputLimitExceeded { limit: max_bytes });
    }
    Ok(())
}

fn ensure_sftp_download_capacity(
    current_bytes: usize,
    incoming_bytes: usize,
    max_bytes: usize,
) -> Result<(), SshError> {
    if current_bytes
        .checked_add(incoming_bytes)
        .is_none_or(|next_size| next_size > max_bytes)
    {
        return Err(SshError::OutputLimitExceeded { limit: max_bytes });
    }
    Ok(())
}

fn is_safe_sftp_entry_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && name != "."
        && name != ".."
        && !name.chars().any(is_unsafe_sftp_entry_name_char)
}

fn is_unsafe_sftp_entry_name_char(ch: char) -> bool {
    ch == '/' || ch == '\\' || ch.is_control() || {
        let codepoint = ch as u32;
        UNSAFE_SFTP_ENTRY_FORMAT_RANGES
            .iter()
            .any(|(start, end)| codepoint >= *start && codepoint <= *end)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accept_any_policy_allows_every_fingerprint() {
        assert!(host_key_allowed(
            &HostKeyPolicy::AcceptAny,
            "SHA256:anything"
        ));
        assert!(host_key_allowed(&HostKeyPolicy::AcceptAny, ""));
    }

    #[test]
    fn exec_output_limit_allows_boundary_and_rejects_growth() {
        assert!(!exec_output_would_exceed_limit(
            SSH_EXEC_MAX_OUTPUT_BYTES - 1,
            1,
            SSH_EXEC_MAX_OUTPUT_BYTES
        ));
        assert!(exec_output_would_exceed_limit(
            SSH_EXEC_MAX_OUTPUT_BYTES,
            1,
            SSH_EXEC_MAX_OUTPUT_BYTES
        ));
        assert!(exec_output_would_exceed_limit(
            SSH_EXEC_MAX_OUTPUT_BYTES - 1,
            2,
            SSH_EXEC_MAX_OUTPUT_BYTES
        ));
    }

    #[test]
    fn sftp_download_size_guard_rejects_known_oversized_files() {
        assert!(ensure_sftp_download_size(1024, 1024).is_ok());
        assert!(matches!(
            ensure_sftp_download_size(1025, 1024),
            Err(SshError::OutputLimitExceeded { limit: 1024 })
        ));
    }

    #[test]
    fn sftp_download_capacity_guard_rejects_chunk_growth_past_limit() {
        assert!(ensure_sftp_download_capacity(512, 512, 1024).is_ok());
        assert!(matches!(
            ensure_sftp_download_capacity(1024, 1, 1024),
            Err(SshError::OutputLimitExceeded { limit: 1024 })
        ));
        assert!(matches!(
            ensure_sftp_download_capacity(usize::MAX, 1, usize::MAX),
            Err(SshError::OutputLimitExceeded { limit: usize::MAX })
        ));
    }

    #[test]
    fn sftp_entry_name_guard_rejects_paths_and_control_characters() {
        for name in [
            "",
            "   ",
            ".",
            "..",
            "../etc",
            "logs/archive",
            "logs\\archive",
            "bad\u{0000}name",
            "bad\u{001b}[31m",
            "safe\u{202e}cod.exe",
        ] {
            assert!(!is_safe_sftp_entry_name(name), "{name:?} should be unsafe");
        }

        assert!(is_safe_sftp_entry_name("file name #1.txt"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn connect_times_out_on_a_silent_server() {
        use tokio::net::TcpListener;
        // A listener that accepts the TCP connection but never sends the SSH
        // banner, so the handshake stalls and the connect timeout must fire.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _conn = listener.accept().await;
            // Hold the connection open, sending nothing.
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        });

        let config = SshConfig {
            host: addr.ip().to_string(),
            port: addr.port(),
            username: "u".into(),
            auth: SshAuth::Password("p".into()),
            host_key_policy: HostKeyPolicy::AcceptAny,
            connect_timeout_ms: 200,
        };
        let result = SshClient::connect(config).await;
        assert!(matches!(result, Err(SshError::TimedOut)));
    }

    #[test]
    fn pinned_policy_allows_only_exact_match() {
        let policy = HostKeyPolicy::Pinned("SHA256:abc123".into());
        assert!(host_key_allowed(&policy, "SHA256:abc123"));
        assert!(!host_key_allowed(&policy, "SHA256:different"));
        assert!(!host_key_allowed(&policy, "abc123"));
    }

    #[test]
    fn tofu_policy_accepts_first_use_and_match_rejects_mismatch() {
        // No stored key -> first use -> accept (and the caller will persist it).
        assert!(host_key_allowed(
            &HostKeyPolicy::TrustOnFirstUse { stored: None },
            "SHA256:abc"
        ));
        // Stored matches -> accept.
        let pinned = HostKeyPolicy::TrustOnFirstUse {
            stored: Some("SHA256:abc".into()),
        };
        assert!(host_key_allowed(&pinned, "SHA256:abc"));
        // Stored differs -> reject (possible MITM / rotated key).
        assert!(!host_key_allowed(&pinned, "SHA256:evil"));
    }

    #[test]
    fn fingerprint_matches_openssh_format() {
        // Parse a known unencrypted OpenSSH ed25519 private key (the same
        // decode path SshAuth::PrivateKey uses) and confirm the public-key
        // fingerprint is the SHA256:base64 form OpenSSH uses (no MD5 colons,
        // no trailing '=' padding).
        let key = russh::keys::decode_secret_key(TEST_ED25519_KEY, None)
            .expect("embedded test key should parse");
        let fp = fingerprint_sha256(key.public_key());
        assert!(fp.starts_with("SHA256:"), "got {fp}");
        assert!(!fp.ends_with('='), "fingerprint should be unpadded base64");
    }

    // A throwaway, unencrypted ed25519 key generated solely for this test
    // (via `ssh-keygen -t ed25519 -N ""`). Not used anywhere outside tests.
    const TEST_ED25519_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACByMPj+5WaPwsAa2WY2coXW7psZmavKDZ+vqY+4krhysQAAAJgj45OfI+OT
nwAAAAtzc2gtZWQyNTUxOQAAACByMPj+5WaPwsAa2WY2coXW7psZmavKDZ+vqY+4krhysQ
AAAEAJnYBAyP+yoIdKmF4Fe+lkUiEKlvZFyHbtwXVdtbtzfHIw+P7lZo/CwBrZZjZyhdbu
mxmZq8oNn6+pj7iSuHKxAAAAEnRlc3RAYXRsYXN0ZXJtLmRldgECAw==
-----END OPENSSH PRIVATE KEY-----
";
}
