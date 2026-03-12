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
use crate::services::KavitaClient;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_series))
        .route("/{id}", get(get_series_detail))
        .route("/{id}/cover", get(get_series_cover))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeriesListParams {
    #[serde(flatten)]
    pagination: PaginationParams,
}

fn kavita_client(state: &AppState) -> KavitaClient {
    KavitaClient::new(&state.config.kavita_url, state.http.clone())
}

async fn list_series(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<SeriesListParams>,
) -> Result<Json<PaginatedResponse<Series>>, AppError> {
    let cred = user.credentials.kavita.ok_or(AppError::ServiceUnavailable(
        "reading not provisioned".into(),
    ))?;

    let client = kavita_client(&state);

    // Get the first library the user has access to.
    let libraries = client.get_libraries(&cred.api_key).await?;
    let library_id = libraries
        .as_array()
        .and_then(|libs| libs.first())
        .and_then(|lib| lib["id"].as_i64())
        .ok_or(AppError::ServiceUnavailable(
            "no reading library found".into(),
        ))?;

    // Kavita uses 1-indexed pages like our frontend.
    let (resp, total) = client
        .list_series(
            &cred.api_key,
            library_id,
            params.pagination.page,
            params.pagination.page_size,
        )
        .await?;

    let items = resp
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(kavita_series_to_model)
        .collect();

    Ok(Json(PaginatedResponse::new(
        items,
        total,
        params.pagination.page,
        params.pagination.page_size,
    )))
}

async fn get_series_detail(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let cred = user.credentials.kavita.ok_or(AppError::ServiceUnavailable(
        "reading not provisioned".into(),
    ))?;

    let client = kavita_client(&state);
    let series = client.get_series(&cred.api_key, id).await?;

    let model = kavita_series_to_model(&series);

    Ok(Json(serde_json::json!({
        "id": model.id,
        "name": model.name,
        "libraryId": model.library_id,
        "coverUrl": model.cover_url,
        "pages": model.pages,
        "format": model.format,
        "pagesRead": model.pages_read,
    })))
}

async fn get_series_cover(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> Result<Response<Body>, AppError> {
    let cred = user.credentials.kavita.ok_or(AppError::ServiceUnavailable(
        "reading not provisioned".into(),
    ))?;

    let client = kavita_client(&state);
    let resp = client.get_series_cover(&cred.api_key, id).await?;
    proxy_binary(resp)
}

// --- Helpers ---

fn kavita_series_to_model(item: &Value) -> Series {
    let id = item["id"].as_i64().unwrap_or(0);

    Series {
        id: id.to_string(),
        name: item["name"].as_str().unwrap_or("").to_string(),
        library_id: item["libraryId"].as_i64().unwrap_or(0),
        cover_url: format!("/api/v1/reading/{id}/cover"),
        pages: item["pages"].as_u64().unwrap_or(0) as u32,
        format: kavita_format(item["format"].as_i64().unwrap_or(0)),
        pages_read: item["pagesRead"].as_u64().unwrap_or(0) as u32,
    }
}

/// Map Kavita's numeric format enum to a human-readable string.
fn kavita_format(format: i64) -> String {
    match format {
        0 => "Unknown".to_string(),
        1 => "Image".to_string(),
        2 => "Archive".to_string(),
        3 => "Epub".to_string(),
        4 => "Pdf".to_string(),
        _ => "Unknown".to_string(),
    }
}
