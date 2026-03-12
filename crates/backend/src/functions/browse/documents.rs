//! Documents browse — Paperless-ngx proxy.

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, Query, State},
    response::Response,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::RwLock;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::models::{Document, DocumentTag};
use crate::pagination::{PaginatedResponse, PaginationParams};
use crate::proxy::proxy_binary;
use crate::services::PaperlessClient;
use crate::AppState;

/// In-memory name resolution cache for Paperless correspondents and tags.
/// Keyed by user_id. Refreshed on cache miss or TTL expiry.
#[derive(Default, Clone)]
pub struct NameCache {
    pub correspondents: HashMap<u64, String>,
    pub tags: HashMap<u64, TagInfo>,
    pub fetched_at: Option<std::time::Instant>,
}

#[derive(Clone)]
pub struct TagInfo {
    pub name: String,
    #[allow(dead_code)]
    pub color: Option<String>,
}

/// Shared cache state. Stored in a lazy_static or passed through State.
/// For simplicity, we use a module-level static.
static NAME_CACHE: std::sync::LazyLock<Arc<RwLock<HashMap<String, NameCache>>>> =
    std::sync::LazyLock::new(|| Arc::new(RwLock::new(HashMap::new())));

const CACHE_TTL_SECS: u64 = crate::constants::PAPERLESS_NAME_CACHE_TTL_SECS;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_documents))
        .route("/tags", get(list_tags))
        .route("/{id}", get(get_document))
        .route("/{id}/thumbnail", get(get_thumbnail))
        .route("/{id}/preview", get(get_preview))
        .route("/{id}/download", get(download))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocListParams {
    #[serde(flatten)]
    pagination: PaginationParams,
    #[serde(default)]
    sort: Option<String>,
    #[serde(default)]
    order: Option<String>,
    #[serde(default)]
    tags: Option<String>,
    #[serde(default)]
    query: Option<String>,
}

fn paperless_client(state: &AppState) -> PaperlessClient {
    PaperlessClient::new(&state.config.paperless_url, state.http.clone())
}

fn map_doc_sort(sort: Option<&str>, order: Option<&str>) -> String {
    let field = match sort {
        Some("dateAdded") => "added",
        Some("dateCreated") => "created",
        Some("title") => "title",
        Some("correspondent") => "correspondent__name",
        _ => "added",
    };
    let prefix = match order {
        Some("asc") => "",
        _ => "-", // desc by default
    };
    format!("{prefix}{field}")
}

async fn list_documents(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<DocListParams>,
) -> Result<Json<PaginatedResponse<Document>>, AppError> {
    let cred = user
        .credentials
        .paperless
        .ok_or(AppError::ServiceUnavailable(
            "documents not provisioned".into(),
        ))?;

    let client = paperless_client(&state);
    let ordering = map_doc_sort(params.sort.as_deref(), params.order.as_deref());

    let mut query_params: Vec<(&str, String)> = vec![
        ("page", params.pagination.page.to_string()),
        ("page_size", params.pagination.page_size.to_string()),
        ("ordering", ordering),
    ];

    if let Some(ref tags) = params.tags {
        query_params.push(("tags__id__all", tags.clone()));
    }
    if let Some(ref q) = params.query {
        query_params.push(("query", q.clone()));
    }

    let resp = client.list_documents(&cred.api_key, &query_params).await?;
    let total = resp["count"].as_u64().unwrap_or(0);

    // Ensure name cache is populated.
    ensure_name_cache(&client, &cred.api_key, &user.id).await?;

    let items = resp["results"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|doc| paperless_to_document(doc, &user.id))
        .collect::<Vec<_>>();

    // Resolve names asynchronously.
    let cache = NAME_CACHE.read().await;
    let user_cache = cache.get(&user.id);
    let items: Vec<Document> = items
        .into_iter()
        .map(|mut doc| {
            if let Some(uc) = user_cache {
                resolve_names(&mut doc, uc);
            }
            doc
        })
        .collect();
    drop(cache);

    let next_page = if resp["next"].is_null() {
        None
    } else {
        Some(params.pagination.page + 1)
    };

    Ok(Json(PaginatedResponse {
        items,
        total,
        page: params.pagination.page,
        page_size: params.pagination.page_size,
        next_page,
    }))
}

