use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::ServiceKind;

/// A Steadfirm user
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
}

/// Tracks a user's connection to an underlying service
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ServiceConnection {
    pub user_id: Uuid,
    pub service: ServiceKind,
    pub endpoint: String,
    pub api_key: String,
    pub active: bool,
}
