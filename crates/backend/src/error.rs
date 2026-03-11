use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("service unavailable: {0}")]
    ServiceUnavailable(String),

    #[error("upstream error: {service} returned {status}")]
    UpstreamError {
        service: String,
        status: u16,
        message: String,
    },

    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error_code, message) = match &self {
            Self::NotFound(msg) => (StatusCode::NOT_FOUND, "not_found", msg.clone()),
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "unauthorized".to_string(),
            ),
            Self::BadRequest(msg) => (StatusCode::BAD_REQUEST, "bad_request", msg.clone()),
            Self::ServiceUnavailable(msg) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "service_unavailable",
                msg.clone(),
            ),
            Self::UpstreamError {
                service,
                status,
                message,
            } => {
                let http_status = match *status {
                    403 => StatusCode::FORBIDDEN,
                    404 => StatusCode::NOT_FOUND,
                    429 => StatusCode::TOO_MANY_REQUESTS,
                    s if s >= 500 => StatusCode::BAD_GATEWAY,
                    _ => StatusCode::BAD_GATEWAY,
                };
                tracing::warn!(
                    upstream_service = service,
                    upstream_status = status,
                    "upstream error: {message}"
                );
                (http_status, "upstream_error", message.clone())
            }
            Self::Internal(err) => {
                tracing::error!("internal error: {err:#}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "internal server error".to_string(),
                )
            }
        };

        (
            status,
            Json(json!({ "error": error_code, "message": message })),
        )
            .into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        Self::Internal(anyhow::anyhow!("database error: {err}"))
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_connect() || err.is_timeout() {
            Self::ServiceUnavailable(format!("service unreachable: {err}"))
        } else {
            Self::Internal(anyhow::anyhow!("http client error: {err}"))
        }
    }
}
