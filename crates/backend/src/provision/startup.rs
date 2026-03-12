//! Service initialization — runs on backend startup.
//!
//! For each underlying service (Immich, Jellyfin, Paperless, Audiobookshelf):
//!   1. Check admin_credentials table for existing token
//!   2. If found, skip (already initialized)
//!   3. If not found, initialize the service and store the token

use serde_json::json;
use sqlx::PgPool;

use crate::config::Config;
use crate::services::*;

#[derive(sqlx::FromRow)]
struct AdminCred {
    #[allow(dead_code)]
    service: String,
    admin_token: String,
    #[allow(dead_code)]
    admin_user_id: String,
}

/// Load admin credentials from DB into the config.
/// Returns updated config with tokens populated.
pub async fn load_admin_credentials(db: &PgPool, mut config: Config) -> anyhow::Result<Config> {
    let rows = sqlx::query_as::<_, AdminCred>(
        "SELECT service, admin_user_id, admin_token FROM admin_credentials",
    )
    .fetch_all(db)
    .await?;

    for row in &rows {
        match row.service.as_str() {
            "immich" => config.immich_admin_api_key = row.admin_token.clone(),
            "jellyfin" => config.jellyfin_admin_token = row.admin_token.clone(),
            "paperless" => config.paperless_admin_token = row.admin_token.clone(),
            "audiobookshelf" => config.audiobookshelf_admin_token = row.admin_token.clone(),
            "kavita" => config.kavita_admin_api_key = row.admin_token.clone(),
            _ => {}
        }
    }

    if rows.len() < crate::constants::EXPECTED_SERVICE_COUNT {
        tracing::info!(
            initialized = rows.len(),
            "some services not yet initialized — will initialize on this startup"
        );
    }

    Ok(config)
}

/// Initialize any services that don't have admin credentials stored.
/// Safe to call on every startup — idempotent.
pub async fn initialize_services(
    db: &PgPool,
    config: &mut Config,
    http: &reqwest::Client,
) -> anyhow::Result<()> {
    let admin_password = &config.admin_password;

    // --- Immich ---
    if config.immich_admin_api_key.is_empty() {
        match init_immich(
            http,
            &config.immich_url,
            &config.immich_admin_email,
            admin_password,
        )
        .await
        {
            Ok((user_id, api_key)) => {
                store_admin_cred(db, "immich", &user_id, &api_key).await?;
                config.immich_admin_api_key = api_key;
                tracing::info!("initialized immich");
            }
            Err(e) => tracing::error!(error = %e, "failed to initialize immich"),
        }
    }

    // --- Jellyfin ---
    if config.jellyfin_admin_token.is_empty() {
        match init_jellyfin(
            http,
            &config.jellyfin_url,
            &config.jellyfin_device_id,
            &config.jellyfin_admin_username,
            admin_password,
        )
        .await
        {
            Ok((user_id, token)) => {
                store_admin_cred(db, "jellyfin", &user_id, &token).await?;
                config.jellyfin_admin_token = token;
                tracing::info!("initialized jellyfin");
            }
            Err(e) => tracing::error!(error = %e, "failed to initialize jellyfin"),
        }
    }

    // --- Paperless ---
    if config.paperless_admin_token.is_empty() {
        match init_paperless(
            http,
            &config.paperless_url,
            &config.paperless_admin_username,
            admin_password,
        )
        .await
        {
            Ok((user_id, token)) => {
                store_admin_cred(db, "paperless", &user_id, &token).await?;
                config.paperless_admin_token = token;
                tracing::info!("initialized paperless");
            }
            Err(e) => tracing::error!(error = %e, "failed to initialize paperless"),
        }
    }

    // --- Audiobookshelf ---
    if config.audiobookshelf_admin_token.is_empty() {
        match init_audiobookshelf(
            http,
            &config.audiobookshelf_url,
            &config.audiobookshelf_admin_username,
            admin_password,
        )
        .await
        {
            Ok((user_id, token)) => {
                store_admin_cred(db, "audiobookshelf", &user_id, &token).await?;
                config.audiobookshelf_admin_token = token;
                tracing::info!("initialized audiobookshelf");
            }
            Err(e) => tracing::error!(error = %e, "failed to initialize audiobookshelf"),
        }
    }

    // --- Kavita ---
    if config.kavita_admin_api_key.is_empty() {
        match init_kavita(
            http,
            &config.kavita_url,
            &config.kavita_admin_username,
            admin_password,
        )
        .await
        {
            Ok((user_id, api_key)) => {
                store_admin_cred(db, "kavita", &user_id, &api_key).await?;
                config.kavita_admin_api_key = api_key;
                tracing::info!("initialized kavita");
            }
            Err(e) => tracing::error!(error = %e, "failed to initialize kavita"),
        }
    }

    // --- Ensure libraries exist (idempotent, runs every startup) ---
    // Library creation may have failed on first init or been skipped.
    // These functions check for existing libraries and create missing ones.

    if !config.jellyfin_admin_token.is_empty() {
        let jf_client = JellyfinClient::new(
            &config.jellyfin_url,
            &config.jellyfin_device_id,
            http.clone(),
        );
        ensure_jellyfin_libraries(&jf_client, &config.jellyfin_admin_token).await;
    }

    if !config.kavita_admin_api_key.is_empty() {
        let kv_client = KavitaClient::new(&config.kavita_url, http.clone());
        // Need JWT for library management — login as admin.
        match kv_client
            .login(&config.kavita_admin_username, &config.admin_password)
            .await
        {
            Ok(resp) => {
                if let Some(token) = resp["token"].as_str() {
                    ensure_kavita_libraries(&kv_client, token).await;
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, "could not login to kavita for library check")
            }
        }
    }

    Ok(())
}

