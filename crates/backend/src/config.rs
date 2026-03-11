use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    // Server
    pub port: u16,
    pub database_url: String,

    // Admin credentials for user provisioning (each service's admin account)
    pub immich_url: String,
    pub immich_admin_api_key: String,

    pub jellyfin_url: String,
    pub jellyfin_admin_token: String,

    pub paperless_url: String,
    pub paperless_admin_token: String,

    pub audiobookshelf_url: String,
    pub audiobookshelf_admin_token: String,

    // Local file storage
    pub files_storage_path: String,

    // Jellyfin-specific (static per backend instance)
    pub jellyfin_device_id: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            port: env_or("PORT", "3001").parse()?,
            database_url: env_required("DATABASE_URL")?,

            immich_url: env_or("IMMICH_URL", "http://immich-server:2283"),
            immich_admin_api_key: env_or("IMMICH_ADMIN_API_KEY", ""),

            jellyfin_url: env_or("JELLYFIN_URL", "http://jellyfin:8096"),
            jellyfin_admin_token: env_or("JELLYFIN_ADMIN_TOKEN", ""),

            paperless_url: env_or("PAPERLESS_URL", "http://paperless:8000"),
            paperless_admin_token: env_or("PAPERLESS_ADMIN_TOKEN", ""),

            audiobookshelf_url: env_or("AUDIOBOOKSHELF_URL", "http://audiobookshelf:80"),
            audiobookshelf_admin_token: env_or("AUDIOBOOKSHELF_ADMIN_TOKEN", ""),

            files_storage_path: env_or("FILES_STORAGE_PATH", "/data/steadfirm/files"),

            jellyfin_device_id: env_or("JELLYFIN_DEVICE_ID", &uuid::Uuid::new_v4().to_string()),
        })
    }
}

fn env_required(key: &str) -> Result<String> {
    std::env::var(key).with_context(|| format!("{key} must be set"))
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}
