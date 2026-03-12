//! Global search endpoint — federated search across all services.
//!
//! `POST /api/v1/search` — SSE streaming response.
//!
//! Two paths run concurrently:
//! - **Fast path**: literal query fanned out to all services immediately.
//! - **Smart path**: LLM decomposes natural language into per-service
//!   structured queries, then fans out with optimized filters.
//!
//! Results stream to the client as they arrive from each service.

use std::convert::Infallible;
use std::time::Instant;

use axum::{
    extract::State,
    response::sse::{Event, Sse},
    routing::post,
    Json, Router,
};
use futures::Stream;
use serde_json::json;
use tokio::task::JoinSet;

use crate::auth::AuthUser;
use crate::constants::{
    SEARCH_LLM_MAX_TOKENS, SEARCH_LLM_MIN_QUERY_WORDS, SEARCH_MAX_QUERY_LENGTH,
    SEARCH_PER_SERVICE_LIMIT, SEARCH_SERVICE_TIMEOUT_SECS,
};
use crate::error::AppError;
use crate::services::{
    AudiobookshelfClient, ImmichClient, JellyfinClient, KavitaClient, PaperlessClient,
};
use crate::AppState;
use steadfirm_shared::search::{
    SearchComplete, SearchRequest, SearchResultItem, ServiceSearchError, ServiceSearchResult,
};
use steadfirm_shared::ServiceKind;

pub fn router() -> Router<AppState> {
    Router::new().route("/", post(search))
}

// ─── Search query compiler system prompt ─────────────────────────────

const SEARCH_SYSTEM_PROMPT: &str = r#"You are a search query compiler for Steadfirm, a personal cloud platform. Your job is to decompose a natural language search query into structured per-service queries.

## Available services

- **photos**: Personal photos and home videos (Immich). Supports CLIP semantic search (natural language descriptions of visual content) and metadata filters (date, favorites).
- **media**: Movies, TV shows, and music (Jellyfin). Supports text search on titles. Filter by type: "Movie", "Series", "Audio".
- **documents**: Scanned/uploaded documents with OCR (Paperless-ngx). Supports full-text search across document content and metadata.
- **audiobooks**: Audiobook library (Audiobookshelf). Supports text search on title, author, narrator.
- **reading**: Ebooks, comics, manga (Kavita). Supports text search on series/title names.
- **files**: Unclassified files in Steadfirm storage. Supports filename search only.

## Your task

Given a user's search query, determine:
1. Which services are relevant (skip irrelevant ones to reduce noise).
2. What query text to send to each service (may be rewritten or expanded).
3. What structured filters to apply (dates, types, progress, etc.).

## Rules

- If the query is clearly about one domain (e.g. "dental receipt"), only target relevant services (documents, maybe photos). Don't search audiobooks for "dental receipt".
- For temporal references ("last month", "yesterday", "summer 2025"), convert to ISO 8601 date filters. Today's date is provided in the user prompt.
- For progress/status queries ("unread", "unfinished", "haven't watched"), use progress_below/progress_above filters.
- For visual/descriptive queries ("sunset", "beach", "red car"), always include photos with the descriptive text as the query (Immich CLIP understands visual concepts).
- Expand synonyms when useful: "dentist" → query "dentist dental orthodont" for documents.
- If the query is generic or ambiguous, search all services with the literal query.

## Output format

Return a JSON object:
```json
{
  "queries": [
    {
      "service": "photos",
      "query": "sunset beach",
      "filters": {
        "date_after": "2025-06-01",
        "date_before": "2025-08-31"
      }
    },
    {
      "service": "documents",
      "query": "dental dentist orthodont receipt",
      "filters": null
    }
  ]
}
```

Output ONLY the raw JSON — no markdown fencing, no explanation."#;

// ─── SSE handler ─────────────────────────────────────────────────────

