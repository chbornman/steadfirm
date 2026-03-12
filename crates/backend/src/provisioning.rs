use std::collections::HashSet;
use std::sync::Arc;

use rand::Rng;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::services::*;
use crate::AppState;

// ─── Public types ────────────────────────────────────────────────────

/// Result of provisioning a single service.
#[derive(Debug)]
pub struct ServiceProvisionResult {
    pub service: String,
    pub status: String,
    pub user_id: Option<String>,
    pub error: Option<String>,
}

/// Centralized provisioning coordinator.
///
/// Owns a per-user lock to ensure only one provisioning flow runs at a
/// time. Both the webhook and the `/users/me` fallback call the same
/// method — [`ensure_provisioned`] — which spawns a background task if
/// (and only if) provisioning isn't already running for that user.
///
/// Callers never block on provisioning. The client polls `/users/me`
/// until all services report as ready.
#[derive(Clone)]
pub struct ProvisioningService {
    in_progress: Arc<Mutex<HashSet<String>>>,
}

impl Default for ProvisioningService {
    fn default() -> Self {
        Self::new()
    }
}

impl ProvisioningService {
    pub fn new() -> Self {
        Self {
            in_progress: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// Ensure a user is being provisioned. Spawns a background task with
    /// retries if not already in progress. Safe to call multiple times —
    /// subsequent calls are no-ops while provisioning is running.
    ///
    /// Returns `true` if a new provisioning task was spawned, `false` if
    /// one was already running.
    pub fn ensure_provisioned(
        &self,
        state: AppState,
        user_id: String,
        name: String,
        email: String,
    ) -> bool {
        let lock = self.in_progress.clone();

        // Fast check — don't even spawn if already running.
        // We can't .await inside this method since we want it sync-compatible
        // for the webhook path, so use try_lock for the quick check.
        if let Ok(set) = lock.try_lock() {
            if set.contains(&user_id) {
                tracing::debug!(user_id = %user_id, "provisioning already in progress");
                return false;
            }
        }

        let lock_for_task = lock.clone();

        tokio::spawn(async move {
            // Acquire lock properly inside the async context.
            {
                let mut set = lock_for_task.lock().await;
                if set.contains(&user_id) {
                    tracing::debug!(user_id = %user_id, "provisioning already in progress");
                    return;
                }
                set.insert(user_id.clone());
            }

            let results = provision_with_retry(
                &state,
                &user_id,
                &name,
                &email,
                state.config.provision_max_retries,
            )
            .await;

            let failed: Vec<_> = results.iter().filter(|r| r.status == "failed").collect();
            if failed.is_empty() {
                tracing::info!(user_id = %user_id, "all services provisioned");
            } else {
                for r in &failed {
                    tracing::error!(
                        user_id = %user_id,
                        service = %r.service,
                        error = r.error.as_deref().unwrap_or("unknown"),
                        "provisioning failed after retries"
                    );
                }
            }

            // Release the lock.
            lock_for_task.lock().await.remove(&user_id);
        });

        true
    }
}

// ─── Provisioning orchestration (private) ────────────────────────────

/// Provision with retries for failed services. Retries with exponential
/// backoff (2s, 4s, 8s, ...) up to `max_retries` times.
async fn provision_with_retry(
    state: &AppState,
    user_id: &str,
    name: &str,
    email: &str,
    max_retries: u32,
) -> Vec<ServiceProvisionResult> {
    let all_services: Vec<String> = ALL_SERVICES.iter().map(|s| s.to_string()).collect();
    let mut results = provision_services(state, user_id, name, email, &all_services).await;

    for attempt in 1..=max_retries {
        let has_failures = results.iter().any(|r| r.status == "failed");
        if !has_failures {
            break;
        }

        let delay = std::time::Duration::from_secs(
            crate::constants::PROVISION_RETRY_BACKOFF_BASE_SECS.pow(attempt),
        );
        tracing::info!(
            user_id = %user_id,
            attempt = attempt,
            delay_secs = delay.as_secs(),
            "retrying failed provisioning"
        );
        tokio::time::sleep(delay).await;

        // Re-check DB — another path may have succeeded in the meantime.
        let missing = find_missing_services(&state.db, user_id).await;
        if missing.is_empty() {
            break;
        }

        let retry_results = provision_services(state, user_id, name, email, &missing).await;

        for retry in retry_results {
            if let Some(pos) = results.iter().position(|r| r.service == retry.service) {
                results[pos] = retry;
            } else {
                results.push(retry);
            }
        }
    }

    results
}

/// The list of all services that need provisioning.
const ALL_SERVICES: &[&str] = &[
    "immich",
    "jellyfin",
    "paperless",
    "audiobookshelf",
    "kavita",
];

/// Provision a specific set of services for a user.
async fn provision_services(
    state: &AppState,
    user_id: &str,
    name: &str,
    email: &str,
    services: &[String],
) -> Vec<ServiceProvisionResult> {
    let mut results = Vec::new();

    for service in services {
        let result = match service.as_str() {
            "immich" => {
                provision_and_store(
                    state,
                    user_id,
                    service,
                    provision_immich(state, email, name).await,
                )
                .await
            }
            "jellyfin" => {
                provision_and_store(
                    state,
                    user_id,
                    service,
                    provision_jellyfin(state, name).await,
                )
                .await
            }
            "paperless" => {
                provision_and_store(
                    state,
                    user_id,
                    service,
                    provision_paperless(state, email).await,
                )
                .await
            }
            "audiobookshelf" => {
                provision_and_store(
                    state,
                    user_id,
                    service,
                    provision_audiobookshelf(state, name).await,
                )
                .await
            }
            "kavita" => {
                provision_and_store(state, user_id, service, provision_kavita(state, name).await)
                    .await
            }
            _ => continue,
        };
        results.push(result);
    }

    results
}

/// Store the result of a service provision attempt. Reduces boilerplate
/// across the per-service match arms.
async fn provision_and_store(
    state: &AppState,
    user_id: &str,
    service: &str,
    result: Result<(String, String), AppError>,
) -> ServiceProvisionResult {
    match result {
        Ok((service_user_id, api_key)) => {
            match store_credential(&state.db, user_id, service, &service_user_id, &api_key).await {
                Ok(()) => ServiceProvisionResult {
                    service: service.into(),
                    status: "provisioned".into(),
                    user_id: Some(service_user_id),
                    error: None,
                },
                Err(e) => ServiceProvisionResult {
                    service: service.into(),
                    status: "failed".into(),
                    user_id: None,
                    error: Some(e.to_string()),
                },
            }
        }
        Err(e) => {
            tracing::error!(service = %service, error = %e, "failed to provision");
            ServiceProvisionResult {
                service: service.into(),
                status: "failed".into(),
                user_id: None,
                error: Some(e.to_string()),
            }
        }
    }
}

// ─── DB helpers ──────────────────────────────────────────────────────

/// Check which services are missing credentials in the DB.
async fn find_missing_services(db: &sqlx::PgPool, user_id: &str) -> Vec<String> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT service FROM service_connections WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(db)
            .await
            .unwrap_or_default();

    let provisioned: Vec<&str> = rows.iter().map(|r| r.0.as_str()).collect();
    ALL_SERVICES
        .iter()
        .filter(|s| !provisioned.contains(s))
        .map(|s| s.to_string())
        .collect()
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

// ─── Per-service provisioning (private) ──────────────────────────────

fn generate_password() -> String {
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::rng();
    (0..crate::constants::GENERATED_PASSWORD_LENGTH)
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

    let user = client
        .admin_create_user(&state.config.immich_admin_api_key, email, name, &password)
        .await?;
    let user_id = user["id"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "immich: no user id in response"
        )))?
        .to_string();

