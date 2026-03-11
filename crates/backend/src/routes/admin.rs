use axum::{extract::State, routing::post, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::provisioning;
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

    let results =
        provisioning::provision_all(&state, target_user_id, &user_row.name, &user_row.email).await;

    Ok(Json(json!({
        "userId": target_user_id,
        "services": provisioning::results_to_json(&results),
    })))
}
