//! Media metadata — Jellyfin refresh, identify, provider search.

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::AppState;
use axum::{
    extract::{Path, State},
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{id}/refresh", post(refresh_metadata))
        .route("/{id}/identify", post(identify_item))
}

/// Trigger a metadata refresh for a Jellyfin item.
async fn refresh_metadata(
    State(_state): State<AppState>,
    _user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    tracing::info!(item_id = %id, "media metadata refresh requested (stub)");
    Ok(Json(json!({ "status": "pending", "itemId": id })))
}

/// Trigger Jellyfin's identify/match dialog for an item.
async fn identify_item(
    State(_state): State<AppState>,
    _user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    tracing::info!(item_id = %id, "media identify requested (stub)");
    Ok(Json(json!({ "status": "pending", "itemId": id })))
}
