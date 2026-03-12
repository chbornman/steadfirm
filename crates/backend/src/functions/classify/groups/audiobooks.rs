//! Audiobook group detection from classified files.

use std::collections::HashMap;

use steadfirm_shared::classify::{AudiobookGroup, FileClassificationResult, FileEntry};
use steadfirm_shared::ServiceKind;

use crate::functions::classify::llm::LlmMetadataMap;
use crate::functions::classify::parsers::{is_cover_image, parse_title_folder};

pub fn detect_audiobook_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
    llm_metadata: &LlmMetadataMap,
) -> Vec<AudiobookGroup> {
    let audiobook_indices: Vec<usize> = results
        .iter()
        .enumerate()
        .filter(|(_, r)| matches!(r.service, ServiceKind::Audiobooks))
        .map(|(i, _)| i)
        .collect();

    if audiobook_indices.is_empty() {
        return vec![];
    }

    // Also collect cover images that share folders with audiobook files
    let audiobook_folders: std::collections::HashSet<String> = audiobook_indices
        .iter()
        .filter_map(|&idx| {
            let file = &files[idx];
            file.relative_path.as_ref().and_then(|p| {
                let parts: Vec<&str> = p.split('/').collect();
                if parts.len() >= 2 {
                    Some(parts[..parts.len() - 1].join("/"))
                } else {
                    None
                }
            })
        })
        .collect();

    let cover_images: HashMap<String, usize> = files
        .iter()
        .enumerate()
        .filter_map(|(idx, file)| {
            if !is_cover_image(&file.filename) {
                return None;
            }
            file.relative_path.as_ref().and_then(|p| {
                let parts: Vec<&str> = p.split('/').collect();
                if parts.len() >= 2 {
                    let folder = parts[..parts.len() - 1].join("/");
                    if audiobook_folders.contains(&folder) {
                        return Some((folder, idx));
                    }
                }
                None
            })
        })
        .collect();

    let mut folder_groups: HashMap<String, Vec<usize>> = HashMap::new();

    for &idx in &audiobook_indices {
        let file = &files[idx];
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
        folder_groups.entry(folder_key).or_default().push(idx);
    }

    let mut groups = Vec::new();

    for (folder_path, indices) in &folder_groups {
        if folder_path == "ungrouped" {
            for &idx in indices {
                let file = &files[idx];
                let (title, author, series) = if let Some(llm) = llm_metadata
                    .get(&idx)
                    .and_then(|l| l.audiobook_metadata.as_ref())
                {
                    (llm.title.clone(), llm.author.clone(), llm.series.clone())
                } else {
                    let t = file
                        .filename
                        .rsplit('.')
                        .next_back()
                        .unwrap_or(&file.filename)
                        .to_string();
                    (t, None, None)
                };
                groups.push(AudiobookGroup {
                    title,
                    author,
                    series,
                    series_sequence: None,
                    narrator: None,
                    year: None,
                    file_indices: vec![idx],
                    cover_index: None,
                    probe_data: None,
                });
            }
            continue;
        }

        let segments: Vec<&str> = folder_path.split('/').collect();

        let (author, raw_title, series) = match segments.len() {
            0 => (None, folder_path.clone(), None),
            1 => (None, segments[0].to_string(), None),
            2 => (Some(segments[0].to_string()), segments[1].to_string(), None),
            _ => (
                Some(segments[0].to_string()),
                segments[segments.len() - 1].to_string(),
                Some(segments[1..segments.len() - 1].join(" / ")),
            ),
        };

        let (title, parsed_year, parsed_sequence, parsed_narrator) = parse_title_folder(&raw_title);

        let llm_ab = indices
            .first()
            .and_then(|&idx| llm_metadata.get(&idx))
            .and_then(|l| l.audiobook_metadata.as_ref());

        let final_title = llm_ab.map(|m| m.title.clone()).unwrap_or(title);
        let final_author = llm_ab.and_then(|m| m.author.clone()).or(author);
        let final_series = llm_ab.and_then(|m| m.series.clone()).or(series);

        let cover_index = cover_images.get(folder_path).copied();

        groups.push(AudiobookGroup {
            title: final_title,
            author: final_author,
            series: final_series,
            series_sequence: parsed_sequence,
            narrator: parsed_narrator,
            year: parsed_year,
            file_indices: indices.clone(),
            cover_index,
            probe_data: None,
        });
    }

    groups
}
