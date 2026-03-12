//! Audiobooks metadata — Audiobookshelf match.

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
    Router::new().route("/{id}/match", post(match_metadata))
}

/// Trigger an Audiobookshelf metadata match for an item.
async fn match_metadata(
    State(_state): State<AppState>,
    _user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    tracing::info!(item_id = %id, "audiobook metadata match requested (stub)");
    Ok(Json(json!({ "status": "pending", "itemId": id })))
}
