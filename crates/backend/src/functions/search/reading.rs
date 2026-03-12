//! Search reading content via Kavita.

use crate::auth::AuthUser;
use crate::services::KavitaClient;
use crate::AppState;
use steadfirm_shared::search::{SearchResultItem, ServiceSearchResult};
use steadfirm_shared::ServiceKind;

use super::helpers::kavita_format_name;

/// Search reading content via Kavita.
pub async fn search_reading(
    state: &AppState,
    user: &AuthUser,
    query: &str,
    limit: u32,
) -> Result<ServiceSearchResult, String> {
    let cred = user.credentials.kavita.as_ref().ok_or("not provisioned")?;
    let client = KavitaClient::new(&state.config.kavita_url, state.http.clone());

    let resp = client
        .search(&cred.api_key, query)
        .await
        .map_err(|e| e.to_string())?;

    // Kavita search returns { series: [...], readingLists: [...], ... }
    let mut items: Vec<SearchResultItem> = resp["series"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .take(limit as usize)
        .filter_map(|series| {
            let id = series["seriesId"]
                .as_u64()
                .or_else(|| series["id"].as_u64())?;
            let name = series["name"].as_str().unwrap_or("Unknown");
            let library_id = series["libraryId"].as_i64().unwrap_or(0);
            let format = series["format"]
                .as_u64()
                .map(kavita_format_name)
                .unwrap_or_default();

            Some(SearchResultItem {
                id: id.to_string(),
                title: name.to_string(),
                subtitle: if format.is_empty() {
                    None
                } else {
                    Some(format)
                },
                image_url: Some(format!("/api/v1/reading/{id}/cover?libraryId={library_id}")),
                route: format!("/reading/{id}"),
            })
        })
        .collect();

    // Also include individual chapters/files from "chapters" results.
    if let Some(chapters) = resp["chapters"].as_array() {
        for ch in chapters
            .iter()
            .take((limit as usize).saturating_sub(items.len()))
        {
            if let Some(series_id) = ch["seriesId"].as_u64() {
                let name = ch["name"].as_str().unwrap_or("Unknown");
                items.push(SearchResultItem {
                    id: series_id.to_string(),
                    title: name.to_string(),
                    subtitle: Some("Chapter".to_string()),
                    image_url: None,
                    route: format!("/reading/{series_id}"),
                });
            }
        }
    }

    let total = items.len() as u32;

    Ok(ServiceSearchResult {
        service: ServiceKind::Reading,
        items,
        total,
    })
}
