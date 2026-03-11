pub mod models;
pub mod services;

/// Service types that Steadfirm orchestrates
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceKind {
    /// Photo & video management (Immich)
    Photos,
    /// Movie, TV, and music streaming (Jellyfin)
    Media,
    /// Document management and OCR (Paperless-ngx)
    Documents,
    /// Audiobook library and player (Audiobookshelf)
    Audiobooks,
    /// Unclassified files (Steadfirm storage)
    Files,
}

/// File classification result from the drop zone
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileClassification {
    pub detected_service: ServiceKind,
    pub mime_type: String,
    pub confidence: f32,
}
