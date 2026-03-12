//! Types for the file classification pipeline.
//!
//! Used by both the programmatic heuristic classifier and the LLM-based
//! classifier. The frontend sends a [`ClassifyRequest`] to
//! `POST /api/v1/classify`, and the backend responds with a
//! [`ClassifyResponse`].

use serde::{Deserialize, Serialize};

use crate::ServiceKind;

// ─── Request ─────────────────────────────────────────────────────────

/// A batch of files to classify.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifyRequest {
    pub files: Vec<FileEntry>,
}

/// Metadata for a single file being classified.
///
/// This is everything the backend needs to make a classification decision
/// without having access to the actual file bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Original filename (e.g. `chapter01.mp3`).
    pub filename: String,

    /// MIME type as detected by the browser (e.g. `audio/mpeg`).
    pub mime_type: String,

    /// File size in bytes.
    pub size_bytes: u64,

    /// Relative path within a dropped folder (e.g.
    /// `Brandon Sanderson/Mistborn/chapter01.mp3`).
    /// `None` for files dropped individually (not from a folder).
    /// Uses `default` so missing keys in JSON (JS `undefined`) deserialize as `None`.
    #[serde(default)]
    pub relative_path: Option<String>,
}

// ─── Response ────────────────────────────────────────────────────────

/// Classification results for the entire batch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifyResponse {
    /// One result per file in the request, in the same order.
    pub files: Vec<FileClassificationResult>,

    /// Detected audiobook groupings. Files classified as `audiobooks`
    /// are grouped by inferred book so the upload step can create the
    /// correct `Author/Title/` folder structure for Audiobookshelf.
    pub audiobook_groups: Vec<AudiobookGroup>,

    /// LLM debug info — only populated when AI classification was used.
    /// Contains the prompts sent and raw response received so the
    /// dev-debug panel can display the full conversation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debug_info: Option<ClassifyDebugInfo>,
}

/// Debug info from an LLM classification call, for the dev-debug panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifyDebugInfo {
    /// The system prompt sent to the LLM.
    pub system_prompt: String,

    /// The user prompt sent to the LLM (file metadata JSON).
    pub user_prompt: String,

    /// Raw LLM response text (before structured extraction).
    /// May be `None` if the Rig extractor doesn't expose it.
    pub raw_response: Option<String>,

    /// Model name used for classification.
    pub model: String,

    /// LLM provider used (`"anthropic"` or `"openai"`).
    pub provider: String,

    /// Number of files sent to the LLM.
    pub file_count: usize,

    /// Time taken for the LLM call in milliseconds.
    pub duration_ms: u64,
}

/// Classification result for a single file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileClassificationResult {
    /// Index of this file in the request's `files` array.
    pub index: usize,

    /// Destination service.
    pub service: ServiceKind,

    /// Confidence score (0.0–1.0).
    pub confidence: f32,

    /// Short human-readable reason for the classification.
    /// Populated by the LLM; `None` for purely heuristic results.
    pub reasoning: Option<String>,

    /// If this file was classified by the LLM (as opposed to purely by
    /// heuristics).
    pub ai_classified: bool,
}

// ─── Audiobook grouping ──────────────────────────────────────────────

/// A set of files that belong to the same audiobook.
///
/// Used to create the `Author/Title/` folder structure that
/// Audiobookshelf expects when writing files to the library.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudiobookGroup {
    /// Inferred book title (e.g. `Mistborn: The Final Empire`).
    pub title: String,

    /// Inferred author name (e.g. `Brandon Sanderson`).
    pub author: Option<String>,

    /// Inferred series name (e.g. `Mistborn`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,

    /// Series sequence/volume number (e.g. `1`, `2.5`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_sequence: Option<String>,

    /// Narrator name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub narrator: Option<String>,

    /// Publish year (e.g. `2006`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<String>,

    /// Indices into the request's `files` array that belong to this book.
    pub file_indices: Vec<usize>,

    /// Index of the cover image file, if one was detected in this group.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_index: Option<usize>,

    /// Probe data extracted from audio files via ffprobe (populated by
    /// the `/classify/probe` endpoint, not during initial classification).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe_data: Option<AudiobookProbeData>,
}

/// Metadata extracted from audio file ID3/ffprobe tags.
/// Aggregated across all files in an audiobook group.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudiobookProbeData {
    /// Album tag (maps to audiobook title).
    pub album: Option<String>,
    /// Artist/album-artist tag (maps to author).
    pub artist: Option<String>,
    /// Composer tag (maps to narrator in ABS convention).
    pub composer: Option<String>,
    /// Genre tag.
    pub genre: Option<String>,
    /// Year/date tag.
    pub year: Option<String>,
    /// Series tag (from ID3 MVNM/series tag).
    pub series: Option<String>,
    /// Series part (from ID3 MVIN/series-part tag).
    pub series_part: Option<String>,
    /// Total duration in seconds across all files.
    pub total_duration_secs: f64,
    /// Per-file probe results, ordered by track number.
    pub tracks: Vec<AudioFileProbe>,
}

/// Probe result for a single audio file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFileProbe {
    /// Index in the original files array.
    pub file_index: usize,
    /// Track number parsed from ID3 or filename.
    pub track_number: Option<u32>,
    /// Disc number from ID3.
    pub disc_number: Option<u32>,
    /// Duration of this file in seconds.
    pub duration_secs: f64,
    /// Title tag from ID3.
    pub title: Option<String>,
    /// Whether this file has an embedded cover image.
    pub has_embedded_cover: bool,
}

// ─── LLM extraction target ──────────────────────────────────────────
// These types define the JSON structure the LLM returns. Deserialized
// from the raw response text after JSON fence stripping.

/// The structured response the LLM returns for a classification batch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmClassifyResult {
    /// One entry per file that was sent to the LLM.
    pub files: Vec<LlmFileClassification>,
}

/// LLM classification for a single file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmFileClassification {
    /// Index of the file in the batch sent to the LLM.
    pub index: usize,

    /// Target service: `"photos"`, `"media"`, `"documents"`,
    /// `"audiobooks"`, or `"files"`.
    pub service: String,

    /// Confidence score from 0.0 to 1.0.
    pub confidence: f32,

    /// Short explanation of why the LLM chose this classification.
    pub reasoning: String,

    /// For audiobooks: inferred metadata to help with folder structure.
    pub audiobook_metadata: Option<LlmAudiobookMetadata>,
}

/// Audiobook metadata inferred by the LLM from filenames and folder
/// structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmAudiobookMetadata {
    /// Inferred book title.
    pub title: String,

    /// Inferred author name.
    pub author: Option<String>,

    /// Inferred series name (e.g. `Mistborn`).
    pub series: Option<String>,
}
