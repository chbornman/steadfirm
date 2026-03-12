//! LLM result parsing and metadata types for classification.

use std::collections::HashMap;

use serde::Serialize;

use steadfirm_shared::classify::{
    AudiobookGroup, ClassifyDebugInfo, FileClassificationResult, FileEntry, LlmClassifyResult,
    LlmFileClassification, MovieGroup, MusicAlbumGroup, ReadingGroup, TvShowGroup,
};
use steadfirm_shared::ServiceKind;

use super::groups;

/// LLM metadata indexed by global file index, used by group detectors
/// to enhance regex-parsed metadata with LLM-inferred clean titles,
/// years, series info, etc.
pub type LlmMetadataMap = HashMap<usize, LlmFileClassification>;

// ─── SSE event data types ────────────────────────────────────────────

/// Sent for each high-confidence file classified by heuristics alone.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SseHeuristic {
    pub index: usize,
    pub service: ServiceKind,
    pub confidence: f32,
}

/// Phase status update.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SseStatus {
    pub phase: &'static str,
    pub pending: usize,
}

/// Sent for each file classified by the LLM.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SseClassification {
    pub index: usize,
    pub service: ServiceKind,
    pub confidence: f32,
    pub reasoning: Option<String>,
    pub ai_classified: bool,
}

/// Batch index → global file index mapping, sent before tokens stream.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SseIndexMap {
    pub index_map: Vec<usize>,
}

/// Final event with authoritative classifications, all groups, and debug info.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SseDone {
    pub classifications: Vec<SseClassification>,
    pub audiobook_groups: Vec<AudiobookGroup>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tv_show_groups: Vec<TvShowGroup>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub movie_groups: Vec<MovieGroup>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub music_groups: Vec<MusicAlbumGroup>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub reading_groups: Vec<ReadingGroup>,
    pub debug_info: Option<ClassifyDebugInfo>,
}

// ─── Group builder helpers ───────────────────────────────────────────

pub type AllGroups = (
    Vec<AudiobookGroup>,
    Vec<TvShowGroup>,
    Vec<MovieGroup>,
    Vec<MusicAlbumGroup>,
    Vec<ReadingGroup>,
);

pub fn build_all_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
    llm_metadata: &LlmMetadataMap,
) -> AllGroups {
    let audiobook_groups =
        groups::audiobooks::detect_audiobook_groups(files, results, llm_metadata);
    let tv_show_groups = groups::tv_shows::detect_tv_show_groups(files, results, llm_metadata);

    let tv_file_indices: std::collections::HashSet<usize> = tv_show_groups
        .iter()
        .flat_map(|g| g.file_indices.iter().copied())
        .collect();

    let movie_groups =
        groups::movies::detect_movie_groups(files, results, &tv_file_indices, llm_metadata);
    let music_groups = groups::music::detect_music_groups(files, results, llm_metadata);
    let reading_groups = groups::reading::detect_reading_groups(files, results, llm_metadata);

    (
        audiobook_groups,
        tv_show_groups,
        movie_groups,
        music_groups,
        reading_groups,
    )
}

pub fn build_sse_done(
    classifications: Vec<SseClassification>,
    files: &[FileEntry],
    results: &[FileClassificationResult],
    debug_info: Option<ClassifyDebugInfo>,
    llm_metadata: &LlmMetadataMap,
) -> SseDone {
    let (audiobook_groups, tv_show_groups, movie_groups, music_groups, reading_groups) =
        build_all_groups(files, results, llm_metadata);
    SseDone {
        classifications,
        audiobook_groups,
        tv_show_groups,
        movie_groups,
        music_groups,
        reading_groups,
        debug_info,
    }
}

// ─── LLM response parsing ───────────────────────────────────────────

/// Parse an LLM JSON response into `LlmClassifyResult`, handling multiple
/// formats small/local models may return.
pub fn parse_llm_result(value: serde_json::Value) -> Result<LlmClassifyResult, serde_json::Error> {
    if let Ok(result) = serde_json::from_value::<LlmClassifyResult>(value.clone()) {
        return Ok(result);
    }
    if let Ok(files) = serde_json::from_value::<Vec<LlmFileClassification>>(value.clone()) {
        return Ok(LlmClassifyResult { files });
    }
    if let Ok(file) = serde_json::from_value::<LlmFileClassification>(value.clone()) {
        return Ok(LlmClassifyResult { files: vec![file] });
    }
    serde_json::from_value::<LlmClassifyResult>(value)
}

pub fn parse_service(s: &str) -> ServiceKind {
    match s {
        "photos" => ServiceKind::Photos,
        "media" => ServiceKind::Media,
        "documents" => ServiceKind::Documents,
        "audiobooks" => ServiceKind::Audiobooks,
        "reading" => ServiceKind::Reading,
        _ => ServiceKind::Files,
    }
}
