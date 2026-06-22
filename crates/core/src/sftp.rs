use crate::models::{ConnectionId, TransferJob, TransferJobId};
use async_trait::async_trait;
use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SftpError {
    #[error("transfer not found")]
    NotFound,
    #[error("transfer failed: {0}")]
    Failed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteDirEntry {
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

#[async_trait]
pub trait SftpService: Send + Sync {
    async fn list_dir(
        &self,
        connection_id: ConnectionId,
        remote_path: &str,
    ) -> Result<Vec<RemoteDirEntry>, SftpError>;
    async fn start_transfer(&self, job: TransferJob) -> Result<TransferJob, SftpError>;
    async fn get_transfer(&self, id: TransferJobId) -> Result<Option<TransferJob>, SftpError>;
    async fn cancel_transfer(&self, id: TransferJobId) -> Result<(), SftpError>;
}
