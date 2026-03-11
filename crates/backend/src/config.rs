use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    // Server
    pub port: u16,
    pub database_url: String,
    pub db_max_connections: u32,

    // HTTP client
    pub http_timeout_secs: u64,
    pub http_connect_timeout_secs: u64,

    // Upload limits
    pub max_upload_bytes: usize,

    // Master admin password — used for all service admin accounts.
    // Deterministic so we can re-authenticate if DB is wiped but service volumes persist.
    pub admin_password: String,

    // Service URLs
    pub immich_url: String,
    pub jellyfin_url: String,
    pub paperless_url: String,
    pub audiobookshelf_url: String,

    // Admin tokens — populated from DB on startup (or env override)
    pub immich_admin_api_key: String,
    pub jellyfin_admin_token: String,
    pub paperless_admin_token: String,
    pub audiobookshelf_admin_token: String,

    // Admin identities — used during service initialization
    pub immich_admin_email: String,
    pub jellyfin_admin_username: String,
    pub paperless_admin_username: String,
    pub audiobookshelf_admin_username: String,

    // Storage paths
    pub files_storage_path: String,
    pub media_storage_path: String,
    pub audiobooks_storage_path: String,

    // Jellyfin-specific (static per backend instance)
    pub jellyfin_device_id: String,

    // Shared secret for webhook signature verification (BetterAuth → Backend)
    pub webhook_secret: String,

    // Provisioning
    pub provision_max_retries: u32,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            port: env_or("PORT", "3001").parse()?,
            database_url: env_required("DATABASE_URL")?,
            db_max_connections: env_or("DB_MAX_CONNECTIONS", "10").parse()?,

            http_timeout_secs: env_or("HTTP_TIMEOUT_SECS", "30").parse()?,
            http_connect_timeout_secs: env_or("HTTP_CONNECT_TIMEOUT_SECS", "5").parse()?,

            max_upload_bytes: env_or(
                "MAX_UPLOAD_BYTES",
                &(2 * 1024 * 1024 * 1024_usize).to_string(),
            )
            .parse()?,

            admin_password: env_required("ADMIN_PASSWORD")?,

            immich_url: env_or("IMMICH_URL", "http://immich-server:2283"),
            jellyfin_url: env_or("JELLYFIN_URL", "http://jellyfin:8096"),
            paperless_url: env_or("PAPERLESS_URL", "http://paperless:8000"),
            audiobookshelf_url: env_or("AUDIOBOOKSHELF_URL", "http://audiobookshelf:80"),

            // Empty by default — loaded from DB by startup module.
            immich_admin_api_key: env_or("IMMICH_ADMIN_API_KEY", ""),
            jellyfin_admin_token: env_or("JELLYFIN_ADMIN_TOKEN", ""),
            paperless_admin_token: env_or("PAPERLESS_ADMIN_TOKEN", ""),
            audiobookshelf_admin_token: env_or("AUDIOBOOKSHELF_ADMIN_TOKEN", ""),

            immich_admin_email: env_or("IMMICH_ADMIN_EMAIL", "admin@steadfirm.local"),
            jellyfin_admin_username: env_or("JELLYFIN_ADMIN_USERNAME", "admin"),
            paperless_admin_username: env_or("PAPERLESS_ADMIN_USERNAME", "admin"),
            audiobookshelf_admin_username: env_or("AUDIOBOOKSHELF_ADMIN_USERNAME", "root"),

            files_storage_path: env_or("FILES_STORAGE_PATH", "/data/steadfirm/files"),
            media_storage_path: env_or("MEDIA_STORAGE_PATH", "/data/steadfirm/media"),
            audiobooks_storage_path: env_or(
                "AUDIOBOOKS_STORAGE_PATH",
                "/data/steadfirm/audiobooks",
            ),

            jellyfin_device_id: env_or("JELLYFIN_DEVICE_ID", &uuid::Uuid::new_v4().to_string()),

            webhook_secret: env_required("WEBHOOK_SECRET")?,

            provision_max_retries: env_or("PROVISION_MAX_RETRIES", "3").parse()?,
        })
    }
}

fn env_required(key: &str) -> Result<String> {
    std::env::var(key).with_context(|| format!("{key} must be set"))
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}
