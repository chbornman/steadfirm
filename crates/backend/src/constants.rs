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