    let login_resp = client.login(email, &password).await?;
    let access_token = login_resp["accessToken"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "immich: no access token in login response"
        )))?;

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

    let user = client
        .admin_create_user(&state.config.jellyfin_admin_token, name, &password)
        .await?;
    let user_id = user["id"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "jellyfin: no user id in response"
        )))?
        .to_string();

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

    let user = client
        .admin_create_user(&state.config.paperless_admin_token, email, &password, email)
        .await?;
    let user_id = user["id"]
        .as_u64()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "paperless: no user id in response"
        )))?
        .to_string();

    let permissions = [
        "view_document",
        "add_document",
        "change_document",
        "delete_document",
        "view_tag",
        "add_tag",
        "change_tag",
        "view_correspondent",
        "add_correspondent",
        "change_correspondent",
        "view_documenttype",
        "add_documenttype",
        "change_documenttype",
    ];
    client
        .admin_set_user_permissions(&state.config.paperless_admin_token, &user_id, &permissions)
        .await?;

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

    let resp = client
        .admin_create_user(&state.config.audiobookshelf_admin_token, name, &password)
        .await?;
    let user_id = resp["user"]["id"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "audiobookshelf: no user id in response"
        )))?
        .to_string();

    client
        .admin_activate_user(&state.config.audiobookshelf_admin_token, &user_id)
        .await?;

    let token = resp["user"]["token"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "audiobookshelf: no token in create response"
        )))?
        .to_string();

    tracing::info!(user_id = %user_id, "provisioned audiobookshelf user");
    Ok((user_id, token))
}

