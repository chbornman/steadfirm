//! `POST /api/v1/classify` — Classify a batch of files using heuristics + LLM.
//!
//! The frontend sends metadata for low-confidence files. The backend:
//! 1. Runs its own server-side heuristics (mirrors the TS ones but with
//!    access to full batch context for audiobook grouping).
//! 2. For files still below the confidence threshold, calls the LLM.
//! 3. Merges results and detects audiobook groupings.

use std::collections::HashMap;

use axum::{extract::State, routing::post, Json, Router};
use serde::Deserialize;

use crate::auth::AuthUser;
use crate::constants::{AI_CONFIDENCE_THRESHOLD, CLASSIFY_BATCH_SIZE};
use crate::error::AppError;
use crate::AppState;
use steadfirm_shared::classify::{
    AudiobookGroup, ClassifyDebugInfo, ClassifyResponse, FileClassificationResult, FileEntry,
};
use steadfirm_shared::ServiceKind;

pub fn router() -> Router<AppState> {
    Router::new().route("/", post(classify))
}

#[derive(Debug, Deserialize)]
struct ClassifyRequest {
    files: Vec<FileEntry>,
}

/// POST /api/v1/classify
async fn classify(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(request): Json<ClassifyRequest>,
) -> Result<Json<ClassifyResponse>, AppError> {
    let file_count = request.files.len();
    tracing::info!(file_count, "classify request received");

    // ── Step 1: Server-side heuristic classification ──
    let mut results: Vec<FileClassificationResult> = request
        .files
        .iter()
        .enumerate()
        .map(|(i, f)| heuristic_classify(i, f))
        .collect();

    // ── Step 2: Call LLM for files still below threshold ──
    let mut debug_info: Option<ClassifyDebugInfo> = None;

    if state.ai.is_enabled() {
        let low_confidence: Vec<(usize, &FileEntry)> = results
            .iter()
            .enumerate()
            .filter(|(_, r)| r.confidence < AI_CONFIDENCE_THRESHOLD)
            .map(|(i, _)| (i, &request.files[i]))
            .collect();

        if !low_confidence.is_empty() {
            tracing::info!(
                low_confidence_count = low_confidence.len(),
                "sending files to LLM for classification"
            );

            // Build the entries for the LLM (only low-confidence files)
            let llm_entries: Vec<FileEntry> = low_confidence
                .iter()
                .map(|(_, entry)| (*entry).clone())
                .collect();

            // Process in batches
            for chunk in llm_entries.chunks(CLASSIFY_BATCH_SIZE) {
                match state.ai.classify(chunk).await {
                    Ok(output) => {
                        for llm_file in &output.result.files {
                            // Map the LLM batch index back to the global index
                            if let Some(&(global_idx, _)) = low_confidence.get(llm_file.index) {
                                if let Some(result) = results.get_mut(global_idx) {
                                    let service = parse_service(&llm_file.service);
                                    result.service = service;
                                    result.confidence = llm_file.confidence.clamp(0.0, 1.0);
                                    result.reasoning = Some(llm_file.reasoning.clone());
                                    result.ai_classified = true;
                                }
                            }
                        }

                        // Keep the last batch's debug info (in practice we
                        // usually have a single batch).
                        debug_info = Some(output.debug_info);
                    }
                    Err(err) => {
                        tracing::warn!(%err, "LLM classification failed, keeping heuristic results");
                    }
                }
            }
        }
    }

    // ── Step 3: Detect audiobook groupings ──
    let audiobook_groups = detect_audiobook_groups(&request.files, &results);

    tracing::info!(
        file_count,
        audiobook_groups = audiobook_groups.len(),
        "classify response ready"
    );

    Ok(Json(ClassifyResponse {
        files: results,
        audiobook_groups,
        debug_info,
    }))
}

// ─── Server-side heuristics ──────────────────────────────────────────

