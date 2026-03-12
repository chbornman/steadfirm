//! Audiobooks browse — Audiobookshelf proxy.

use axum::{
    body::Body,
    extract::{Path, Query, State},
    response::Response,
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::models::*;
use crate::pagination::*;
use crate::proxy::proxy_binary;
use crate::services::AudiobookshelfClient;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_audiobooks))
        .route("/sessions", get(list_sessions))
        .route("/{id}", get(get_audiobook))
        .route("/{id}/cover", get(get_cover))
        .route("/{id}/play", post(start_playback))
        .route("/{id}/progress", patch(sync_progress))
        .route("/{id}/stream", get(stream_audio))
        .route("/{id}/bookmarks", post(create_bookmark))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudiobookListParams {
    #[serde(flatten)]
    pagination: PaginationParams,
    #[serde(default)]
    sort: Option<String>,
    #[serde(default)]
    order: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct StreamParams {
    #[serde(default)]
    session: Option<String>,
}

fn abs_client(state: &AppState) -> AudiobookshelfClient {
    AudiobookshelfClient::new(&state.config.audiobookshelf_url, state.http.clone())
}

fn map_abs_sort(sort: Option<&str>) -> &str {
    match sort {
        Some("title") => "media.metadata.title",
        Some("author") => "media.metadata.authorName",
        Some("recentlyListened") => "progress",
        _ => "media.metadata.title",
    }
}

async fn list_audiobooks(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<AudiobookListParams>,
) -> Result<Json<PaginatedResponse<Audiobook>>, AppError> {
    let cred = user
        .credentials
        .audiobookshelf
        .ok_or(AppError::ServiceUnavailable(
            "audiobooks not provisioned".into(),
        ))?;

    let client = abs_client(&state);

    // We need a library ID. For now, use the first library found.
    // In a full implementation, the library ID would be stored during provisioning.
    let libraries = client.get_libraries(&cred.api_key).await?;
    let library_id = libraries["libraries"]
        .as_array()
        .and_then(|libs| libs.first())
        .and_then(|lib| lib["id"].as_str())
        .ok_or(AppError::ServiceUnavailable(
            "no audiobook library found".into(),
        ))?
        .to_string();

    let abs_page = page_to_abs_page(params.pagination.page);
    let sort = map_abs_sort(params.sort.as_deref());
    let desc = if params.order.as_deref() == Some("desc") {
        "1"
    } else {
        "0"
    };

    let query: Vec<(&str, String)> = vec![
        ("page", abs_page.to_string()),
        ("limit", params.pagination.page_size.to_string()),
        ("sort", sort.to_string()),
        ("desc", desc.to_string()),
        ("include", "rssfeed,progress".to_string()),
    ];

    let resp = client
        .list_items(&cred.api_key, &library_id, &query)
        .await?;
    let total = resp["total"].as_u64().unwrap_or(0);

    let items = resp["results"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(abs_item_to_audiobook)
        .collect();

    Ok(Json(PaginatedResponse::new(
        items,
        total,
        params.pagination.page,
        params.pagination.page_size,
    )))
}

async fn get_audiobook(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let cred = user
        .credentials
        .audiobookshelf
        .ok_or(AppError::ServiceUnavailable(
            "audiobooks not provisioned".into(),
        ))?;

    let client = abs_client(&state);
    let item = client.get_item(&cred.api_key, &id).await?;

    let audiobook = abs_item_to_audiobook(&item);
    let chapters: Vec<Chapter> = item["media"]["chapters"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .enumerate()
        .map(|(i, ch)| Chapter {
            id: ch["id"].as_u64().unwrap_or(i as u64) as u32,
            title: ch["title"].as_str().unwrap_or("").to_string(),
            start: ch["start"].as_f64().unwrap_or(0.0),
            end: ch["end"].as_f64().unwrap_or(0.0),
        })
        .collect();

    Ok(Json(serde_json::json!({
        "id": audiobook.id,
        "title": audiobook.title,
        "author": audiobook.author,
        "narrator": audiobook.narrator,
        "duration": audiobook.duration,
        "coverUrl": audiobook.cover_url,
        "progress": audiobook.progress,
        "chapters": chapters,
    })))
}

async fn get_cover(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let cred = user
        .credentials
        .audiobookshelf
        .ok_or(AppError::ServiceUnavailable(
            "audiobooks not provisioned".into(),
        ))?;

    let client = abs_client(&state);
    let resp = client
        .get_cover(
            &cred.api_key,
            &id,
            Some(crate::constants::COVER_IMAGE_MAX_WIDTH),
        )
        .await?;
    proxy_binary(resp)
}

async fn start_playback(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<PlaybackSession>, AppError> {
    let cred = user
        .credentials
        .audiobookshelf
        .ok_or(AppError::ServiceUnavailable(
            "audiobooks not provisioned".into(),
        ))?;

    let client = abs_client(&state);
    let resp = client.start_playback(&cred.api_key, &id).await?;

    let session_id = resp["id"].as_str().unwrap_or("").to_string();
    let current_time = resp["currentTime"].as_f64().unwrap_or(0.0);

    let audio_tracks: Vec<AudioTrack> = resp["audioTracks"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|t| {
            // Rewrite contentUrl to proxy through Steadfirm.
            let _original_url = t["contentUrl"].as_str().unwrap_or("");
            AudioTrack {
                content_url: format!("/api/v1/audiobooks/{}/stream?session={}", id, session_id),
                mime_type: t["mimeType"].as_str().map(|s| s.to_string()),
                duration: t["duration"].as_f64(),
            }
        })
        .collect();

    let chapters: Vec<Chapter> = resp["chapters"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .enumerate()
        .map(|(i, ch)| Chapter {
            id: ch["id"].as_u64().unwrap_or(i as u64) as u32,
            title: ch["title"].as_str().unwrap_or("").to_string(),
            start: ch["start"].as_f64().unwrap_or(0.0),
            end: ch["end"].as_f64().unwrap_or(0.0),
        })
        .collect();

    Ok(Json(PlaybackSession {
        session_id,
        audio_tracks,
        current_time,
        chapters,
    }))
}

async fn sync_progress(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<axum::http::StatusCode, AppError> {
    let cred = user
        .credentials
        .audiobookshelf
        .ok_or(AppError::ServiceUnavailable(
            "audiobooks not provisioned".into(),
        ))?;

    let client = abs_client(&state);
    let progress = body["progress"].as_f64().unwrap_or(0.0);
    let is_finished = progress >= 1.0;

    let abs_body = serde_json::json!({
        "currentTime": body["currentTime"],
        "duration": body["duration"],
        "progress": progress,
        "isFinished": is_finished,
    });

    client
        .update_progress(&cred.api_key, &id, &abs_body)
        .await?;
    Ok(axum::http::StatusCode::OK)
}

async fn stream_audio(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Query(_params): Query<StreamParams>,
    req: axum::http::Request<Body>,
) -> Result<Response<Body>, AppError> {
    let cred = user
        .credentials
        .audiobookshelf
        .ok_or(AppError::ServiceUnavailable(
            "audiobooks not provisioned".into(),
        ))?;

    let range = req.headers().get("range").cloned();
    let client = abs_client(&state);

    // Get the item to find the actual audio file path.
    let item = client.get_item(&cred.api_key, &id).await?;
    let content_url = item["media"]["audioFiles"]
        .as_array()
        .and_then(|files| files.first())
        .and_then(|f| f["ino"].as_str())
        .map(|ino| format!("/api/items/{id}/file/{ino}"))
        .unwrap_or_else(|| format!("/api/items/{id}/play"));

    let resp = client
        .stream(&cred.api_key, &content_url, range.as_ref())
        .await?;
    proxy_binary(resp)
}

async fn create_bookmark(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let cred = user
        .credentials
        .audiobookshelf
        .ok_or(AppError::ServiceUnavailable(
            "audiobooks not provisioned".into(),
        ))?;

    let client = abs_client(&state);
    let resp = client.create_bookmark(&cred.api_key, &id, &body).await?;
    Ok(Json(resp))
}

async fn list_sessions(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<ListeningSession>>, AppError> {
    let cred = user
        .credentials
        .audiobookshelf
        .ok_or(AppError::ServiceUnavailable(
            "audiobooks not provisioned".into(),
        ))?;

    let client = abs_client(&state);
    let resp = client.listening_sessions(&cred.api_key).await?;

    let sessions = resp["sessions"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|s| {
            let book_id = s["libraryItemId"].as_str().unwrap_or("").to_string();
            ListeningSession {
                id: s["id"].as_str().unwrap_or("").to_string(),
                book_id: book_id.clone(),
                book_title: s["displayTitle"].as_str().map(|s| s.to_string()),
                cover_url: format!("/api/v1/audiobooks/{book_id}/cover"),
                current_time: s["currentTime"].as_f64().unwrap_or(0.0),
                duration: s["duration"].as_f64().unwrap_or(0.0),
                updated_at: s["updatedAt"].as_str().map(|s| s.to_string()),
            }
        })
        .collect();

    Ok(Json(sessions))
}

// --- Helpers ---

fn abs_item_to_audiobook(item: &Value) -> Audiobook {
    let id = item["id"].as_str().unwrap_or("").to_string();
    let media = &item["media"];
    let metadata = &media["metadata"];

    Audiobook {
        cover_url: format!("/api/v1/audiobooks/{id}/cover"),
        id,
        title: metadata["title"].as_str().unwrap_or("").to_string(),
        author: metadata["authorName"].as_str().map(|s| s.to_string()),
        narrator: metadata["narratorName"].as_str().map(|s| s.to_string()),
        duration: media["duration"].as_f64(),
        progress: item
            .get("mediaProgress")
            .and_then(|p| p["currentTime"].as_f64()),
    }
}
