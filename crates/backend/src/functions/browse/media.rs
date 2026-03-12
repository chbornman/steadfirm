//! Media browse — Jellyfin proxy (movies, TV shows, music).

use axum::{
    body::Body,
    extract::{Path, Query, State},
    response::Response,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::models::*;
use crate::pagination::*;
use crate::proxy::proxy_binary;
use crate::services::JellyfinClient;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/movies", get(list_movies))
        .route("/shows", get(list_shows))
        .route("/shows/{show_id}/seasons", get(list_seasons))
        .route(
            "/shows/{show_id}/seasons/{season_id}/episodes",
            get(list_episodes),
        )
        .route("/music/artists", get(list_artists))
        .route("/music/artists/{artist_id}/albums", get(list_artist_albums))
        .route("/music/albums/{album_id}/tracks", get(list_album_tracks))
        .route("/{id}", get(get_item))
        .route("/{id}/image", get(get_image))
        .route("/{id}/stream", get(stream_media))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaListParams {
    #[serde(flatten)]
    pagination: PaginationParams,
    #[serde(default)]
    sort: Option<String>,
    #[serde(default)]
    order: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageParams {
    max_width: Option<u32>,
}

fn jf_client(state: &AppState) -> JellyfinClient {
    JellyfinClient::new(
        &state.config.jellyfin_url,
        &state.config.jellyfin_device_id,
        state.http.clone(),
    )
}

fn map_sort(sort: Option<&str>) -> &str {
    match sort {
        Some("title") => "SortName",
        Some("dateAdded") => "DateCreated",
        Some("year") => "ProductionYear",
        _ => "SortName",
    }
}

fn map_order(order: Option<&str>) -> &str {
    match order {
        Some("desc") => "Descending",
        _ => "Ascending",
    }
}

async fn list_movies(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<MediaListParams>,
) -> Result<Json<PaginatedResponse<Movie>>, AppError> {
    let cred = user
        .credentials
        .jellyfin
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    let client = jf_client(&state);
    let start_index = page_to_start_index(params.pagination.page, params.pagination.page_size);
    let sort_by = map_sort(params.sort.as_deref());
    let sort_order = map_order(params.order.as_deref());

    let resp = client
        .get_items(
            &cred.api_key,
            &cred.service_user_id,
            &[
                ("includeItemTypes", "Movie"),
                ("recursive", "true"),
                ("sortBy", sort_by),
                ("sortOrder", sort_order),
                ("startIndex", &start_index.to_string()),
                ("limit", &params.pagination.page_size.to_string()),
                (
                    "fields",
                    "Overview,ProviderIds,PrimaryImageAspectRatio,MediaSources",
                ),
                ("enableUserData", "true"),
                ("enableTotalRecordCount", "true"),
            ],
        )
        .await?;

    let total = resp["totalRecordCount"].as_u64().unwrap_or(0);
    let items = jf_items_to_movies(&resp);

    Ok(Json(PaginatedResponse::new(
        items,
        total,
        params.pagination.page,
        params.pagination.page_size,
    )))
}

async fn list_shows(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<MediaListParams>,
) -> Result<Json<PaginatedResponse<TvShow>>, AppError> {
    let cred = user
        .credentials
        .jellyfin
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    let client = jf_client(&state);
    let start_index = page_to_start_index(params.pagination.page, params.pagination.page_size);

    let resp = client
        .get_items(
            &cred.api_key,
            &cred.service_user_id,
            &[
                ("includeItemTypes", "Series"),
                ("recursive", "true"),
                ("sortBy", "SortName"),
                ("sortOrder", "Ascending"),
                ("startIndex", &start_index.to_string()),
                ("limit", &params.pagination.page_size.to_string()),
                ("fields", "Overview,ChildCount,PrimaryImageAspectRatio"),
                ("enableUserData", "true"),
                ("enableTotalRecordCount", "true"),
            ],
        )
        .await?;

    let total = resp["totalRecordCount"].as_u64().unwrap_or(0);
    let items = jf_items_to_shows(&resp);

    Ok(Json(PaginatedResponse::new(
        items,
        total,
        params.pagination.page,
        params.pagination.page_size,
    )))
}

async fn list_seasons(
    State(state): State<AppState>,
    user: AuthUser,
    Path(show_id): Path<String>,
) -> Result<Json<Vec<Season>>, AppError> {
    let cred = user
        .credentials
        .jellyfin
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    let client = jf_client(&state);
    let resp = client
        .get_seasons(&cred.api_key, &cred.service_user_id, &show_id)
        .await?;

    let items = resp["items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|item| Season {
            id: jf_str(item, "id"),
            name: jf_str(item, "name"),
            season_number: item["indexNumber"].as_u64().map(|v| v as u32),
            episode_count: item["childCount"].as_u64().map(|v| v as u32),
        })
        .collect();

    Ok(Json(items))
}

async fn list_episodes(
    State(state): State<AppState>,
    user: AuthUser,
    Path((show_id, season_id)): Path<(String, String)>,
) -> Result<Json<Vec<Episode>>, AppError> {
    let cred = user
        .credentials
        .jellyfin
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    let client = jf_client(&state);
    let resp = client
        .get_episodes(&cred.api_key, &cred.service_user_id, &show_id, &season_id)
        .await?;

    let items = resp["items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|item| {
            let id = jf_str(item, "id");
            Episode {
                image_url: format!("/api/v1/media/{id}/image"),
                stream_url: format!("/api/v1/media/{id}/stream"),
                id,
                title: jf_str(item, "name"),
                season_number: item["parentIndexNumber"].as_u64().map(|v| v as u32),
                episode_number: item["indexNumber"].as_u64().map(|v| v as u32),
                runtime: item["runTimeTicks"]
                    .as_u64()
                    .map(|t| (t / 600_000_000) as u32),
                overview: item["overview"].as_str().map(|s| s.to_string()),
            }
        })
        .collect();

    Ok(Json(items))
}

