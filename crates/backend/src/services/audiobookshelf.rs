use reqwest::Client;
use serde_json::Value;

use crate::error::AppError;
use crate::proxy::check_upstream_status;

pub struct AudiobookshelfClient {
    base_url: String,
    http: Client,
}

impl AudiobookshelfClient {
    pub fn new(base_url: &str, http: Client) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http,
        }
    }

    /// Build a request with standard ABS headers.
    fn request(&self, method: reqwest::Method, path: &str, token: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{}", self.base_url, path))
            .header("authorization", format!("Bearer {token}"))
    }

    /// List library items.
    pub async fn list_items(
        &self,
        token: &str,
        library_id: &str,
        query: &[(&str, String)],
    ) -> Result<Value, AppError> {
        let resp = self
            .request(
                reqwest::Method::GET,
                &format!("/api/libraries/{library_id}/items"),
                token,
            )
            .query(query)
            .send()
            .await?;
        check_upstream_status("audiobookshelf", &resp)?;
        Ok(resp.json().await?)
    }

    /// Get a single item with details.
    pub async fn get_item(&self, token: &str, item_id: &str) -> Result<Value, AppError> {
        let resp = self
            .request(
                reqwest::Method::GET,
                &format!("/api/items/{item_id}"),
                token,
            )
            .query(&[("include", "progress,rssfeed"), ("expanded", "1")])
            .send()
            .await?;
        check_upstream_status("audiobookshelf", &resp)?;
        Ok(resp.json().await?)
    }

    /// Get cover image (binary, for proxying).
    pub async fn get_cover(
        &self,
        token: &str,
        item_id: &str,
        width: Option<u32>,
    ) -> Result<reqwest::Response, AppError> {
        let mut req = self.request(
            reqwest::Method::GET,
            &format!("/api/items/{item_id}/cover"),
            token,
        );
        if let Some(w) = width {
            req = req.query(&[("width", w.to_string())]);
        }
        let resp = req.send().await?;
        check_upstream_status("audiobookshelf", &resp)?;
        Ok(resp)
    }

    /// Start a playback session.
    pub async fn start_playback(&self, token: &str, item_id: &str) -> Result<Value, AppError> {
        let resp = self
            .request(
                reqwest::Method::POST,
                &format!("/api/items/{item_id}/play"),
                token,
            )
            .json(&serde_json::json!({
                "deviceInfo": {
                    "deviceId": "steadfirm-web",
                    "clientName": "Steadfirm"
                },
                "forceDirectPlay": true,
                "forceTranscode": false,
                "supportedMimeTypes": [
                    "audio/mpeg", "audio/mp4", "audio/ogg", "audio/flac"
                ]
            }))
            .send()
            .await?;
        check_upstream_status("audiobookshelf", &resp)?;
        Ok(resp.json().await?)
    }

    /// Sync playback progress.
    pub async fn update_progress(
        &self,
        token: &str,
        item_id: &str,
        body: &Value,
    ) -> Result<(), AppError> {
        let resp = self
            .request(
                reqwest::Method::PATCH,
                &format!("/api/me/progress/{item_id}"),
                token,
            )
            .json(body)
            .send()
            .await?;
        check_upstream_status("audiobookshelf", &resp)?;
        Ok(())
    }

    /// List recent listening sessions.
    pub async fn listening_sessions(&self, token: &str) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::GET, "/api/me/listening-sessions", token)
            .query(&[("itemsPerPage", "10")])
            .send()
            .await?;
        check_upstream_status("audiobookshelf", &resp)?;
        Ok(resp.json().await?)
    }

    /// Create a bookmark.
    pub async fn create_bookmark(
        &self,
        token: &str,
        item_id: &str,
        body: &Value,
    ) -> Result<Value, AppError> {
        let resp = self
            .request(
                reqwest::Method::POST,
                &format!("/api/me/item/{item_id}/bookmark"),
                token,
            )
            .json(body)
            .send()
            .await?;
        check_upstream_status("audiobookshelf", &resp)?;
        Ok(resp.json().await?)
    }

    /// Stream audio file (binary, for proxying).
    pub async fn stream(
        &self,
        token: &str,
        content_url: &str,
        range: Option<&axum::http::HeaderValue>,
    ) -> Result<reqwest::Response, AppError> {
        let url = format!("{}{}", self.base_url, content_url);
        let mut req = self
            .http
            .get(&url)
            .header("authorization", format!("Bearer {token}"));

        if let Some(range_val) = range {
            req = req.header("range", range_val.as_bytes());
        }

        let resp = req.send().await?;
        check_upstream_status("audiobookshelf", &resp)?;
        Ok(resp)
    }

    /// Get all libraries (used during provisioning to find the audiobook library).
    pub async fn get_libraries(&self, token: &str) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::GET, "/api/libraries", token)
            .send()
            .await?;
        check_upstream_status("audiobookshelf", &resp)?;
        Ok(resp.json().await?)
    }

    // --- Admin endpoints (for provisioning) ---

    /// Create a user.
    pub async fn admin_create_user(
        &self,
        admin_token: &str,
        username: &str,
        password: &str,
    ) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::POST, "/api/users", admin_token)
            .json(&serde_json::json!({
                "username": username,
                "password": password,
                "type": "user",
            }))
            .send()
            .await?;
        check_upstream_status("audiobookshelf", &resp)?;
        Ok(resp.json().await?)
    }

    /// Activate a user (created inactive by default).
    pub async fn admin_activate_user(
        &self,
        admin_token: &str,
        user_id: &str,
    ) -> Result<(), AppError> {
        let resp = self
            .request(
                reqwest::Method::PATCH,
                &format!("/api/users/{user_id}"),
                admin_token,
            )
            .json(&serde_json::json!({ "isActive": true }))
            .send()
            .await?;
        check_upstream_status("audiobookshelf", &resp)?;
        Ok(())
    }

    /// Login as a user to get a token.
    pub async fn login(&self, username: &str, password: &str) -> Result<Value, AppError> {
        let resp = self
            .http
            .post(format!("{}/api/login", self.base_url))
            .json(&serde_json::json!({
                "username": username,
                "password": password,
            }))
            .send()
            .await?;
        check_upstream_status("audiobookshelf", &resp)?;
        Ok(resp.json().await?)
    }
}