// ─── Immich ──────────────────────────────────────────────────────────

async fn init_immich(
    http: &reqwest::Client,
    base_url: &str,
    admin_email: &str,
    password: &str,
) -> anyhow::Result<(String, String)> {
    let client = ImmichClient::new(base_url, http.clone());

    let config: serde_json::Value = http
        .get(format!("{base_url}/api/server/config"))
        .send()
        .await?
        .json()
        .await?;

    let is_initialized = config["isInitialized"].as_bool().unwrap_or(false);

    if !is_initialized {
        let resp = http
            .post(format!("{base_url}/api/auth/admin-sign-up"))
            .json(&json!({
                "email": admin_email,
                "password": password,
                "name": "Admin",
            }))
            .send()
            .await?;
        if !resp.status().is_success() {
            anyhow::bail!("immich admin signup failed: {}", resp.status());
        }
    }

    let login: serde_json::Value = client.login(admin_email, password).await?;
    let access_token = login["accessToken"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("no access token from immich login"))?;

    let api_key_resp = client.create_api_key(access_token).await?;
    let api_key = api_key_resp["secret"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("no secret from immich api key"))?
        .to_string();

    let user_id = login["userId"].as_str().unwrap_or("admin").to_string();

    Ok((user_id, api_key))
}

// ─── Jellyfin ────────────────────────────────────────────────────────