async fn get_document(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Document>, AppError> {
    let cred = user
        .credentials
        .paperless
        .ok_or(AppError::ServiceUnavailable(
            "documents not provisioned".into(),
        ))?;

    let client = paperless_client(&state);
    let doc = client.get_document(&cred.api_key, &id).await?;

    ensure_name_cache(&client, &cred.api_key, &user.id).await?;

    let mut document = paperless_to_document(&doc, &user.id);

    let cache = NAME_CACHE.read().await;
    if let Some(uc) = cache.get(&user.id) {
        resolve_names(&mut document, uc);
    }

    Ok(Json(document))
}

async fn get_thumbnail(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let cred = user
        .credentials
        .paperless
        .ok_or(AppError::ServiceUnavailable(
            "documents not provisioned".into(),
        ))?;
    let client = paperless_client(&state);
    let resp = client.get_thumbnail(&cred.api_key, &id).await?;
    proxy_binary(resp)
}

async fn get_preview(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let cred = user
        .credentials
        .paperless
        .ok_or(AppError::ServiceUnavailable(
            "documents not provisioned".into(),
        ))?;
    let client = paperless_client(&state);
    let resp = client.get_preview(&cred.api_key, &id).await?;
    proxy_binary(resp)
}

async fn download(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let cred = user
        .credentials
        .paperless
        .ok_or(AppError::ServiceUnavailable(
            "documents not provisioned".into(),
        ))?;
    let client = paperless_client(&state);
    let resp = client.download(&cred.api_key, &id).await?;
    proxy_binary(resp)
}

async fn list_tags(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<DocumentTag>>, AppError> {
    let cred = user
        .credentials
        .paperless
        .ok_or(AppError::ServiceUnavailable(
            "documents not provisioned".into(),
        ))?;

    let client = paperless_client(&state);
    let resp = client.list_tags(&cred.api_key).await?;

    let tags = resp["results"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|t| DocumentTag {
            id: t["id"].as_u64().unwrap_or(0).to_string(),
            name: t["name"].as_str().unwrap_or("").to_string(),
            color: t["color"].as_str().map(|s| s.to_string()),
        })
        .collect();

    Ok(Json(tags))
}

// --- Helpers ---

/// Build a Document from Paperless JSON. Names are placeholders (IDs as strings)
/// until resolve_names is called.
fn paperless_to_document(doc: &Value, _user_id: &str) -> Document {
    let id = doc["id"].as_u64().unwrap_or(0).to_string();

    // Store correspondent ID temporarily in the field; resolve_names will replace it.
    let correspondent_id = doc["correspondent"].as_u64();
    let tag_ids: Vec<u64> = doc["tags"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|v| v.as_u64())
        .collect();

    // Paperless sets archived_file_name when it has a PDF archive version.
    let has_archive_version = doc["archived_file_name"].as_str().is_some();

    Document {
        thumbnail_url: format!("/api/v1/documents/{id}/thumbnail"),
        preview_url: format!("/api/v1/documents/{id}/preview"),
        download_url: format!("/api/v1/documents/{id}/download"),
        id,
        title: doc["title"].as_str().unwrap_or("").to_string(),
        // Store ID as string temporarily; resolve_names replaces.
        correspondent: correspondent_id.map(|id| format!("__corr_id:{id}")),
        tags: tag_ids.iter().map(|id| format!("__tag_id:{id}")).collect(),
        date_created: doc["created"].as_str().map(|s| s.to_string()),
        date_added: doc["added"].as_str().map(|s| s.to_string()),
        page_count: doc["page_count"].as_u64().map(|v| v as u32),
        mime_type: doc["mime_type"].as_str().map(|s| s.to_string()),
        original_file_name: doc["original_file_name"].as_str().map(|s| s.to_string()),
        has_archive_version,
    }
}

/// Replace ID placeholders with actual names from the cache.
fn resolve_names(doc: &mut Document, cache: &NameCache) {
    // Resolve correspondent.
    if let Some(ref corr) = doc.correspondent {
        if let Some(id_str) = corr.strip_prefix("__corr_id:") {
            if let Ok(id) = id_str.parse::<u64>() {
                doc.correspondent = cache.correspondents.get(&id).cloned();
            }
        }
    }

    // Resolve tags.
    doc.tags = doc
        .tags
        .iter()
        .filter_map(|tag| {
            if let Some(id_str) = tag.strip_prefix("__tag_id:") {
                if let Ok(id) = id_str.parse::<u64>() {
                    return cache.tags.get(&id).map(|t| t.name.clone());
                }
            }
            Some(tag.clone())
        })
        .collect();
}

/// Ensure the name resolution cache is populated for this user.
async fn ensure_name_cache(
    client: &PaperlessClient,
    token: &str,
    user_id: &str,
) -> Result<(), AppError> {
    let should_refresh = {
        let cache = NAME_CACHE.read().await;
        match cache.get(user_id) {
            Some(uc) => match uc.fetched_at {
                Some(t) => t.elapsed().as_secs() > CACHE_TTL_SECS,
                None => true,
            },
            None => true,
        }
    };

    if should_refresh {
        let correspondents_resp = client.list_correspondents(token).await?;
        let tags_resp = client.list_tags(token).await?;

        let mut correspondents = HashMap::new();
        if let Some(results) = correspondents_resp["results"].as_array() {
            for c in results {
                if let (Some(id), Some(name)) = (c["id"].as_u64(), c["name"].as_str()) {
                    correspondents.insert(id, name.to_string());
                }
            }
        }

        let mut tags = HashMap::new();
        if let Some(results) = tags_resp["results"].as_array() {
            for t in results {
                if let (Some(id), Some(name)) = (t["id"].as_u64(), t["name"].as_str()) {
                    tags.insert(
                        id,
                        TagInfo {
                            name: name.to_string(),
                            color: t["color"].as_str().map(|s| s.to_string()),
                        },
                    );
                }
            }
        }

        let mut cache = NAME_CACHE.write().await;
        cache.insert(
            user_id.to_string(),
            NameCache {
                correspondents,
                tags,
                fetched_at: Some(std::time::Instant::now()),
            },
        );
    }

    Ok(())
}
