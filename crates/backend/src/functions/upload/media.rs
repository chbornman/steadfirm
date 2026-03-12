//! Jellyfin upload — media service.
//!
//! Two entry points:
//! - `upload_to_media`: simple single-file upload (dispatched from `upload_file`)
//! - `upload_media`: structured multi-file upload handler (TV shows, movies, music)

use axum::{
    extract::{Multipart, State},
    Json,
};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::services::JellyfinClient;
use crate::AppState;

/// Determine the Jellyfin library subdirectory for a file based on MIME type
/// and filename.  Audio → Music/, video with episode pattern → Shows/,
/// everything else → Movies/.
fn media_subdir(mime_type: &str, filename: &str) -> &'static str {
    if mime_type.starts_with("audio/") {
        return "Music";
    }
    if looks_like_episode(filename) {
        return "Shows";
    }
    "Movies"
}

/// Returns true if the filename contains a TV episode pattern like
/// S01E02, s1e3, 1x02, etc.
fn looks_like_episode(filename: &str) -> bool {
    let lower = filename.to_ascii_lowercase();
    // Match S01E02 / s1e3 style
    let mut chars = lower.chars().peekable();
    while let Some(c) = chars.next() {
        if c == 's' {
            // Consume digits after 's'
            let mut has_s_digits = false;
            while chars.peek().is_some_and(|ch| ch.is_ascii_digit()) {
                chars.next();
                has_s_digits = true;
            }
            if has_s_digits && chars.peek() == Some(&'e') {
                chars.next();
                if chars.peek().is_some_and(|ch| ch.is_ascii_digit()) {
                    return true;
                }
            }
        }
    }
    // Match 1x02 / 12x03 style
    let bytes = lower.as_bytes();
    for i in 0..bytes.len() {
        if bytes[i] == b'x'
            && i > 0
            && bytes[i - 1].is_ascii_digit()
            && i + 1 < bytes.len()
            && bytes[i + 1].is_ascii_digit()
        {
            return true;
        }
    }
    false
}

/// Parse show name and season number from a TV episode filename.
/// "Arcane S02E08.mkv" → ("Arcane", 2)
/// "I Think You Should Leave S02E04.mkv" → ("I Think You Should Leave", 2)
/// "show.1x03.mkv" → ("show", 1)
fn parse_episode_info(filename: &str) -> (String, u32) {
    let stem = filename.rsplit('.').skip(1).collect::<Vec<_>>();
    let stem = stem.into_iter().rev().collect::<Vec<_>>().join(".");
    let lower = stem.to_ascii_lowercase();

    // Try S##E## pattern
    if let Some(pos) = lower.find('s').and_then(|s_pos| {
        let after_s = &lower[s_pos + 1..];
        let digits_end = after_s
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(after_s.len());
        if digits_end > 0 && after_s[digits_end..].starts_with('e') {
            Some(s_pos)
        } else {
            None
        }
    }) {
        let show_name = stem[..pos].trim().trim_end_matches(['-', '.', '_']);
        let show_name = show_name.replace(['.', '_'], " ");
        let after_s = &lower[pos + 1..];
        let digits_end = after_s
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(after_s.len());
        let season: u32 = after_s[..digits_end].parse().unwrap_or(1);
        let name = if show_name.is_empty() {
            "Unknown Show".to_string()
        } else {
            show_name
        };
        return (name, season);
    }

    // Try ##x## pattern
    for (i, c) in lower.char_indices() {
        if c == 'x' && i > 0 && lower.as_bytes()[i - 1].is_ascii_digit() {
            // Walk backwards to find start of season number
            let mut start = i - 1;
            while start > 0 && lower.as_bytes()[start - 1].is_ascii_digit() {
                start -= 1;
            }
            let season: u32 = lower[start..i].parse().unwrap_or(1);
            let show_name = stem[..start].trim().trim_end_matches(['-', '.', '_']);
            let show_name = show_name.replace(['.', '_'], " ");
            let name = if show_name.is_empty() {
                "Unknown Show".to_string()
            } else {
                show_name
            };
            return (name, season);
        }
    }

    ("Unknown Show".to_string(), 1)
}

/// Simple single-file media upload — routes to the correct Jellyfin library
/// (Music/ for audio, Movies/ for video) and triggers a library refresh.
pub async fn upload_to_media(
    state: &AppState,
    user: &AuthUser,
    filename: &str,
    file_data: &[u8],
    mime_type: &str,
) -> Result<(), AppError> {
    let _cred = user
        .credentials
        .jellyfin
        .as_ref()
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    let subdir = media_subdir(mime_type, filename);

    let file_path = if subdir == "Shows" {
        // Parse show name and season from filename for proper Jellyfin structure.
        // "Arcane S02E08.mkv" → Shows/{userId}/Arcane/Season 02/Arcane S02E08.mkv
        let (show_name, season) = parse_episode_info(filename);
        let show_dir = format!(
            "{}/Shows/{}/{}/Season {:02}",
            state.config.media_storage_path, user.id, show_name, season
        );
        tokio::fs::create_dir_all(&show_dir)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;
        format!("{}/{}", show_dir, filename)
    } else {
        let media_dir = format!("{}/{}/{}", state.config.media_storage_path, subdir, user.id);
        tokio::fs::create_dir_all(&media_dir)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;
        format!("{}/{}", media_dir, filename)
    };
    tokio::fs::write(&file_path, file_data)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("write error: {e}")))?;

    // Trigger Jellyfin library refresh.
    let jf_client = JellyfinClient::new(
        &state.config.jellyfin_url,
        &state.config.jellyfin_device_id,
        state.http.clone(),
    );
    let _ = jf_client
        .refresh_library(&state.config.jellyfin_admin_token)
        .await;

    Ok(())
}

