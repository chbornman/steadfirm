//! LLM-enhanced search — query compiler that decomposes natural language
//! into structured per-service queries.

use serde_json::json;

use crate::constants::SEARCH_LLM_MAX_TOKENS;
use crate::AppState;
use steadfirm_shared::search::ServiceSearchResult;
use steadfirm_shared::ServiceKind;

// ─── Search query compiler system prompt ─────────────────────────────

pub const SEARCH_SYSTEM_PROMPT: &str = r#"You are a search query compiler for Steadfirm, a personal cloud platform. Your job is to decompose a natural language search query into structured per-service queries.

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

// ─── LLM-enhanced search ─────────────────────────────────────────────

/// Run the LLM query compiler and then execute the structured queries.
/// Returns a sentinel result — actual per-service results are not
/// merged in this version (they'd require a more complex SSE protocol).
/// For now, the LLM path is a no-op placeholder that logs the compiled
/// query for debugging.
pub async fn run_llm_enhanced_search(
    state: &AppState,
    _user: &crate::auth::AuthUser,
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
