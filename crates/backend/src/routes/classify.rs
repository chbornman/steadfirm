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

/// Classify a single file using MIME / extension only.
///
/// This is a minimal first pass — ambiguous files (audio, video) get low
/// confidence so they are sent to the LLM for proper classification with
/// full context (folder structure, batch analysis, etc.).
fn heuristic_classify(index: usize, file: &FileEntry) -> FileClassificationResult {
    let ext = file
        .filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();

    let (service, confidence) = match ext.as_str() {
        // Photos — unambiguous
        "jpg" | "jpeg" | "heic" | "png" | "webp" | "gif" | "raw" | "dng" | "cr2" | "arw"
        | "nef" | "orf" => (ServiceKind::Photos, 0.95),

        // Documents — unambiguous
        "pdf" | "docx" | "doc" | "xlsx" | "xls" | "odt" | "ods" | "pptx" | "ppt" | "txt"
        | "rtf" | "csv" | "epub" => (ServiceKind::Documents, 0.92),

        // M4B is always an audiobook
        "m4b" => (ServiceKind::Audiobooks, 0.98),

        // Video — could be personal, movie, or TV; let LLM decide
        "mp4" | "mov" | "mkv" | "avi" | "wmv" | "webm" | "flv" | "m4v" | "ts" => {
            (ServiceKind::Media, 0.5)
        }

        // Audio — could be music or audiobook; let LLM decide
        "mp3" | "flac" | "ogg" | "aac" | "wma" | "opus" | "m4a" | "wav" => {
            (ServiceKind::Media, 0.5)
        }

        // MIME fallbacks
        _ => {
            if file.mime_type.starts_with("image/") {
                (ServiceKind::Photos, 0.9)
            } else if file.mime_type.starts_with("video/")
                || file.mime_type.starts_with("audio/")
            {
                (ServiceKind::Media, 0.5)
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
