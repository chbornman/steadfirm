use axum::Router;

use crate::AppState;

mod admin;
mod audiobooks;
mod classify;
mod documents;
mod dropzone;
mod files;
mod hooks;
mod media;
mod photos;
mod reading;
mod users;

pub fn api_router() -> Router<AppState> {
    Router::new()
        .nest("/users", users::router())
        .nest("/admin", admin::router())
        .nest("/hooks", hooks::router())
        .nest("/upload", dropzone::router())
        .nest("/classify", classify::router())
        .nest("/photos", photos::router())
        .nest("/media", media::router())
        .nest("/documents", documents::router())
        .nest("/audiobooks", audiobooks::router())
        .nest("/reading", reading::router())
        .nest("/files", files::router())
}
