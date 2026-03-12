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

    // ─── Search ───────────────────────────────────────────────────────

    /// Search across all libraries for series matching a query string.
    pub async fn search(&self, api_key: &str, query: &str) -> Result<Value, AppError> {
        let resp = self
            .request_api_key(reqwest::Method::GET, "/api/Search/search", api_key)
            .query(&[("queryString", query)])
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
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

    // ─── Reader endpoints ─────────────────────────────────────────────

    /// Get volumes (with nested chapters) for a series.
    pub async fn get_volumes(&self, api_key: &str, series_id: i64) -> Result<Value, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!("/api/Series/volumes?seriesId={series_id}"),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get the continue reading point for a series.
    pub async fn continue_point(&self, api_key: &str, series_id: i64) -> Result<Value, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!("/api/Reader/continue-point?seriesId={series_id}"),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get chapter info (caches images server-side, returns metadata).
    pub async fn chapter_info(
        &self,
        api_key: &str,
        chapter_id: i64,
        include_dimensions: bool,
    ) -> Result<Value, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!(
                    "/api/Reader/chapter-info?chapterId={chapter_id}&includeDimensions={include_dimensions}"
                ),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get a page image for a comic/manga chapter.
    pub async fn page_image(
        &self,
        api_key: &str,
        chapter_id: i64,
        page: u32,
    ) -> Result<reqwest::Response, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!("/api/Reader/image?chapterId={chapter_id}&page={page}&extractPdf=false"),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp)
    }

    /// Get the raw PDF file for a chapter.
    pub async fn pdf_file(
        &self,
        api_key: &str,
        chapter_id: i64,
    ) -> Result<reqwest::Response, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!("/api/Reader/pdf?chapterId={chapter_id}&extractPdf=false"),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp)
    }

    /// Get EPUB book info (page count, metadata).
    pub async fn book_info(&self, api_key: &str, chapter_id: i64) -> Result<Value, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!("/api/Book/{chapter_id}/book-info"),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get EPUB table of contents.
    pub async fn book_chapters(&self, api_key: &str, chapter_id: i64) -> Result<Value, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!("/api/Book/{chapter_id}/chapters"),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get a rendered EPUB page as scoped HTML.
    pub async fn book_page(
        &self,
        api_key: &str,
        chapter_id: i64,
        page: u32,
    ) -> Result<String, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!("/api/Book/{chapter_id}/book-page?page={page}"),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.text().await?)
    }

    /// Get an EPUB embedded resource (image, font, CSS).
    pub async fn book_resource(
        &self,
        api_key: &str,
        chapter_id: i64,
        file: &str,
    ) -> Result<reqwest::Response, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!(
                    "/api/Book/{chapter_id}/book-resources?file={}",
                    urlencoding::encode(file)
                ),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp)
    }

    /// Get reading progress for a chapter.
    pub async fn get_progress(&self, api_key: &str, chapter_id: i64) -> Result<Value, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!("/api/Reader/get-progress?chapterId={chapter_id}"),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// Save reading progress.
    pub async fn save_progress(&self, api_key: &str, progress: &Value) -> Result<(), AppError> {
        let resp = self
            .request_api_key(reqwest::Method::POST, "/api/Reader/progress", api_key)
            .json(progress)
            .send()
            .await?;
        check_response("kavita", resp).await?;
        Ok(())
    }

    /// Get next chapter ID in reading order.
    pub async fn next_chapter(
        &self,
        api_key: &str,
        series_id: i64,
        volume_id: i64,
        chapter_id: i64,
    ) -> Result<i64, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!(
                    "/api/Reader/next-chapter?seriesId={series_id}&volumeId={volume_id}&currentChapterId={chapter_id}"
                ),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        let id: i64 = resp.json().await?;
        Ok(id)
    }

    /// Get previous chapter ID in reading order.
    pub async fn prev_chapter(
        &self,
        api_key: &str,
        series_id: i64,
        volume_id: i64,
        chapter_id: i64,
    ) -> Result<i64, AppError> {
        let resp = self
            .request_api_key(
                reqwest::Method::GET,
                &format!(
                    "/api/Reader/prev-chapter?seriesId={series_id}&volumeId={volume_id}&currentChapterId={chapter_id}"
                ),
                api_key,
            )
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        let id: i64 = resp.json().await?;
        Ok(id)
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

    /// Invite a new user (admin JWT required).
    ///
    /// Returns the email confirmation link from which the confirmation
    /// token can be extracted.  Roles should be empty — Kavita assigns
    /// `Pleb` + `Login` automatically during confirmation.
    pub async fn invite_user(&self, admin_token: &str, email: &str) -> Result<String, AppError> {
        let resp = self
            .request(reqwest::Method::POST, "/api/Account/invite", admin_token)
            .json(&serde_json::json!({
                "email": email,
                "roles": [],
                "libraries": [],
                "ageRestriction": { "ageRating": 0, "includeUnknowns": true },
            }))
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        let body: Value = resp.json().await?;

        // Response: { "emailLink": "http://…/confirm-email?token=…&email=…", … }
        body["emailLink"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| {
                AppError::Internal(anyhow::anyhow!(
                    "kavita invite: missing emailLink in response"
                ))
            })
    }

    /// Confirm an invited user by setting their password.
    ///
    /// `email_link` is the full URL returned by [`invite_user`].  The
    /// confirmation token is extracted from its query string automatically.
    ///
    /// On success Kavita returns a full login response that includes an
    /// `apiKey` field, so no separate login + Plugin/authenticate call is
    /// needed.
    pub async fn confirm_invite(
        &self,
        email_link: &str,
        username: &str,
        password: &str,
    ) -> Result<Value, AppError> {
        // Extract the `token` query parameter from the confirmation URL.
        let token = url::Url::parse(email_link)
            .ok()
            .and_then(|u| {
                u.query_pairs()
                    .find(|(k, _)| k == "token")
                    .map(|(_, v)| v.to_string())
            })
            .ok_or_else(|| {
                AppError::Internal(anyhow::anyhow!(
                    "kavita confirm: failed to extract token from email link"
                ))
            })?;

        let resp = self
            .http
            .post(format!("{}/api/Account/confirm-email", self.base_url))
            .json(&serde_json::json!({
                "username": username,
                "password": password,
                "email": format!("{username}@steadfirm.local"),
                "token": token,
            }))
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// List all users (admin JWT required).
    pub async fn get_users(&self, admin_token: &str) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::GET, "/api/Users", admin_token)
            .send()
            .await?;
        let resp = check_response("kavita", resp).await?;
        Ok(resp.json().await?)
    }

    /// Delete a user by username (admin JWT required).
    pub async fn delete_user(&self, admin_token: &str, username: &str) -> Result<(), AppError> {
        let encoded = urlencoding::encode(username);
        let resp = self
            .request(
                reqwest::Method::DELETE,
                &format!("/api/Users/delete-user?username={encoded}"),
                admin_token,
            )
            .send()
            .await?;
        check_response("kavita", resp).await?;
        Ok(())
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