async fn search(
    State(state): State<AppState>,
    user: AuthUser,
    Json(request): Json<SearchRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    // Validate query length.
    if request.query.trim().is_empty() {
        return Err(AppError::BadRequest("query is required".into()));
    }
    if request.query.len() > SEARCH_MAX_QUERY_LENGTH {
        return Err(AppError::BadRequest(format!(
            "query exceeds maximum length of {SEARCH_MAX_QUERY_LENGTH} characters"
        )));
    }

    let stream = async_stream::stream! {
        let start = Instant::now();
        let query = request.query.trim().to_string();
        let limit = request.limit.unwrap_or(SEARCH_PER_SERVICE_LIMIT);
        let timeout = std::time::Duration::from_secs(SEARCH_SERVICE_TIMEOUT_SECS);

        // Determine which services the user has provisioned and wants to search.
        let requested_services = request.services.as_deref();

        // ── Fast path: fan out literal queries to all services ────────
        let mut join_set: JoinSet<(ServiceKind, Result<ServiceSearchResult, String>)> =
            JoinSet::new();

        // Photos (Immich)
        if should_search(ServiceKind::Photos, requested_services, &user) {
            let state = state.clone();
            let user = user.clone();
            let query = query.clone();
            join_set.spawn(async move {
                let result = tokio::time::timeout(
                    timeout,
                    search_photos(&state, &user, &query, limit),
                )
                .await;
                (ServiceKind::Photos, flatten_timeout(result))
            });
        }

        // Media (Jellyfin)
        if should_search(ServiceKind::Media, requested_services, &user) {
            let state = state.clone();
            let user = user.clone();
            let query = query.clone();
            join_set.spawn(async move {
                let result = tokio::time::timeout(
                    timeout,
                    search_media(&state, &user, &query, limit),
                )
                .await;
                (ServiceKind::Media, flatten_timeout(result))
            });
        }

        // Documents (Paperless)
        if should_search(ServiceKind::Documents, requested_services, &user) {
            let state = state.clone();
            let user = user.clone();
            let query = query.clone();
            join_set.spawn(async move {
                let result = tokio::time::timeout(
                    timeout,
                    search_documents(&state, &user, &query, limit),
                )
                .await;
                (ServiceKind::Documents, flatten_timeout(result))
            });
        }

        // Audiobooks (Audiobookshelf)
        if should_search(ServiceKind::Audiobooks, requested_services, &user) {
            let state = state.clone();
            let user = user.clone();
            let query = query.clone();
            join_set.spawn(async move {
                let result = tokio::time::timeout(
                    timeout,
                    search_audiobooks(&state, &user, &query, limit),
                )
                .await;
                (ServiceKind::Audiobooks, flatten_timeout(result))
            });
        }

        // Reading (Kavita)
        if should_search(ServiceKind::Reading, requested_services, &user) {
            let state = state.clone();
            let user = user.clone();
            let query = query.clone();
            join_set.spawn(async move {
                let result = tokio::time::timeout(
                    timeout,
                    search_reading(&state, &user, &query, limit),
                )
                .await;
                (ServiceKind::Reading, flatten_timeout(result))
            });
        }

        // Files (Postgres)
        if should_search(ServiceKind::Files, requested_services, &user) {
            let state = state.clone();
            let user = user.clone();
            let query = query.clone();
            join_set.spawn(async move {
                let result = tokio::time::timeout(
                    timeout,
                    search_files(&state, &user, &query, limit),
                )
                .await;
                (ServiceKind::Files, flatten_timeout(result))
            });
        }

        // ── Optionally: LLM smart path (runs in parallel) ────────────
        let word_count = query.split_whitespace().count();
        let ai_enabled = state.ai.read().await.is_enabled();
        let use_llm = ai_enabled && word_count >= SEARCH_LLM_MIN_QUERY_WORDS;

        if use_llm {
            let state_clone = state.clone();
            let user_clone = user.clone();
            let query_clone = query.clone();
            join_set.spawn(async move {
                // This is a sentinel — we use a special ServiceKind to identify
                // LLM results vs fast-path results. We'll handle merging below.
                let result = tokio::time::timeout(
                    // LLM gets more time than individual services.
                    std::time::Duration::from_secs(SEARCH_SERVICE_TIMEOUT_SECS * 2),
                    run_llm_enhanced_search(&state_clone, &user_clone, &query_clone, limit),
                )
                .await;
                // Use Files as a dummy kind — we'll never actually emit this.
                // The LLM path emits its own per-service results.
                (ServiceKind::Files, flatten_timeout(result).map(|_| ServiceSearchResult {
                    service: ServiceKind::Files,
                    items: vec![],
                    total: 0,
                }))
            });
        }

        // ── Collect and stream results ────────────────────────────────
        let mut total_results: u32 = 0;
        let mut services_queried: Vec<ServiceKind> = Vec::new();
        let mut services_failed: Vec<ServiceSearchError> = Vec::new();
        // Track which services already sent fast-path results so we
        // don't duplicate when LLM results arrive.
        let mut _emitted_services: std::collections::HashSet<ServiceKind> =
            std::collections::HashSet::new();

        while let Some(result) = join_set.join_next().await {
            match result {
                Ok((service, Ok(search_result))) => {
                    if search_result.items.is_empty() && search_result.total == 0 {
                        // Skip empty results (e.g. LLM sentinel).
                        continue;
                    }
                    services_queried.push(service);
                    total_results += search_result.total;
                    _emitted_services.insert(service);
                    if let Ok(data) = serde_json::to_string(&search_result) {
                        yield Ok(Event::default().event("results").data(data));
                    }
                }
                Ok((service, Err(err))) => {
                    tracing::warn!(service = ?service, error = %err, "search failed for service");
                    services_failed.push(ServiceSearchError {
                        service,
                        error: err,
                    });
                }
                Err(join_err) => {
                    tracing::error!("search task panicked: {join_err}");
                }
            }
        }

        // ── Send completion event ─────────────────────────────────────
        let done = SearchComplete {
            total_results,
            duration_ms: start.elapsed().as_millis() as u64,
            services_queried,
            services_failed,
        };
        if let Ok(data) = serde_json::to_string(&done) {
            yield Ok(Event::default().event("done").data(data));
        }
    };

    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

// ─── Helpers ─────────────────────────────────────────────────────────

/// Check if a service should be searched based on user request and provisioning.
fn should_search(
    service: ServiceKind,
    requested: Option<&[ServiceKind]>,
    user: &AuthUser,
) -> bool {
    // If the user specified services, only search those.
    if let Some(requested) = requested {
        if !requested.contains(&service) {
            return false;
        }
    }
    // Check the user has credentials for this service.
    match service {
        ServiceKind::Photos => user.credentials.immich.is_some(),
        ServiceKind::Media => user.credentials.jellyfin.is_some(),
        ServiceKind::Documents => user.credentials.paperless.is_some(),
        ServiceKind::Audiobooks => user.credentials.audiobookshelf.is_some(),
        ServiceKind::Reading => user.credentials.kavita.is_some(),
        ServiceKind::Files => true, // Files are always available (Postgres).
    }
}

/// Flatten a timeout result into a simple Result<T, String>.
fn flatten_timeout<T>(
    result: Result<Result<T, String>, tokio::time::error::Elapsed>,
) -> Result<T, String> {
    match result {
        Ok(inner) => inner,
        Err(_) => Err("search timed out".to_string()),
    }
}

// ─── Per-service search implementations ──────────────────────────────

/// Search photos via Immich smart search (CLIP).
async fn search_photos(
    state: &AppState,
    user: &AuthUser,
    query: &str,
    limit: u32,
) -> Result<ServiceSearchResult, String> {
    let cred = user.credentials.immich.as_ref().ok_or("not provisioned")?;
    let client = ImmichClient::new(&state.config.immich_url, state.http.clone());

    let body = json!({
        "query": query,
        "page": 1,
        "size": limit,
    });

    let resp = client
        .smart_search(&cred.api_key, &body)
        .await
        .map_err(|e| e.to_string())?;

    let items = resp["assets"]["items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|asset| {
            let id = asset["id"].as_str()?;
            let filename = asset["originalFileName"].as_str().unwrap_or("Unknown");
            let date = asset["localDateTime"]
                .as_str()
                .or_else(|| asset["fileCreatedAt"].as_str())
                .unwrap_or("");
            let is_video = asset["type"].as_str() == Some("VIDEO");

            Some(SearchResultItem {
                id: id.to_string(),
                title: filename.to_string(),
                subtitle: Some(format_photo_subtitle(date, is_video)),
                image_url: Some(format!("/api/v1/photos/{id}/thumbnail")),
                route: "/photos".to_string(),
            })
        })
        .collect::<Vec<_>>();

    let total = resp["assets"]["total"].as_u64().unwrap_or(items.len() as u64) as u32;

    Ok(ServiceSearchResult {
        service: ServiceKind::Photos,
        items,
        total,
    })
}