async fn list_artists(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<MediaListParams>,
) -> Result<Json<PaginatedResponse<Artist>>, AppError> {
    let cred = user
        .credentials
        .jellyfin
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    let client = jf_client(&state);
    let start_index = page_to_start_index(params.pagination.page, params.pagination.page_size);

    let resp = client
        .get_album_artists(
            &cred.api_key,
            &cred.service_user_id,
            &[
                ("startIndex", &start_index.to_string()),
                ("limit", &params.pagination.page_size.to_string()),
                ("sortBy", "SortName"),
                ("sortOrder", "Ascending"),
                ("fields", "PrimaryImageAspectRatio"),
                ("enableTotalRecordCount", "true"),
            ],
        )
        .await?;

    let total = resp["totalRecordCount"].as_u64().unwrap_or(0);
    let items = resp["items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|item| {
            let id = jf_str(item, "id");
            Artist {
                image_url: format!("/api/v1/media/{id}/image"),
                id,
                name: jf_str(item, "name"),
                album_count: item["childCount"].as_u64().map(|v| v as u32),
            }
        })
        .collect();

    Ok(Json(PaginatedResponse::new(
        items,
        total,
        params.pagination.page,
        params.pagination.page_size,
    )))
}

async fn list_artist_albums(
    State(state): State<AppState>,
    user: AuthUser,
    Path(artist_id): Path<String>,
) -> Result<Json<Vec<Album>>, AppError> {
    let cred = user
        .credentials
        .jellyfin
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    let client = jf_client(&state);
    let resp = client
        .get_items(
            &cred.api_key,
            &cred.service_user_id,
            &[
                ("includeItemTypes", "MusicAlbum"),
                ("recursive", "true"),
                ("albumArtistIds", &artist_id),
                ("sortBy", "ProductionYear,SortName"),
                ("sortOrder", "Descending"),
                ("fields", "PrimaryImageAspectRatio,ChildCount"),
            ],
        )
        .await?;

    let items = resp["items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|item| {
            let id = jf_str(item, "id");
            Album {
                image_url: format!("/api/v1/media/{id}/image"),
                id,
                name: jf_str(item, "name"),
                year: item["productionYear"].as_u64().map(|v| v as u32),
                artist_name: item["albumArtist"].as_str().map(|s| s.to_string()),
                track_count: item["childCount"].as_u64().map(|v| v as u32),
            }
        })
        .collect();

    Ok(Json(items))
}

async fn list_album_tracks(
    State(state): State<AppState>,
    user: AuthUser,
    Path(album_id): Path<String>,
) -> Result<Json<Vec<Track>>, AppError> {
    let cred = user
        .credentials
        .jellyfin
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    let client = jf_client(&state);
    let resp = client
        .get_items(
            &cred.api_key,
            &cred.service_user_id,
            &[
                ("includeItemTypes", "Audio"),
                ("parentId", &album_id),
                ("sortBy", "IndexNumber"),
                ("sortOrder", "Ascending"),
                ("fields", "MediaSources"),
            ],
        )
        .await?;

    let items = resp["items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|item| {
            let id = jf_str(item, "id");
            let album_id_ref = item["albumId"].as_str().unwrap_or("");
            Track {
                stream_url: format!("/api/v1/media/{id}/stream"),
                album_image_url: if album_id_ref.is_empty() {
                    None
                } else {
                    Some(format!("/api/v1/media/{album_id_ref}/image"))
                },
                id,
                title: jf_str(item, "name"),
                track_number: item["indexNumber"].as_u64().map(|v| v as u32),
                duration: item["runTimeTicks"]
                    .as_u64()
                    .map(|t| t as f64 / 10_000_000.0),
                artist_name: item["artists"]
                    .as_array()
                    .and_then(|a| a.first())
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                album_name: item["album"].as_str().map(|s| s.to_string()),
            }
        })
        .collect();

    Ok(Json(items))
}

