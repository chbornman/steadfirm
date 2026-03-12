use axum::{extract::State, routing::post, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::AppState;

#[derive(sqlx::FromRow)]
struct UserRow {
    #[allow(dead_code)]
    id: String,
    name: String,
    email: String,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/provision", post(provision_user))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProvisionRequest {
    #[serde(default)]
    user_id: Option<String>,
}

/// Admin endpoint to manually trigger provisioning for a user.
/// Delegates to the same ProvisioningService used by the webhook.
async fn provision_user(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(body): Json<ProvisionRequest>,
) -> Result<Json<Value>, AppError> {
    let target_user_id = body.user_id.as_deref().unwrap_or(&auth_user.id);

    let user_row =
        sqlx::query_as::<_, UserRow>(r#"SELECT id, name, email FROM "user" WHERE id = $1"#)
            .bind(target_user_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NotFound("user not found".into()))?;

    let spawned = state.provisioner.ensure_provisioned(
        state.clone(),
        target_user_id.to_string(),
        user_row.name,
        user_row.email,
    );

    Ok(Json(json!({
        "userId": target_user_id,
        "status": if spawned { "provisioning" } else { "already_in_progress" },
    })))
}
