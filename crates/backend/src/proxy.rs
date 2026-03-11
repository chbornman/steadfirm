use axum::body::Body;
use axum::http::HeaderValue;
use axum::response::Response;

use crate::error::AppError;

/// Proxy a binary/streaming response from an upstream service.
/// Streams the body without buffering, forwarding relevant headers.
pub fn proxy_binary(upstream: reqwest::Response) -> Result<Response<Body>, AppError> {
    let status = upstream.status();
    let mut builder = Response::builder().status(status.as_u16());

    // Forward relevant headers.
    let headers_to_forward = [
        "content-type",
        "content-length",
        "content-disposition",
        "accept-ranges",
        "content-range",
        "etag",
        "last-modified",
        "cache-control",
    ];
    for header_name in headers_to_forward {
        if let Some(val) = upstream.headers().get(header_name) {
            builder = builder.header(header_name, val.clone());
        }
    }

    let body = Body::from_stream(upstream.bytes_stream());
    builder
        .body(body)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("failed to build proxy response: {e}")))
}

/// Make a streaming GET request to an upstream service and proxy the response.
/// Forwards the Range header for video/audio seeking.
#[allow(dead_code)]
pub async fn proxy_stream(
    http: &reqwest::Client,
    url: &str,
    auth_header: (&str, &str),
    range_header: Option<&HeaderValue>,
) -> Result<Response<Body>, AppError> {
    let mut req = http.get(url).header(auth_header.0, auth_header.1);

    if let Some(range) = range_header {
        req = req.header("range", range.clone());
    }

    let resp = req.send().await?;
    check_upstream_status("stream", &resp)?;
    proxy_binary(resp)
}

/// Check an upstream response status and convert errors to AppError.
pub fn check_upstream_status(service: &str, resp: &reqwest::Response) -> Result<(), AppError> {
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }

    match status.as_u16() {
        404 => Err(AppError::NotFound(format!("{service}: resource not found"))),
        401 | 403 => Err(AppError::ServiceUnavailable(format!(
            "{service}: credentials may have expired, try reprovisioning"
        ))),
        429 => Err(AppError::UpstreamError {
            service: service.to_string(),
            status: 429,
            message: "rate limited".to_string(),
        }),
        s if s >= 500 => Err(AppError::UpstreamError {
            service: service.to_string(),
            status: s,
            message: format!("{service} server error"),
        }),
        s => Err(AppError::UpstreamError {
            service: service.to_string(),
            status: s,
            message: format!("{service} returned {s}"),
        }),
    }
}
