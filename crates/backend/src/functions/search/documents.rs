//! Search documents via Paperless-ngx full-text search.

use crate::auth::AuthUser;
use crate::services::PaperlessClient;
use crate::AppState;
use steadfirm_shared::search::{SearchResultItem, ServiceSearchResult};
use steadfirm_shared::ServiceKind;

use super::helpers::format_date_short;

/// Search documents via Paperless-ngx full-text search.
pub async fn search_documents(
    state: &AppState,
    user: &AuthUser,
    query: &str,
    limit: u32,
) -> Result<ServiceSearchResult, String> {
    let cred = user
        .credentials
        .paperless
        .as_ref()
        .ok_or("not provisioned")?;
    let client = PaperlessClient::new(&state.config.paperless_url, state.http.clone());

    let query_params = vec![
        ("query", query.to_string()),
        ("page_size", limit.to_string()),
    ];

    let resp = client
        .list_documents(&cred.api_key, &query_params)
        .await
        .map_err(|e| e.to_string())?;

    let items = resp["results"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|doc| {
            let id = doc["id"].as_u64()?;
            let title = doc["title"].as_str().unwrap_or("Untitled");
            let correspondent = doc["correspondent"].as_u64();
            let date = doc["created"].as_str().unwrap_or("");

            let subtitle = if let Some(_corr_id) = correspondent {
                // We don't have the name cache here; just show the date.
                Some(format_date_short(date))
            } else {
                Some(format_date_short(date))
            };

            Some(SearchResultItem {
                id: id.to_string(),
                title: title.to_string(),
                subtitle,
                image_url: Some(format!("/api/v1/documents/{id}/thumbnail")),
                route: "/documents".to_string(),
            })
        })
        .collect::<Vec<_>>();

    let total = resp["count"].as_u64().unwrap_or(items.len() as u64) as u32;

    Ok(ServiceSearchResult {
        service: ServiceKind::Documents,
        items,
        total,
    })
}
