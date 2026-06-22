use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use time::OffsetDateTime;
use uuid::Uuid;

pub type ConnectionId = Uuid;
pub type WorkspaceId = Uuid;
pub type SessionId = Uuid;
pub type TransferJobId = Uuid;
pub type PortForwardRuleId = Uuid;
pub type VaultItemId = Uuid;
pub type AuditEventId = Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Connection {
    pub id: ConnectionId,
    pub workspace_id: WorkspaceId,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub credential: CredentialRef,
    pub tags: Vec<String>,
    pub metadata: BTreeMap<String, String>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

impl Connection {
    pub fn new(
        workspace_id: WorkspaceId,
        name: impl Into<String>,
        host: impl Into<String>,
        port: u16,
        username: impl Into<String>,
        credential: CredentialRef,
    ) -> Self {
        let now = OffsetDateTime::now_utc();
        Self {
            id: Uuid::new_v4(),
            workspace_id,
            name: name.into(),
            host: host.into(),
            port,
            username: username.into(),
            credential,
            tags: Vec::new(),
            metadata: BTreeMap::new(),
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CredentialRef {
    pub kind: CredentialRefKind,
    pub vault_item_id: Option<VaultItemId>,
    pub label: Option<String>,
}

impl CredentialRef {
    pub fn vault_item(vault_item_id: VaultItemId) -> Self {
        Self {
            kind: CredentialRefKind::VaultItem,
            vault_item_id: Some(vault_item_id),
            label: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CredentialRefKind {
    VaultItem,
    Agent,
    PasswordPrompt,
    PrivateKeyPath,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalSession {
    pub id: SessionId,
    pub connection_id: ConnectionId,
    pub started_at: OffsetDateTime,
    pub ended_at: Option<OffsetDateTime>,
    pub title: Option<String>,
    pub shell: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub connection_id: ConnectionId,
    pub status: ConnectionTestStatus,
    pub latency_ms: Option<u64>,
    pub message: Option<String>,
    pub tested_at: OffsetDateTime,
}

impl ConnectionTestResult {
    pub fn succeeded(connection_id: ConnectionId, latency_ms: u64) -> Self {
        Self {
            connection_id,
            status: ConnectionTestStatus::Succeeded,
            latency_ms: Some(latency_ms),
            message: None,
            tested_at: OffsetDateTime::now_utc(),
        }
    }

    pub fn failed(connection_id: ConnectionId, message: impl Into<String>) -> Self {
        Self {
            connection_id,
            status: ConnectionTestStatus::Failed,
            latency_ms: None,
            message: Some(message.into()),
            tested_at: OffsetDateTime::now_utc(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionTestStatus {
    Succeeded,
    Failed,
    TimedOut,
    Canceled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferJob {
    pub id: TransferJobId,
    pub connection_id: ConnectionId,
    pub direction: TransferDirection,
    pub local_path: String,
    pub remote_path: String,
    pub status: TransferStatus,
    pub bytes_total: Option<u64>,
    pub bytes_done: u64,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortForwardRule {
    pub id: PortForwardRuleId,
    pub connection_id: ConnectionId,
    pub direction: PortForwardDirection,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PortForwardDirection {
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub name: String,
    pub created_at: OffsetDateTime,
}

impl Workspace {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            created_at: OffsetDateTime::now_utc(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultItem {
    pub id: VaultItemId,
    pub workspace_id: WorkspaceId,
    pub name: String,
    pub kind: VaultItemKind,
    pub secret_ref: String,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VaultItemKind {
    Password,
    PrivateKey,
    Passphrase,
    Token,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: AuditEventId,
    pub workspace_id: WorkspaceId,
    pub actor: String,
    pub kind: AuditEventKind,
    pub message: String,
    pub metadata: BTreeMap<String, String>,
    pub occurred_at: OffsetDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuditEventKind {
    ConnectionCreated,
    ConnectionOpened,
    CommandBlocked,
    VaultItemAccessed,
    TransferStarted,
    PortForwardStarted,
    SyncCompleted,
}
