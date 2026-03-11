use axum::{Json, Router, routing::get};
use serde_json::{Value, json};

use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me", get(get_current_user))
}

async fn get_current_user() -> Json<Value> {
    // TODO: extract user from Clerk JWT
    Json(json!({
        "id": "placeholder",
        "message": "Clerk auth integration pending"
    }))
}
