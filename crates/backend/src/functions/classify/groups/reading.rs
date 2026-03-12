//! Reading group detection from classified files.

use std::collections::HashMap;

use steadfirm_shared::classify::{
    FileClassificationResult, FileEntry, ReadingGroup, ReadingVolume,
};
use steadfirm_shared::ServiceKind;

use crate::functions::classify::llm::LlmMetadataMap;
use crate::functions::classify::parsers::{infer_reading_series, parse_reading_volume};

pub fn detect_reading_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
    llm_metadata: &LlmMetadataMap,
) -> Vec<ReadingGroup> {
    let reading_exts: std::collections::HashSet<&str> = crate::constants::EBOOK_EXTENSIONS
        .iter()
        .chain(crate::constants::COMIC_EXTENSIONS.iter())
        .copied()
        .collect();

    let mut folder_groups: HashMap<String, Vec<usize>> = HashMap::new();

    for (i, result) in results.iter().enumerate() {
        if !matches!(result.service, ServiceKind::Reading) {
            continue;
        }
        let file = &files[i];
        let ext = file
            .filename
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_lowercase();

        if !reading_exts.contains(ext.as_str()) && ext != "pdf" {
            continue;
        }

        let folder_key = if let Some(series) = llm_metadata
            .get(&i)
            .and_then(|l| l.reading_metadata.as_ref())
            .and_then(|m| m.series.clone())
        {
            series
        } else {
            match &file.relative_path {
                Some(path) => {
                    let parts: Vec<&str> = path.split('/').collect();
                    if parts.len() >= 2 {
                        parts[0].to_string()
                    } else {
                        infer_reading_series(&file.filename)
                    }
                }
                None => infer_reading_series(&file.filename),
            }
        };
        folder_groups.entry(folder_key).or_default().push(i);
    }

    if folder_groups.is_empty() {
        return vec![];
    }

    let mut groups = Vec::new();

    for (series_name, indices) in &folder_groups {
        let mut volumes: Vec<ReadingVolume> = indices
            .iter()
            .map(|&idx| {
                let file = &files[idx];
                let ext = file
                    .filename
                    .rsplit('.')
                    .next()
                    .unwrap_or("")
                    .to_lowercase();

                let (parsed_number, parsed_title, is_special) =
                    parse_reading_volume(&file.filename);

                let llm_reading = llm_metadata
                    .get(&idx)
                    .and_then(|l| l.reading_metadata.as_ref());

                let number = llm_reading.and_then(|m| m.volume.clone()).or(parsed_number);
                let title = llm_reading
                    .map(|m| Some(m.title.clone()))
                    .unwrap_or(parsed_title);

                ReadingVolume {
                    number,
                    title,
                    format: ext,
                    is_special,
                    file_index: idx,
                }
            })
            .collect();

        volumes.sort_by(|a, b| {
            let num_a = a
                .number
                .as_ref()
                .and_then(|n| n.parse::<f64>().ok())
                .unwrap_or(f64::MAX);
            let num_b = b
                .number
                .as_ref()
                .and_then(|n| n.parse::<f64>().ok())
                .unwrap_or(f64::MAX);
            num_a
                .partial_cmp(&num_b)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        groups.push(ReadingGroup {
            series_name: series_name.clone(),
            volumes,
            file_indices: indices.clone(),
        });
    }

    groups
}
