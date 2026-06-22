use crate::models::{VaultItem, VaultItemId, WorkspaceId};
use async_trait::async_trait;
use thiserror::Error;

pub const REDACTED_SECRET_REF: &str = "<redacted>";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretMaterial(pub Vec<u8>);

impl SecretMaterial {
    pub fn expose(&self) -> &[u8] {
        &self.0
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum VaultError {
    #[error("vault item not found")]
    NotFound,
    #[error("vault operation denied")]
    Denied,
    #[error("vault operation failed: {0}")]
    Failed(String),
}

pub fn redact_vault_item(item: &VaultItem) -> VaultItem {
    let mut redacted = item.clone();
    redacted.secret_ref = REDACTED_SECRET_REF.to_string();
    redacted
}

pub fn redact_vault_items(items: &[VaultItem]) -> Vec<VaultItem> {
    items.iter().map(redact_vault_item).collect()
}

#[async_trait]
pub trait VaultService: Send + Sync {
    async fn list_items(&self, workspace_id: WorkspaceId) -> Result<Vec<VaultItem>, VaultError>;
    async fn get_item(&self, id: VaultItemId) -> Result<Option<VaultItem>, VaultError>;
    async fn put_item(
        &self,
        item: VaultItem,
        secret: SecretMaterial,
    ) -> Result<VaultItem, VaultError>;
    async fn reveal_secret(&self, id: VaultItemId) -> Result<SecretMaterial, VaultError>;
    async fn delete_item(&self, id: VaultItemId) -> Result<(), VaultError>;
}
