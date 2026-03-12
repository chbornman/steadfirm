//! Kavita API client — ebooks, comics, and manga management.
//!
//! Kavita uses JWT tokens for session auth and persistent API keys
//! (via `x-api-key` header) for long-lived integrations.
//! Auth flow: login → JWT token → create API key for the user.

use reqwest::Client;
use serde_json::Value;

use crate::error::AppError;
use crate::proxy::check_response;

pub struct KavitaClient {
    base_url: String,
    http: Client,
}

#[allow(dead_code)]
impl KavitaClient {
    pub fn new(base_url: &str, http: Client) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http,
        }
    }

    /// Build a request with JWT bearer token auth.
    fn request(&self, method: reqwest::Method, path: &str, token: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{}", self.base_url, path))
            .header("authorization", format!("Bearer {token}"))
    }

    /// Build a request with persistent API key auth.
    fn request_api_key(
        &self,
        method: reqwest::Method,
        path: &str,
        api_key: &str,
    ) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{}", self.base_url, path))
            .header("x-api-key", api_key)
    }

    // ─── User-facing endpoints ───────────────────────────────────────

    /// List all libraries the user has access to.
    pub async fn get_libraries(&self, api_key: &str) -> Result<Value, AppError> {
        let resp = self
            .request_api_key(reqwest::Method::GET, "/api/Library/libraries", api_key)
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// List series in a library. Returns (items, total_count).
    /// Kavita returns pagination metadata in a `Pagination` response header.
    pub async fn list_series(
        &self,
        api_key: &str,
        library_id: i64,
        page: u32,
        page_size: u32,
    ) -> Result<(Value, u64), AppError> {
        let resp = self
            .request_api_key(reqwest::Method::POST, "/api/Series/v2", api_key)
            .json(&serde_json::json!({
                "statements": [],
                "combination": 0,
                "sortOptions": { "sortField": 1, "isAscending": true },
                "limitTo": 0,
            }))
            .query(&[
                ("libraryId", library_id.to_string()),
                ("pageNumber", page.to_string()),
                ("pageSize", page_size.to_string()),
            ])
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;

        // Parse total count from Kavita's Pagination header.
        let total = resp
            .headers()
            .get("pagination")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .and_then(|v| v["totalItems"].as_u64())
            .unwrap_or(0);

        let items: Value = resp.json().await?;
        Ok((items, total))
    }

    /// Get a single series with details.
    pub async fn get_series(&self, api_key: &str, series_id: i64) -> Result<Value, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!("/api/Series/{series_id}"),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get the cover image for a series.
    pub async fn get_series_cover(
        &self,
        api_key: &str,
        series_id: i64,
    ) -> Result<reqwest::Response, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!("/api/image/series-cover?seriesId={series_id}"),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp)
    }

    /// Trigger a library scan (after uploading files).
    pub async fn scan_library(&self, api_key: &str, library_id: i64) -> Result<(), AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::POST,
                &format!("/api/Library/scan?libraryId={library_id}"),
                api_key,
            )
            .send()
            .await?;
        check_response("kavita", resp).await?;
        Ok(())
    }

    /// Trigger a scan of all libraries.
    pub async fn scan_all_libraries(&self, api_key: &str) -> Result<(), AppError> {
        let resp = self
            .request_api_key(reqwest::Method::POST, "/api/Library/scan-all", api_key)
            .send()
            .await?;
        check_response("kavita", resp).await?;
        Ok(())
    }

    // ─── Admin endpoints (for provisioning) ──────────────────────────

    /// Login as admin to get a JWT token.
    pub async fn login(&self, username: &str, password: &str) -> Result<Value, AppError> {
        let resp = self
            .http
            .post(format!("{}/api/Account/login", self.base_url))
            .json(&serde_json::json!({
                "username": username,
                "password": password,
            }))
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// Create a new user (admin JWT required).
    /// Kavita's invite endpoint creates a user and returns a link,
    /// but we use the direct admin creation endpoint.
    pub async fn admin_create_user(
        &self,
        admin_token: &str,
        username: &str,
        _password: &str,
    ) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::POST, "/api/Account/invite", admin_token)
            .json(&serde_json::json!({
                "email": format!("{username}@steadfirm.local"),
                "roles": ["Pleb"],
                "libraries": [],
                "ageRestriction": { "ageRating": 0, "includeUnknowns": true },
            }))
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// Confirm an invited user by setting their password via the invite URL.
    pub async fn confirm_invite(
        &self,
        invite_url: &str,
        username: &str,
        password: &str,
    ) -> Result<Value, AppError> {
        let resp = self
            .http
            .post(format!("{}/api/Account/confirm-email", self.base_url))
            .json(&serde_json::json!({
                "username": username,
                "password": password,
                "email": format!("{username}@steadfirm.local"),
                "token": invite_url,
            }))
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// Create a persistent API key for a user (requires user's JWT token).
    pub async fn create_api_key(&self, user_token: &str) -> Result<String, AppError> {
        let resp = self
            .request(
                reqwest::Method::POST,
                "/api/Plugin/authenticate",
                user_token,
            )
            .json(&serde_json::json!({
                "pluginName": "Steadfirm",
            }))
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        // Response is a plain string (the API key)
        let api_key = resp.text().await?;
        // Strip surrounding quotes if present
        Ok(api_key.trim_matches('"').to_string())
    }
}
