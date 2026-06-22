use crate::models::{Connection, ConnectionId, TerminalSession};
use async_trait::async_trait;
use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ConnectionError {
    #[error("connection not found")]
    NotFound,
    #[error("connection failed: {0}")]
    Failed(String),
}

#[async_trait]
pub trait ConnectionService: Send + Sync {
    async fn list_connections(&self) -> Result<Vec<Connection>, ConnectionError>;
    async fn get_connection(&self, id: ConnectionId)
        -> Result<Option<Connection>, ConnectionError>;
    async fn save_connection(&self, connection: Connection) -> Result<Connection, ConnectionError>;
    async fn delete_connection(&self, id: ConnectionId) -> Result<(), ConnectionError>;
    async fn open_terminal(&self, id: ConnectionId) -> Result<TerminalSession, ConnectionError>;
}
