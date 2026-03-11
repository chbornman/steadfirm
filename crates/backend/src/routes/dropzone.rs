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
    Router::new().route("/", post(upload_file))
}

async fn upload_file(
    State(state): State<AppState>,
    user: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let mut file_data: Option<Vec<u8>> = None;
    let mut filename = String::new();
    let mut service = String::new();

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
            let media_dir = format!("/data/steadfirm/media/{}/Movies", user.id);
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

            let abs_dir = format!("/data/steadfirm/audiobooks/{}", user.id);
            tokio::fs::create_dir_all(&abs_dir)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;

            let file_path = format!("{}/{}", abs_dir, filename);
            tokio::fs::write(&file_path, &file_data)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("write error: {e}")))?;

            // TODO: Trigger ABS library scan.
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

    Ok(Json(json!({
        "status": "routed",
        "service": service,
        "filename": filename,
    })))
}
