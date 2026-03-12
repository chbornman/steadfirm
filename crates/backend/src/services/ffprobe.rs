//! ffprobe-based audio metadata extraction.
//!
//! Runs `ffprobe` on uploaded audio files to extract ID3 tags, duration,
//! embedded cover art, and track metadata. Used by the audiobook
//! classification pipeline to distinguish audiobooks from music and to
//! populate metadata for the ABS upload API.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;

use steadfirm_shared::classify::AudioFileProbe;

// ─── ffprobe JSON output types ───────────────────────────────────────

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    format: Option<FfprobeFormat>,
    streams: Option<Vec<FfprobeStream>>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
    tags: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    /// For video streams that are cover art, this is typically "mjpeg" or "png".
    codec_name: Option<String>,
    /// Disposition flags — attached_pic=1 means embedded cover art.
    disposition: Option<FfprobeDisposition>,
}

#[derive(Debug, Deserialize)]
struct FfprobeDisposition {
    attached_pic: Option<u8>,
}

// ─── Public API ──────────────────────────────────────────────────────

/// Metadata extracted from a single audio file via ffprobe.
#[derive(Debug, Clone)]
pub struct ProbeResult {
    /// Duration in seconds.
    pub duration_secs: f64,
    /// ID3/format tags (lowercased keys).
    pub tags: HashMap<String, String>,
    /// Whether the file has an embedded cover image.
    pub has_embedded_cover: bool,
}

#[allow(dead_code)]
impl ProbeResult {
    pub fn tag(&self, key: &str) -> Option<&str> {
        // ID3 tags are case-insensitive; we store lowercased.
        self.tags.get(key).map(|s| s.as_str())
    }

    /// Get artist, falling back to album_artist.
    pub fn artist(&self) -> Option<&str> {
        self.tag("artist")
            .or_else(|| self.tag("album_artist"))
            .or_else(|| self.tag("albumartist"))
            .or_else(|| self.tag("album-artist"))
    }

    pub fn album(&self) -> Option<&str> {
        self.tag("album").or_else(|| self.tag("title"))
    }

    pub fn composer(&self) -> Option<&str> {
        self.tag("composer")
    }

    pub fn genre(&self) -> Option<&str> {
        self.tag("genre")
    }

    pub fn year(&self) -> Option<&str> {
        self.tag("year").or_else(|| self.tag("date"))
    }

    pub fn series(&self) -> Option<&str> {
        self.tag("series").or_else(|| self.tag("mvnm"))
    }

    pub fn series_part(&self) -> Option<&str> {
        self.tag("series-part").or_else(|| self.tag("mvin"))
    }

    pub fn track_number(&self) -> Option<u32> {
        self.tag("track")
            .or_else(|| self.tag("trck"))
            .or_else(|| self.tag("trk"))
            .and_then(|t| {
                // Handle "3/12" format
                t.split('/').next().and_then(|n| n.trim().parse().ok())
            })
    }

    pub fn disc_number(&self) -> Option<u32> {
        self.tag("discnumber")
            .or_else(|| self.tag("disc"))
            .or_else(|| self.tag("disk"))
            .or_else(|| self.tag("tpos"))
            .and_then(|t| t.split('/').next().and_then(|n| n.trim().parse().ok()))
    }

    pub fn track_title(&self) -> Option<&str> {
        self.tag("title")
    }

    /// Convert to the shared AudioFileProbe type for a given file index.
    pub fn to_audio_file_probe(&self, file_index: usize) -> AudioFileProbe {
        AudioFileProbe {
            file_index,
            track_number: self.track_number(),
            disc_number: self.disc_number(),
            duration_secs: self.duration_secs,
            title: self.track_title().map(|s| s.to_string()),
            has_embedded_cover: self.has_embedded_cover,
        }
    }
}

