//! Upload feature — routes and per-service upload logic.
//!
//! Extracts the upload functionality from the former `routes/dropzone.rs`
//! into per-service modules with a shared multipart parser.

pub mod audiobooks;
pub mod documents;
pub mod files;
pub mod media;
pub mod photos;
pub mod reading;

use axum::{
    extract::{Multipart, State},
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::AppState;

/// Parsed fields from a single-file multipart upload.
pub struct ParsedUpload {
    pub file_data: Vec<u8>,
    pub filename: String,
    pub service: String,
    pub mime_type: String,
    pub relative_path: Option<String>,
}

/// Parse a single-file multipart upload with common fields:
/// `file`, `filename`, `service`, `relative_path`.
pub async fn parse_single_file_upload(mut multipart: Multipart) -> Result<ParsedUpload, AppError> {
    let mut file_data: Option<Vec<u8>> = None;
    let mut filename = String::new();
    let mut service = String::new();
    let mut relative_path: Option<String> = None;

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

    let mime_type = mime_guess::from_path(&filename)
        .first_or_octet_stream()
        .to_string();

    Ok(ParsedUpload {
        file_data,
        filename,
        service,
        mime_type,
        relative_path,
    })
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(upload_file))
        .route("/audiobook", post(audiobooks::upload_audiobook))
        .route("/media", post(media::upload_media))
        .route("/reading", post(reading::upload_reading))
}

async fn upload_file(
    State(state): State<AppState>,
    user: AuthUser,
    multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let parsed = parse_single_file_upload(multipart).await?;

    let size_bytes = parsed.file_data.len();

    tracing::info!(
        user_id = %user.id,
        filename = %parsed.filename,
        service = %parsed.service,
        mime_type = %parsed.mime_type,
        size_bytes = size_bytes,
        relative_path = ?parsed.relative_path,
        "upload started"
    );

    match parsed.service.as_str() {
        "photos" => {
            photos::upload_to_photos(
                &state,
                &user,
                &parsed.filename,
                &parsed.file_data,
                &parsed.mime_type,
            )
            .await?;
        }
        "documents" => {
            documents::upload_to_documents(
                &state,
                &user,
                &parsed.filename,
                &parsed.file_data,
                &parsed.mime_type,
            )
            .await?;
        }
        "media" => {
            media::upload_to_media(
                &state,
                &user,
                &parsed.filename,
                &parsed.file_data,
                &parsed.mime_type,
            )
            .await?;
        }
        "audiobooks" => {
            audiobooks::upload_to_audiobooks(
                &state,
                &user,
                &parsed.filename,
                &parsed.file_data,
                &parsed.mime_type,
                parsed.relative_path.as_deref(),
            )
            .await?;
        }
        "reading" => {
            reading::upload_to_reading(
                &state,
                &user,
                &parsed.filename,
                &parsed.file_data,
                &parsed.mime_type,
                parsed.relative_path.as_deref(),
            )
            .await?;
        }
        "files" => {
            files::upload_to_files(
                &state,
                &user,
                &parsed.filename,
                &parsed.file_data,
                &parsed.mime_type,
            )
            .await?;
        }
        _ => {
            return Err(AppError::BadRequest(format!(
                "unknown service: {}",
                parsed.service
            )));
        }
    }

    tracing::info!(
        user_id = %user.id,
        filename = %parsed.filename,
        service = %parsed.service,
        "upload complete"
    );

    Ok(Json(json!({
        "status": "routed",
        "service": parsed.service,
        "filename": parsed.filename,
    })))
}
