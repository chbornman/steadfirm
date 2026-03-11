use serde::{Deserialize, Deserializer, Serialize};

fn deserialize_u32_from_str_opt<'de, D: Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrU32 {
        Str(String),
        Num(u32),
    }
    match StringOrU32::deserialize(d)? {
        StringOrU32::Str(s) => s.parse().map_err(serde::de::Error::custom),
        StringOrU32::Num(n) => Ok(n),
    }
}

/// Standard pagination parameters from the frontend.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationParams {
    #[serde(
        default = "default_page",
        deserialize_with = "deserialize_u32_from_str_opt"
    )]
    pub page: u32,
    #[serde(
        default = "default_page_size",
        deserialize_with = "deserialize_u32_from_str_opt"
    )]
    pub page_size: u32,
}

fn default_page() -> u32 {
    1
}

fn default_page_size() -> u32 {
    crate::constants::DEFAULT_PAGE_SIZE
}

/// Unified paginated response for the frontend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedResponse<T: Serialize> {
    pub items: Vec<T>,
    pub total: u64,
    pub page: u32,
    pub page_size: u32,
    pub next_page: Option<u32>,
}

impl<T: Serialize> PaginatedResponse<T> {
    pub fn new(items: Vec<T>, total: u64, page: u32, page_size: u32) -> Self {
        let next_page = if (page as u64) * (page_size as u64) < total {
            Some(page + 1)
        } else {
            None
        };
        Self {
            items,
            total,
            page,
            page_size,
            next_page,
        }
    }
}

/// Convert frontend 1-indexed page to Jellyfin's startIndex (0-indexed offset).
pub fn page_to_start_index(page: u32, page_size: u32) -> u32 {
    (page.saturating_sub(1)) * page_size
}

/// Convert frontend 1-indexed page to Audiobookshelf's 0-indexed page.
pub fn page_to_abs_page(page: u32) -> u32 {
    page.saturating_sub(1)
}