async fn get_item(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let cred = user
        .credentials
        .jellyfin
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    let client = jf_client(&state);
    let item = client
        .get_item(&cred.api_key, &cred.service_user_id, &id)
        .await?;

    // Return the appropriate model based on item type.
    let item_type = item["type"].as_str().unwrap_or("");
    match item_type {
        "Movie" => {
            let movie = jf_item_to_movie(&item);
            Ok(Json(serde_json::to_value(movie).unwrap()))
        }
        "Series" => {
            let show = jf_item_to_show(&item);
            Ok(Json(serde_json::to_value(show).unwrap()))
        }
        "Episode" => {
            let ep_id = jf_str(&item, "id");
            let episode = Episode {
                image_url: format!("/api/v1/media/{ep_id}/image"),
                stream_url: format!("/api/v1/media/{ep_id}/stream"),
                id: ep_id,
                title: jf_str(&item, "name"),
                season_number: item["parentIndexNumber"].as_u64().map(|v| v as u32),
                episode_number: item["indexNumber"].as_u64().map(|v| v as u32),
                runtime: item["runTimeTicks"]
                    .as_u64()
                    .map(|t| (t / 600_000_000) as u32),
                overview: item["overview"].as_str().map(|s| s.to_string()),
            };
            Ok(Json(serde_json::to_value(episode).unwrap()))
        }
        _ => {
            // Return raw for unknown types.
            Ok(Json(item))
        }
    }
}

async fn get_image(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(id): Path<String>,
    Query(params): Query<ImageParams>,
) -> Result<Response<Body>, AppError> {
    let client = jf_client(&state);
    let resp = client.get_image(&id, params.max_width).await?;

    // If no image, return 404.
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::NotFound("no image available".into()));
    }

    proxy_binary(resp)
}

async fn stream_media(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    req: axum::http::Request<Body>,
) -> Result<Response<Body>, AppError> {
    let cred = user
        .credentials
        .jellyfin
        .ok_or(AppError::ServiceUnavailable("media not provisioned".into()))?;

    let range = req.headers().get("range").cloned();
    let client = jf_client(&state);

    // Determine item type to choose video vs audio stream endpoint.
    // For simplicity, try video first; if the item is audio, use audio endpoint.
    let item = client
        .get_item(&cred.api_key, &cred.service_user_id, &id)
        .await?;
    let item_type = item["type"].as_str().unwrap_or("");

    let resp = if item_type == "Audio" {
        client
            .stream_audio(&cred.api_key, &id, range.as_ref())
            .await?
    } else {
        client
            .stream_video(&cred.api_key, &id, range.as_ref())
            .await?
    };

    proxy_binary(resp)
}

// --- Jellyfin JSON helpers ---

fn jf_str(item: &Value, key: &str) -> String {
    item[key].as_str().unwrap_or("").to_string()
}

fn jf_item_to_movie(item: &Value) -> Movie {
    let id = jf_str(item, "id");
    Movie {
        image_url: format!("/api/v1/media/{id}/image"),
        stream_url: format!("/api/v1/media/{id}/stream"),
        id,
        title: jf_str(item, "name"),
        year: item["productionYear"].as_u64().map(|v| v as u32),
        runtime: item["runTimeTicks"]
            .as_u64()
            .map(|t| (t / 600_000_000) as u32),
        overview: item["overview"].as_str().map(|s| s.to_string()),
        rating: item["officialRating"].as_str().map(|s| s.to_string()),
    }
}

fn jf_items_to_movies(resp: &Value) -> Vec<Movie> {
    resp["items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(jf_item_to_movie)
        .collect()
}

fn jf_item_to_show(item: &Value) -> TvShow {
    let id = jf_str(item, "id");
    let year_start = item["productionYear"].as_u64().map(|v| v.to_string());
    let status = item["status"].as_str().unwrap_or("");
    let end_date = item["endDate"].as_str().unwrap_or("");

    let year = match (year_start, status, end_date) {
        (Some(start), "Ended", end) if !end.is_empty() => {
            let end_year = end.split('-').next().unwrap_or("");
            format!("{start}-{end_year}")
        }
        (Some(start), "Ended", _) => start.to_string(),
        (Some(start), _, _) => format!("{start}-"),
        _ => String::new(),
    };

    TvShow {
        image_url: format!("/api/v1/media/{id}/image"),
        id,
        title: jf_str(item, "name"),
        year,
        overview: item["overview"].as_str().map(|s| s.to_string()),
        season_count: item["childCount"].as_u64().map(|v| v as u32),
    }
}

fn jf_items_to_shows(resp: &Value) -> Vec<TvShow> {
    resp["items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(jf_item_to_show)
        .collect()
}
