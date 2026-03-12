//! Jellyfin upload — media service.
//!
//! Two entry points:
//! - `upload_to_media`: simple single-file upload (dispatched from `upload_file`)
//! - `upload_media`: structured multi-file upload handler (TV shows, movies, music)

use axum::{
    extract::{Multipart, State},
    Json,
};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::services::JellyfinClient;
use crate::AppState;

/// Simple single-file media upload — writes to Movies/ and refreshes Jellyfin.
pub async fn upload_to_media(
    state: &AppState,
    user: &AuthUser,
    filename: &str,
    file_data: &[u8],
    _mime_type: &str,
) -> Result<(), AppError> {
    // Save to Jellyfin library folder.
    let _cred = user
        .credentials
        .jellyfin
        .as_ref()
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    // TODO: TMDb lookup for proper folder naming.
    let media_dir = format!("{}/{}/Movies", state.config.media_storage_path, user.id);
    tokio::fs::create_dir_all(&media_dir)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;

    let file_path = format!("{}/{}", media_dir, filename);
    tokio::fs::write(&file_path, file_data)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("write error: {e}")))?;

    // Trigger Jellyfin library refresh.
    let jf_client = JellyfinClient::new(
        &state.config.jellyfin_url,
        &state.config.jellyfin_device_id,
        state.http.clone(),
    );
    let _ = jf_client
        .refresh_library(&state.config.jellyfin_admin_token)
        .await;

    Ok(())
}

/// POST /api/v1/upload/media
///
/// Upload media files (TV shows, movies, music) with structured folder paths.
/// Creates the correct folder structure for Jellyfin before writing files.
///
/// Form fields:
///   - `media_type` (required): "tv_show", "movie", or "music"
///   - `title` (required): Show name, movie title, or album name
///   - `year` (optional): Release year
///   - `artist` (optional): For music — artist name
///   - `season` (optional): For TV shows — season number
///   - Files: numbered keys (0, 1, 2...) with the actual files
///   - File paths: `path_0`, `path_1`, etc. — the relative path to write each file to
pub async fn upload_media(
    State(state): State<AppState>,
    user: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let _cred = user
        .credentials
        .jellyfin
        .as_ref()
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    let mut media_type = String::new();
    let mut title = String::new();
    let mut year: Option<String> = None;
    let mut artist: Option<String> = None;
    let mut season: Option<String> = None;
    let mut files: Vec<(String, Vec<u8>, String)> = Vec::new();
    let mut file_paths: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "media_type" => {
                media_type = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
            }
            "title" => {
                title = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
            }
            "year" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                if !text.is_empty() {
                    year = Some(text);
                }
            }
            "artist" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                if !text.is_empty() {
                    artist = Some(text);
                }
            }
            "season" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                if !text.is_empty() {
                    season = Some(text);
                }
            }
            name if name.starts_with("path_") => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                let idx = name.strip_prefix("path_").unwrap_or("").to_string();
                file_paths.insert(idx, text);
            }
            _ => {
                // File fields
                let filename = field.file_name().unwrap_or("file").to_string();
                let data = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                let mime = mime_guess::from_path(&filename)
                    .first_or_octet_stream()
                    .to_string();
                files.push((filename, data.to_vec(), mime));
            }
        }
    }

    if title.is_empty() {
        return Err(AppError::BadRequest("title is required".into()));
    }
    if media_type.is_empty() {
        return Err(AppError::BadRequest("media_type is required".into()));
    }
    if files.is_empty() {
        return Err(AppError::BadRequest("at least one file is required".into()));
    }

    let file_count = files.len();
    let total_bytes: usize = files.iter().map(|(_, data, _)| data.len()).sum();

    tracing::info!(
        user_id = %user.id,
        media_type = %media_type,
        title = %title,
        year = ?year,
        artist = ?artist,
        season = ?season,
        file_count,
        total_bytes,
        "media upload started"
    );

    let year_suffix = year
        .as_ref()
        .map(|y| format!(" ({})", y))
        .unwrap_or_default();

    for (idx, (filename, data, _mime)) in files.iter().enumerate() {
        let rel_path = file_paths
            .get(&idx.to_string())
            .cloned()
            .unwrap_or_else(|| filename.clone());

        let full_path = match media_type.as_str() {
            "tv_show" => {
                let season_dir = season
                    .as_ref()
                    .map(|s| format!("Season {}", s.trim_start_matches('0')))
                    .unwrap_or_else(|| "Season 01".to_string());
                format!(
                    "{}/{}/Shows/{}{}/{}/{}",
                    state.config.media_storage_path,
                    user.id,
                    title,
                    year_suffix,
                    season_dir,
                    rel_path,
                )
            }
            "movie" => {
                format!(
                    "{}/{}/Movies/{}{}/{}",
                    state.config.media_storage_path, user.id, title, year_suffix, rel_path,
                )
            }
            "music" => {
                let artist_dir = artist.as_deref().unwrap_or("Unknown Artist");
                format!(
                    "{}/{}/Music/{}/{}/{}",
                    state.config.media_storage_path, user.id, artist_dir, title, rel_path,
                )
            }
            _ => {
                return Err(AppError::BadRequest(format!(
                    "unknown media_type: {}",
                    media_type
                )));
            }
        };

        // Create parent directory
        if let Some(parent) = std::path::Path::new(&full_path).parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;
        }

        tokio::fs::write(&full_path, data)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("write error: {e}")))?;
    }

    // Trigger Jellyfin library refresh
    let jf_client = JellyfinClient::new(
        &state.config.jellyfin_url,
        &state.config.jellyfin_device_id,
        state.http.clone(),
    );
    let _ = jf_client
        .refresh_library(&state.config.jellyfin_admin_token)
        .await;

    tracing::info!(
        user_id = %user.id,
        media_type = %media_type,
        title = %title,
        file_count,
        "media upload complete"
    );

    Ok(Json(json!({
        "status": "uploaded",
        "service": "media",
        "mediaType": media_type,
        "title": title,
        "fileCount": file_count,
    })))
}
