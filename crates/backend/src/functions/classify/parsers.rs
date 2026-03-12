//! Filename parsing utilities for classification and grouping.

use crate::constants;
use steadfirm_shared::classify::FileEntry;

/// Parse S##E## patterns from a string, returning (season, episode, optional end_episode).
pub fn parse_season_episode(s: &str) -> Option<(u32, u32, Option<u32>)> {
    let lower = s.to_lowercase();
    let bytes = lower.as_bytes();

    for i in 0..bytes.len().saturating_sub(3) {
        if bytes[i] != b's' {
            continue;
        }
        if i > 0 && bytes[i - 1].is_ascii_alphanumeric() {
            continue;
        }

        let season_start = i + 1;
        let mut j = season_start;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            j += 1;
        }
        if j == season_start || j >= bytes.len() {
            continue;
        }
        let season: u32 = match lower[season_start..j].parse() {
            Ok(n) => n,
            Err(_) => continue,
        };

        if bytes[j] != b'e' {
            continue;
        }

        let ep_start = j + 1;
        let mut k = ep_start;
        while k < bytes.len() && bytes[k].is_ascii_digit() {
            k += 1;
        }
        if k == ep_start {
            continue;
        }
        let episode: u32 = match lower[ep_start..k].parse() {
            Ok(n) => n,
            Err(_) => continue,
        };

        let mut episode_end: Option<u32> = None;
        if k < bytes.len() {
            let next_start = if bytes[k] == b'-' && k + 1 < bytes.len() && bytes[k + 1] == b'e' {
                k + 2
            } else if bytes[k] == b'e' {
                k + 1
            } else {
                0
            };
            if next_start > 0 && next_start < bytes.len() {
                let mut m = next_start;
                while m < bytes.len() && bytes[m].is_ascii_digit() {
                    m += 1;
                }
                if m > next_start {
                    if let Ok(end_ep) = lower[next_start..m].parse::<u32>() {
                        if end_ep > episode {
                            episode_end = Some(end_ep);
                        }
                    }
                }
            }
        }

        return Some((season, episode, episode_end));
    }

    None
}

/// Extract a movie title and year from a filename, stripping scene release tags.
pub fn parse_movie_name(
    filename: &str,
) -> (String, Option<String>, Option<String>, Option<String>) {
    let stem = filename
        .rsplit('.')
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(".");
    let working = if stem.is_empty() { filename } else { &stem };

    let normalized: String = working
        .chars()
        .map(|c| if c == '.' || c == '_' { ' ' } else { c })
        .collect();

    let mut title_end = normalized.len();
    let mut year: Option<String> = None;
    let mut resolution: Option<String> = None;
    let mut source: Option<String> = None;

    if let Some(paren_start) = normalized.find('(') {
        let rest = &normalized[paren_start + 1..];
        if let Some(paren_end) = rest.find(')') {
            let inside = &rest[..paren_end];
            if inside.len() == 4 && inside.chars().all(|c| c.is_ascii_digit()) {
                let y: u32 = inside.parse().unwrap_or(0);
                if (1920..=2030).contains(&y) {
                    year = Some(inside.to_string());
                    title_end = paren_start;
                }
            }
        }
    }

    if year.is_none() {
        let lower = normalized.to_lowercase();
        for word in lower.split_whitespace() {
            if word.len() == 4 && word.chars().all(|c| c.is_ascii_digit()) {
                let y: u32 = word.parse().unwrap_or(0);
                if (1920..=2030).contains(&y) {
                    year = Some(word.to_string());
                    if let Some(pos) = lower.find(word) {
                        title_end = title_end.min(pos);
                    }
                    break;
                }
            }
        }
    }

    let lower = normalized.to_lowercase();
    for tag in constants::RESOLUTION_TAGS {
        if lower.contains(tag) {
            resolution = Some(tag.to_string());
            if let Some(pos) = lower.find(tag) {
                title_end = title_end.min(pos);
            }
            break;
        }
    }

    for tag in constants::SOURCE_TAGS {
        if lower.contains(tag) {
            source = Some(tag.to_string());
            if let Some(pos) = lower.find(tag) {
                title_end = title_end.min(pos);
            }
            break;
        }
    }

    for tag in constants::CODEC_TAGS {
        if let Some(pos) = lower.find(tag) {
            title_end = title_end.min(pos);
        }
    }

    let title = normalized[..title_end].trim().to_string();

    (title, year, resolution, source)
}

