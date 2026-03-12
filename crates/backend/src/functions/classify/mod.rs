//! File classification — determine which service a file belongs to.
//!
//! Uses extension/MIME heuristics for high-confidence files and LLM
//! disambiguation for ambiguous ones. Groups related files (audiobook
//! chapters, TV episodes, album tracks) for batch upload.

use axum::Router;

use crate::AppState;

pub mod groups;
pub mod heuristics;
pub mod json;
pub mod llm;
pub mod parsers;
pub mod probe;
pub mod provider;
pub mod stream;

// Re-export types used across the module.
pub use heuristics::heuristic_classify;
pub use llm::{parse_llm_result, parse_service, LlmMetadataMap};
pub use parsers::*;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", axum::routing::post(json::classify))
        .route("/stream", axum::routing::post(stream::classify_stream))
        .route("/probe", axum::routing::post(probe::probe_audiobook_files))
        .route("/provider", axum::routing::get(provider::get_provider))
        .route("/provider", axum::routing::put(provider::set_provider))
}