/// POST /api/v1/upload/media
///
/// Upload media files (TV shows, movies, music) with structured folder paths.
/// Creates the correct folder structure for Jellyfin before writing files.
///
/// Form fields:
///   - `media_type` (required): "tv_show", "movie", or "music"
///   - `title` (required): Show name, movie title, or album name
///   - `year` (optional): Release year
///   - `artist` (optional): For music — artist name
///   - `season` (optional): For TV shows — season number
///   - Files: numbered keys (0, 1, 2...) with the actual files
///   - File paths: `path_0`, `path_1`, etc. — the relative path to write each file to
pub async fn upload_media(
    State(state): State<AppState>,
    user: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let _cred = user
        .credentials
        .jellyfin
        .as_ref()
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    let mut media_type = String::new();
    let mut title = String::new();
    let mut year: Option<String> = None;
    let mut artist: Option<String> = None;
    let mut season: Option<String> = None;
    let mut files: Vec<(String, Vec<u8>, String)> = Vec::new();
    let mut file_paths: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "media_type" => {
                media_type = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
            }
            "title" => {
                title = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
            }
            "year" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                if !text.is_empty() {
                    year = Some(text);
                }
            }
            "artist" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                if !text.is_empty() {
                    artist = Some(text);
                }
            }
            "season" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                if !text.is_empty() {
                    season = Some(text);
                }
            }
            name if name.starts_with("path_") => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                let idx = name.strip_prefix("path_").unwrap_or("").to_string();
                file_paths.insert(idx, text);
            }
            _ => {
                // File fields
                let filename = field.file_name().unwrap_or("file").to_string();
                let data = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("read error: {e}")))?;
                let mime = mime_guess::from_path(&filename)
                    .first_or_octet_stream()
                    .to_string();
                files.push((filename, data.to_vec(), mime));
            }
        }
    }

    if title.is_empty() {
        return Err(AppError::BadRequest("title is required".into()));
    }
    if media_type.is_empty() {
        return Err(AppError::BadRequest("media_type is required".into()));
    }
    if files.is_empty() {
        return Err(AppError::BadRequest("at least one file is required".into()));
    }

    let file_count = files.len();
    let total_bytes: usize = files.iter().map(|(_, data, _)| data.len()).sum();

    tracing::info!(
        user_id = %user.id,
        media_type = %media_type,
        title = %title,
        year = ?year,
        artist = ?artist,
        season = ?season,
        file_count,
        total_bytes,
        "media upload started"
    );

    let year_suffix = year
        .as_ref()
        .map(|y| format!(" ({})", y))
        .unwrap_or_default();

    for (idx, (filename, data, _mime)) in files.iter().enumerate() {
        let rel_path = file_paths
            .get(&idx.to_string())
            .cloned()
            .unwrap_or_else(|| filename.clone());

        let full_path = match media_type.as_str() {
            "tv_show" => {
                let season_dir = season
                    .as_ref()
                    .map(|s| format!("Season {}", s.trim_start_matches('0')))
                    .unwrap_or_else(|| "Season 01".to_string());
                format!(
                    "{}/Shows/{}/{}{}/{}/{}",
                    state.config.media_storage_path,
                    user.id,
                    title,
                    year_suffix,
                    season_dir,
                    rel_path,
                )
            }
            "movie" => {
                format!(
                    "{}/Movies/{}/{}{}/{}",
                    state.config.media_storage_path, user.id, title, year_suffix, rel_path,
                )
            }
            "music" => {
                let artist_dir = artist.as_deref().unwrap_or("Unknown Artist");
                format!(
                    "{}/Music/{}/{}/{}/{}",
                    state.config.media_storage_path, user.id, artist_dir, title, rel_path,
                )
            }
            _ => {
                return Err(AppError::BadRequest(format!(
                    "unknown media_type: {}",
                    media_type
                )));
            }
        };

        // Create parent directory
        if let Some(parent) = std::path::Path::new(&full_path).parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;
        }

        tokio::fs::write(&full_path, data)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("write error: {e}")))?;
    }

    // Trigger Jellyfin library refresh
    let jf_client = JellyfinClient::new(
        &state.config.jellyfin_url,
        &state.config.jellyfin_device_id,
        state.http.clone(),
    );
    let _ = jf_client
        .refresh_library(&state.config.jellyfin_admin_token)
        .await;

    tracing::info!(
        user_id = %user.id,
        media_type = %media_type,
        title = %title,
        file_count,
        "media upload complete"
    );

    Ok(Json(json!({
        "status": "uploaded",
        "service": "media",
        "mediaType": media_type,
        "title": title,
        "fileCount": file_count,
    })))
}
