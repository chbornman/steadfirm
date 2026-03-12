//! Formatting helpers used across search result construction.

/// Format a photo or video subtitle with date.
pub fn format_photo_subtitle(date: &str, is_video: bool) -> String {
    let kind = if is_video { "Video" } else { "Photo" };
    let short_date = format_date_short(date);
    if short_date.is_empty() {
        kind.to_string()
    } else {
        format!("{kind} \u{00b7} {short_date}")
    }
}

/// Take just the date portion of an ISO 8601 string.
pub fn format_date_short(date: &str) -> String {
    date.get(..10).unwrap_or("").to_string()
}

/// Format a byte count as a human-readable size string.
pub fn format_file_size(bytes: i64) -> String {
    const KB: i64 = 1024;
    const MB: i64 = 1024 * 1024;
    const GB: i64 = 1024 * 1024 * 1024;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.0} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}

/// Map Kavita numeric format IDs to human-readable names.
pub fn kavita_format_name(format_id: u64) -> String {
    match format_id {
        0 => "Unknown".to_string(),
        1 => "EPUB".to_string(),
        2 => "PDF".to_string(),
        3 => "Archive (CBZ/CBR)".to_string(),
        4 => "Image".to_string(),
        _ => format!("Format {format_id}"),
    }
}
