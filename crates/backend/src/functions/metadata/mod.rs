//! Metadata enrichment — enrich/correct metadata after upload.
//!
//! Each sub-module handles metadata operations for one backing service.
//! This is a new feature — initial implementation is stubs that will be
//! fleshed out as we integrate deeper with each service's metadata APIs.

use crate::AppState;
use axum::Router;

pub mod audiobooks;
pub mod documents;
pub mod files;
pub mod media;
pub mod reading;

pub fn router() -> Router<AppState> {
    Router::new()
        .nest("/media", media::router())
        .nest("/audiobooks", audiobooks::router())
        .nest("/documents", documents::router())
        .nest("/reading", reading::router())
        .nest("/files", files::router())
}
