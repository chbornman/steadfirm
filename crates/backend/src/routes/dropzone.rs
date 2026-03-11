use axum::{Json, Router, routing::post};
use serde_json::{Value, json};

pub fn router() -> Router {
    Router::new()
        .route("/", post(upload_file))
}

async fn upload_file() -> Json<Value> {
    // TODO: accept multipart upload, classify file, route to correct service
    // Classification pipeline:
    //   1. MIME detection
    //   2. Metadata extraction (EXIF, ID3, etc.)
    //   3. Service routing based on steadfirm_shared::FileClassification
    //   4. Forward to appropriate service API (Immich, Jellyfin, Paperless, etc.)
    Json(json!({
        "message": "drop zone upload endpoint - pending implementation"
    }))
}
