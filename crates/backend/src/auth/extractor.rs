use axum::{extract::FromRequestParts, http::request::Parts};
use axum_extra::extract::CookieJar;

use crate::error::AppError;
use crate::AppState;

use super::session;

/// Per-service credential.
#[derive(Debug, Clone)]
pub struct ServiceCred {
    pub service_user_id: String,
    pub api_key: String,
}

/// Resolved credentials for all services.
#[derive(Debug, Clone, Default)]
pub struct ServiceCredentials {
    pub immich: Option<ServiceCred>,
    pub jellyfin: Option<ServiceCred>,
    pub paperless: Option<ServiceCred>,
    pub audiobookshelf: Option<ServiceCred>,
}

/// Authenticated user extracted from the session token.
/// Use as an Axum extractor in handler signatures.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub credentials: ServiceCredentials,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // Extract session token from cookie or Authorization header.
        let token = extract_token(parts, state).await?;

        // Validate session via direct Postgres read.
        let session_user = session::validate_session(&state.db, &token)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("session query failed: {e}")))?
            .ok_or(AppError::Unauthorized)?;

        // Load per-service credentials.
        let cred_rows = session::load_credentials(&state.db, &session_user.user_id)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("credential query failed: {e}")))?;

        let mut credentials = ServiceCredentials::default();
        for row in cred_rows {
            let cred = ServiceCred {
                service_user_id: row.service_user_id,
                api_key: row.api_key,
            };
            match row.service.as_str() {
                "immich" => credentials.immich = Some(cred),
                "jellyfin" => credentials.jellyfin = Some(cred),
                "paperless" => credentials.paperless = Some(cred),
                "audiobookshelf" => credentials.audiobookshelf = Some(cred),
                _ => {
                    tracing::warn!(service = %row.service, "unknown service in credentials");
                }
            }
        }

        Ok(AuthUser {
            id: session_user.user_id,
            name: session_user.name,
            email: session_user.email,
            credentials,
        })
    }
}

/// Extract the session token from the cookie or Authorization header.
///
/// Cookie: `better-auth.session_token` — extract the token portion before the `.`
/// Header: `Authorization: Bearer <token>` — use as-is
async fn extract_token(parts: &mut Parts, state: &AppState) -> Result<String, AppError> {
    // Try cookie first.
    let jar = CookieJar::from_request_parts(parts, state)
        .await
        .map_err(|_| AppError::Unauthorized)?;

    if let Some(cookie) = jar.get("better-auth.session_token") {
        let value = cookie.value();
        // BetterAuth appends `.{hmac}` — the raw token is before the dot.
        let token = value.split('.').next().unwrap_or(value);
        if !token.is_empty() {
            return Ok(token.to_string());
        }
    }

    // Try Authorization header.
    if let Some(auth_header) = parts.headers.get("authorization") {
        let header_str = auth_header.to_str().map_err(|_| AppError::Unauthorized)?;
        if let Some(token) = header_str.strip_prefix("Bearer ") {
            let token = token.trim();
            if !token.is_empty() {
                return Ok(token.to_string());
            }
        }
    }

    Err(AppError::Unauthorized)
}
