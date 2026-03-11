use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::Response,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::models::UserFile;
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_files))
        .route("/{id}", get(get_file))
        .route("/{id}", delete(delete_file))
        .route("/{id}/download", get(download_file))
        .route("/{id}/reclassify", post(reclassify_file))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileListParams {
    #[serde(flatten)]
    pagination: PaginationParams,
    #[serde(default)]
    sort: Option<String>,
    #[serde(default)]
    order: Option<String>,
}

async fn list_files(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<FileListParams>,
) -> Result<Json<PaginatedResponse<UserFile>>, AppError> {
    let sort_col = match params.sort.as_deref() {
        Some("name") | Some("filename") => "filename",
        Some("size") => "size_bytes",
        Some("type") => "mime_type",
        _ => "created_at",
    };
    let order = match params.order.as_deref() {
        Some("asc") => "ASC",
        _ => "DESC",
    };

    let offset = ((params.pagination.page.saturating_sub(1)) * params.pagination.page_size) as i64;
    let limit = params.pagination.page_size as i64;

    // Dynamic ORDER BY requires building the query string.
    let query = format!(
        "SELECT id, filename, mime_type, size_bytes, storage_path, created_at \
         FROM files WHERE user_id = $1 ORDER BY {sort_col} {order} LIMIT $2 OFFSET $3"
    );

    let rows = sqlx::query_as::<_, FileRow>(&query)
        .bind(&user.id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await?;

    let count_row = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM files WHERE user_id = $1")
        .bind(&user.id)
        .fetch_one(&state.db)
        .await?;

    let total = count_row as u64;
    let items = rows.into_iter().map(file_row_to_user_file).collect();

    Ok(Json(PaginatedResponse::new(
        items,
        total,
        params.pagination.page,
        params.pagination.page_size,
    )))
}

async fn get_file(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<UserFile>, AppError> {
    let id =
        uuid::Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("invalid file id".into()))?;

    let row = sqlx::query_as::<_, FileRow>(
        "SELECT id, filename, mime_type, size_bytes, storage_path, created_at \
         FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("file not found".into()))?;

    Ok(Json(file_row_to_user_file(row)))
}

async fn download_file(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let id =
        uuid::Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("invalid file id".into()))?;

    let row = sqlx::query_as::<_, FileRow>(
        "SELECT id, filename, mime_type, size_bytes, storage_path, created_at \
         FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("file not found".into()))?;

    let file = tokio::fs::File::open(&row.storage_path)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("failed to open file: {e}")))?;

    let stream = tokio_util::io::ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let content_type = mime_guess::from_path(&row.filename)
        .first_or_octet_stream()
        .to_string();

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", content_type)
        .header(
            "content-disposition",
            format!("attachment; filename=\"{}\"", row.filename),
        )
        .body(body)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("failed to build response: {e}")))
}

async fn delete_file(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let id =
        uuid::Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("invalid file id".into()))?;

    let row = sqlx::query_as::<_, FileRow>(
        "SELECT id, filename, mime_type, size_bytes, storage_path, created_at \
         FROM files WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("file not found".into()))?;

    // Delete from disk.
    let _ = tokio::fs::remove_file(&row.storage_path).await;

    // Delete from DB.
    sqlx::query("DELETE FROM files WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(&user.id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn reclassify_file(
    State(_state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let _id =
        uuid::Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("invalid file id".into()))?;
    let service = body["service"]
        .as_str()
        .ok_or(AppError::BadRequest("service is required".into()))?;

    // TODO: Read file from disk, upload to target service, delete from files table.
    // This requires the full upload-to-service logic from the drop zone.
    // For now, return a placeholder.
    tracing::info!(
        user_id = %user.id,
        file_id = %id,
        target_service = %service,
        "reclassify requested (not yet implemented)"
    );

    Ok(Json(json!({
        "service": service,
        "status": "routed"
    })))
}

// --- DB row types ---

#[derive(sqlx::FromRow)]
struct FileRow {
    id: uuid::Uuid,
    filename: String,
    mime_type: String,
    size_bytes: i64,
    storage_path: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

fn file_row_to_user_file(row: FileRow) -> UserFile {
    let id = row.id.to_string();
    UserFile {
        download_url: format!("/api/v1/files/{id}/download"),
        id,
        filename: row.filename,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        created_at: row.created_at.to_rfc3339(),
    }
}
