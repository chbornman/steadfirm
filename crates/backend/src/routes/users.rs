use axum::{extract::State, routing::get, Json, Router};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/me", get(get_current_user))
}

/// Returns the current user's profile and service connection status.
///
/// Provisioning is handled by [`ProvisioningService`]. The webhook is the
/// primary trigger; this endpoint acts as a fallback by calling the same
/// `ensure_provisioned` method (which no-ops if already in progress).
///
/// This handler never blocks on provisioning — it returns the current
/// state and lets the client poll until all services are ready.
async fn get_current_user(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let has_any_service = user.credentials.immich.is_some()
        || user.credentials.jellyfin.is_some()
        || user.credentials.paperless.is_some()
        || user.credentials.audiobookshelf.is_some()
        || user.credentials.kavita.is_some();

    // If no services are provisioned yet, make sure provisioning is running.
    // This is a no-op if the webhook already kicked it off.
    if !has_any_service {
        state.provisioner.ensure_provisioned(
            state.clone(),
            user.id.clone(),
            user.name.clone(),
            user.email.clone(),
        );
    }

    // Always return the current state — client polls until services are ready.
    Ok(Json(json!({
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "services": {
            "photos": user.credentials.immich.is_some(),
            "media": user.credentials.jellyfin.is_some(),
            "documents": user.credentials.paperless.is_some(),
            "audiobooks": user.credentials.audiobookshelf.is_some(),
            "reading": user.credentials.kavita.is_some(),
            "files": true,
        }
    })))
}
