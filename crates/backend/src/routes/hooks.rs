use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
    Router,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;

use crate::AppState;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserCreatedPayload {
    user_id: String,
    name: String,
    email: String,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/user-created", post(handle_user_created))
}

/// Webhook called by BetterAuth after a new user signs up.
/// Validates HMAC-SHA256 signature, then spawns provisioning in background.
async fn handle_user_created(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> StatusCode {
    // Validate signature
    let signature = match headers.get("x-webhook-signature") {
        Some(sig) => match sig.to_str() {
            Ok(s) => s.to_string(),
            Err(_) => {
                tracing::warn!("webhook: invalid signature header encoding");
                return StatusCode::UNAUTHORIZED;
            }
        },
        None => {
            tracing::warn!("webhook: missing X-Webhook-Signature header");
            return StatusCode::UNAUTHORIZED;
        }
    };

    let expected_signature = match compute_signature(&state.config.webhook_secret, &body) {
        Ok(sig) => sig,
        Err(err) => {
            tracing::error!(error = %err, "webhook: failed to compute HMAC");
            return StatusCode::INTERNAL_SERVER_ERROR;
        }
    };

    if !constant_time_eq(signature.as_bytes(), expected_signature.as_bytes()) {
        tracing::warn!("webhook: signature mismatch");
        return StatusCode::UNAUTHORIZED;
    }

    // Parse payload
    let payload: UserCreatedPayload = match serde_json::from_str(&body) {
        Ok(p) => p,
        Err(err) => {
            tracing::warn!(error = %err, "webhook: invalid payload");
            return StatusCode::BAD_REQUEST;
        }
    };

    tracing::info!(
        user_id = %payload.user_id,
        email = %payload.email,
        "webhook: user-created received"
    );

    state.provisioner.ensure_provisioned(
        state.clone(),
        payload.user_id,
        payload.name,
        payload.email,
    );

    // Return 200 immediately — provisioning runs in the background.
    StatusCode::OK
}

fn compute_signature(secret: &str, payload: &str) -> Result<String, hmac::digest::InvalidLength> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())?;
    mac.update(payload.as_bytes());
    let result = mac.finalize();
    Ok(hex::encode(result.into_bytes()))
}

/// Constant-time comparison to prevent timing attacks on signature validation.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}