async fn init_jellyfin(
    http: &reqwest::Client,
    base_url: &str,
    device_id: &str,
    admin_username: &str,
    password: &str,
) -> anyhow::Result<(String, String)> {
    let client = JellyfinClient::new(base_url, device_id, http.clone());

    let info: serde_json::Value = http
        .get(format!("{base_url}/System/Info/Public"))
        .send()
        .await?
        .json()
        .await?;

    let wizard_done = info["StartupWizardCompleted"].as_bool().unwrap_or(false);

    if !wizard_done {
        http.post(format!("{base_url}/Startup/Configuration"))
            .json(&json!({
                "UICulture": "en-US",
                "MetadataCountryCode": "US",
                "PreferredMetadataLanguage": "en",
            }))
            .send()
            .await?;

        http.get(format!("{base_url}/Startup/User")).send().await?;

        http.post(format!("{base_url}/Startup/User"))
            .json(&json!({
                "Name": admin_username,
                "Password": password,
            }))
            .send()
            .await?;

        http.post(format!("{base_url}/Startup/RemoteAccess"))
            .json(&json!({
                "EnableRemoteAccess": true,
                "EnableAutomaticPortMapping": false,
            }))
            .send()
            .await?;

        http.post(format!("{base_url}/Startup/Complete"))
            .send()
            .await?;

        tokio::time::sleep(std::time::Duration::from_secs(
            crate::constants::JELLYFIN_WIZARD_SETTLE_SECS,
        ))
        .await;
    }

    let auth_resp = client
        .authenticate_by_name(admin_username, password)
        .await?;
    let token = auth_resp["AccessToken"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("no AccessToken from jellyfin auth"))?
        .to_string();
    let user_id = auth_resp["User"]["Id"]
        .as_str()
        .unwrap_or("admin")
        .to_string();

    // Ensure media libraries exist (idempotent — skips if already created).
    ensure_jellyfin_libraries(&client, &token).await;

    Ok((user_id, token))
}

/// Create Jellyfin virtual folders for Movies, Shows, and Music if they
/// don't already exist. Each library type points at a dedicated subdirectory
/// under the shared `/media` mount so Jellyfin can index content by type.
async fn ensure_jellyfin_libraries(client: &JellyfinClient, admin_token: &str) {
    let existing = match client.get_virtual_folders(admin_token).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "failed to list jellyfin virtual folders");
            return;
        }
    };

    let existing_names: Vec<String> = existing
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|f| f["Name"].as_str().map(|s| s.to_string()))
        .collect();

    let libraries = [
        ("Movies", "movies", "/media/Movies"),
        ("Shows", "tvshows", "/media/Shows"),
        ("Music", "music", "/media/Music"),
    ];

    for (name, collection_type, path) in &libraries {
        if existing_names.iter().any(|n| n == name) {
            continue;
        }
        match client
            .add_virtual_folder(admin_token, name, collection_type, path)
            .await
        {
            Ok(()) => tracing::info!(library = name, "created jellyfin library"),
            Err(e) => {
                tracing::error!(library = name, error = %e, "failed to create jellyfin library")
            }
        }
    }
}

// ─── Paperless ───────────────────────────────────────────────────────

async fn init_paperless(
    http: &reqwest::Client,
    base_url: &str,
    admin_username: &str,
    password: &str,
) -> anyhow::Result<(String, String)> {
    let client = PaperlessClient::new(base_url, http.clone());

    let token_result = client.get_token(admin_username, password).await;

    match token_result {
        Ok(resp) => {
            let token = resp["token"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("no token from paperless"))?
                .to_string();
            Ok((admin_username.to_string(), token))
        }
        Err(_) => {
            anyhow::bail!(
                "paperless admin not available — set PAPERLESS_ADMIN_USER=admin and \
                 PAPERLESS_ADMIN_PASSWORD in docker-compose environment"
            )
        }
    }
}

// ─── Audiobookshelf ──────────────────────────────────────────────────

async fn init_audiobookshelf(
    http: &reqwest::Client,
    base_url: &str,
    admin_username: &str,
    password: &str,
) -> anyhow::Result<(String, String)> {
    let client = AudiobookshelfClient::new(base_url, http.clone());

    let status: serde_json::Value = http
        .get(format!("{base_url}/status"))
        .send()
        .await?
        .json()
        .await?;

    let is_init = status["isInit"].as_bool().unwrap_or(false);

    if !is_init {
        let resp = http
            .post(format!("{base_url}/init"))
            .json(&json!({
                "newRoot": {
                    "username": admin_username,
                    "password": password,
                }
            }))
            .send()
            .await?;
        if !resp.status().is_success() {
            anyhow::bail!("audiobookshelf init failed: {}", resp.status());
        }
    }

    let login_resp = client.login(admin_username, password).await?;
    let token = login_resp["user"]["token"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("no token from audiobookshelf login"))?
        .to_string();
    let user_id = login_resp["user"]["id"]
        .as_str()
        .unwrap_or("root")
        .to_string();

    let libraries = client.get_libraries(&token).await?;
    let lib_count = libraries["libraries"]
        .as_array()
        .map(|a| a.len())
        .unwrap_or(0);
    if lib_count == 0 {
        let resp = http
            .post(format!("{base_url}/api/libraries"))
            .header("authorization", format!("Bearer {token}"))
            .json(&json!({
                "name": "Audiobooks",
                "mediaType": "book",
                "folders": [{"fullPath": "/audiobooks"}],
            }))
            .send()
            .await?;
        if resp.status().is_success() {
            tracing::info!("created audiobook library");
        }
    }

    Ok((user_id, token))
}

