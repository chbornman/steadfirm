use axum::{routing::get, Json, Router};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/me", get(get_current_user))
}

async fn get_current_user(user: AuthUser) -> Result<Json<Value>, AppError> {
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
