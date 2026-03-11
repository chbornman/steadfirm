use reqwest::Client;
use serde_json::Value;

use crate::error::AppError;
use crate::proxy::{check_response, check_streaming_status};

pub struct ImmichClient {
    base_url: String,
    http: Client,
}

impl ImmichClient {
    pub fn new(base_url: &str, http: Client) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http,
        }
    }

    /// Search photos/videos using metadata search (POST endpoint).
    pub async fn search_metadata(&self, api_key: &str, body: &Value) -> Result<Value, AppError> {
        let resp = self
            .http
            .post(format!("{}/api/search/metadata", self.base_url))
            .header("x-api-key", api_key)
            .json(body)
            .send()
            .await?;
        let resp = check_response("immich", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get a single asset's metadata.
    pub async fn get_asset(&self, api_key: &str, asset_id: &str) -> Result<Value, AppError> {
        let resp = self
            .http
            .get(format!("{}/api/assets/{}", self.base_url, asset_id))
            .header("x-api-key", api_key)
            .send()
            .await?;
        let resp = check_response("immich", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get thumbnail binary response (for proxying).
    pub async fn get_thumbnail(
        &self,
        api_key: &str,
        asset_id: &str,
    ) -> Result<reqwest::Response, AppError> {
        let resp = self
            .http
            .get(format!(
                "{}/api/assets/{}/thumbnail?size=preview",
                self.base_url, asset_id
            ))
            .header("x-api-key", api_key)
            .send()
            .await?;
        check_streaming_status("immich", &resp)?;
        Ok(resp)
    }

    /// Get original file binary response (for proxying).
    pub async fn get_original(
        &self,
        api_key: &str,
        asset_id: &str,
    ) -> Result<reqwest::Response, AppError> {
        let resp = self
            .http
            .get(format!(
                "{}/api/assets/{}/original",
                self.base_url, asset_id
            ))
            .header("x-api-key", api_key)
            .send()
            .await?;
        check_streaming_status("immich", &resp)?;
        Ok(resp)
    }

    /// Get video playback stream (for proxying, supports range requests).
    pub async fn get_video_playback(
        &self,
        api_key: &str,
        asset_id: &str,
        range: Option<&axum::http::HeaderValue>,
    ) -> Result<reqwest::Response, AppError> {
        let mut req = self
            .http
            .get(format!(
                "{}/api/assets/{}/video/playback",
                self.base_url, asset_id
            ))
            .header("x-api-key", api_key);

        if let Some(range_val) = range {
            req = req.header("range", range_val.as_bytes());
        }

        let resp = req.send().await?;
        check_streaming_status("immich", &resp)?;
        Ok(resp)
    }

    /// Update an asset (e.g., toggle favorite).
    pub async fn update_asset(
        &self,
        api_key: &str,
        asset_id: &str,
        body: &Value,
    ) -> Result<Value, AppError> {
        let resp = self
            .http
            .put(format!("{}/api/assets/{}", self.base_url, asset_id))
            .header("x-api-key", api_key)
            .json(body)
            .send()
            .await?;
        let resp = check_response("immich", resp).await?;
        Ok(resp.json().await?)
    }

    /// Upload an asset (multipart).
    pub async fn upload_asset(
        &self,
        api_key: &str,
        form: reqwest::multipart::Form,
    ) -> Result<Value, AppError> {
        let resp = self
            .http
            .post(format!("{}/api/assets", self.base_url))
            .header("x-api-key", api_key)
            .multipart(form)
            .send()
            .await?;
        let resp = check_response("immich", resp).await?;
        Ok(resp.json().await?)
    }

    // --- Admin endpoints (for provisioning) ---

    /// Create a user via admin API.
    pub async fn admin_create_user(
        &self,
        admin_key: &str,
        email: &str,
        name: &str,
        password: &str,
    ) -> Result<Value, AppError> {
        let resp = self
            .http
            .post(format!("{}/api/admin/users", self.base_url))
            .header("x-api-key", admin_key)
            .json(&serde_json::json!({
                "email": email,
                "name": name,
                "password": password,
            }))
            .send()
            .await?;
        let resp = check_response("immich", resp).await?;
        Ok(resp.json().await?)
    }

    /// Login as a user to get an access token.
    pub async fn login(&self, email: &str, password: &str) -> Result<Value, AppError> {
        let resp = self
            .http
            .post(format!("{}/api/auth/login", self.base_url))
            .json(&serde_json::json!({
                "email": email,
                "password": password,
            }))
            .send()
            .await?;
        let resp = check_response("immich", resp).await?;
        Ok(resp.json().await?)
    }

    /// Create an API key for the authenticated user.
    pub async fn create_api_key(&self, access_token: &str) -> Result<Value, AppError> {
        let resp = self
            .http
            .post(format!("{}/api/api-keys", self.base_url))
            .header("authorization", format!("Bearer {access_token}"))
            .json(&serde_json::json!({
                "name": "steadfirm",
                "permissions": ["all"],
            }))
            .send()
            .await?;
        let resp = check_response("immich", resp).await?;
        Ok(resp.json().await?)
    }
}
