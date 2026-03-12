//! Search audiobooks via Audiobookshelf.

use crate::auth::AuthUser;
use crate::services::AudiobookshelfClient;
use crate::AppState;
use steadfirm_shared::search::{SearchResultItem, ServiceSearchResult};
use steadfirm_shared::ServiceKind;

/// Search audiobooks via Audiobookshelf.
pub async fn search_audiobooks(
    state: &AppState,
    user: &AuthUser,
    query: &str,
    limit: u32,
) -> Result<ServiceSearchResult, String> {
    let cred = user
        .credentials
        .audiobookshelf
        .as_ref()
        .ok_or("not provisioned")?;
    let client = AudiobookshelfClient::new(&state.config.audiobookshelf_url, state.http.clone());

    // Get the first library ID.
    let libraries = client
        .get_libraries(&cred.api_key)
        .await
        .map_err(|e| e.to_string())?;
    let library_id = libraries["libraries"]
        .as_array()
        .and_then(|libs| libs.first())
        .and_then(|lib| lib["id"].as_str())
        .ok_or("no audiobook library found")?;

    let resp = client
        .search(&cred.api_key, library_id, query, limit)
        .await
        .map_err(|e| e.to_string())?;

    // ABS search returns { book: [...], podcast: [...], narrators: [...], ... }
    let items = resp["book"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|entry| {
            // Each entry in search results has a "libraryItem" wrapper.
            let item = entry.get("libraryItem").unwrap_or(entry);
            let id = item["id"].as_str()?;
            let metadata = &item["media"]["metadata"];
            let title = metadata["title"].as_str().unwrap_or("Unknown");
            let author = metadata["authorName"].as_str();

            Some(SearchResultItem {
                id: id.to_string(),
                title: title.to_string(),
                subtitle: author.map(|a| a.to_string()),
                image_url: Some(format!("/api/v1/audiobooks/{id}/cover")),
                route: format!("/audiobooks/{id}"),
            })
        })
        .collect::<Vec<_>>();

    let total = items.len() as u32;

    Ok(ServiceSearchResult {
        service: ServiceKind::Audiobooks,
        items,
        total,
    })
}
