use axum::body::Body;
use axum::http::HeaderValue;
use axum::response::Response;

use crate::error::AppError;

/// Proxy a binary/streaming response from an upstream service.
/// Streams the body without buffering, forwarding relevant headers.
pub fn proxy_binary(upstream: reqwest::Response) -> Result<Response<Body>, AppError> {
    let status = upstream.status();
    let mut builder = Response::builder().status(status.as_u16());

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
    check_streaming_status("stream", &resp)?;
    proxy_binary(resp)
}

/// Check an upstream response. On success, returns the response for further processing.
/// On error, consumes the body and includes it in the error message so we can see
/// exactly why a service rejected our request.
pub async fn check_response(
    service: &str,
    resp: reqwest::Response,
) -> Result<reqwest::Response, AppError> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }

    let status_code = status.as_u16();
    let url = resp.url().to_string();
    let body = resp
        .text()
        .await
        .unwrap_or_else(|_| "<unreadable>".to_string());

    // Truncate for log output but keep a reasonable amount for debugging.
    let max = crate::constants::UPSTREAM_ERROR_BODY_MAX_CHARS;
    let body_short = if body.len() > max {
        format!("{}…", &body[..max])
    } else {
        body
    };

    tracing::warn!(
        service = service,
        status = status_code,
        url = %url,
        body = %body_short,
        "upstream error"
    );

    match status_code {
        404 => Err(AppError::NotFound(format!(
            "{service}: not found — {body_short}"
        ))),
        401 | 403 => Err(AppError::ServiceUnavailable(format!(
            "{service}: auth failed — {body_short}"
        ))),
        s => Err(AppError::UpstreamError {
            service: service.to_string(),
            status: s,
            message: body_short,
        }),
    }
}

/// Lightweight status check for streaming responses where we can't consume the body.
/// Only use this for binary/streaming proxying — use `check_response` everywhere else.
pub fn check_streaming_status(service: &str, resp: &reqwest::Response) -> Result<(), AppError> {
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }

    let s = status.as_u16();
    tracing::warn!(service = service, status = s, "upstream streaming error");

    match s {
        404 => Err(AppError::NotFound(format!("{service}: resource not found"))),
        401 | 403 => Err(AppError::ServiceUnavailable(format!(
            "{service}: credentials may have expired"
        ))),
        _ => Err(AppError::UpstreamError {
            service: service.to_string(),
            status: s,
            message: format!("{service} returned {s}"),
        }),
    }
}
