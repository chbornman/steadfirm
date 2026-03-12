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

    /// Detected TV show groupings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tv_show_groups: Vec<TvShowGroup>,

    /// Detected movie groupings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub movie_groups: Vec<MovieGroup>,

    /// Detected music album groupings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub music_groups: Vec<MusicAlbumGroup>,

    /// Detected reading/ebook groupings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reading_groups: Vec<ReadingGroup>,

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

// ─── TV Show grouping ────────────────────────────────────────────────

/// A set of files that belong to the same TV show.
///
/// Used to create the `Shows/Series Name (year)/Season ##/` folder
/// structure that Jellyfin expects.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TvShowGroup {
    /// Inferred series title (e.g. `Breaking Bad`).
    pub series_name: String,

    /// Inferred year (e.g. `2008`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<String>,

    /// Episodes detected in this group.
    pub episodes: Vec<TvEpisode>,

    /// Indices into the request's `files` array for all files in this show.
    pub file_indices: Vec<usize>,

    /// Indices for subtitle files associated with this show.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub subtitle_indices: Vec<usize>,
}

/// A single episode parsed from a filename.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TvEpisode {
    /// Season number.
    pub season: u32,

    /// Episode number.
    pub episode: u32,

    /// Optional end episode for multi-episode files (e.g. S01E01-E02).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub episode_end: Option<u32>,

    /// Episode title if parseable from filename.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    /// Index into the request's `files` array.
    pub file_index: usize,
}

// ─── Movie grouping ─────────────────────────────────────────────────

/// A single movie detected from uploaded files.
///
/// Used to create the `Movies/Movie Name (year)/` folder structure
/// that Jellyfin expects.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovieGroup {
    /// Inferred movie title (e.g. `The Matrix`).
    pub title: String,

    /// Inferred year (e.g. `1999`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<String>,

    /// Video resolution (e.g. `1080p`, `4K`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,

    /// Source/quality info (e.g. `BluRay`, `WEB-DL`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,

    /// Index of the main video file.
    pub file_index: usize,

    /// Indices for subtitle files associated with this movie.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub subtitle_indices: Vec<usize>,

    /// Indices for other associated files (cover art, NFO, etc.).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub extra_indices: Vec<usize>,
}

// ─── Music grouping ─────────────────────────────────────────────────

/// A set of files that belong to the same music album.
///
/// Used to create the `Music/Artist/Album/` folder structure
/// that Jellyfin expects.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicAlbumGroup {
    /// Album title (from folder name or ID3).
    pub album: String,

    /// Artist name (from folder name or ID3).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,

    /// Album year.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<String>,

    /// Indices into the request's `files` array.
    pub file_indices: Vec<usize>,

    /// Index of cover art file if detected.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_index: Option<usize>,

    /// Probe data from ffprobe (populated after probing).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe_data: Option<MusicProbeData>,
}

/// Metadata extracted from music file ID3/ffprobe tags.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicProbeData {
    /// Album tag.
    pub album: Option<String>,
    /// Artist/album-artist tag.
    pub artist: Option<String>,
    /// Genre tag.
    pub genre: Option<String>,
    /// Year/date tag.
    pub year: Option<String>,
    /// Total duration in seconds.
    pub total_duration_secs: f64,
    /// Per-file probe results.
    pub tracks: Vec<AudioFileProbe>,
}

// ─── Reading grouping ───────────────────────────────────────────────

/// A set of files that belong to the same reading series.
///
/// Used to create the `Series Name/` folder structure with proper
/// volume naming that Kavita expects.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingGroup {
    /// Series name.
    pub series_name: String,

    /// Individual volumes/issues in this group.
    pub volumes: Vec<ReadingVolume>,

    /// Indices into the request's `files` array.
    pub file_indices: Vec<usize>,
}

/// A single volume/issue in a reading group.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingVolume {
    /// Volume/issue number (e.g. `1`, `2.5`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,

    /// Volume title if parseable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    /// Format: `epub`, `cbz`, `pdf`, etc.
    pub format: String,

    /// Whether this is a special (SP marker or Specials folder).
    pub is_special: bool,

    /// Index into the request's `files` array.
    pub file_index: usize,
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

    /// For media (movies, TV, music): inferred metadata for folder naming.
    pub media_metadata: Option<LlmMediaMetadata>,

    /// For reading (ebooks, comics, manga): inferred metadata for folder naming.
    pub reading_metadata: Option<LlmReadingMetadata>,
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