/// Sanitize a display name into a valid Kavita username.
/// Kavita only allows letters and digits — no spaces or special characters.
fn sanitize_kavita_username(name: &str) -> String {
    let sanitized: String = name.chars().filter(|c| c.is_alphanumeric()).collect();
    if sanitized.is_empty() {
        // Fallback: generate a random username from a hash of the original name.
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        name.hash(&mut hasher);
        format!("user{:x}", hasher.finish())
    } else {
        sanitized
    }
}

async fn provision_kavita(state: &AppState, name: &str) -> Result<(String, String), AppError> {
    let client = KavitaClient::new(&state.config.kavita_url, state.http.clone());
    let password = generate_password();
    let username = sanitize_kavita_username(name);
    let email = format!("{username}@steadfirm.local");

    // Login as admin to get a JWT.
    let admin_login = client
        .login(
            &state.config.kavita_admin_username,
            &state.config.admin_password,
        )
        .await?;
    let admin_token = admin_login["token"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "kavita: no token in admin login response"
        )))?;

    // If the user already exists (e.g. from a previous failed provisioning
    // attempt), delete them so we can start fresh.  We cannot reuse a
    // pending invite because we don't have the original confirmation token.
    let users = client.get_users(admin_token).await?;
    let existing = users.as_array().and_then(|arr| {
        arr.iter()
            .find(|u| u["email"].as_str() == Some(email.as_str()))
    });
    if existing.is_some() {
        tracing::info!(%email, "kavita: removing stale user before re-provisioning");
        let _ = client.delete_user(admin_token, &username).await;
    }

    // Invite the new user — returns an email confirmation link.
    let email_link = client.invite_user(admin_token, &email).await?;

    // Confirm the invitation to set the user's password.
    // The confirm-email response is a full login payload that includes
    // an `apiKey` field, so we can skip the separate login + Plugin call.
    let confirm_resp = client
        .confirm_invite(&email_link, &username, &password)
        .await?;

    let api_key = confirm_resp["apiKey"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| {
            AppError::Internal(anyhow::anyhow!(
                "kavita: no apiKey in confirm-email response"
            ))
        })?;

    tracing::info!(user_id = %email, "provisioned kavita user");
    Ok((email, api_key))
}

// ─── JSON helpers ────────────────────────────────────────────────────

/// Convert provision results to a JSON object for the API response.
pub fn results_to_json(results: &[ServiceProvisionResult]) -> Value {
    let mut services = json!({});
    for r in results {
        if r.status == "provisioned" {
            services[&r.service] = json!({
                "status": "provisioned",
                "userId": r.user_id,
            });
        } else {
            services[&r.service] = json!({
                "status": "failed",
                "error": r.error,
            });
        }
    }
    services
}
