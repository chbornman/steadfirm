//! Search media via Jellyfin (movies, shows, music).

use crate::auth::AuthUser;
use crate::services::JellyfinClient;
use crate::AppState;
use steadfirm_shared::search::{SearchResultItem, ServiceSearchResult};
use steadfirm_shared::ServiceKind;

/// Search media via Jellyfin (movies, shows, music).
pub async fn search_media(
    state: &AppState,
    user: &AuthUser,
    query: &str,
    limit: u32,
) -> Result<ServiceSearchResult, String> {
    let cred = user
        .credentials
        .jellyfin
        .as_ref()
        .ok_or("not provisioned")?;
    let client = JellyfinClient::new(
        &state.config.jellyfin_url,
        &state.config.jellyfin_device_id,
        state.http.clone(),
    );

    let limit_str = limit.to_string();
    let jf_query = &[
        ("searchTerm", query),
        ("IncludeItemTypes", "Movie,Series,Audio,MusicAlbum"),
        ("Recursive", "true"),
        ("Limit", &limit_str),
        ("Fields", "Overview,PrimaryImageAspectRatio"),
    ];

    let resp = client
        .get_items(&cred.api_key, &cred.service_user_id, jf_query)
        .await
        .map_err(|e| e.to_string())?;

    let items = resp["Items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|item| {
            let id = item["Id"].as_str()?;
            let name = item["Name"].as_str().unwrap_or("Unknown");
            let item_type = item["Type"].as_str().unwrap_or("");
            let year = item["ProductionYear"].as_u64();

            let subtitle = match item_type {
                "Movie" => year.map(|y| format!("Movie \u{00b7} {y}")),
                "Series" => Some("TV Show".to_string()),
                "Audio" => {
                    let artist = item["AlbumArtist"]
                        .as_str()
                        .or_else(|| item["Artists"].as_array()?.first()?.as_str());
                    artist.map(|a| format!("Music \u{00b7} {a}"))
                }
                "MusicAlbum" => {
                    let artist = item["AlbumArtist"].as_str();
                    artist.map(|a| format!("Album \u{00b7} {a}"))
                }
                _ => Some(item_type.to_string()),
            };

            let route = match item_type {
                "Movie" => "/media/movies".to_string(),
                "Series" => format!("/media/shows/{id}"),
                "Audio" | "MusicAlbum" => "/media/music".to_string(),
                _ => "/media/movies".to_string(),
            };

            Some(SearchResultItem {
                id: id.to_string(),
                title: name.to_string(),
                subtitle,
                image_url: Some(format!("/api/v1/media/{id}/image")),
                route,
            })
        })
        .collect::<Vec<_>>();

    let total = resp["TotalRecordCount"]
        .as_u64()
        .unwrap_or(items.len() as u64) as u32;

    Ok(ServiceSearchResult {
        service: ServiceKind::Media,
        items,
        total,
    })
}
