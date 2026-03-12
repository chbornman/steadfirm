//! Steadfirm files catchall — unclassified file storage.

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::AppState;

pub async fn upload_to_files(
    state: &AppState,
    user: &AuthUser,
    filename: &str,
    file_data: &[u8],
    mime_type: &str,
) -> Result<(), AppError> {
    // Save to local Steadfirm storage.
    let user_dir = format!("{}/{}", state.config.files_storage_path, user.id);
    tokio::fs::create_dir_all(&user_dir)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;

    let file_id = uuid::Uuid::new_v4();
    let storage_path = format!("{}/{}_{}", user_dir, file_id, filename);
    let size_bytes = file_data.len() as i64;

    tokio::fs::write(&storage_path, file_data)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("write error: {e}")))?;

    sqlx::query(
        "INSERT INTO files (id, user_id, filename, mime_type, size_bytes, storage_path) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(file_id)
    .bind(&user.id)
    .bind(filename)
    .bind(mime_type)
    .bind(size_bytes)
    .bind(&storage_path)
    .execute(&state.db)
    .await?;

    Ok(())
}
