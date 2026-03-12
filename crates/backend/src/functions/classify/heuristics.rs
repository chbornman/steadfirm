//! Extension/MIME-based heuristic classification.

use crate::constants;
use steadfirm_shared::classify::{FileClassificationResult, FileEntry};
use steadfirm_shared::ServiceKind;

use super::parsers::parse_season_episode;

pub fn heuristic_classify(index: usize, file: &FileEntry) -> FileClassificationResult {
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

        // Documents — unambiguous (archival/office formats)
        "docx" | "doc" | "xlsx" | "xls" | "odt" | "ods" | "pptx" | "ppt" | "txt" | "rtf"
        | "csv" => (ServiceKind::Documents, 0.92),

        // Reading — ebooks are always for reading
        "epub" | "mobi" | "azw" | "azw3" | "fb2" => (ServiceKind::Reading, 0.95),

        // Reading — comics/manga are always for reading
        "cbz" | "cbr" | "cb7" | "cbt" | "cba" => (ServiceKind::Reading, 0.95),

        // PDF — could be a document to archive or a book to read; let LLM decide
        "pdf" => (ServiceKind::Documents, 0.5),

        // M4B is always an audiobook
        "m4b" => (ServiceKind::Audiobooks, 0.98),

        // Video — check for TV show patterns before deferring to LLM
        "mp4" | "mov" | "mkv" | "avi" | "wmv" | "webm" | "flv" | "m4v" | "ts" => {
            heuristic_classify_video(file)
        }

        // Subtitle files — follow their associated video
        "srt" | "ass" | "ssa" | "sub" | "idx" | "vtt" => heuristic_classify_video(file),

        // Audio — check for audiobook signals before falling back to LLM
        "mp3" | "flac" | "ogg" | "aac" | "wma" | "opus" | "m4a" | "wav" => {
            heuristic_classify_audio(file)
        }

        // MIME fallbacks
        _ => {
            if file.mime_type.starts_with("image/") {
                (ServiceKind::Photos, 0.9)
            } else if file.mime_type.starts_with("video/") || file.mime_type.starts_with("audio/") {
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

/// Enhanced heuristic for audio files that checks for audiobook signals
/// before deferring to the LLM.
fn heuristic_classify_audio(file: &FileEntry) -> (ServiceKind, f32) {
    let lower_name = file.filename.to_lowercase();
    let lower_path = file.relative_path.as_deref().unwrap_or("").to_lowercase();

    let combined = format!("{} {}", lower_path, lower_name);

    // Strong audiobook signals in filename or path
    let audiobook_keywords = constants::AUDIOBOOK_FILENAME_KEYWORDS;
    let has_audiobook_keyword = audiobook_keywords.iter().any(|kw| {
        let kw_len = kw.len();
        combined.match_indices(kw).any(|(pos, _)| {
            let before_ok = pos == 0 || !combined.as_bytes()[pos - 1].is_ascii_alphanumeric();
            let after_pos = pos + kw_len;
            let after_ok = after_pos >= combined.len()
                || !combined.as_bytes()[after_pos].is_ascii_alphabetic();
            before_ok && after_ok
        })
    });

    // Check for sequential chapter numbering patterns
    let has_chapter_numbering = {
        let patterns = [lower_name
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .count()
            >= 2];
        patterns.iter().any(|p| *p)
    };

    // Check folder structure for audiobook-like patterns
    let path_segments: Vec<&str> = lower_path.split('/').filter(|s| !s.is_empty()).collect();
    let has_bookish_folder = path_segments.len() >= 2
        && !lower_path.contains("music")
        && !lower_path.contains("album")
        && !lower_path.contains("discography")
        && !lower_path.contains("playlist");

    if has_audiobook_keyword && has_bookish_folder {
        return (ServiceKind::Audiobooks, 0.92);
    }
    if has_audiobook_keyword {
        return (ServiceKind::Audiobooks, 0.88);
    }
    if has_chapter_numbering && has_bookish_folder {
        return (ServiceKind::Audiobooks, 0.75);
    }

    (ServiceKind::Media, 0.5)
}

/// Enhanced heuristic for video/subtitle files that checks for TV show
/// patterns (S##E##) and movie-like naming before deferring to the LLM.
fn heuristic_classify_video(file: &FileEntry) -> (ServiceKind, f32) {
    let lower_name = file.filename.to_lowercase();
    let lower_path = file.relative_path.as_deref().unwrap_or("").to_lowercase();
    let combined = format!("{} {}", lower_path, lower_name);

    if parse_season_episode(&combined).is_some() {
        return (ServiceKind::Media, 0.92);
    }

    if lower_path.contains("season ") || lower_path.contains("season_") {
        return (ServiceKind::Media, 0.90);
    }

    let has_year_parens = combined
        .find('(')
        .and_then(|start| {
            let rest = &combined[start + 1..];
            rest.find(')').and_then(|end| {
                let inside = &rest[..end];
                if inside.len() == 4 && inside.chars().all(|c| c.is_ascii_digit()) {
                    let year: u32 = inside.parse().unwrap_or(0);
                    if (1920..=2030).contains(&year) {
                        return Some(());
                    }
                }
                None
            })
        })
        .is_some();

    let has_resolution = constants::RESOLUTION_TAGS
        .iter()
        .any(|tag| combined.contains(tag));

    let has_source = constants::SOURCE_TAGS
        .iter()
        .any(|tag| combined.contains(tag));

    if has_year_parens && (has_resolution || has_source) {
        return (ServiceKind::Media, 0.88);
    }
    if has_year_parens {
        return (ServiceKind::Media, 0.80);
    }
    if has_resolution || has_source {
        return (ServiceKind::Media, 0.70);
    }

    (ServiceKind::Media, 0.5)
}
