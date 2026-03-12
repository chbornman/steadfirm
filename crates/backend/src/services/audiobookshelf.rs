use reqwest::Client;
use serde_json::Value;

use crate::error::AppError;
use crate::proxy::{check_response, check_streaming_status};

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
        let resp = check_response("audiobookshelf", resp).await?;
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
        let resp = check_response("audiobookshelf", resp).await?;
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
        check_streaming_status("audiobookshelf", &resp)?;
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
        let resp = check_response("audiobookshelf", resp).await?;
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
        check_response("audiobookshelf", resp).await?;
        Ok(())
    }

    /// List recent listening sessions.
    pub async fn listening_sessions(&self, token: &str) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::GET, "/api/me/listening-sessions", token)
            .query(&[(
                "itemsPerPage",
                crate::constants::AUDIOBOOKSHELF_SESSIONS_PAGE_SIZE,
            )])
            .send()
            .await?;
        let resp = check_response("audiobookshelf", resp).await?;
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
        let resp = check_response("audiobookshelf", resp).await?;
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
        check_streaming_status("audiobookshelf", &resp)?;
        Ok(resp)
    }

    /// Get all libraries (used during provisioning to find the audiobook library).
    pub async fn get_libraries(&self, token: &str) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::GET, "/api/libraries", token)
            .send()
            .await?;
        let resp = check_response("audiobookshelf", resp).await?;
        Ok(resp.json().await?)
    }

    /// Find the first book-type library and its first folder.
    /// Returns `(library_id, folder_id)`.
    pub async fn get_book_library_info(&self, token: &str) -> Result<(String, String), AppError> {
        let libraries = self.get_libraries(token).await?;
        let libs = libraries["libraries"]
            .as_array()
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("invalid libraries response")))?;

        for lib in libs {
            if lib["mediaType"].as_str() == Some("book") {
                let lib_id = lib["id"]
                    .as_str()
                    .ok_or_else(|| AppError::Internal(anyhow::anyhow!("library missing id")))?;
                let folder_id = lib["folders"]
                    .as_array()
                    .and_then(|f| f.first())
                    .and_then(|f| f["id"].as_str())
                    .ok_or_else(|| AppError::Internal(anyhow::anyhow!("library has no folders")))?;
                return Ok((lib_id.to_string(), folder_id.to_string()));
            }
        }

        Err(AppError::Internal(anyhow::anyhow!(
            "no book-type library found in Audiobookshelf"
        )))
    }

    /// Upload an audiobook to ABS using the upload API.
    ///
    /// This creates the proper folder structure (`Author/Series/Title/`)
    /// and triggers a library scan automatically.
    #[allow(clippy::too_many_arguments)]
    pub async fn upload_book(
        &self,
        token: &str,
        library_id: &str,
        folder_id: &str,
        title: &str,
        author: Option<&str>,
        series: Option<&str>,
        files: Vec<(String, Vec<u8>, String)>, // (filename, data, mime_type)
    ) -> Result<(), AppError> {
        let mut form = reqwest::multipart::Form::new()
            .text("title", title.to_string())
            .text("library", library_id.to_string())
            .text("folder", folder_id.to_string());

        if let Some(author) = author {
            form = form.text("author", author.to_string());
        }
        if let Some(series) = series {
            form = form.text("series", series.to_string());
        }

        for (i, (filename, data, mime_type)) in files.into_iter().enumerate() {
            let part = reqwest::multipart::Part::bytes(data)
                .file_name(filename)
                .mime_str(&mime_type)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("mime error: {e}")))?;
            form = form.part(i.to_string(), part);
        }

        let resp = self
            .http
            .post(format!("{}/api/upload", self.base_url))
            .header("authorization", format!("Bearer {token}"))
            .multipart(form)
            .send()
            .await?;

        check_response("audiobookshelf", resp).await?;
        Ok(())
    }

    /// Trigger a library scan (used by drop zone upload routing).
    #[allow(dead_code)]
    pub async fn scan_library(&self, token: &str, library_id: &str) -> Result<(), AppError> {
        let resp = self
            .request(
                reqwest::Method::POST,
                &format!("/api/libraries/{library_id}/scan"),
                token,
            )
            .send()
            .await?;
        // Scan returns 200 with no body on success
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(anyhow::anyhow!(
                "ABS scan failed ({}): {}",
                status,
                body
            )));
        }
        Ok(())
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
        let resp = check_response("audiobookshelf", resp).await?;
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
        check_response("audiobookshelf", resp).await?;
        Ok(())
    }

    /// Login as a user to get a token.
    pub async fn login(&self, username: &str, password: &str) -> Result<Value, AppError> {
        let resp = self
            .http
            .post(format!("{}/login", self.base_url))
            .json(&serde_json::json!({
                "username": username,
                "password": password,
            }))
            .send()
            .await?;
        let resp = check_response("audiobookshelf", resp).await?;
        Ok(resp.json().await?)
    }
}
