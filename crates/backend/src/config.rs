use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,

    // Clerk auth
    pub clerk_publishable_key: String,
    pub clerk_secret_key: String,

    // Underlying services
    pub immich_url: Option<String>,
    pub immich_api_key: Option<String>,
    pub jellyfin_url: Option<String>,
    pub jellyfin_api_key: Option<String>,
    pub paperless_url: Option<String>,
    pub paperless_token: Option<String>,
    pub audiobookshelf_url: Option<String>,
    pub audiobookshelf_token: Option<String>,

    // Local file storage for unclassified uploads
    pub files_storage_path: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            port: env_or("PORT", "3001").parse()?,
            database_url: env_required("DATABASE_URL")?,
            clerk_publishable_key: env_required("CLERK_PUBLISHABLE_KEY")?,
            clerk_secret_key: env_required("CLERK_SECRET_KEY")?,
            immich_url: env_optional("IMMICH_URL"),
            immich_api_key: env_optional("IMMICH_API_KEY"),
            jellyfin_url: env_optional("JELLYFIN_URL"),
            jellyfin_api_key: env_optional("JELLYFIN_API_KEY"),
            paperless_url: env_optional("PAPERLESS_URL"),
            paperless_token: env_optional("PAPERLESS_TOKEN"),
            audiobookshelf_url: env_optional("AUDIOBOOKSHELF_URL"),
            audiobookshelf_token: env_optional("AUDIOBOOKSHELF_TOKEN"),
            files_storage_path: env_or("FILES_STORAGE_PATH", "/data/steadfirm/files"),
        })
    }
}

fn env_required(key: &str) -> Result<String> {
    std::env::var(key).with_context(|| format!("{key} must be set"))
}

fn env_optional(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}
