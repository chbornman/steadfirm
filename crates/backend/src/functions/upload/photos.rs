//! Immich upload — photos service.

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::services::ImmichClient;
use crate::AppState;

pub async fn upload_to_photos(
    state: &AppState,
    user: &AuthUser,
    filename: &str,
    file_data: &[u8],
    mime_type: &str,
) -> Result<(), AppError> {
    let cred = user
        .credentials
        .immich
        .as_ref()
        .ok_or(AppError::ServiceUnavailable(
            "photos not provisioned".into(),
        ))?;
    let client = ImmichClient::new(&state.config.immich_url, state.http.clone());

    let device_asset_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let part = reqwest::multipart::Part::bytes(file_data.to_vec())
        .file_name(filename.to_string())
        .mime_str(mime_type)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("mime error: {e}")))?;

    let form = reqwest::multipart::Form::new()
        .part("assetData", part)
        .text("deviceAssetId", device_asset_id)
        .text("deviceId", "steadfirm")
        .text("fileCreatedAt", now.clone())
        .text("fileModifiedAt", now);

    client.upload_asset(&cred.api_key, form).await?;

    Ok(())
}
