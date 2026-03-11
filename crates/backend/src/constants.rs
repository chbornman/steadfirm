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
pub const EXPECTED_SERVICE_COUNT: usize = 4;
