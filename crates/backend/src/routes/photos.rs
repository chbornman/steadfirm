use axum::{
    body::Body,
    extract::{Path, Query, State},
    response::Response,
    routing::{get, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::models::Photo;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::proxy::proxy_binary;
use crate::services::ImmichClient;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_photos))
        .route("/{id}", get(get_photo))
        .route("/{id}/thumbnail", get(get_thumbnail))
        .route("/{id}/original", get(get_original))
        .route("/{id}/video", get(stream_video))
        .route("/{id}/favorite", put(toggle_favorite))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PhotoListParams {
    #[serde(flatten)]
    pagination: PaginationParams,
    #[serde(default)]
    favorites: Option<bool>,
    #[serde(default)]
    order: Option<String>,
}

fn immich_client(state: &AppState) -> ImmichClient {
    ImmichClient::new(&state.config.immich_url, state.http.clone())
}

async fn list_photos(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<PhotoListParams>,
) -> Result<Json<PaginatedResponse<Photo>>, AppError> {
    let cred = user.credentials.immich.ok_or(AppError::ServiceUnavailable(
        "photos not provisioned".into(),
    ))?;

    let client = immich_client(&state);

    let mut body = json!({
        "page": params.pagination.page,
        "size": params.pagination.page_size,
        "order": params.order.as_deref().unwrap_or("desc"),
        "visibility": "timeline",
    });

    if params.favorites == Some(true) {
        body["isFavorite"] = json!(true);
    }

    let resp = client.search_metadata(&cred.api_key, &body).await?;

    // Parse Immich's response: { assets: { items, total, count, nextPage } }
    let assets = &resp["assets"];
    let items = assets["items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(immich_asset_to_photo)
        .collect();
    let total = assets["total"].as_u64().unwrap_or(0);

    Ok(Json(PaginatedResponse::new(
        items,
        total,
        params.pagination.page,
        params.pagination.page_size,
    )))
}

async fn get_photo(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Photo>, AppError> {
    let cred = user.credentials.immich.ok_or(AppError::ServiceUnavailable(
        "photos not provisioned".into(),
    ))?;

    let client = immich_client(&state);
    let asset = client.get_asset(&cred.api_key, &id).await?;
    Ok(Json(immich_asset_to_photo(&asset)))
}

async fn get_thumbnail(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let cred = user.credentials.immich.ok_or(AppError::ServiceUnavailable(
        "photos not provisioned".into(),
    ))?;

    let client = immich_client(&state);
    let resp = client.get_thumbnail(&cred.api_key, &id).await?;
    proxy_binary(resp)
}

async fn get_original(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let cred = user.credentials.immich.ok_or(AppError::ServiceUnavailable(
        "photos not provisioned".into(),
    ))?;

    let client = immich_client(&state);
    let resp = client.get_original(&cred.api_key, &id).await?;
    proxy_binary(resp)
}

async fn stream_video(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    req: axum::http::Request<Body>,
) -> Result<Response<Body>, AppError> {
    let cred = user.credentials.immich.ok_or(AppError::ServiceUnavailable(
        "photos not provisioned".into(),
    ))?;

    let range = req.headers().get("range").cloned();
    let client = immich_client(&state);
    let resp = client
        .get_video_playback(&cred.api_key, &id, range.as_ref())
        .await?;
    proxy_binary(resp)
}

async fn toggle_favorite(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let cred = user.credentials.immich.ok_or(AppError::ServiceUnavailable(
        "photos not provisioned".into(),
    ))?;

    let client = immich_client(&state);

    // Get current state.
    let asset = client.get_asset(&cred.api_key, &id).await?;
    let current = asset["isFavorite"].as_bool().unwrap_or(false);

    // Toggle.
    let updated = client
        .update_asset(&cred.api_key, &id, &json!({ "isFavorite": !current }))
        .await?;

    Ok(Json(json!({
        "isFavorite": updated["isFavorite"].as_bool().unwrap_or(!current)
    })))
}

/// Convert an Immich AssetResponseDto to our Photo model.
fn immich_asset_to_photo(asset: &Value) -> Photo {
    let id = asset["id"].as_str().unwrap_or("").to_string();
    let asset_type = asset["type"].as_str().unwrap_or("IMAGE");
    let photo_type = match asset_type {
        "VIDEO" => "video",
        _ => "image",
    }
    .to_string();

    let duration = if photo_type == "video" {
        // Immich duration is "H:MM:SS.mmm" or similar.
        asset["duration"].as_str().and_then(parse_immich_duration)
    } else {
        None
    };

    Photo {
        thumbnail_url: format!("/api/v1/photos/{id}/thumbnail"),
        id,
        photo_type,
        filename: asset["originalFileName"].as_str().unwrap_or("").to_string(),
        mime_type: asset["originalMimeType"].as_str().unwrap_or("").to_string(),
        width: asset
            .get("exifInfo")
            .and_then(|e| e["exifImageWidth"].as_u64())
            .map(|v| v as u32),
        height: asset
            .get("exifInfo")
            .and_then(|e| e["exifImageHeight"].as_u64())
            .map(|v| v as u32),
        date_taken: asset["fileCreatedAt"].as_str().unwrap_or("").to_string(),
        is_favorite: asset["isFavorite"].as_bool().unwrap_or(false),
        duration,
    }
}

/// Parse Immich's duration format "H:MM:SS.mmm" to seconds.
fn parse_immich_duration(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    match parts.len() {
        3 => {
            let h: f64 = parts[0].parse().ok()?;
            let m: f64 = parts[1].parse().ok()?;
            let s: f64 = parts[2].parse().ok()?;
            Some(h * 3600.0 + m * 60.0 + s)
        }
        2 => {
            let m: f64 = parts[0].parse().ok()?;
            let s: f64 = parts[1].parse().ok()?;
            Some(m * 60.0 + s)
        }
        _ => None,
    }
}
