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

mod audiobooks;
mod documents;
mod files;
pub mod helpers;
mod llm;
mod media;
mod photos;
mod reading;

use std::convert::Infallible;
use std::time::Instant;

use axum::{
    extract::State,
    response::sse::{Event, Sse},
    routing::post,
    Json, Router,
};
use futures::Stream;
use tokio::task::JoinSet;

use crate::auth::AuthUser;
use crate::constants::{
    SEARCH_LLM_MIN_QUERY_WORDS, SEARCH_MAX_QUERY_LENGTH, SEARCH_PER_SERVICE_LIMIT,
    SEARCH_SERVICE_TIMEOUT_SECS,
};
use crate::error::AppError;
use crate::AppState;
use steadfirm_shared::search::{
    SearchComplete, SearchRequest, ServiceSearchError, ServiceSearchResult,
};
use steadfirm_shared::ServiceKind;

pub fn router() -> Router<AppState> {
    Router::new().route("/", post(search))
}

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
                    photos::search_photos(&state, &user, &query, limit),
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
                    media::search_media(&state, &user, &query, limit),
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
                    documents::search_documents(&state, &user, &query, limit),
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
                    audiobooks::search_audiobooks(&state, &user, &query, limit),
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
                    reading::search_reading(&state, &user, &query, limit),
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
                    files::search_files(&state, &user, &query, limit),
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
                    llm::run_llm_enhanced_search(&state_clone, &user_clone, &query_clone, limit),
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
fn should_search(service: ServiceKind, requested: Option<&[ServiceKind]>, user: &AuthUser) -> bool {
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
