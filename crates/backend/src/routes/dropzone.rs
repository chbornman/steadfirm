use axum::{
    extract::{Multipart, State},
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::services::*;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(upload_file))
        .route("/audiobook", post(upload_audiobook))
        .route("/media", post(upload_media))
        .route("/reading", post(upload_reading))
}

async fn upload_file(
    State(state): State<AppState>,
    user: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let mut file_data: Option<Vec<u8>> = None;
    let mut filename = String::new();
    let mut service = String::new();
    let mut relative_path: Option<String> = None;

    // Parse multipart fields.
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "file" => {
                filename = field.file_name().unwrap_or("unknown").to_string();
                let data = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("failed to read file: {e}")))?;
                file_data = Some(data.to_vec());
            }
            "filename" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("failed to read filename: {e}")))?;
                if !text.is_empty() {
                    filename = text;
                }
            }
            "service" => {
                service = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("failed to read service: {e}")))?;
            }
            "relative_path" => {
                let text = field.text().await.map_err(|e| {
                    AppError::BadRequest(format!("failed to read relative_path: {e}"))
                })?;
                if !text.is_empty() {
                    relative_path = Some(text);
                }
            }
            _ => {}
        }
    }

    let file_data = file_data.ok_or(AppError::BadRequest("file is required".into()))?;
    if service.is_empty() {
        return Err(AppError::BadRequest("service is required".into()));
    }
    if filename.is_empty() {
        return Err(AppError::BadRequest("filename is required".into()));
    }

    let size_bytes = file_data.len();
    let mime_type = mime_guess::from_path(&filename)
        .first_or_octet_stream()
        .to_string();

    tracing::info!(
        user_id = %user.id,
        filename = %filename,
        service = %service,
        mime_type = %mime_type,
        size_bytes = size_bytes,
        relative_path = ?relative_path,
        "upload started"
    );

    match service.as_str() {
        "photos" => {
            let cred = user.credentials.immich.ok_or(AppError::ServiceUnavailable(
                "photos not provisioned".into(),
            ))?;
            let client = ImmichClient::new(&state.config.immich_url, state.http.clone());

            let device_asset_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();

            let part = reqwest::multipart::Part::bytes(file_data)
                .file_name(filename.clone())
                .mime_str(&mime_type)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("mime error: {e}")))?;

            let form = reqwest::multipart::Form::new()
                .part("assetData", part)
                .text("deviceAssetId", device_asset_id)
                .text("deviceId", "steadfirm")
                .text("fileCreatedAt", now.clone())
                .text("fileModifiedAt", now);

            client.upload_asset(&cred.api_key, form).await?;
        }
        "documents" => {
            let cred = user
                .credentials
                .paperless
                .ok_or(AppError::ServiceUnavailable(
                    "documents not provisioned".into(),
                ))?;
            let client = PaperlessClient::new(&state.config.paperless_url, state.http.clone());

            let title = std::path::Path::new(&filename)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&filename)
                .to_string();

            let part = reqwest::multipart::Part::bytes(file_data)
                .file_name(filename.clone())
                .mime_str(&mime_type)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("mime error: {e}")))?;

            let form = reqwest::multipart::Form::new()
                .part("document", part)
                .text("title", title);

            client.upload_document(&cred.api_key, form).await?;
        }
        "media" => {
            // Save to Jellyfin library folder.
            let _cred = user
                .credentials
                .jellyfin
                .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

            // TODO: TMDb lookup for proper folder naming.
            let media_dir = format!("{}/{}/Movies", state.config.media_storage_path, user.id);
            tokio::fs::create_dir_all(&media_dir)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;

            let file_path = format!("{}/{}", media_dir, filename);
            tokio::fs::write(&file_path, &file_data)
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
        }
        "audiobooks" => {
            let _cred = user
                .credentials
                .audiobookshelf
                .ok_or(AppError::ServiceUnavailable(
                    "audiobooks not provisioned".into(),
                ))?;

            // Use relative_path to preserve folder structure (Author/Title/)
            // for Audiobookshelf. Falls back to flat upload if no path.
            let abs_dir = if let Some(ref rel) = relative_path {
                // Strip the filename from relative_path to get the folder
                let folder = std::path::Path::new(rel)
                    .parent()
                    .and_then(|p| p.to_str())
                    .unwrap_or("");
                if folder.is_empty() {
                    format!("{}/{}", state.config.audiobooks_storage_path, user.id)
                } else {
                    format!(
                        "{}/{}/{}",
                        state.config.audiobooks_storage_path, user.id, folder
                    )
                }
            } else {
                format!("{}/{}", state.config.audiobooks_storage_path, user.id)
            };

            tokio::fs::create_dir_all(&abs_dir)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;

            let file_path = format!("{}/{}", abs_dir, filename);
            tokio::fs::write(&file_path, &file_data)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("write error: {e}")))?;

            // TODO: Trigger ABS library scan.
        }
        "reading" => {
            let cred = user.credentials.kavita.ok_or(AppError::ServiceUnavailable(
                "reading not provisioned".into(),
            ))?;

            // Save to Kavita library folder, preserving folder structure.
            let abs_dir = if let Some(ref rel) = relative_path {
                let folder = std::path::Path::new(rel)
                    .parent()
                    .and_then(|p| p.to_str())
                    .unwrap_or("");
                if folder.is_empty() {
                    format!("{}/{}", state.config.reading_storage_path, user.id)
                } else {
                    format!(
                        "{}/{}/{}",
                        state.config.reading_storage_path, user.id, folder
                    )
                }
            } else {
                format!("{}/{}", state.config.reading_storage_path, user.id)
            };

            tokio::fs::create_dir_all(&abs_dir)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;

            let file_path = format!("{}/{}", abs_dir, filename);
            tokio::fs::write(&file_path, &file_data)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("write error: {e}")))?;

            // Trigger Kavita library scan so it picks up the new file.
            let kavita_client =
                crate::services::KavitaClient::new(&state.config.kavita_url, state.http.clone());
            let _ = kavita_client.scan_all_libraries(&cred.api_key).await;
        }
        "files" => {
            // Save to local Steadfirm storage.
            let user_dir = format!("{}/{}", state.config.files_storage_path, user.id);
            tokio::fs::create_dir_all(&user_dir)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;

            let file_id = uuid::Uuid::new_v4();
            let storage_path = format!("{}/{}_{}", user_dir, file_id, filename);
            let size_bytes = file_data.len() as i64;

            tokio::fs::write(&storage_path, &file_data)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("write error: {e}")))?;

            sqlx::query(
                "INSERT INTO files (id, user_id, filename, mime_type, size_bytes, storage_path) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(file_id)
            .bind(&user.id)
            .bind(&filename)
            .bind(&mime_type)
            .bind(size_bytes)
            .bind(&storage_path)
            .execute(&state.db)
            .await?;
        }
        _ => {
            return Err(AppError::BadRequest(format!("unknown service: {service}")));
        }
    }

    tracing::info!(
        user_id = %user.id,
        filename = %filename,
        service = %service,
        "upload complete"
    );

    Ok(Json(json!({
        "status": "routed",
        "service": service,
        "filename": filename,
    })))
}