/// Search media via Jellyfin (movies, shows, music).
async fn search_media(
    state: &AppState,
    user: &AuthUser,
    query: &str,
    limit: u32,
) -> Result<ServiceSearchResult, String> {
    let cred = user.credentials.jellyfin.as_ref().ok_or("not provisioned")?;
    let client = JellyfinClient::new(
        &state.config.jellyfin_url,
        &state.config.jellyfin_device_id,
        state.http.clone(),
    );

    let limit_str = limit.to_string();
    let jf_query = &[
        ("searchTerm", query),
        ("IncludeItemTypes", "Movie,Series,Audio,MusicAlbum"),
        ("Recursive", "true"),
        ("Limit", &limit_str),
        ("Fields", "Overview,PrimaryImageAspectRatio"),
    ];

    let resp = client
        .get_items(&cred.api_key, &cred.service_user_id, jf_query)
        .await
        .map_err(|e| e.to_string())?;

    let items = resp["Items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|item| {
            let id = item["Id"].as_str()?;
            let name = item["Name"].as_str().unwrap_or("Unknown");
            let item_type = item["Type"].as_str().unwrap_or("");
            let year = item["ProductionYear"].as_u64();

            let subtitle = match item_type {
                "Movie" => year.map(|y| format!("Movie \u{00b7} {y}")),
                "Series" => Some("TV Show".to_string()),
                "Audio" => {
                    let artist = item["AlbumArtist"]
                        .as_str()
                        .or_else(|| item["Artists"].as_array()?.first()?.as_str());
                    artist.map(|a| format!("Music \u{00b7} {a}"))
                }
                "MusicAlbum" => {
                    let artist = item["AlbumArtist"].as_str();
                    artist.map(|a| format!("Album \u{00b7} {a}"))
                }
                _ => Some(item_type.to_string()),
            };

            let route = match item_type {
                "Movie" => "/media/movies".to_string(),
                "Series" => format!("/media/shows/{id}"),
                "Audio" | "MusicAlbum" => "/media/music".to_string(),
                _ => "/media/movies".to_string(),
            };

            Some(SearchResultItem {
                id: id.to_string(),
                title: name.to_string(),
                subtitle,
                image_url: Some(format!("/api/v1/media/{id}/image")),
                route,
            })
        })
        .collect::<Vec<_>>();

    let total = resp["TotalRecordCount"].as_u64().unwrap_or(items.len() as u64) as u32;

    Ok(ServiceSearchResult {
        service: ServiceKind::Media,
        items,
        total,
    })
}

