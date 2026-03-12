//! Types for the global search pipeline.
//!
//! The frontend sends a [`SearchRequest`] to `POST /api/v1/search`,
//! which returns an SSE stream of [`ServiceSearchResult`] events as
//! results arrive from each backing service.

use serde::{Deserialize, Serialize};

use crate::ServiceKind;

// ─── Request ─────────────────────────────────────────────────────────

/// A global search query.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    /// The user's search query (natural language or literal).
    pub query: String,

    /// Restrict search to specific services. `None` searches all services
    /// the user has provisioned.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub services: Option<Vec<ServiceKind>>,

    /// Maximum results per service. Falls back to the server default
    /// if not specified.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

// ─── Response (SSE events) ───────────────────────────────────────────

/// Results from a single service, sent as one SSE event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSearchResult {
    /// Which service produced these results.
    pub service: ServiceKind,

    /// The matched items.
    pub items: Vec<SearchResultItem>,

    /// Total number of matches in this service (may exceed `items.len()`
    /// if the result was truncated by the per-service limit).
    pub total: u32,
}

/// A single search result, normalized across all services.
///
/// Flat structure with common display fields so the frontend can render
/// a unified result list without knowing service-specific schemas.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultItem {
    /// The item's ID in its backing service.
    pub id: String,

    /// Display title (filename for photos/files, title for everything else).
    pub title: String,

    /// Secondary line — author, year, correspondent, MIME type, etc.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,

    /// Thumbnail or cover image URL (relative Steadfirm path).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,

    /// The route path to navigate to this item in the Steadfirm UI
    /// (e.g. `/photos`, `/media/movies`, `/reading/42`).
    pub route: String,
}

// ─── SSE completion event ────────────────────────────────────────────

/// Sent as the final SSE event when all services have responded.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchComplete {
    /// Total results across all services.
    pub total_results: u32,

    /// Total time in milliseconds from request to completion.
    pub duration_ms: u64,

    /// Which services were queried.
    pub services_queried: Vec<ServiceKind>,

    /// Services that failed (if any). Items still arrived from the
    /// services that succeeded.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub services_failed: Vec<ServiceSearchError>,
}

/// Error info for a service that failed during search.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSearchError {
    /// Which service failed.
    pub service: ServiceKind,

    /// Human-readable error message.
    pub error: String,
}

// ─── LLM query compiler output ──────────────────────────────────────
// The LLM decomposes a natural language query into per-service
// structured queries. These types define the JSON the LLM returns.

/// The structured output from the LLM query compiler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompiledSearch {
    /// Per-service queries to execute. Services not listed should be
    /// skipped (the LLM determined they're irrelevant).
    pub queries: Vec<ServiceQuery>,
}

/// A query targeting a single service, as produced by the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceQuery {
    /// Which service to search.
    pub service: ServiceKind,

    /// The search text to send to the service's search API.
    /// May be the original query verbatim, a rewritten/expanded version,
    /// or `None` if only filters apply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,

    /// Optional structured filters the service supports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<SearchFilters>,
}

/// Structured filters that can be applied to service search APIs.
///
/// All fields are optional — the LLM populates only the ones
/// relevant to the user's intent. Each service maps these to its
/// own API parameters.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilters {
    /// ISO 8601 date — only return items after this date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_after: Option<String>,

    /// ISO 8601 date — only return items before this date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_before: Option<String>,

    /// Filter by favorites/starred status.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_favorite: Option<bool>,

    /// Media type filter (e.g. `"image"`, `"video"`, `"Movie"`,
    /// `"Series"`, `"Audio"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,

    /// Genre filter (Jellyfin, Kavita).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,

    /// Tag name filter (Paperless).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,

    /// Progress filter — items with progress below this threshold
    /// (0.0–1.0). Useful for "unread" / "unfinished" queries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_below: Option<f32>,

    /// Progress filter — items with progress above this threshold.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_above: Option<f32>,
}