/// Extract a TV show series name from a filename by finding text before S##E##.
pub fn parse_series_name_from_filename(filename: &str) -> String {
    let stem = filename
        .rsplit('.')
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(".");
    let working = if stem.is_empty() { filename } else { &stem };

    let normalized: String = working
        .chars()
        .map(|c| if c == '.' || c == '_' { ' ' } else { c })
        .collect();

    let lower = normalized.to_lowercase();
    for i in 0..lower.len().saturating_sub(3) {
        let bytes = lower.as_bytes();
        if bytes[i] == b's'
            && (i == 0 || !bytes[i - 1].is_ascii_alphanumeric())
            && i + 1 < bytes.len()
            && bytes[i + 1].is_ascii_digit()
        {
            let rest = &lower[i..];
            if parse_season_episode(rest).is_some() {
                let before = normalized[..i].trim();
                if !before.is_empty() {
                    return before.to_string();
                }
            }
        }
    }

    let (title, _, _, _) = parse_movie_name(filename);
    title
}

/// Parse an ABS-style title folder name to extract metadata.
pub fn parse_title_folder(
    folder_name: &str,
) -> (String, Option<String>, Option<String>, Option<String>) {
    let mut title = folder_name.to_string();
    let mut narrator: Option<String> = None;
    let mut year: Option<String> = None;
    let mut sequence: Option<String> = None;

    if let Some(open) = title.find('{') {
        if let Some(close) = title.find('}') {
            if close > open {
                narrator = Some(title[open + 1..close].trim().to_string());
                title = format!("{}{}", &title[..open], &title[close + 1..]);
                title = title.trim().to_string();
            }
        }
    }

    let segments: Vec<&str> = title.split(" - ").map(|s| s.trim()).collect();

    if segments.len() >= 2 {
        let mut remaining = Vec::new();
        for seg in &segments {
            let trimmed = seg.trim_start_matches('(').trim_end_matches(')');
            if year.is_none() && trimmed.len() == 4 && trimmed.chars().all(|c| c.is_ascii_digit()) {
                year = Some(trimmed.to_string());
                continue;
            }
            if sequence.is_none() {
                let lower = trimmed.to_lowercase();
                let seq = extract_sequence(&lower);
                if seq.is_some() {
                    sequence = seq;
                    continue;
                }
            }
            remaining.push(*seg);
        }
        title = remaining.join(" - ");
    } else if !title.is_empty() {
        let trimmed = title.trim_start_matches('(');
        if trimmed.len() >= 4 && trimmed[..4].chars().all(|c| c.is_ascii_digit()) {
            if let Some(rest) = trimmed.get(4..) {
                let rest = rest
                    .trim_start_matches(')')
                    .trim_start_matches(" - ")
                    .trim();
                if !rest.is_empty() {
                    year = Some(trimmed[..4].to_string());
                    title = rest.to_string();
                }
            }
        }
    }

    (title, year, sequence, narrator)
}

/// Try to extract a sequence number from a string like "vol 1", "book 2", "1", "1."
pub fn extract_sequence(s: &str) -> Option<String> {
    let prefixes = ["vol ", "vol. ", "volume ", "book "];
    for prefix in &prefixes {
        if let Some(rest) = s.strip_prefix(prefix) {
            let num: String = rest
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if !num.is_empty() {
                return Some(num.trim_end_matches('.').to_string());
            }
        }
    }
    let num: String = s
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if !num.is_empty() && num.len() <= 4 {
        let after = &s[num.len()..];
        if after.is_empty()
            || after.starts_with(". ")
            || after.starts_with(' ')
            || after.starts_with('.')
        {
            return Some(num.trim_end_matches('.').to_string());
        }
    }
    None
}

/// Try to parse an episode title from a filename.
pub fn parse_episode_title(file: &FileEntry) -> Option<String> {
    let stem = file
        .filename
        .rsplit('.')
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(".");
    let working = if stem.is_empty() {
        &file.filename
    } else {
        &stem
    };

    let normalized: String = working
        .chars()
        .map(|c| if c == '.' || c == '_' { ' ' } else { c })
        .collect();

    let lower = normalized.to_lowercase();

    if parse_season_episode(&lower).is_some() {
        for i in 0..lower.len().saturating_sub(3) {
            let bytes = lower.as_bytes();
            if bytes[i] == b's'
                && (i == 0 || !bytes[i - 1].is_ascii_alphanumeric())
                && parse_season_episode(&lower[i..]).is_some()
            {
                let mut j = i + 1;
                while j < bytes.len() && bytes[j].is_ascii_digit() {
                    j += 1;
                }
                if j < bytes.len() && bytes[j] == b'e' {
                    j += 1;
                    while j < bytes.len() && bytes[j].is_ascii_digit() {
                        j += 1;
                    }
                }
                if j < bytes.len() && bytes[j] == b'-' {
                    j += 1;
                    if j < bytes.len() && bytes[j] == b'e' {
                        j += 1;
                        while j < bytes.len() && bytes[j].is_ascii_digit() {
                            j += 1;
                        }
                    }
                }

                let after = normalized[j..].trim_start_matches([' ', '-']);

                if after.is_empty() {
                    return None;
                }

                let after_lower = after.to_lowercase();
                let mut end = after.len();
                for tag in constants::RESOLUTION_TAGS
                    .iter()
                    .chain(constants::SOURCE_TAGS.iter())
                    .chain(constants::CODEC_TAGS.iter())
                {
                    if let Some(pos) = after_lower.find(tag) {
                        end = end.min(pos);
                    }
                }

                let title = after[..end].trim();
                if !title.is_empty() {
                    return Some(title.to_string());
                }
                return None;
            }
        }
    }

    None
}

