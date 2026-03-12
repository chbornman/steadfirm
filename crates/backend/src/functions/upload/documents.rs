//! Paperless upload — documents service.

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::services::PaperlessClient;
use crate::AppState;

pub async fn upload_to_documents(
    state: &AppState,
    user: &AuthUser,
    filename: &str,
    file_data: &[u8],
    mime_type: &str,
) -> Result<(), AppError> {
    let cred = user
        .credentials
        .paperless
        .as_ref()
        .ok_or(AppError::ServiceUnavailable(
            "documents not provisioned".into(),
        ))?;
    let client = PaperlessClient::new(&state.config.paperless_url, state.http.clone());

    let title = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename)
        .to_string();

    let part = reqwest::multipart::Part::bytes(file_data.to_vec())
        .file_name(filename.to_string())
        .mime_str(mime_type)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("mime error: {e}")))?;

    let form = reqwest::multipart::Form::new()
        .part("document", part)
        .text("title", title);

    client.upload_document(&cred.api_key, form).await?;

    Ok(())
}