/// Run ffprobe on a file and extract metadata.
///
/// The file can be provided as raw bytes written to a temp path, or
/// as a path to an already-written file.
pub async fn probe_file(path: &Path) -> Result<ProbeResult> {
    let output = tokio::process::Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .await
        .context("failed to run ffprobe")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("ffprobe failed: {stderr}");
    }

    let parsed: FfprobeOutput =
        serde_json::from_slice(&output.stdout).context("failed to parse ffprobe JSON")?;

    let duration_secs = parsed
        .format
        .as_ref()
        .and_then(|f| f.duration.as_ref())
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);

    // Lowercase all tag keys for case-insensitive lookup
    let tags: HashMap<String, String> = parsed
        .format
        .as_ref()
        .and_then(|f| f.tags.as_ref())
        .map(|t| {
            t.iter()
                .map(|(k, v)| (k.to_lowercase(), v.clone()))
                .collect()
        })
        .unwrap_or_default();

    // Check for embedded cover art (video stream with attached_pic disposition)
    let has_embedded_cover = parsed
        .streams
        .as_ref()
        .map(|streams| {
            streams.iter().any(|s| {
                s.codec_type.as_deref() == Some("video")
                    && s.disposition
                        .as_ref()
                        .and_then(|d| d.attached_pic)
                        .unwrap_or(0)
                        == 1
            })
        })
        .unwrap_or(false);

    Ok(ProbeResult {
        duration_secs,
        tags,
        has_embedded_cover,
    })
}

/// Probe audio bytes by writing to a temp file.
/// Returns the probe result and cleans up the temp file.
pub async fn probe_bytes(data: &[u8], filename: &str) -> Result<ProbeResult> {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp3");

    let temp_dir = std::env::temp_dir().join("steadfirm-probe");
    tokio::fs::create_dir_all(&temp_dir).await?;

    let temp_path = temp_dir.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    tokio::fs::write(&temp_path, data).await?;

    let result = probe_file(&temp_path).await;

    // Clean up
    let _ = tokio::fs::remove_file(&temp_path).await;

    result
}

/// Parse a track number from a filename using common patterns.
///
/// Handles patterns like:
///   - `01 - Chapter Title.mp3`
///   - `chapter_03.mp3`
///   - `Track 07.mp3`
///   - `disc1_track03.mp3`
///   - `Book Title - 01.mp3`
pub fn parse_track_from_filename(filename: &str) -> Option<u32> {
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);

    // Try patterns in order of specificity

    // "Track 01", "track01", "Track_01"
    let lower = stem.to_lowercase();
    if let Some(rest) = lower
        .strip_prefix("track")
        .map(|s| s.trim_start_matches(['_', ' ', '-']))
    {
        if let Ok(n) = rest
            .split(|c: char| !c.is_ascii_digit())
            .next()
            .unwrap_or("")
            .parse::<u32>()
        {
            return Some(n);
        }
    }

    // "Chapter 01", "ch01", "chap_01"
    for prefix in ["chapter", "chap", "ch"] {
        if let Some(rest) = lower
            .strip_prefix(prefix)
            .map(|s| s.trim_start_matches(['_', ' ', '-', '.']))
        {
            if let Ok(n) = rest
                .split(|c: char| !c.is_ascii_digit())
                .next()
                .unwrap_or("")
                .parse::<u32>()
            {
                return Some(n);
            }
        }
    }

    // Leading number: "01 - Title.mp3", "01_title.mp3"
    let leading: String = stem.chars().take_while(|c| c.is_ascii_digit()).collect();
    if !leading.is_empty() && leading.len() <= 4 {
        if let Ok(n) = leading.parse::<u32>() {
            return Some(n);
        }
    }

    // Trailing number after " - ": "Title - 01.mp3"
    if let Some(last) = stem.rsplit(" - ").next() {
        let trailing: String = last.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !trailing.is_empty() {
            if let Ok(n) = trailing.parse::<u32>() {
                return Some(n);
            }
        }
    }

    None
}