/// POST /api/v1/upload/audiobook
///
/// Upload a complete audiobook (all files for one book) to Audiobookshelf
/// via its upload API. Accepts multipart form with metadata fields and
/// all audio/cover files for the book.
///
/// Form fields:
///   - `title` (required): Book title
///   - `author` (optional): Author name
///   - `series` (optional): Series name
///   - Files: numbered keys (0, 1, 2...) with audio/cover files
async fn upload_audiobook(
    State(state): State<AppState>,
    user: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let cred = user
        .credentials
        .audiobookshelf
        .ok_or(AppError::ServiceUnavailable(
            "audiobooks not provisioned".into(),
        ))?;

    let mut title = String::new();
    let mut author: Option<String> = None;
    let mut series: Option<String> = None;
    let mut files: Vec<(String, Vec<u8>, String)> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "title" => {
                title = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
            }
            "author" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                if !text.is_empty() {
                    author = Some(text);
                }
            }
            "series" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                if !text.is_empty() {
                    series = Some(text);
                }
            }
            _ => {
                // File fields — key is an index or any string
                let filename = field.file_name().unwrap_or("audio.mp3").to_string();
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
    if files.is_empty() {
        return Err(AppError::BadRequest("at least one file is required".into()));
    }

    let file_count = files.len();
    let total_bytes: usize = files.iter().map(|(_, data, _)| data.len()).sum();

    tracing::info!(
        user_id = %user.id,
        title = %title,
        author = ?author,
        series = ?series,
        file_count,
        total_bytes,
        "audiobook upload started"
    );

    let abs_client =
        AudiobookshelfClient::new(&state.config.audiobookshelf_url, state.http.clone());

    // Get the book library ID and folder ID using admin token
    let (library_id, folder_id) = abs_client
        .get_book_library_info(&state.config.audiobookshelf_admin_token)
        .await?;

    // Upload via the ABS API using the user's token
    abs_client
        .upload_book(
            &cred.api_key,
            &library_id,
            &folder_id,
            &title,
            author.as_deref(),
            series.as_deref(),
            files,
        )
        .await?;

    tracing::info!(
        user_id = %user.id,
        title = %title,
        file_count,
        "audiobook upload complete"
    );

    Ok(Json(json!({
        "status": "uploaded",
        "service": "audiobooks",
        "title": title,
        "fileCount": file_count,
    })))
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
async fn upload_media(
    State(state): State<AppState>,
    user: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let _cred = user
        .credentials
        .jellyfin
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

/// POST /api/v1/upload/reading
///
/// Upload reading files with structured folder paths for Kavita.
/// Creates the correct folder structure (Series Name/) before writing files.
///
/// Form fields:
///   - `series_name` (required): Series/collection name
///   - Files: numbered keys (0, 1, 2...) with the actual files
async fn upload_reading(
    State(state): State<AppState>,
    user: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let cred = user.credentials.kavita.ok_or(AppError::ServiceUnavailable(
        "reading not provisioned".into(),
    ))?;

    let mut series_name = String::new();
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "series_name" => {
                series_name = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
            }
            _ => {
                let filename = field.file_name().unwrap_or("file").to_string();
                let data = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                files.push((filename, data.to_vec()));
            }
        }
    }

    if series_name.is_empty() {
        return Err(AppError::BadRequest("series_name is required".into()));
    }
    if files.is_empty() {
        return Err(AppError::BadRequest("at least one file is required".into()));
    }

    let file_count = files.len();
    let total_bytes: usize = files.iter().map(|(_, data)| data.len()).sum();

    tracing::info!(
        user_id = %user.id,
        series_name = %series_name,
        file_count,
        total_bytes,
        "reading upload started"
    );

    let series_dir = format!(
        "{}/{}/{}",
        state.config.reading_storage_path, user.id, series_name
    );
    tokio::fs::create_dir_all(&series_dir)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;

    for (filename, data) in &files {
        let file_path = format!("{}/{}", series_dir, filename);
        tokio::fs::write(&file_path, data)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("write error: {e}")))?;
    }

    // Trigger Kavita library scan
    let kavita_client =
        crate::services::KavitaClient::new(&state.config.kavita_url, state.http.clone());
    let _ = kavita_client.scan_all_libraries(&cred.api_key).await;

    tracing::info!(
        user_id = %user.id,
        series_name = %series_name,
        file_count,
        "reading upload complete"
    );

    Ok(Json(json!({
        "status": "uploaded",
        "service": "reading",
        "seriesName": series_name,
        "fileCount": file_count,
    })))
}
