//! Files metadata — reclassify to another service.

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
    Router::new().route("/{id}/reclassify", post(reclassify))
}

/// Reclassify a file — move it from Steadfirm's own storage to another service.
async fn reclassify(
    State(_state): State<AppState>,
    _user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    tracing::info!(file_id = %id, "file reclassify requested (stub)");
    Ok(Json(json!({ "status": "pending", "fileId": id })))
}
