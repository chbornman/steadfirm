//! Movie group detection from classified files.

use steadfirm_shared::classify::{FileClassificationResult, FileEntry, MovieGroup};
use steadfirm_shared::ServiceKind;

use crate::functions::classify::llm::LlmMetadataMap;
use crate::functions::classify::parsers::{folder_of, parse_movie_name};

pub fn detect_movie_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
    tv_show_file_indices: &std::collections::HashSet<usize>,
    llm_metadata: &LlmMetadataMap,
) -> Vec<MovieGroup> {
    let video_exts: std::collections::HashSet<&str> =
        crate::constants::VIDEO_EXTENSIONS.iter().copied().collect();
    let subtitle_exts: std::collections::HashSet<&str> = crate::constants::SUBTITLE_EXTENSIONS
        .iter()
        .copied()
        .collect();

    let mut groups = Vec::new();

    for (i, result) in results.iter().enumerate() {
        if !matches!(result.service, ServiceKind::Media) {
            continue;
        }
        if tv_show_file_indices.contains(&i) {
            continue;
        }

        let file = &files[i];
        let ext = file
            .filename
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_lowercase();

        if !video_exts.contains(ext.as_str()) {
            continue;
        }

        let (parsed_title, parsed_year, resolution, source) = parse_movie_name(&file.filename);

        let llm_movie = llm_metadata
            .get(&i)
            .and_then(|l| l.media_metadata.as_ref())
            .filter(|m| m.media_type == "movie");

        let title = llm_movie.map(|m| m.title.clone()).unwrap_or(parsed_title);
        let year = llm_movie.and_then(|m| m.year.clone()).or(parsed_year);

        if title.is_empty() {
            continue;
        }

        let movie_folder = folder_of(file);
        let subtitle_indices: Vec<usize> = if let Some(ref folder) = movie_folder {
            files
                .iter()
                .enumerate()
                .filter(|(idx, f)| {
                    *idx != i
                        && !tv_show_file_indices.contains(idx)
                        && subtitle_exts.contains(
                            f.filename
                                .rsplit('.')
                                .next()
                                .unwrap_or("")
                                .to_lowercase()
                                .as_str(),
                        )
                        && folder_of(f).as_ref() == Some(folder)
                })
                .map(|(idx, _)| idx)
                .collect()
        } else {
            vec![]
        };

        let extra_exts = ["nfo", "jpg", "jpeg", "png", "webp"];
        let extra_indices: Vec<usize> = if let Some(ref folder) = movie_folder {
            files
                .iter()
                .enumerate()
                .filter(|(idx, f)| {
                    *idx != i
                        && !tv_show_file_indices.contains(idx)
                        && !subtitle_indices.contains(idx)
                        && extra_exts.contains(
                            &f.filename
                                .rsplit('.')
                                .next()
                                .unwrap_or("")
                                .to_lowercase()
                                .as_str(),
                        )
                        && folder_of(f).as_ref() == Some(folder)
                })
                .map(|(idx, _)| idx)
                .collect()
        } else {
            vec![]
        };

        groups.push(MovieGroup {
            title,
            year,
            resolution,
            source,
            file_index: i,
            subtitle_indices,
            extra_indices,
        });
    }

    groups
}
