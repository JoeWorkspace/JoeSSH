pub mod connection;
pub mod forward;
pub mod known_hosts;
pub mod models;
pub mod net_probe;
pub mod openssh_config;
pub mod security;
pub mod sftp;
pub mod ssh;
pub mod sync;
pub mod tcp_forward;
pub mod vault;

pub use connection::{ConnectionError, ConnectionService};
pub use forward::{
    validate_bind_host, validate_local_bind_addr, ForwardBindValidationError, ForwardError,
    ForwardHandle, ForwardService,
};
pub use models::{
    AuditEvent, AuditEventKind, Connection, ConnectionId, ConnectionTestResult,
    ConnectionTestStatus, CredentialRef, CredentialRefKind, PortForwardDirection, PortForwardRule,
    TerminalSession, TransferDirection, TransferJob, TransferStatus, VaultItem, VaultItemKind,
    Workspace, WorkspaceId,
};
pub use net_probe::{probe_tcp, ProbeOutcome};
pub use sftp::{RemoteDirEntry, SftpError, SftpService};
pub use ssh::{
    fingerprint_sha256, host_key_allowed, probe_host_key, HostKeyPolicy, PtyOutput, PtyReader,
    PtySession, PtyWriter, SftpClient, SftpEntry, SshAuth, SshClient, SshConfig, SshError,
};
pub use sync::{SyncDirection, SyncError, SyncReport, SyncService};
pub use tcp_forward::{spawn_forward_with_dialer, spawn_tcp_forward, TcpForwardHandle};
pub use vault::{redact_vault_item, redact_vault_items, SecretMaterial, VaultError, VaultService};