/// Media metadata inferred by the LLM from filenames and folder structure.
///
/// Covers movies, TV shows, and music — the LLM sets `media_type` to
/// indicate which subtype, and the relevant fields are populated.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmMediaMetadata {
    /// Subtype: `"movie"`, `"tv_show"`, or `"music"`.
    pub media_type: String,

    /// Clean title (movie name, show name, or album name).
    pub title: String,

    /// Release year (e.g. `"1999"`, `"2024"`).
    pub year: Option<String>,

    /// TV only: season number.
    pub season: Option<u32>,

    /// TV only: episode number.
    pub episode: Option<u32>,

    /// TV only: end episode for multi-episode files (e.g. S01E01-E03).
    pub episode_end: Option<u32>,

    /// Music only: artist/band name.
    pub artist: Option<String>,

    /// Music only: album name (may differ from `title` if title is a
    /// track name).
    pub album: Option<String>,
}

/// Reading metadata inferred by the LLM from filenames and folder structure.
///
/// Covers ebooks, comics, and manga.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmReadingMetadata {
    /// Clean title or series name.
    pub title: String,

    /// Series name if part of a series.
    pub series: Option<String>,

    /// Volume or issue number (e.g. `"1"`, `"2.5"`).
    pub volume: Option<String>,

    /// Subtype: `"manga"`, `"comic"`, or `"ebook"`.
    pub reading_type: Option<String>,
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ServiceKind;

    #[test]
    fn service_kind_serializes_to_snake_case() {
        let json = serde_json::to_string(&ServiceKind::Audiobooks).unwrap();
        assert_eq!(json, r#""audiobooks""#);
    }

    #[test]
    fn service_kind_deserializes_from_snake_case() {
        let kind: ServiceKind = serde_json::from_str(r#""reading""#).unwrap();
        assert_eq!(kind, ServiceKind::Reading);
    }

    #[test]
    fn service_kind_roundtrip_all_variants() {
        let variants = [
            ServiceKind::Photos,
            ServiceKind::Media,
            ServiceKind::Documents,
            ServiceKind::Audiobooks,
            ServiceKind::Reading,
            ServiceKind::Files,
        ];
        for kind in variants {
            let json = serde_json::to_string(&kind).unwrap();
            let back: ServiceKind = serde_json::from_str(&json).unwrap();
            assert_eq!(back, kind);
        }
    }

    #[test]
    fn classify_request_deserializes_from_camel_case() {
        let json = r#"{
            "files": [{
                "filename": "chapter01.mp3",
                "mimeType": "audio/mpeg",
                "sizeBytes": 50000000,
                "relativePath": "Sanderson/Mistborn/chapter01.mp3"
            }]
        }"#;
        let req: ClassifyRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.files.len(), 1);
        assert_eq!(req.files[0].filename, "chapter01.mp3");
        assert_eq!(req.files[0].mime_type, "audio/mpeg");
        assert_eq!(req.files[0].size_bytes, 50_000_000);
        assert_eq!(
            req.files[0].relative_path.as_deref(),
            Some("Sanderson/Mistborn/chapter01.mp3")
        );
    }

    #[test]
    fn file_entry_relative_path_defaults_to_none() {
        let json = r#"{
            "filename": "photo.jpg",
            "mimeType": "image/jpeg",
            "sizeBytes": 4000000
        }"#;
        let entry: FileEntry = serde_json::from_str(json).unwrap();
        assert!(entry.relative_path.is_none());
    }

    #[test]
    fn file_classification_result_serializes_camel_case() {
        let result = FileClassificationResult {
            index: 0,
            service: ServiceKind::Photos,
            confidence: 0.95,
            reasoning: Some("Image extension".to_string()),
            ai_classified: false,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains(r#""aiClassified""#));
        assert!(json.contains(r#""index""#));
    }
}
