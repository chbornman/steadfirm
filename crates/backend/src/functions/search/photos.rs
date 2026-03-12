//! Search photos via Immich smart search (CLIP).

use serde_json::json;

use crate::auth::AuthUser;
use crate::services::ImmichClient;
use crate::AppState;
use steadfirm_shared::search::{SearchResultItem, ServiceSearchResult};
use steadfirm_shared::ServiceKind;

use super::helpers::format_photo_subtitle;

/// Search photos via Immich smart search (CLIP).
pub async fn search_photos(
    state: &AppState,
    user: &AuthUser,
    query: &str,
    limit: u32,
) -> Result<ServiceSearchResult, String> {
    let cred = user.credentials.immich.as_ref().ok_or("not provisioned")?;
    let client = ImmichClient::new(&state.config.immich_url, state.http.clone());

    let body = json!({
        "query": query,
        "page": 1,
        "size": limit,
    });

    let resp = client
        .smart_search(&cred.api_key, &body)
        .await
        .map_err(|e| e.to_string())?;

    let items = resp["assets"]["items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|asset| {
            let id = asset["id"].as_str()?;
            let filename = asset["originalFileName"].as_str().unwrap_or("Unknown");
            let date = asset["localDateTime"]
                .as_str()
                .or_else(|| asset["fileCreatedAt"].as_str())
                .unwrap_or("");
            let is_video = asset["type"].as_str() == Some("VIDEO");

            Some(SearchResultItem {
                id: id.to_string(),
                title: filename.to_string(),
                subtitle: Some(format_photo_subtitle(date, is_video)),
                image_url: Some(format!("/api/v1/photos/{id}/thumbnail")),
                route: "/photos".to_string(),
            })
        })
        .collect::<Vec<_>>();

    let total = resp["assets"]["total"]
        .as_u64()
        .unwrap_or(items.len() as u64) as u32;

    Ok(ServiceSearchResult {
        service: ServiceKind::Photos,
        items,
        total,
    })
}
