//! TV show group detection from classified files.

use std::collections::HashMap;

use steadfirm_shared::classify::{FileClassificationResult, FileEntry, TvEpisode, TvShowGroup};
use steadfirm_shared::ServiceKind;

use crate::functions::classify::llm::LlmMetadataMap;
use crate::functions::classify::parsers::{
    extract_year_from_folder_or_name, folder_of, infer_series_name, parse_episode_title,
    parse_season_episode,
};

pub fn detect_tv_show_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
    llm_metadata: &LlmMetadataMap,
) -> Vec<TvShowGroup> {
    let video_exts: std::collections::HashSet<&str> =
        crate::constants::VIDEO_EXTENSIONS.iter().copied().collect();
    let subtitle_exts: std::collections::HashSet<&str> = crate::constants::SUBTITLE_EXTENSIONS
        .iter()
        .copied()
        .collect();

    type EpisodeEntry = (usize, u32, u32, Option<u32>, Option<String>);
    let mut show_episodes: HashMap<String, Vec<EpisodeEntry>> = HashMap::new();

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

        if !video_exts.contains(ext.as_str()) {
            continue;
        }

        let combined = format!(
            "{} {}",
            file.relative_path.as_deref().unwrap_or(""),
            file.filename
        )
        .to_lowercase();

        let llm_tv = llm_metadata
            .get(&i)
            .and_then(|l| l.media_metadata.as_ref())
            .filter(|m| m.media_type == "tv_show");

        if let Some((season, episode, episode_end)) = parse_season_episode(&combined) {
            let series_name = llm_tv
                .map(|m| m.title.clone())
                .unwrap_or_else(|| infer_series_name(file));
            show_episodes.entry(series_name).or_default().push((
                i,
                season,
                episode,
                episode_end,
                parse_episode_title(file),
            ));
        } else if let Some(tv) = llm_tv {
            if let (Some(season), Some(episode)) = (tv.season, tv.episode) {
                let series_name = tv.title.clone();
                show_episodes.entry(series_name).or_default().push((
                    i,
                    season,
                    episode,
                    tv.episode_end,
                    parse_episode_title(file),
                ));
            }
        }
    }

    if show_episodes.is_empty() {
        return vec![];
    }

    let mut groups = Vec::new();

    for (series_name, episodes) in &show_episodes {
        let video_indices: Vec<usize> = episodes.iter().map(|(idx, ..)| *idx).collect();

        let video_folders: std::collections::HashSet<String> = video_indices
            .iter()
            .filter_map(|&idx| folder_of(&files[idx]))
            .collect();

        let subtitle_indices: Vec<usize> = files
            .iter()
            .enumerate()
            .filter(|(_, file)| {
                let ext = file
                    .filename
                    .rsplit('.')
                    .next()
                    .unwrap_or("")
                    .to_lowercase();
                if !subtitle_exts.contains(ext.as_str()) {
                    return false;
                }
                if let Some(folder) = folder_of(file) {
                    video_folders.contains(&folder)
                } else {
                    false
                }
            })
            .map(|(i, _)| i)
            .collect();

        let llm_tv_meta = video_indices
            .first()
            .and_then(|&idx| llm_metadata.get(&idx))
            .and_then(|l| l.media_metadata.as_ref())
            .filter(|m| m.media_type == "tv_show");

        let year = llm_tv_meta
            .and_then(|m| m.year.clone())
            .or_else(|| extract_year_from_folder_or_name(series_name));

        let clean_name = if let Some(ref y) = year {
            let stripped = series_name.replace(&format!("({y})"), "").replace(y, "");
            stripped.trim().trim_end_matches(" -").trim().to_string()
        } else {
            series_name.clone()
        };

        let mut tv_episodes: Vec<TvEpisode> = episodes
            .iter()
            .map(|(idx, season, episode, episode_end, title)| TvEpisode {
                season: *season,
                episode: *episode,
                episode_end: *episode_end,
                title: title.clone(),
                file_index: *idx,
            })
            .collect();

        tv_episodes.sort_by(|a, b| a.season.cmp(&b.season).then(a.episode.cmp(&b.episode)));

        let mut all_indices = video_indices;
        all_indices.extend(&subtitle_indices);

        groups.push(TvShowGroup {
            series_name: clean_name,
            year,
            episodes: tv_episodes,
            file_indices: all_indices,
            subtitle_indices,
        });
    }

    groups
}
