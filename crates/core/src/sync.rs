use crate::models::{AuditEvent, WorkspaceId};
use async_trait::async_trait;
use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SyncError {
    #[error("sync conflict")]
    Conflict,
    #[error("sync failed: {0}")]
    Failed(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncDirection {
    Pull,
    Push,
    Bidirectional,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncReport {
    pub workspace_id: WorkspaceId,
    pub direction: SyncDirection,
    pub changed_items: usize,
    pub audit_events: Vec<AuditEvent>,
}

#[async_trait]
pub trait SyncService: Send + Sync {
    async fn sync(
        &self,
        workspace_id: WorkspaceId,
        direction: SyncDirection,
    ) -> Result<SyncReport, SyncError>;
}