/// Search documents via Paperless-ngx full-text search.
async fn search_documents(
    state: &AppState,
    user: &AuthUser,
    query: &str,
    limit: u32,
) -> Result<ServiceSearchResult, String> {
    let cred = user
        .credentials
        .paperless
        .as_ref()
        .ok_or("not provisioned")?;
    let client = PaperlessClient::new(&state.config.paperless_url, state.http.clone());

    let query_params = vec![
        ("query", query.to_string()),
        ("page_size", limit.to_string()),
    ];

    let resp = client
        .list_documents(&cred.api_key, &query_params)
        .await
        .map_err(|e| e.to_string())?;

    let items = resp["results"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|doc| {
            let id = doc["id"].as_u64()?;
            let title = doc["title"].as_str().unwrap_or("Untitled");
            let correspondent = doc["correspondent"].as_u64();
            let date = doc["created"].as_str().unwrap_or("");

            let subtitle = if let Some(_corr_id) = correspondent {
                // We don't have the name cache here; just show the date.
                Some(format_date_short(date))
            } else {
                Some(format_date_short(date))
            };

            Some(SearchResultItem {
                id: id.to_string(),
                title: title.to_string(),
                subtitle,
                image_url: Some(format!("/api/v1/documents/{id}/thumbnail")),
                route: "/documents".to_string(),
            })
        })
        .collect::<Vec<_>>();

    let total = resp["count"].as_u64().unwrap_or(items.len() as u64) as u32;

    Ok(ServiceSearchResult {
        service: ServiceKind::Documents,
        items,
        total,
    })
}