/// Classify a single file using server-side heuristics.
/// Mirrors the TypeScript `classifyFile` logic but runs server-side for
/// consistency and to enable batch-level analysis.
fn heuristic_classify(index: usize, file: &FileEntry) -> FileClassificationResult {
    let ext = file
        .filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();
    let lower = file.filename.to_lowercase();
    let folders = get_folder_segments(&file.relative_path);

    let folder_suggests_audiobook = folders.iter().any(|f| {
        f.contains("audiobook")
            || f.contains("narrat")
            || f.contains("unabridged")
            || f.contains("abridged")
            || f.contains("librivox")
            || f.contains("audible")
    });

    let (service, confidence) = match ext.as_str() {
        // Photos
        "jpg" | "jpeg" | "heic" | "png" | "webp" | "raw" | "dng" | "cr2" | "arw" | "nef"
        | "orf" => (ServiceKind::Photos, 0.95),

        // Videos
        "mp4" | "mov" | "mkv" | "avi" | "wmv" | "webm" | "flv" | "m4v" | "ts" => {
            classify_video(&file.filename, file.size_bytes, &folders)
        }

        // Audiobook container
        "m4b" => (ServiceKind::Audiobooks, 0.98),

        // Audio
        "mp3" | "flac" | "ogg" | "aac" | "wma" | "opus" | "m4a" | "wav" => {
            classify_audio(&lower, file.size_bytes, folder_suggests_audiobook, &folders)
        }

        // Documents
        "pdf" | "docx" | "doc" | "xlsx" | "xls" | "odt" | "ods" | "pptx" | "ppt" | "txt"
        | "rtf" | "csv" | "epub" => (ServiceKind::Documents, 0.92),

        // MIME fallbacks
        _ => {
            if file.mime_type.starts_with("image/") {
                (ServiceKind::Photos, 0.9)
            } else if file.mime_type.starts_with("video/") {
                classify_video(&file.filename, file.size_bytes, &folders)
            } else if file.mime_type.starts_with("audio/") {
                classify_audio(&lower, file.size_bytes, folder_suggests_audiobook, &folders)
            } else {
                (ServiceKind::Files, 1.0)
            }
        }
    };

    FileClassificationResult {
        index,
        service,
        confidence,
        reasoning: None,
        ai_classified: false,
    }
}

fn classify_video(filename: &str, size_bytes: u64, folders: &[String]) -> (ServiceKind, f32) {
    // TV episode pattern
    let tv_re = regex_lite::Regex::new(r"(?i)\bS\d{1,2}E\d{1,2}\b").unwrap();
    if tv_re.is_match(filename) {
        return (ServiceKind::Media, 0.92);
    }

    // Movie release patterns
    let movie_re = regex_lite::Regex::new(
        r"(?i)\b(?:720p|1080p|2160p|4k|bluray|blu-ray|bdrip|brrip|dvdrip|webrip|web-dl|hdtv|hdrip|remux|x264|x265|h\.?264|h\.?265|hevc)\b",
    ).unwrap();
    if movie_re.is_match(filename) {
        return (ServiceKind::Media, 0.9);
    }

    // Home video patterns
    let home_re = regex_lite::Regex::new(
        r"(?i)^(?:IMG_|VID_|MVI_|MOV_|DSC_?|PXL_|Screen Recording|\d{4}-\d{2}-\d{2}|20\d{6}_\d{6})",
    )
    .unwrap();
    if home_re.is_match(filename) {
        return (ServiceKind::Photos, 0.92);
    }

    // Folder context
    let parent = folders.last().map(|s| s.as_str()).unwrap_or("");
    let folder_re =
        regex_lite::Regex::new(r"(?i)^(movies?|films?|tv\s*shows?|series|media)$").unwrap();
    if folder_re.is_match(parent) {
        return (ServiceKind::Media, 0.85);
    }

    // Size heuristics
    const SIZE_500MB: u64 = 500 * 1024 * 1024;
    const SIZE_2GB: u64 = 2 * 1024 * 1024 * 1024;

    if size_bytes > SIZE_2GB {
        (ServiceKind::Media, 0.75)
    } else if size_bytes < SIZE_500MB {
        (ServiceKind::Photos, 0.7)
    } else {
        (ServiceKind::Media, 0.6)
    }
}

