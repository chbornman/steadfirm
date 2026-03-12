use rand::Rng;
use serde_json::{json, Value};

use crate::error::AppError;
use crate::services::*;
use crate::AppState;

/// Result of provisioning a single service.
#[derive(Debug)]
pub struct ServiceProvisionResult {
    pub service: String,
    pub status: String,
    pub user_id: Option<String>,
    pub error: Option<String>,
}

/// Provision a user into all four services.
/// Returns partial results — each service is independent.
pub async fn provision_all(
    state: &AppState,
    user_id: &str,
    name: &str,
    email: &str,
) -> Vec<ServiceProvisionResult> {
    let mut results = Vec::new();

    // --- Immich ---
    match provision_immich(state, email, name).await {
        Ok((service_user_id, api_key)) => {
            let stored =
                store_credential(&state.db, user_id, "immich", &service_user_id, &api_key).await;
            match stored {
                Ok(()) => results.push(ServiceProvisionResult {
                    service: "immich".into(),
                    status: "provisioned".into(),
                    user_id: Some(service_user_id),
                    error: None,
                }),
                Err(e) => results.push(ServiceProvisionResult {
                    service: "immich".into(),
                    status: "failed".into(),
                    user_id: None,
                    error: Some(e.to_string()),
                }),
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to provision immich");
            results.push(ServiceProvisionResult {
                service: "immich".into(),
                status: "failed".into(),
                user_id: None,
                error: Some(e.to_string()),
            });
        }
    }

    // --- Jellyfin ---
    match provision_jellyfin(state, name).await {
        Ok((service_user_id, token)) => {
            let stored =
                store_credential(&state.db, user_id, "jellyfin", &service_user_id, &token).await;
            match stored {
                Ok(()) => results.push(ServiceProvisionResult {
                    service: "jellyfin".into(),
                    status: "provisioned".into(),
                    user_id: Some(service_user_id),
                    error: None,
                }),
                Err(e) => results.push(ServiceProvisionResult {
                    service: "jellyfin".into(),
                    status: "failed".into(),
                    user_id: None,
                    error: Some(e.to_string()),
                }),
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to provision jellyfin");
            results.push(ServiceProvisionResult {
                service: "jellyfin".into(),
                status: "failed".into(),
                user_id: None,
                error: Some(e.to_string()),
            });
        }
    }

    // --- Paperless ---
    match provision_paperless(state, email).await {
        Ok((service_user_id, token)) => {
            let stored =
                store_credential(&state.db, user_id, "paperless", &service_user_id, &token).await;
            match stored {
                Ok(()) => results.push(ServiceProvisionResult {
                    service: "paperless".into(),
                    status: "provisioned".into(),
                    user_id: Some(service_user_id),
                    error: None,
                }),
                Err(e) => results.push(ServiceProvisionResult {
                    service: "paperless".into(),
                    status: "failed".into(),
                    user_id: None,
                    error: Some(e.to_string()),
                }),
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to provision paperless");
            results.push(ServiceProvisionResult {
                service: "paperless".into(),
                status: "failed".into(),
                user_id: None,
                error: Some(e.to_string()),
            });
        }
    }

    // --- Audiobookshelf ---
    match provision_audiobookshelf(state, name).await {
        Ok((service_user_id, token)) => {
            let stored = store_credential(
                &state.db,
                user_id,
                "audiobookshelf",
                &service_user_id,
                &token,
            )
            .await;
            match stored {
                Ok(()) => results.push(ServiceProvisionResult {
                    service: "audiobookshelf".into(),
                    status: "provisioned".into(),
                    user_id: Some(service_user_id),
                    error: None,
                }),
                Err(e) => results.push(ServiceProvisionResult {
                    service: "audiobookshelf".into(),
                    status: "failed".into(),
                    user_id: None,
                    error: Some(e.to_string()),
                }),
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to provision audiobookshelf");
            results.push(ServiceProvisionResult {
                service: "audiobookshelf".into(),
                status: "failed".into(),
                user_id: None,
                error: Some(e.to_string()),
            });
        }
    }

    // --- Kavita ---
    match provision_kavita(state, name).await {
        Ok((service_user_id, api_key)) => {
            let stored =
                store_credential(&state.db, user_id, "kavita", &service_user_id, &api_key).await;
            match stored {
                Ok(()) => results.push(ServiceProvisionResult {
                    service: "kavita".into(),
                    status: "provisioned".into(),
                    user_id: Some(service_user_id),
                    error: None,
                }),
                Err(e) => results.push(ServiceProvisionResult {
                    service: "kavita".into(),
                    status: "failed".into(),
                    user_id: None,
                    error: Some(e.to_string()),
                }),
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to provision kavita");
            results.push(ServiceProvisionResult {
                service: "kavita".into(),
                status: "failed".into(),
                user_id: None,
                error: Some(e.to_string()),
            });
        }
    }

    results
}

/// Provision with retries for failed services.
/// Used by the webhook handler where services may still be booting.
/// Retries up to `max_retries` times with exponential backoff (2s, 4s, 8s, ...).
pub async fn provision_all_with_retry(
    state: &AppState,
    user_id: &str,
    name: &str,
    email: &str,
    max_retries: u32,
) -> Vec<ServiceProvisionResult> {
    let mut results = provision_all(state, user_id, name, email).await;

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

        // Re-attempt only for services that are still missing from the DB.
        let missing = find_missing_services(&state.db, user_id).await;
        if missing.is_empty() {
            // All services provisioned (maybe by the /users/me fallback).
            break;
        }

        let retry_results = provision_missing(state, user_id, name, email, &missing).await;

        // Replace failed results with retry results.
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

/// Check which services are missing credentials in the DB.
async fn find_missing_services(db: &sqlx::PgPool, user_id: &str) -> Vec<String> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT service FROM service_connections WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(db)
            .await
            .unwrap_or_default();

    let provisioned: Vec<&str> = rows.iter().map(|r| r.0.as_str()).collect();
    let all_services = [
        "immich",
        "jellyfin",
        "paperless",
        "audiobookshelf",
        "kavita",
    ];
    all_services
        .iter()
        .filter(|s| !provisioned.contains(s))
        .map(|s| s.to_string())
        .collect()
}

/// Provision only the specified services.
async fn provision_missing(
    state: &AppState,
    user_id: &str,
    name: &str,
    email: &str,
    services: &[String],
) -> Vec<ServiceProvisionResult> {
    let mut results = Vec::new();

    for service in services {
        let result = match service.as_str() {
            "immich" => match provision_immich(state, email, name).await {
                Ok((sid, key)) => store_and_result(&state.db, user_id, "immich", &sid, &key).await,
                Err(e) => {
                    tracing::error!(error = %e, "retry: failed to provision immich");
                    ServiceProvisionResult {
                        service: "immich".into(),
                        status: "failed".into(),
                        user_id: None,
                        error: Some(e.to_string()),
                    }
                }
            },
            "jellyfin" => match provision_jellyfin(state, name).await {
                Ok((sid, token)) => {
                    store_and_result(&state.db, user_id, "jellyfin", &sid, &token).await
                }
                Err(e) => {
                    tracing::error!(error = %e, "retry: failed to provision jellyfin");
                    ServiceProvisionResult {
                        service: "jellyfin".into(),
                        status: "failed".into(),
                        user_id: None,
                        error: Some(e.to_string()),
                    }
                }
            },
            "paperless" => match provision_paperless(state, email).await {
                Ok((sid, token)) => {
                    store_and_result(&state.db, user_id, "paperless", &sid, &token).await
                }
                Err(e) => {
                    tracing::error!(error = %e, "retry: failed to provision paperless");
                    ServiceProvisionResult {
                        service: "paperless".into(),
                        status: "failed".into(),
                        user_id: None,
                        error: Some(e.to_string()),
                    }
                }
            },
            "audiobookshelf" => match provision_audiobookshelf(state, name).await {
                Ok((sid, token)) => {
                    store_and_result(&state.db, user_id, "audiobookshelf", &sid, &token).await
                }
                Err(e) => {
                    tracing::error!(error = %e, "retry: failed to provision audiobookshelf");
                    ServiceProvisionResult {
                        service: "audiobookshelf".into(),
                        status: "failed".into(),
                        user_id: None,
                        error: Some(e.to_string()),
                    }
                }
            },
            "kavita" => match provision_kavita(state, name).await {
                Ok((sid, api_key)) => {
                    store_and_result(&state.db, user_id, "kavita", &sid, &api_key).await
                }
                Err(e) => {
                    tracing::error!(error = %e, "retry: failed to provision kavita");
                    ServiceProvisionResult {
                        service: "kavita".into(),
                        status: "failed".into(),
                        user_id: None,
                        error: Some(e.to_string()),
                    }
                }
            },
            _ => continue,
        };
        results.push(result);
    }

    results
}

/// Helper: store credential and return a result.
async fn store_and_result(
    db: &sqlx::PgPool,
    user_id: &str,
    service: &str,
    service_user_id: &str,
    api_key: &str,
) -> ServiceProvisionResult {
    match store_credential(db, user_id, service, service_user_id, api_key).await {
        Ok(()) => ServiceProvisionResult {
            service: service.into(),
            status: "provisioned".into(),
            user_id: Some(service_user_id.to_string()),
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

async fn provision_kavita(state: &AppState, name: &str) -> Result<(String, String), AppError> {
    let client = KavitaClient::new(&state.config.kavita_url, state.http.clone());
    let password = generate_password();

    // Login as admin to get a JWT
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

    // Invite the new user
    let invite_resp = client
        .admin_create_user(admin_token, name, &password)
        .await?;

    // The invite endpoint may return a confirmation link/token.
    // Extract the email link token if present, then confirm.
    let invite_link = invite_resp.as_str().unwrap_or_default().to_string();

    // Confirm the invitation to set the user's password
    if !invite_link.is_empty() {
        client.confirm_invite(&invite_link, name, &password).await?;
    }

    // Login as the new user to get their JWT
    let user_login = client.login(name, &password).await?;
    let user_token = user_login["token"]
        .as_str()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "kavita: no token in user login response"
        )))?;

    // Create a persistent API key for the user
    let api_key = client.create_api_key(user_token).await?;

    // Use the email as the user ID (Kavita doesn't always expose numeric IDs easily)
    let user_id = format!("{name}@steadfirm.local");

    tracing::info!(user_id = %user_id, "provisioned kavita user");
    Ok((user_id, api_key))
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