/// Search audiobooks via Audiobookshelf.
async fn search_audiobooks(
    state: &AppState,
    user: &AuthUser,
    query: &str,
    limit: u32,
) -> Result<ServiceSearchResult, String> {
    let cred = user
        .credentials
        .audiobookshelf
        .as_ref()
        .ok_or("not provisioned")?;
    let client = AudiobookshelfClient::new(&state.config.audiobookshelf_url, state.http.clone());

    // Get the first library ID.
    let libraries = client
        .get_libraries(&cred.api_key)
        .await
        .map_err(|e| e.to_string())?;
    let library_id = libraries["libraries"]
        .as_array()
        .and_then(|libs| libs.first())
        .and_then(|lib| lib["id"].as_str())
        .ok_or("no audiobook library found")?;

    let resp = client
        .search(&cred.api_key, library_id, query, limit)
        .await
        .map_err(|e| e.to_string())?;

    // ABS search returns { book: [...], podcast: [...], narrators: [...], ... }
    let items = resp["book"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|entry| {
            // Each entry in search results has a "libraryItem" wrapper.
            let item = entry.get("libraryItem").unwrap_or(entry);
            let id = item["id"].as_str()?;
            let metadata = &item["media"]["metadata"];
            let title = metadata["title"].as_str().unwrap_or("Unknown");
            let author = metadata["authorName"].as_str();

            Some(SearchResultItem {
                id: id.to_string(),
                title: title.to_string(),
                subtitle: author.map(|a| a.to_string()),
                image_url: Some(format!("/api/v1/audiobooks/{id}/cover")),
                route: format!("/audiobooks/{id}"),
            })
        })
        .collect::<Vec<_>>();

    let total = items.len() as u32;

    Ok(ServiceSearchResult {
        service: ServiceKind::Audiobooks,
        items,
        total,
    })
}

