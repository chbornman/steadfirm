//! Reading metadata — Kavita series refresh.

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
    Router::new().route("/{id}/refresh", post(refresh_metadata))
}

/// Trigger a Kavita metadata refresh for a series.
async fn refresh_metadata(
    State(_state): State<AppState>,
    _user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    tracing::info!(series_id = %id, "reading metadata refresh requested (stub)");
    Ok(Json(json!({ "status": "pending", "seriesId": id })))
}
