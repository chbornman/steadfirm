//! Reading browse — Kavita proxy.

use axum::{
    body::Body,
    extract::{Path, Query, State},
    response::Response,
    routing::{get, post},
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
        // Library browsing
        .route("/", get(list_series))
        .route("/{id}", get(get_series_detail))
        .route("/{id}/cover", get(get_series_cover))
        .route("/{id}/volumes", get(get_volumes))
        .route("/{id}/continue", get(get_continue_point))
        // Reader: image-based (comic/manga)
        .route("/chapter/{chapterId}/info", get(get_chapter_info))
        .route("/chapter/{chapterId}/page/{page}", get(get_page_image))
        // Reader: EPUB
        .route("/book/{chapterId}/info", get(get_book_info))
        .route("/book/{chapterId}/chapters", get(get_book_chapters))
        .route("/book/{chapterId}/page/{page}", get(get_book_page))
        .route("/book/{chapterId}/resource", get(get_book_resource))
        // Reader: PDF
        .route("/chapter/{chapterId}/pdf", get(get_pdf))
        // Progress + navigation
        .route("/chapter/{chapterId}/progress", get(get_progress))
        .route("/progress", post(save_progress))
        .route("/chapter/{chapterId}/next", get(get_next_chapter))
        .route("/chapter/{chapterId}/prev", get(get_prev_chapter))
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
    let api_key = kavita_api_key(&user)?;

    let client = kavita_client(&state);

    // Get the first library the user has access to.
    let libraries = client.get_libraries(&api_key).await?;
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
            &api_key,
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
    let api_key = kavita_api_key(&user)?;

    let client = kavita_client(&state);
    let series = client.get_series(&api_key, id).await?;

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
    let api_key = kavita_api_key(&user)?;

    let client = kavita_client(&state);
    let resp = client.get_series_cover(&api_key, id).await?;
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

/// Extract the Kavita API key from the authenticated user's credentials.
fn kavita_api_key(user: &AuthUser) -> Result<String, AppError> {
    user.credentials
        .kavita
        .as_ref()
        .map(|c| c.api_key.clone())
        .ok_or(AppError::ServiceUnavailable(
            "reading not provisioned".into(),
        ))
}

// ─── Volumes / Structure ─────────────────────────────────────────────

async fn get_volumes(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    let volumes = client.get_volumes(&api_key, id).await?;
    Ok(Json(volumes))
}

async fn get_continue_point(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    let chapter = client.continue_point(&api_key, id).await?;
    Ok(Json(chapter))
}

// ─── Image reader (comic/manga) ─────────────────────────────────────

async fn get_chapter_info(
    State(state): State<AppState>,
    user: AuthUser,
    Path(chapter_id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    let info = client.chapter_info(&api_key, chapter_id, true).await?;
    Ok(Json(info))
}

async fn get_page_image(
    State(state): State<AppState>,
    user: AuthUser,
    Path((chapter_id, page)): Path<(i64, u32)>,
) -> Result<Response<Body>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    let resp = client.page_image(&api_key, chapter_id, page).await?;
    proxy_binary(resp)
}

// ─── EPUB reader ─────────────────────────────────────────────────────

async fn get_book_info(
    State(state): State<AppState>,
    user: AuthUser,
    Path(chapter_id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    let info = client.book_info(&api_key, chapter_id).await?;
    Ok(Json(info))
}

async fn get_book_chapters(
    State(state): State<AppState>,
    user: AuthUser,
    Path(chapter_id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    let chapters = client.book_chapters(&api_key, chapter_id).await?;
    Ok(Json(chapters))
}

async fn get_book_page(
    State(state): State<AppState>,
    user: AuthUser,
    Path((chapter_id, page)): Path<(i64, u32)>,
) -> Result<axum::response::Html<String>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    let html = client.book_page(&api_key, chapter_id, page).await?;
    // Kavita returns the HTML as a JSON-encoded string — strip quotes if present.
    let html = html
        .trim_matches('"')
        .replace("\\n", "\n")
        .replace("\\\"", "\"");
    Ok(axum::response::Html(html))
}

#[derive(Deserialize)]
struct BookResourceParams {
    file: String,
}

async fn get_book_resource(
    State(state): State<AppState>,
    user: AuthUser,
    Path(chapter_id): Path<i64>,
    Query(params): Query<BookResourceParams>,
) -> Result<Response<Body>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    let resp = client
        .book_resource(&api_key, chapter_id, &params.file)
        .await?;
    proxy_binary(resp)
}

// ─── PDF reader ──────────────────────────────────────────────────────

async fn get_pdf(
    State(state): State<AppState>,
    user: AuthUser,
    Path(chapter_id): Path<i64>,
) -> Result<Response<Body>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    let resp = client.pdf_file(&api_key, chapter_id).await?;
    proxy_binary(resp)
}

// ─── Progress + Navigation ───────────────────────────────────────────

async fn get_progress(
    State(state): State<AppState>,
    user: AuthUser,
    Path(chapter_id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    let progress = client.get_progress(&api_key, chapter_id).await?;
    Ok(Json(progress))
}

async fn save_progress(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    client.save_progress(&api_key, &body).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NavParams {
    series_id: i64,
    volume_id: i64,
}

async fn get_next_chapter(
    State(state): State<AppState>,
    user: AuthUser,
    Path(chapter_id): Path<i64>,
    Query(params): Query<NavParams>,
) -> Result<Json<Value>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    let next_id = client
        .next_chapter(&api_key, params.series_id, params.volume_id, chapter_id)
        .await?;
    Ok(Json(serde_json::json!({ "chapterId": next_id })))
}

async fn get_prev_chapter(
    State(state): State<AppState>,
    user: AuthUser,
    Path(chapter_id): Path<i64>,
    Query(params): Query<NavParams>,
) -> Result<Json<Value>, AppError> {
    let api_key = kavita_api_key(&user)?;
    let client = kavita_client(&state);
    let prev_id = client
        .prev_chapter(&api_key, params.series_id, params.volume_id, chapter_id)
        .await?;
    Ok(Json(serde_json::json!({ "chapterId": prev_id })))
}
