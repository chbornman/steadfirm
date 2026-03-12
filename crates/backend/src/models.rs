//! Shared response types matching the frontend's expected shapes.
//! All IDs are strings. All URLs are relative Steadfirm paths.

use serde::Serialize;

// --- Photos (from Immich) ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub id: String,
    #[serde(rename = "type")]
    pub photo_type: String, // "image" or "video"
    pub filename: String,
    pub mime_type: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub date_taken: String, // ISO 8601
    pub is_favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>, // seconds, for videos
    pub thumbnail_url: String,
}

// --- Media (from Jellyfin) ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Movie {
    pub id: String,
    pub title: String,
    pub year: Option<u32>,
    pub runtime: Option<u32>, // minutes
    pub overview: Option<String>,
    pub rating: Option<String>,
    pub image_url: String,
    pub stream_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TvShow {
    pub id: String,
    pub title: String,
    pub year: String, // "2020-2024" or "2020-"
    pub overview: Option<String>,
    pub season_count: Option<u32>,
    pub image_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Season {
    pub id: String,
    pub name: String,
    pub season_number: Option<u32>,
    pub episode_count: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Episode {
    pub id: String,
    pub title: String,
    pub season_number: Option<u32>,
    pub episode_number: Option<u32>,
    pub runtime: Option<u32>,
    pub overview: Option<String>,
    pub image_url: String,
    pub stream_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artist {
    pub id: String,
    pub name: String,
    pub image_url: String,
    pub album_count: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    pub id: String,
    pub name: String,
    pub year: Option<u32>,
    pub artist_name: Option<String>,
    pub track_count: Option<u32>,
    pub image_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub title: String,
    pub track_number: Option<u32>,
    pub duration: Option<f64>, // seconds
    pub artist_name: Option<String>,
    pub album_name: Option<String>,
    pub album_image_url: Option<String>,
    pub stream_url: String,
}

// --- Documents (from Paperless) ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub title: String,
    pub correspondent: Option<String>,
    pub tags: Vec<String>,
    pub date_created: Option<String>,
    pub date_added: Option<String>,
    pub page_count: Option<u32>,
    pub thumbnail_url: String,
    pub preview_url: String,
    pub download_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

// --- Audiobooks (from Audiobookshelf) ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Audiobook {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub narrator: Option<String>,
    pub duration: Option<f64>, // seconds
    pub cover_url: String,
    pub progress: Option<f64>, // seconds listened
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: u32,
    pub title: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    pub session_id: String,
    pub audio_tracks: Vec<AudioTrack>,
    pub current_time: f64,
    pub chapters: Vec<Chapter>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub content_url: String,
    pub mime_type: Option<String>,
    pub duration: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningSession {
    pub id: String,
    pub book_id: String,
    pub book_title: Option<String>,
    pub cover_url: String,
    pub current_time: f64,
    pub duration: f64,
    pub updated_at: Option<String>,
}

// --- Reading (from Kavita) ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub id: String,
    pub name: String,
    pub library_id: i64,
    pub cover_url: String,
    pub pages: u32,
    pub format: String,
    pub pages_read: u32,
}

// --- Files (Steadfirm internal) ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserFile {
    pub id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub created_at: String,
    pub download_url: String,
}
