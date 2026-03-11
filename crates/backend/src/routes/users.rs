use axum::{extract::State, routing::get, Json, Router};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::provisioning;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/me", get(get_current_user))
}

/// Returns the current user's profile and service connection status.
///
/// Primary provisioning is handled by the webhook (`POST /hooks/user-created`)
/// fired by BetterAuth on signup. This endpoint acts as a fallback: if the
/// webhook failed or was missed (e.g. race condition, network blip), we
/// provision here so the user is never stuck. Provisioning is idempotent.
async fn get_current_user(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let has_any_service = user.credentials.immich.is_some()
        || user.credentials.jellyfin.is_some()
        || user.credentials.paperless.is_some()
        || user.credentials.audiobookshelf.is_some();

    // Fallback: provision if webhook hasn't run yet.
    if !has_any_service {
        tracing::info!(user_id = %user.id, "fallback provisioning (webhook may have missed)");
        let results = provisioning::provision_all(&state, &user.id, &user.name, &user.email).await;

        for r in &results {
            if r.status == "failed" {
                tracing::warn!(
                    service = %r.service,
                    error = r.error.as_deref().unwrap_or("unknown"),
                    "fallback provision failed for service"
                );
            }
        }

        return Ok(Json(json!({
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "services": {
                "photos": results.iter().any(|r| r.service == "immich" && r.status == "provisioned"),
                "media": results.iter().any(|r| r.service == "jellyfin" && r.status == "provisioned"),
                "documents": results.iter().any(|r| r.service == "paperless" && r.status == "provisioned"),
                "audiobooks": results.iter().any(|r| r.service == "audiobookshelf" && r.status == "provisioned"),
                "files": true,
            }
        })));
    }

    Ok(Json(json!({
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "services": {
            "photos": user.credentials.immich.is_some(),
            "media": user.credentials.jellyfin.is_some(),
            "documents": user.credentials.paperless.is_some(),
            "audiobooks": user.credentials.audiobookshelf.is_some(),
            "files": true,
        }
    })))
}
