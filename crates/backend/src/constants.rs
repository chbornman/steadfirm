//! Named constants for tuning parameters that don't vary between deployments.
//! For environment-specific values, see `config.rs`.

// ─── Pagination ──────────────────────────────────────────────────────

/// Default page size when the client omits `pageSize`.
pub const DEFAULT_PAGE_SIZE: u32 = 50;

// ─── Upstream proxying ───────────────────────────────────────────────

/// Max characters of an upstream error body to include in logs/responses.
pub const UPSTREAM_ERROR_BODY_MAX_CHARS: usize = 500;

// ─── Provisioning ────────────────────────────────────────────────────

/// Length of randomly generated passwords for service user accounts.
pub const GENERATED_PASSWORD_LENGTH: usize = 32;

/// Exponential backoff base (seconds) for provisioning retries: 2^attempt.
pub const PROVISION_RETRY_BACKOFF_BASE_SECS: u64 = 2;

// ─── Caching ─────────────────────────────────────────────────────────

/// TTL for in-memory Paperless correspondent/tag name cache.
pub const PAPERLESS_NAME_CACHE_TTL_SECS: u64 = 300;

/// Page size when fetching all tags/correspondents from Paperless for caching.
pub const PAPERLESS_METADATA_PAGE_SIZE: &str = "1000";

// ─── Media ───────────────────────────────────────────────────────────

/// Default max width for audiobook cover image proxying.
pub const COVER_IMAGE_MAX_WIDTH: u32 = 800;

/// Default image format for Jellyfin image proxying.
pub const JELLYFIN_IMAGE_FORMAT: &str = "Webp";

/// Default image quality (1-100) for Jellyfin image proxying.
pub const JELLYFIN_IMAGE_QUALITY: &str = "90";

/// Number of recent Audiobookshelf listening sessions to fetch.
pub const AUDIOBOOKSHELF_SESSIONS_PAGE_SIZE: &str = "10";

// ─── Startup ─────────────────────────────────────────────────────────

/// Delay after Jellyfin startup wizard completion to let it finalize.
pub const JELLYFIN_WIZARD_SETTLE_SECS: u64 = 2;

/// Total number of services that should be initialized.
pub const EXPECTED_SERVICE_COUNT: usize = 5;

/// Length of Kavita auth keys created via `POST /api/Account/create-auth-key`.
/// Valid range: 8–32.
pub const KAVITA_AUTH_KEY_LENGTH: u32 = 32;

// ─── AI classification ───────────────────────────────────────────────

/// Confidence threshold below which files are sent to the LLM for
/// classification. Files at or above this threshold keep their
/// heuristic classification.
pub const AI_CONFIDENCE_THRESHOLD: f32 = 0.85;

/// Default Anthropic model for classification.
pub const DEFAULT_ANTHROPIC_MODEL: &str = "claude-sonnet-4-6";

/// Default model name for local OpenAI-compatible servers.
pub const DEFAULT_LOCAL_MODEL: &str = "default";

/// Max tokens for the classification LLM response.
/// 4096 was too low — 48 files caused truncation after ~33 classifications.
pub const CLASSIFY_MAX_TOKENS: u64 = 16384;

/// Maximum number of files to send to the LLM in a single batch.
/// Larger batches are chunked.
pub const CLASSIFY_BATCH_SIZE: usize = 50;

// ─── Audiobook detection ─────────────────────────────────────────────

/// Minimum total duration (seconds) for a set of audio files to be
/// considered an audiobook rather than a music album. ~45 minutes.
pub const AUDIOBOOK_MIN_DURATION_SECS: f64 = 2700.0;

/// Audio file extensions that might be audiobook chapters.
pub const AUDIOBOOK_AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "m4b", "flac", "ogg", "opus", "aac", "wma", "wav",
];

/// Regex-style keywords in filenames/paths that suggest audiobook content.
pub const AUDIOBOOK_FILENAME_KEYWORDS: &[&str] = &[
    "chapter",
    "chap",
    "ch",
    "part",
    "section",
    "narrated",
    "unabridged",
    "abridged",
    "audiobook",
];

// ─── TV Show detection ───────────────────────────────────────────────

/// Video file extensions that can be TV shows or movies.
pub const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "wmv", "webm", "flv", "m4v", "ts",
];

/// Subtitle file extensions.
pub const SUBTITLE_EXTENSIONS: &[&str] = &["srt", "ass", "ssa", "sub", "idx", "vtt"];

/// Scene release resolution tags.
pub const RESOLUTION_TAGS: &[&str] = &[
    "2160p", "4k", "uhd", "1080p", "1080i", "720p", "576p", "480p",
];

/// Scene release source/quality tags.
pub const SOURCE_TAGS: &[&str] = &[
    "bluray", "blu-ray", "bdrip", "brrip", "remux", "web-dl", "webdl", "webrip", "web", "hdtv",
    "pdtv", "dsr", "dvdrip", "dvd", "hdcam", "cam", "ts", "tc",
];

/// Codec tags to strip from filenames when parsing titles.
pub const CODEC_TAGS: &[&str] = &[
    "x264", "x265", "h264", "h265", "hevc", "avc", "xvid", "divx", "aac", "ac3", "dts", "flac",
    "dd5.1", "7.1", "5.1", "atmos",
];

// ─── Music detection ─────────────────────────────────────────────────

/// Path keywords that indicate music content (not audiobooks).
pub const MUSIC_PATH_KEYWORDS: &[&str] = &[
    "music",
    "album",
    "discography",
    "playlist",
    "single",
    "ep",
    "soundtrack",
    "ost",
];

/// Music audio extensions (same as audiobook but context differs).
pub const MUSIC_AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "ogg", "opus", "aac", "wma", "wav", "m4a", "alac", "ape", "wv",
];

// ─── Reading detection ───────────────────────────────────────────────

/// Ebook file extensions.
pub const EBOOK_EXTENSIONS: &[&str] = &["epub", "mobi", "azw", "azw3", "fb2"];

/// Comic/manga file extensions.
pub const COMIC_EXTENSIONS: &[&str] = &["cbz", "cbr", "cb7", "cbt", "cba"];

/// Volume indicators in filenames for reading content.
pub const READING_VOLUME_PREFIXES: &[&str] = &[
    "vol ", "vol. ", "volume ", "v", "tome ", "tome. ", "issue ", "issue. ", "#",
];

/// Special markers in reading filenames.
pub const READING_SPECIAL_MARKERS: &[&str] = &["sp", "special", "specials", "oneshot", "one-shot"];

// ─── Search ──────────────────────────────────────────────────────────

/// Maximum number of results to return per service in a global search.
pub const SEARCH_PER_SERVICE_LIMIT: u32 = 10;

/// Timeout for individual service search calls (seconds). If a service
/// doesn't respond within this window, results from other services are
/// still returned.
pub const SEARCH_SERVICE_TIMEOUT_SECS: u64 = 5;

/// Maximum query length accepted by the search endpoint. Queries longer
/// than this are rejected with 400 Bad Request.
pub const SEARCH_MAX_QUERY_LENGTH: usize = 500;

/// Max tokens for the search query compiler LLM response. Much smaller
/// than classification — the output is just a JSON object with a few
/// per-service queries, not per-file reasoning.
pub const SEARCH_LLM_MAX_TOKENS: u64 = 2048;

/// Minimum query length to consider for LLM-enhanced search. Shorter
/// queries are treated as literal and skip the LLM entirely.
pub const SEARCH_LLM_MIN_QUERY_WORDS: usize = 3;
