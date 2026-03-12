//! Search files in Steadfirm's own storage (Postgres ILIKE).

use crate::auth::AuthUser;
use crate::AppState;
use steadfirm_shared::search::{SearchResultItem, ServiceSearchResult};
use steadfirm_shared::ServiceKind;

use super::helpers::format_file_size;

#[derive(sqlx::FromRow)]
struct FileSearchRow {
    id: uuid::Uuid,
    filename: String,
    #[allow(dead_code)]
    mime_type: String,
    size_bytes: i64,
    #[allow(dead_code)]
    created_at: chrono::DateTime<chrono::Utc>,
}

/// Search files in Steadfirm's own storage (Postgres ILIKE).
pub async fn search_files(
    state: &AppState,
    user: &AuthUser,
    query: &str,
    limit: u32,
) -> Result<ServiceSearchResult, String> {
    let pattern = format!("%{query}%");
    let limit_i64 = limit as i64;

    let rows = sqlx::query_as::<_, FileSearchRow>(
        "SELECT id, filename, mime_type, size_bytes, created_at \
         FROM files WHERE user_id = $1 AND filename ILIKE $2 \
         ORDER BY created_at DESC LIMIT $3",
    )
    .bind(&user.id)
    .bind(&pattern)
    .bind(limit_i64)
    .fetch_all(&state.db)
    .await
    .map_err(|e| format!("database error: {e}"))?;

    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM files WHERE user_id = $1 AND filename ILIKE $2",
    )
    .bind(&user.id)
    .bind(&pattern)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let items = rows
        .into_iter()
        .map(|row| {
            let id = row.id.to_string();
            SearchResultItem {
                id,
                title: row.filename.clone(),
                subtitle: Some(format_file_size(row.size_bytes)),
                image_url: None,
                route: "/files".to_string(),
            }
        })
        .collect();

    Ok(ServiceSearchResult {
        service: ServiceKind::Files,
        items,
        total: count as u32,
    })
}
