//! Music album group detection from classified files.

use std::collections::HashMap;

use steadfirm_shared::classify::{FileClassificationResult, FileEntry, MusicAlbumGroup};
use steadfirm_shared::ServiceKind;

use crate::functions::classify::llm::LlmMetadataMap;
use crate::functions::classify::parsers::{extract_year_from_folder_or_name, is_cover_image};

pub fn detect_music_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
    llm_metadata: &LlmMetadataMap,
) -> Vec<MusicAlbumGroup> {
    let audio_exts: std::collections::HashSet<&str> = crate::constants::MUSIC_AUDIO_EXTENSIONS
        .iter()
        .copied()
        .collect();

    let mut folder_groups: HashMap<String, Vec<usize>> = HashMap::new();

    for (i, result) in results.iter().enumerate() {
        if !matches!(result.service, ServiceKind::Media) {
            continue;
        }
        let file = &files[i];
        let ext = file
            .filename
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_lowercase();

        if !audio_exts.contains(ext.as_str()) {
            continue;
        }

        let folder_key = match &file.relative_path {
            Some(path) => {
                let parts: Vec<&str> = path.split('/').collect();
                if parts.len() >= 2 {
                    parts[..parts.len() - 1].join("/")
                } else {
                    "ungrouped".to_string()
                }
            }
            None => "ungrouped".to_string(),
        };
        folder_groups.entry(folder_key).or_default().push(i);
    }

    if folder_groups.is_empty() {
        return vec![];
    }

    let mut groups = Vec::new();

    for (folder_path, indices) in &folder_groups {
        if indices.is_empty() {
            continue;
        }

        let segments: Vec<&str> = folder_path.split('/').collect();
        let (artist, album) = match segments.len() {
            0 | 1 => {
                if folder_path == "ungrouped" {
                    (None, "Unknown Album".to_string())
                } else {
                    (
                        None,
                        segments.last().unwrap_or(&"Unknown Album").to_string(),
                    )
                }
            }
            2 => (Some(segments[0].to_string()), segments[1].to_string()),
            _ => {
                let album_idx = segments.len() - 1;
                let artist_idx = segments.len() - 2;
                (
                    Some(segments[artist_idx].to_string()),
                    segments[album_idx].to_string(),
                )
            }
        };

        let cover_index = files
            .iter()
            .enumerate()
            .find(|(_, file)| {
                if !is_cover_image(&file.filename) {
                    return false;
                }
                if let Some(ref path) = file.relative_path {
                    let parts: Vec<&str> = path.split('/').collect();
                    if parts.len() >= 2 {
                        return parts[..parts.len() - 1].join("/") == *folder_path;
                    }
                }
                false
            })
            .map(|(idx, _)| idx);

        let year = extract_year_from_folder_or_name(&album).or_else(|| {
            let trimmed = album.trim();
            if trimmed.len() >= 4 && trimmed[..4].chars().all(|c| c.is_ascii_digit()) {
                let y: u32 = trimmed[..4].parse().unwrap_or(0);
                if (1920..=2030).contains(&y) {
                    return Some(trimmed[..4].to_string());
                }
            }
            None
        });

        let llm_music = indices
            .first()
            .and_then(|&idx| llm_metadata.get(&idx))
            .and_then(|l| l.media_metadata.as_ref())
            .filter(|m| m.media_type == "music");

        let final_album = llm_music.and_then(|m| m.album.clone()).unwrap_or(album);
        let final_artist = llm_music.and_then(|m| m.artist.clone()).or(artist);
        let final_year = llm_music.and_then(|m| m.year.clone()).or(year);

        groups.push(MusicAlbumGroup {
            album: final_album,
            artist: final_artist,
            year: final_year,
            file_indices: indices.clone(),
            cover_index,
            probe_data: None,
        });
    }

    groups
}
