use axum::Router;

use crate::AppState;

mod admin;
mod hooks;
mod users;

pub fn api_router() -> Router<AppState> {
    Router::new()
        // Thin routes (stay in routes/)
        .nest("/users", users::router())
        .nest("/admin", admin::router())
        .nest("/hooks", hooks::router())
        // Feature modules (all logic in functions/)
        .nest("/classify", crate::functions::classify::router())
        .nest("/upload", crate::functions::upload::router())
        .nest("/photos", crate::functions::browse::photos::router())
        .nest("/media", crate::functions::browse::media::router())
        .nest("/documents", crate::functions::browse::documents::router())
        .nest(
            "/audiobooks",
            crate::functions::browse::audiobooks::router(),
        )
        .nest("/reading", crate::functions::browse::reading::router())
        .nest("/files", crate::functions::browse::files::router())
        .nest("/search", crate::functions::search::router())
        .nest("/metadata", crate::functions::metadata::router())
}
