//! Audiobookshelf upload — audiobooks service.
//!
//! Two entry points:
//! - `upload_to_audiobooks`: simple single-file upload (dispatched from `upload_file`)
//! - `upload_audiobook`: structured multi-file audiobook upload via ABS API

use axum::{
    extract::{Multipart, State},
    Json,
};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::services::AudiobookshelfClient;
use crate::AppState;

/// Simple single-file audiobook upload — writes to storage and triggers library scan.
pub async fn upload_to_audiobooks(
    state: &AppState,
    user: &AuthUser,
    filename: &str,
    file_data: &[u8],
    _mime_type: &str,
    relative_path: Option<&str>,
) -> Result<(), AppError> {
    let _cred = user
        .credentials
        .audiobookshelf
        .as_ref()
        .ok_or(AppError::ServiceUnavailable(
            "audiobooks not provisioned".into(),
        ))?;

    // Use relative_path to preserve folder structure (Author/Title/)
    // for Audiobookshelf. Falls back to flat upload if no path.
    let abs_dir = if let Some(rel) = relative_path {
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
    tokio::fs::write(&file_path, file_data)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("write error: {e}")))?;

    // Trigger Audiobookshelf library scan so it picks up the new file.
    let abs_client =
        AudiobookshelfClient::new(&state.config.audiobookshelf_url, state.http.clone());
    if let Ok((library_id, _)) = abs_client
        .get_book_library_info(&state.config.audiobookshelf_admin_token)
        .await
    {
        let _ = abs_client
            .scan_library(&state.config.audiobookshelf_admin_token, &library_id)
            .await;
    }

    Ok(())
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
pub async fn upload_audiobook(
    State(state): State<AppState>,
    user: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let cred = user
        .credentials
        .audiobookshelf
        .as_ref()
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
