use axum::{extract::Request, middleware::Next, response::Response};
use tracing::Instrument;

/// Middleware that generates a request ID and attaches it to the tracing span.
/// Also sets the `x-request-id` response header so the frontend can correlate.
pub async fn request_id(request: Request, next: Next) -> Response {
    let id = uuid::Uuid::new_v4().to_string();

    let span = tracing::info_span!(
        "req",
        id = %id,
        method = %request.method(),
        path = %request.uri().path(),
    );

    let mut response = next.run(request).instrument(span).await;

    response
        .headers_mut()
        .insert("x-request-id", id.parse().unwrap());

    response
}
