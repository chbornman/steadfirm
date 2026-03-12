//! Documents metadata — Paperless-ngx tag management.

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
    Router::new().route("/{id}/tags", post(update_tags))
}

/// Update Paperless-ngx tags for a document.
async fn update_tags(
    State(_state): State<AppState>,
    _user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    tracing::info!(document_id = %id, "document tag update requested (stub)");
    Ok(Json(json!({ "status": "pending", "documentId": id })))
}
