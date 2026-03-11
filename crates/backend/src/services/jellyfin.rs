use reqwest::Client;
use serde_json::Value;

use crate::error::AppError;
use crate::proxy::{check_response, check_streaming_status};

pub struct JellyfinClient {
    base_url: String,
    device_id: String,
    http: Client,
}

impl JellyfinClient {
    pub fn new(base_url: &str, device_id: &str, http: Client) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            device_id: device_id.to_string(),
            http,
        }
    }

    /// Build the MediaBrowser Authorization header value.
    fn auth_header_value(&self, token: &str) -> String {
        format!(
            r#"MediaBrowser Client="Steadfirm", Device="Steadfirm-Backend", DeviceId="{}", Version="{}", Token="{}""#,
            self.device_id,
            env!("CARGO_PKG_VERSION"),
            token,
        )
    }

    /// Build a request with standard Jellyfin headers.
    fn request(&self, method: reqwest::Method, path: &str, token: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{}", self.base_url, path))
            .header("authorization", self.auth_header_value(token))
            .header("accept", r#"application/json; profile="CamelCase""#)
    }

    /// List items with query parameters.
    pub async fn get_items(
        &self,
        token: &str,
        user_id: &str,
        query: &[(&str, &str)],
    ) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::GET, "/Items", token)
            .query(&[("userId", user_id)])
            .query(query)
            .send()
            .await?;
        let resp = check_response("jellyfin", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get a single item.
    pub async fn get_item(
        &self,
        token: &str,
        user_id: &str,
        item_id: &str,
    ) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::GET, &format!("/Items/{item_id}"), token)
            .query(&[("userId", user_id)])
            .send()
            .await?;
        let resp = check_response("jellyfin", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get seasons for a show.
    pub async fn get_seasons(
        &self,
        token: &str,
        user_id: &str,
        show_id: &str,
    ) -> Result<Value, AppError> {
        let resp = self
            .request(
                reqwest::Method::GET,
                &format!("/Shows/{show_id}/Seasons"),
                token,
            )
            .query(&[("userId", user_id), ("fields", "Overview")])
            .send()
            .await?;
        let resp = check_response("jellyfin", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get episodes for a show/season.
    pub async fn get_episodes(
        &self,
        token: &str,
        user_id: &str,
        show_id: &str,
        season_id: &str,
    ) -> Result<Value, AppError> {
        let resp = self
            .request(
                reqwest::Method::GET,
                &format!("/Shows/{show_id}/Episodes"),
                token,
            )
            .query(&[
                ("userId", user_id),
                ("seasonId", season_id),
                ("fields", "Overview,MediaSources,PrimaryImageAspectRatio"),
                ("enableUserData", "true"),
            ])
            .send()
            .await?;
        let resp = check_response("jellyfin", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get album artists.
    pub async fn get_album_artists(
        &self,
        token: &str,
        user_id: &str,
        query: &[(&str, &str)],
    ) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::GET, "/Artists/AlbumArtists", token)
            .query(&[("userId", user_id)])
            .query(query)
            .send()
            .await?;
        let resp = check_response("jellyfin", resp).await?;
        Ok(resp.json().await?)
    }

    /// Get image (binary, for proxying). No auth required but we proxy anyway.
    pub async fn get_image(
        &self,
        item_id: &str,
        max_width: Option<u32>,
    ) -> Result<reqwest::Response, AppError> {
        let mut url = format!("{}/Items/{item_id}/Images/Primary", self.base_url);
        let mut params = vec![
            (
                "format",
                crate::constants::JELLYFIN_IMAGE_FORMAT.to_string(),
            ),
            (
                "quality",
                crate::constants::JELLYFIN_IMAGE_QUALITY.to_string(),
            ),
        ];
        if let Some(w) = max_width {
            params.push(("maxWidth", w.to_string()));
        }

        let query_string: Vec<String> = params.iter().map(|(k, v)| format!("{k}={v}")).collect();
        if !query_string.is_empty() {
            url = format!("{}?{}", url, query_string.join("&"));
        }

        let resp = self.http.get(&url).send().await?;
        // Don't check status for images — 404 just means no image.
        Ok(resp)
    }

    /// Stream video (direct stream, static=true).
    pub async fn stream_video(
        &self,
        token: &str,
        item_id: &str,
        range: Option<&axum::http::HeaderValue>,
    ) -> Result<reqwest::Response, AppError> {
        let url = format!(
            "{}/Videos/{}/stream?static=true&mediaSourceId={}",
            self.base_url, item_id, item_id
        );
        let mut req = self
            .http
            .get(&url)
            .header("authorization", self.auth_header_value(token));

        if let Some(range_val) = range {
            req = req.header("range", range_val.as_bytes());
        }

        let resp = req.send().await?;
        check_streaming_status("jellyfin", &resp)?;
        Ok(resp)
    }

    /// Stream audio (direct stream, static=true).
    pub async fn stream_audio(
        &self,
        token: &str,
        item_id: &str,
        range: Option<&axum::http::HeaderValue>,
    ) -> Result<reqwest::Response, AppError> {
        let url = format!(
            "{}/Audio/{}/stream?static=true&mediaSourceId={}",
            self.base_url, item_id, item_id
        );
        let mut req = self
            .http
            .get(&url)
            .header("authorization", self.auth_header_value(token));

        if let Some(range_val) = range {
            req = req.header("range", range_val.as_bytes());
        }

        let resp = req.send().await?;
        check_streaming_status("jellyfin", &resp)?;
        Ok(resp)
    }

    // --- Admin endpoints (for provisioning) ---

    /// Create a new user.
    pub async fn admin_create_user(
        &self,
        admin_token: &str,
        name: &str,
        password: &str,
    ) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::POST, "/Users/New", admin_token)
            .json(&serde_json::json!({
                "Name": name,
                "Password": password,
            }))
            .send()
            .await?;
        let resp = check_response("jellyfin", resp).await?;
        Ok(resp.json().await?)
    }

    /// Set user policy.
    pub async fn set_user_policy(
        &self,
        admin_token: &str,
        user_id: &str,
        policy: &Value,
    ) -> Result<(), AppError> {
        let resp = self
            .request(
                reqwest::Method::POST,
                &format!("/Users/{user_id}/Policy"),
                admin_token,
            )
            .json(policy)
            .send()
            .await?;
        check_response("jellyfin", resp).await?;
        Ok(())
    }

    /// Trigger a library refresh (admin endpoint).
    pub async fn refresh_library(&self, admin_token: &str) -> Result<(), AppError> {
        let _ = self
            .request(reqwest::Method::POST, "/Library/Refresh", admin_token)
            .send()
            .await?;
        Ok(())
    }

    /// Authenticate by username/password to get an access token.
    pub async fn authenticate_by_name(
        &self,
        username: &str,
        password: &str,
    ) -> Result<Value, AppError> {
        let auth_value = format!(
            r#"MediaBrowser Client="Steadfirm", Device="Steadfirm-Backend", DeviceId="{}", Version="{}""#,
            self.device_id,
            env!("CARGO_PKG_VERSION"),
        );
        let resp = self
            .http
            .post(format!("{}/Users/AuthenticateByName", self.base_url))
            .header("authorization", auth_value)
            .header("content-type", "application/json")
            .json(&serde_json::json!({
                "Username": username,
                "Pw": password,
            }))
            .send()
            .await?;
        let resp = check_response("jellyfin", resp).await?;
        Ok(resp.json().await?)
    }
}
