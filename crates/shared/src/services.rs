/// Configuration for connecting to underlying self-hosted services
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ServiceConfig {
    pub immich_url: Option<String>,
    pub immich_api_key: Option<String>,
    pub jellyfin_url: Option<String>,
    pub jellyfin_api_key: Option<String>,
    pub paperless_url: Option<String>,
    pub paperless_token: Option<String>,
    pub audiobookshelf_url: Option<String>,
    pub audiobookshelf_token: Option<String>,
    pub kavita_url: Option<String>,
    pub kavita_api_key: Option<String>,
}