/// Get the folder path of a file (everything before the last `/`).
pub fn folder_of(file: &FileEntry) -> Option<String> {
    file.relative_path.as_ref().and_then(|p| {
        let parts: Vec<&str> = p.split('/').collect();
        if parts.len() >= 2 {
            Some(parts[..parts.len() - 1].join("/"))
        } else {
            None
        }
    })
}

/// Extract a 4-digit year from a string like "Breaking Bad (2008)".
pub fn extract_year_from_folder_or_name(name: &str) -> Option<String> {
    if let Some(start) = name.find('(') {
        let rest = &name[start + 1..];
        if let Some(end) = rest.find(')') {
            let inside = &rest[..end];
            if inside.len() == 4 && inside.chars().all(|c| c.is_ascii_digit()) {
                let y: u32 = inside.parse().unwrap_or(0);
                if (1920..=2030).contains(&y) {
                    return Some(inside.to_string());
                }
            }
        }
    }
    None
}

/// Infer the series name from a file's folder structure or filename.
pub fn infer_series_name(file: &FileEntry) -> String {
    if let Some(ref path) = file.relative_path {
        let segments: Vec<&str> = path.split('/').collect();
        if segments.len() >= 2 {
            return segments[0].to_string();
        }
    }
    parse_series_name_from_filename(&file.filename)
}

/// Image extensions that might be a cover image.
const COVER_IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];

/// Check if a filename looks like a cover image.
pub fn is_cover_image(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    if !COVER_IMAGE_EXTENSIONS.contains(&ext) {
        return false;
    }
    let stem = lower.rsplit('.').next_back().unwrap_or(&lower);
    stem.contains("cover") || stem.contains("folder") || stem.contains("front")
}

/// Infer a series name from a reading filename by stripping volume/issue indicators.
pub fn infer_reading_series(filename: &str) -> String {
    let stem = filename
        .rsplit('.')
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(".");
    let working = if stem.is_empty() { filename } else { &stem };

    let normalized: String = working
        .chars()
        .map(|c| if c == '_' { ' ' } else { c })
        .collect();

    let lower = normalized.to_lowercase();

    for prefix in constants::READING_VOLUME_PREFIXES {
        if let Some(pos) = lower.find(prefix) {
            let before = normalized[..pos].trim();
            if !before.is_empty() {
                return before.trim_end_matches([' ', '-', '_']).to_string();
            }
        }
    }

    let trimmed = normalized.trim_end_matches(|c: char| c.is_ascii_digit() || c == ' ' || c == '.');
    if !trimmed.is_empty() && trimmed.len() < normalized.len() {
        return trimmed.trim_end_matches([' ', '-', '_']).to_string();
    }

    normalized
}

/// Parse volume/issue number and title from a reading filename.
pub fn parse_reading_volume(filename: &str) -> (Option<String>, Option<String>, bool) {
    let stem = filename
        .rsplit('.')
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(".");
    let working = if stem.is_empty() { filename } else { &stem };

    let normalized: String = working
        .chars()
        .map(|c| if c == '_' { ' ' } else { c })
        .collect();

    let lower = normalized.to_lowercase();

    let is_special = constants::READING_SPECIAL_MARKERS.iter().any(|marker| {
        lower
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|word| word == *marker)
    });

    for prefix in constants::READING_VOLUME_PREFIXES {
        if let Some(pos) = lower.find(prefix) {
            let after = &lower[pos + prefix.len()..];
            let num: String = after
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if !num.is_empty() {
                let title = after[num.len()..]
                    .trim()
                    .trim_start_matches(['-', ' '])
                    .to_string();
                let title = if title.is_empty() { None } else { Some(title) };
                return (
                    Some(num.trim_end_matches('.').to_string()),
                    title,
                    is_special,
                );
            }
        }
    }

    let parts: Vec<&str> = normalized.split_whitespace().collect();
    if let Some(last) = parts.last() {
        let num: String = last
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if !num.is_empty() && num.len() == last.len() {
            return (
                Some(num.trim_end_matches('.').to_string()),
                None,
                is_special,
            );
        }
    }

    (None, None, is_special)
}
