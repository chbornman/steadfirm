//! AI provider switching endpoints.

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::AppState;

#[derive(Serialize)]
pub struct ProviderInfo {
    provider: String,
    model: String,
    enabled: bool,
}

/// GET /api/v1/classify/provider
pub async fn get_provider(State(state): State<AppState>, _user: AuthUser) -> Json<ProviderInfo> {
    let ai = state.ai.read().await;
    Json(ProviderInfo {
        provider: ai.active_provider().to_string(),
        model: ai.active_model().to_string(),
        enabled: ai.is_enabled(),
    })
}

#[derive(Debug, Deserialize)]
pub struct SetProviderRequest {
    provider: String,
}

/// PUT /api/v1/classify/provider
pub async fn set_provider(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(req): Json<SetProviderRequest>,
) -> Json<ProviderInfo> {
    let mut ai = state.ai.write().await;
    ai.switch_provider(&state.config, &req.provider);
    Json(ProviderInfo {
        provider: ai.active_provider().to_string(),
        model: ai.active_model().to_string(),
        enabled: ai.is_enabled(),
    })
}
