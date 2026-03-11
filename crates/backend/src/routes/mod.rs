use axum::Router;

use crate::AppState;

mod dropzone;
mod proxy;
mod users;

pub fn api_router() -> Router<AppState> {
    Router::new()
        .nest("/users", users::router())
        .nest("/upload", dropzone::router())
        .nest("/photos", proxy::photos_router())
        .nest("/media", proxy::media_router())
        .nest("/documents", proxy::documents_router())
        .nest("/audiobooks", proxy::audiobooks_router())
        .nest("/files", proxy::files_router())
}
