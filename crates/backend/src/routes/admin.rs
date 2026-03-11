use axum::{extract::State, routing::post, Json, Router};
use rand::Rng;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::services::*;
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
    // Use the provided user_id or default to the current user.
    let target_user_id = body.user_id.as_deref().unwrap_or(&auth_user.id);

    // Read user details from BetterAuth user table.
    let user_row =
        sqlx::query_as::<_, UserRow>(r#"SELECT id, name, email FROM "user" WHERE id = $1"#)
            .bind(target_user_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NotFound("user not found".into()))?;

    let user_name = &user_row.name;
    let user_email = &user_row.email;

    let mut services = json!({});

    // --- Immich ---
    let immich_result = provision_immich(&state, user_email, user_name).await;
    match immich_result {
        Ok((immich_user_id, api_key)) => {
            store_credential(
                &state.db,
                target_user_id,
                "immich",
                &immich_user_id,
                &api_key,
            )
            .await?;
            services["immich"] = json!({
                "status": "provisioned",
                "userId": immich_user_id,
            });
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to provision immich");
            services["immich"] = json!({
                "status": "failed",
                "error": e.to_string(),
            });
        }
    }

    // --- Jellyfin ---
    let jf_result = provision_jellyfin(&state, user_name).await;
    match jf_result {
        Ok((jf_user_id, token)) => {
            store_credential(&state.db, target_user_id, "jellyfin", &jf_user_id, &token).await?;
            services["jellyfin"] = json!({
                "status": "provisioned",
                "userId": jf_user_id,
            });
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to provision jellyfin");
            services["jellyfin"] = json!({
                "status": "failed",
                "error": e.to_string(),
            });
        }
    }

    // --- Paperless ---
    let paperless_result = provision_paperless(&state, user_email).await;
    match paperless_result {
        Ok((paperless_user_id, token)) => {
            store_credential(
                &state.db,
                target_user_id,
                "paperless",
                &paperless_user_id,
                &token,
            )
            .await?;
            services["paperless"] = json!({
                "status": "provisioned",
                "userId": paperless_user_id,
            });
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to provision paperless");
            services["paperless"] = json!({
                "status": "failed",
                "error": e.to_string(),
            });
        }
    }

    // --- Audiobookshelf ---
    let abs_result = provision_audiobookshelf(&state, user_name).await;
    match abs_result {
        Ok((abs_user_id, token)) => {
            store_credential(
                &state.db,
                target_user_id,
                "audiobookshelf",
                &abs_user_id,
                &token,
            )
            .await?;
            services["audiobookshelf"] = json!({
                "status": "provisioned",
                "userId": abs_user_id,
            });
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to provision audiobookshelf");
            services["audiobookshelf"] = json!({
                "status": "failed",
                "error": e.to_string(),
            });
        }
    }

    Ok(Json(json!({
        "userId": target_user_id,
        "services": services,
    })))
}

fn generate_password() -> String {
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::rng();
    (0..32)
        .map(|_| {
            let idx = rng.random_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

async fn provision_immich(
    state: &AppState,
    email: &str,
    name: &str,
) -> Result<(String, String), AppError> {
    let client = ImmichClient::new(&state.config.immich_url, state.http.clone());
    let password = generate_password();

    // 1. Create user via admin API.
    let user = client
        .admin_create_user(&state.config.immich_admin_api_key, email, name, &password)
        .await?;
    let user_id = user["id"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "immich: no user id in response"
        )))?
        .to_string();

    // 2. Login as the new user.
    let login_resp = client.login(email, &password).await?;
    let access_token = login_resp["accessToken"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "immich: no access token in login response"
        )))?;

    // 3. Create an API key for the user.
    let api_key_resp = client.create_api_key(access_token).await?;
    let api_key = api_key_resp["secret"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "immich: no secret in api key response"
        )))?
        .to_string();

    tracing::info!(user_id = %user_id, "provisioned immich user");
    Ok((user_id, api_key))
}

async fn provision_jellyfin(state: &AppState, name: &str) -> Result<(String, String), AppError> {
    let client = JellyfinClient::new(
        &state.config.jellyfin_url,
        &state.config.jellyfin_device_id,
        state.http.clone(),
    );
    let password = generate_password();

    // 1. Create user.
    let user = client
        .admin_create_user(&state.config.jellyfin_admin_token, name, &password)
        .await?;
    let user_id = user["id"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "jellyfin: no user id in response"
        )))?
        .to_string();

    // 2. Set user policy.
    client
        .set_user_policy(
            &state.config.jellyfin_admin_token,
            &user_id,
            &json!({
                "IsHidden": true,
                "EnableMediaPlayback": true,
                "EnableAudioPlaybackTranscoding": true,
                "EnableVideoPlaybackTranscoding": true,
                "EnablePlaybackRemuxing": true,
                "EnableContentDownloading": true,
                "EnableRemoteAccess": true,
                "AuthenticationProviderId": "Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider",
                "PasswordResetProviderId": "Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider",
            }),
        )
        .await?;

    // 3. Authenticate as the user to get a token.
    let auth_resp = client.authenticate_by_name(name, &password).await?;
    let token = auth_resp["AccessToken"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "jellyfin: no access token in auth response"
        )))?
        .to_string();

    tracing::info!(user_id = %user_id, "provisioned jellyfin user");
    Ok((user_id, token))
}

async fn provision_paperless(state: &AppState, email: &str) -> Result<(String, String), AppError> {
    let client = PaperlessClient::new(&state.config.paperless_url, state.http.clone());
    let password = generate_password();

    // 1. Create user.
    let user = client
        .admin_create_user(&state.config.paperless_admin_token, email, &password, email)
        .await?;
    let user_id = user["id"]
        .as_u64()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "paperless: no user id in response"
        )))?
        .to_string();

    // 2. Get token.
    let token_resp = client.get_token(email, &password).await?;
    let token = token_resp["token"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "paperless: no token in response"
        )))?
        .to_string();

    tracing::info!(user_id = %user_id, "provisioned paperless user");
    Ok((user_id, token))
}

async fn provision_audiobookshelf(
    state: &AppState,
    name: &str,
) -> Result<(String, String), AppError> {
    let client = AudiobookshelfClient::new(&state.config.audiobookshelf_url, state.http.clone());
    let password = generate_password();

    // 1. Create user. Response is {"user": {…}}.
    let resp = client
        .admin_create_user(&state.config.audiobookshelf_admin_token, name, &password)
        .await?;
    let user_id = resp["user"]["id"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "audiobookshelf: no user id in response"
        )))?
        .to_string();

    // 2. Activate the user (created inactive by default).
    client
        .admin_activate_user(&state.config.audiobookshelf_admin_token, &user_id)
        .await?;

    // 3. Use the token from the create response (ABS doesn't support login for admin-created users).
    let token = resp["user"]["token"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "audiobookshelf: no token in create response"
        )))?
        .to_string();

    tracing::info!(user_id = %user_id, "provisioned audiobookshelf user");
    Ok((user_id, token))
}

async fn store_credential(
    db: &sqlx::PgPool,
    user_id: &str,
    service: &str,
    service_user_id: &str,
    api_key: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO service_connections (user_id, service, service_user_id, api_key) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (user_id, service) \
         DO UPDATE SET service_user_id = $3, api_key = $4, active = true",
    )
    .bind(user_id)
    .bind(service)
    .bind(service_user_id)
    .bind(api_key)
    .execute(db)
    .await?;
    Ok(())
}