fn classify_audio(
    lower_filename: &str,
    size_bytes: u64,
    folder_suggests_audiobook: bool,
    folders: &[String],
) -> (ServiceKind, f32) {
    if folder_suggests_audiobook {
        return (ServiceKind::Audiobooks, 0.93);
    }

    let audiobook_keywords = [
        "audiobook",
        "chapter",
        "narrat",
        "unabridged",
        "abridged",
        "disc",
        "part",
        "book",
    ];
    if audiobook_keywords
        .iter()
        .any(|kw| lower_filename.contains(kw))
    {
        return (ServiceKind::Audiobooks, 0.85);
    }

    // Parent folder suggests music
    let parent = folders.last().map(|s| s.as_str()).unwrap_or("");
    let music_re = regex_lite::Regex::new(r"(?i)^(music|albums?|songs?|playlists?)$").unwrap();
    if music_re.is_match(parent) {
        return (ServiceKind::Media, 0.88);
    }

    const SIZE_100MB: u64 = 100 * 1024 * 1024;
    if size_bytes > SIZE_100MB {
        return (ServiceKind::Audiobooks, 0.7);
    }

    (ServiceKind::Media, 0.8)
}

fn get_folder_segments(relative_path: &Option<String>) -> Vec<String> {
    match relative_path {
        Some(path) => {
            let parts: Vec<&str> = path.split('/').collect();
            if parts.len() >= 2 {
                parts[..parts.len() - 1]
                    .iter()
                    .map(|s| s.to_lowercase())
                    .collect()
            } else {
                vec![]
            }
        }
        None => vec![],
    }
}

fn parse_service(s: &str) -> ServiceKind {
    match s {
        "photos" => ServiceKind::Photos,
        "media" => ServiceKind::Media,
        "documents" => ServiceKind::Documents,
        "audiobooks" => ServiceKind::Audiobooks,
        _ => ServiceKind::Files,
    }
}

// ─── Audiobook grouping ──────────────────────────────────────────────

/// Group audiobook files by their inferred book, using folder structure.
///
/// Strategy: files classified as audiobooks that share the same parent
/// folder (or grandparent if nested) are grouped together. The folder
/// name becomes the book title, and the grandparent becomes the author.
fn detect_audiobook_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
) -> Vec<AudiobookGroup> {
    // Collect indices of audiobook files
    let audiobook_indices: Vec<usize> = results
        .iter()
        .enumerate()
        .filter(|(_, r)| matches!(r.service, ServiceKind::Audiobooks))
        .map(|(i, _)| i)
        .collect();

    if audiobook_indices.is_empty() {
        return vec![];
    }

    // Group by parent folder path
    let mut folder_groups: HashMap<String, Vec<usize>> = HashMap::new();

    for &idx in &audiobook_indices {
        let file = &files[idx];
        let folder_key = match &file.relative_path {
            Some(path) => {
                let parts: Vec<&str> = path.split('/').collect();
                if parts.len() >= 2 {
                    // Use all folder segments (minus the filename) as the group key
                    parts[..parts.len() - 1].join("/")
                } else {
                    // No folder context — group by filename prefix
                    "ungrouped".to_string()
                }
            }
            None => "ungrouped".to_string(),
        };
        folder_groups.entry(folder_key).or_default().push(idx);
    }

    let mut groups = Vec::new();

    for (folder_path, indices) in &folder_groups {
        if folder_path == "ungrouped" {
            // Each ungrouped file is its own "book"
            for &idx in indices {
                let file = &files[idx];
                let title = file
                    .filename
                    .rsplit('.')
                    .next_back()
                    .unwrap_or(&file.filename)
                    .to_string();
                groups.push(AudiobookGroup {
                    title,
                    author: None,
                    file_indices: vec![idx],
                });
            }
            continue;
        }

        let segments: Vec<&str> = folder_path.split('/').collect();

        // Infer author and title from folder structure:
        // Author/Title/ -> author = segments[0], title = segments[1]
        // Title/ -> author = None, title = segments[0]
        let (author, title) = match segments.len() {
            0 => (None, folder_path.clone()),
            1 => (None, segments[0].to_string()),
            _ => {
                // Assume Author/Title structure (common in audiobook libraries)
                (Some(segments[0].to_string()), segments[1..].join(" - "))
            }
        };

        groups.push(AudiobookGroup {
            title,
            author,
            file_indices: indices.clone(),
        });
    }

    groups
}