/// Search reading content via Kavita.
async fn search_reading(
    state: &AppState,
    user: &AuthUser,
    query: &str,
    limit: u32,
) -> Result<ServiceSearchResult, String> {
    let cred = user.credentials.kavita.as_ref().ok_or("not provisioned")?;
    let client = KavitaClient::new(&state.config.kavita_url, state.http.clone());

    let resp = client
        .search(&cred.api_key, query)
        .await
        .map_err(|e| e.to_string())?;

    // Kavita search returns { series: [...], readingLists: [...], ... }
    let mut items: Vec<SearchResultItem> = resp["series"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .take(limit as usize)
        .filter_map(|series| {
            let id = series["seriesId"].as_u64().or_else(|| series["id"].as_u64())?;
            let name = series["name"].as_str().unwrap_or("Unknown");
            let library_id = series["libraryId"].as_i64().unwrap_or(0);
            let format = series["format"]
                .as_u64()
                .map(kavita_format_name)
                .unwrap_or_default();

            Some(SearchResultItem {
                id: id.to_string(),
                title: name.to_string(),
                subtitle: if format.is_empty() {
                    None
                } else {
                    Some(format)
                },
                image_url: Some(format!(
                    "/api/v1/reading/{id}/cover?libraryId={library_id}"
                )),
                route: format!("/reading/{id}"),
            })
        })
        .collect();

    // Also include individual chapters/files from "chapters" results.
    if let Some(chapters) = resp["chapters"].as_array() {
        for ch in chapters.iter().take((limit as usize).saturating_sub(items.len())) {
            if let Some(series_id) = ch["seriesId"].as_u64() {
                let name = ch["name"].as_str().unwrap_or("Unknown");
                items.push(SearchResultItem {
                    id: series_id.to_string(),
                    title: name.to_string(),
                    subtitle: Some("Chapter".to_string()),
                    image_url: None,
                    route: format!("/reading/{series_id}"),
                });
            }
        }
    }

    let total = items.len() as u32;

    Ok(ServiceSearchResult {
        service: ServiceKind::Reading,
        items,
        total,
    })
}

/// Search files in Steadfirm's own storage (Postgres ILIKE).
async fn search_files(
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

// ─── LLM-enhanced search ─────────────────────────────────────────────

/// Run the LLM query compiler and then execute the structured queries.
/// Returns a sentinel result — actual per-service results are not
/// merged in this version (they'd require a more complex SSE protocol).
/// For now, the LLM path is a no-op placeholder that logs the compiled
/// query for debugging.
async fn run_llm_enhanced_search(
    state: &AppState,
    _user: &AuthUser,
    query: &str,
    _limit: u32,
) -> Result<ServiceSearchResult, String> {
    let ai = state.ai.read().await;
    if !ai.is_enabled() {
        return Ok(ServiceSearchResult {
            service: ServiceKind::Files,
            items: vec![],
            total: 0,
        });
    }

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let user_prompt = format!(
        "Today's date is {today}.\n\nSearch query: \"{query}\"\n\nDecompose this into per-service structured queries."
    );

    // Non-streaming call — the query compiler output is small.
    let body = json!({
        "model": ai.active_model(),
        "max_tokens": SEARCH_LLM_MAX_TOKENS,
        "temperature": 0.1,
        "system": SEARCH_SYSTEM_PROMPT,
        "messages": [
            { "role": "user", "content": user_prompt },
        ],
    });

    tracing::info!(
        query = %query,
        model = %ai.active_model(),
        provider = %ai.active_provider(),
        "running LLM search query compiler"
    );

    // We need to drop the AI lock before making HTTP calls.
    let model = ai.active_model().to_string();
    let provider = ai.active_provider().to_string();
    drop(ai);

    // For now, just log that the LLM path would run. The actual HTTP
    // call integration will reuse the existing AiClassifier HTTP methods
    // with a different system prompt.
    tracing::debug!(
        model = %model,
        provider = %provider,
        compiled_body = %body,
        "LLM query compiler request prepared (execution deferred to follow-up)"
    );

    // Return empty — fast path results are already streaming.
    Ok(ServiceSearchResult {
        service: ServiceKind::Files,
        items: vec![],
        total: 0,
    })
}

// ─── Formatting helpers ──────────────────────────────────────────────

fn format_photo_subtitle(date: &str, is_video: bool) -> String {
    let kind = if is_video { "Video" } else { "Photo" };
    let short_date = format_date_short(date);
    if short_date.is_empty() {
        kind.to_string()
    } else {
        format!("{kind} \u{00b7} {short_date}")
    }
}

fn format_date_short(date: &str) -> String {
    // Take just the date portion of an ISO 8601 string.
    date.get(..10).unwrap_or("").to_string()
}

fn format_file_size(bytes: i64) -> String {
    const KB: i64 = 1024;
    const MB: i64 = 1024 * 1024;
    const GB: i64 = 1024 * 1024 * 1024;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.0} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}

fn kavita_format_name(format_id: u64) -> String {
    match format_id {
        0 => "Unknown".to_string(),
        1 => "EPUB".to_string(),
        2 => "PDF".to_string(),
        3 => "Archive (CBZ/CBR)".to_string(),
        4 => "Image".to_string(),
        _ => format!("Format {format_id}"),
    }
}