// ─── Kavita ──────────────────────────────────────────────────────────

async fn init_kavita(
    http: &reqwest::Client,
    base_url: &str,
    admin_username: &str,
    password: &str,
) -> anyhow::Result<(String, String)> {
    let client = KavitaClient::new(base_url, http.clone());
    let email = format!("{admin_username}@steadfirm.local");

    let login_result = client.login(admin_username, password).await;

    // We need both the JWT token (for admin library ops) and the API key
    // (for long-lived auth). JWT is required for library creation.
    let (jwt_token, api_key) = match login_result {
        Ok(resp) => {
            let token = resp["token"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("no token from kavita login"))?
                .to_string();

            let api_key = client.create_api_key(&token).await?;
            (token, api_key)
        }
        Err(_) => {
            let resp = http
                .post(format!("{base_url}/api/Account/register"))
                .json(&json!({
                    "username": admin_username,
                    "password": password,
                    "email": email,
                }))
                .send()
                .await?;

            let status = resp.status();
            let body: serde_json::Value = resp.json().await.unwrap_or_default();

            if !status.is_success() {
                anyhow::bail!("kavita admin registration failed: {body}");
            }

            // Registration returns a UserDto with JWT token and apiKey.
            let token = body["token"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("no token from kavita registration response"))?
                .to_string();

            // Create a persistent API key using the JWT from registration.
            let api_key = client.create_api_key(&token).await?;

            (token, api_key)
        }
    };

    // Ensure libraries exist using JWT (API keys lack library management permissions).
    ensure_kavita_libraries(&client, &jwt_token).await;

    Ok((admin_username.to_string(), api_key))
}

/// Create Kavita libraries for Books and Comics if they don't already exist.
/// Uses JWT bearer auth (required for admin library endpoints).
/// Kavita library types: 0=Manga, 1=Comic, 2=Book, 3=Image, 4=LightNovel
async fn ensure_kavita_libraries(client: &KavitaClient, jwt_token: &str) {
    let existing = match client.get_libraries_jwt(jwt_token).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "failed to list kavita libraries");
            return;
        }
    };

    let existing_names: Vec<String> = existing
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|lib| lib["name"].as_str().map(|s| s.to_string()))
        .collect();

    // Kavita type 2 = Book (epub, pdf), type 1 = Comic (cbz, cbr)
    let libraries: &[(&str, i32, &str)] =
        &[("Books", 2, "/books/Books"), ("Comics", 1, "/books/Comics")];

    for (name, lib_type, folder) in libraries {
        if existing_names.iter().any(|n| n == name) {
            continue;
        }
        match client
            .create_library_jwt(jwt_token, name, *lib_type, &[folder])
            .await
        {
            Ok(()) => tracing::info!(library = name, "created kavita library"),
            Err(e) => {
                tracing::error!(library = name, error = %e, "failed to create kavita library")
            }
        }
    }
}

// ─── DB helpers ──────────────────────────────────────────────────────

async fn store_admin_cred(
    db: &PgPool,
    service: &str,
    admin_user_id: &str,
    admin_token: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO admin_credentials (service, admin_user_id, admin_token) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (service) DO UPDATE SET admin_user_id = $2, admin_token = $3",
    )
    .bind(service)
    .bind(admin_user_id)
    .bind(admin_token)
    .execute(db)
    .await?;
    Ok(())
}
