use axum::{Json, Router, routing::get};
use serde_json::{Value, json};

/// Immich proxy — photos and home videos
pub fn photos_router() -> Router {
    Router::new()
        .route("/", get(list_photos))
}

/// Jellyfin proxy — movies, TV, music
pub fn media_router() -> Router {
    Router::new()
        .route("/", get(list_media))
}

/// Paperless-ngx proxy — documents
pub fn documents_router() -> Router {
    Router::new()
        .route("/", get(list_documents))
}

/// Audiobookshelf proxy — audiobooks
pub fn audiobooks_router() -> Router {
    Router::new()
        .route("/", get(list_audiobooks))
}

/// Actual Budget proxy — budgeting
pub fn budget_router() -> Router {
    Router::new()
        .route("/", get(get_budget))
}

// TODO: each handler will proxy requests to the underlying service,
// injecting the user's service-specific credentials and scoping
// responses to the authenticated user.

async fn list_photos() -> Json<Value> {
    Json(json!({ "service": "immich", "status": "pending" }))
}

async fn list_media() -> Json<Value> {
    Json(json!({ "service": "jellyfin", "status": "pending" }))
}

async fn list_documents() -> Json<Value> {
    Json(json!({ "service": "paperless", "status": "pending" }))
}

async fn list_audiobooks() -> Json<Value> {
    Json(json!({ "service": "audiobookshelf", "status": "pending" }))
}

async fn get_budget() -> Json<Value> {
    Json(json!({ "service": "actual", "status": "pending" }))
}
