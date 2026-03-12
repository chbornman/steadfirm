//! Kavita upload — reading service.
//!
//! Two entry points:
//! - `upload_to_reading`: simple single-file upload (dispatched from `upload_file`)
//! - `upload_reading`: structured multi-file reading upload with series folder structure

use axum::{
    extract::{Multipart, State},
    Json,
};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::services::KavitaClient;
use crate::AppState;

/// Simple single-file reading upload — writes to storage and triggers Kavita scan.
pub async fn upload_to_reading(
    state: &AppState,
    user: &AuthUser,
    filename: &str,
    file_data: &[u8],
    _mime_type: &str,
    relative_path: Option<&str>,
) -> Result<(), AppError> {
    let cred = user
        .credentials
        .kavita
        .as_ref()
        .ok_or(AppError::ServiceUnavailable(
            "reading not provisioned".into(),
        ))?;

    // Save to Kavita library folder, preserving folder structure.
    let abs_dir = if let Some(rel) = relative_path {
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
    tokio::fs::write(&file_path, file_data)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("write error: {e}")))?;

    // Trigger Kavita library scan so it picks up the new file.
    let kavita_client = KavitaClient::new(&state.config.kavita_url, state.http.clone());
    let _ = kavita_client.scan_all_libraries(&cred.api_key).await;

    Ok(())
}

/// POST /api/v1/upload/reading
///
/// Upload reading files with structured folder paths for Kavita.
/// Creates the correct folder structure (Series Name/) before writing files.
///
/// Form fields:
///   - `series_name` (required): Series/collection name
///   - Files: numbered keys (0, 1, 2...) with the actual files
pub async fn upload_reading(
    State(state): State<AppState>,
    user: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let cred = user
        .credentials
        .kavita
        .as_ref()
        .ok_or(AppError::ServiceUnavailable(
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
    let kavita_client = KavitaClient::new(&state.config.kavita_url, state.http.clone());
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
