use reqwest::Client;
use serde_json::Value;

use crate::error::AppError;
use crate::proxy::check_upstream_status;

pub struct PaperlessClient {
    base_url: String,
    http: Client,
}

impl PaperlessClient {
    pub fn new(base_url: &str, http: Client) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http,
        }
    }

    /// Build a request with standard Paperless headers.
    fn request(&self, method: reqwest::Method, path: &str, token: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{}", self.base_url, path))
            .header("authorization", format!("Token {token}"))
            .header("accept", "application/json; version=9")
    }

    /// List documents with query parameters.
    pub async fn list_documents(
        &self,
        token: &str,
        query: &[(&str, String)],
    ) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::GET, "/api/documents/", token)
            .query(query)
            .send()
            .await?;
        check_upstream_status("paperless", &resp)?;
        Ok(resp.json().await?)
    }

    /// Get a single document.
    pub async fn get_document(&self, token: &str, doc_id: &str) -> Result<Value, AppError> {
        let resp = self
            .request(
                reqwest::Method::GET,
                &format!("/api/documents/{doc_id}/"),
                token,
            )
            .query(&[("truncate_content", "true")])
            .send()
            .await?;
        check_upstream_status("paperless", &resp)?;
        Ok(resp.json().await?)
    }

    /// Get document thumbnail (binary, for proxying).
    pub async fn get_thumbnail(
        &self,
        token: &str,
        doc_id: &str,
    ) -> Result<reqwest::Response, AppError> {
        let resp = self
            .request(
                reqwest::Method::GET,
                &format!("/api/documents/{doc_id}/thumb/"),
                token,
            )
            .send()
            .await?;
        check_upstream_status("paperless", &resp)?;
        Ok(resp)
    }

    /// Get document PDF preview (binary, for proxying).
    pub async fn get_preview(
        &self,
        token: &str,
        doc_id: &str,
    ) -> Result<reqwest::Response, AppError> {
        let resp = self
            .request(
                reqwest::Method::GET,
                &format!("/api/documents/{doc_id}/preview/"),
                token,
            )
            .send()
            .await?;
        check_upstream_status("paperless", &resp)?;
        Ok(resp)
    }

    /// Download original file (binary, for proxying).
    pub async fn download(&self, token: &str, doc_id: &str) -> Result<reqwest::Response, AppError> {
        let resp = self
            .request(
                reqwest::Method::GET,
                &format!("/api/documents/{doc_id}/download/"),
                token,
            )
            .send()
            .await?;
        check_upstream_status("paperless", &resp)?;
        Ok(resp)
    }

    /// List all tags.
    pub async fn list_tags(&self, token: &str) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::GET, "/api/tags/", token)
            .query(&[("page_size", "1000")])
            .send()
            .await?;
        check_upstream_status("paperless", &resp)?;
        Ok(resp.json().await?)
    }

    /// List all correspondents.
    pub async fn list_correspondents(&self, token: &str) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::GET, "/api/correspondents/", token)
            .query(&[("page_size", "1000")])
            .send()
            .await?;
        check_upstream_status("paperless", &resp)?;
        Ok(resp.json().await?)
    }

    /// Upload a document (multipart).
    pub async fn upload_document(
        &self,
        token: &str,
        form: reqwest::multipart::Form,
    ) -> Result<Value, AppError> {
        let resp = self
            .http
            .post(format!("{}/api/documents/post_document/", self.base_url))
            .header("authorization", format!("Token {token}"))
            .multipart(form)
            .send()
            .await?;
        check_upstream_status("paperless", &resp)?;
        // Paperless returns task ID, not the document itself.
        Ok(resp.json().await?)
    }

    // --- Admin endpoints (for provisioning) ---

    /// Create a user via admin API.
    pub async fn admin_create_user(
        &self,
        admin_token: &str,
        username: &str,
        password: &str,
        email: &str,
    ) -> Result<Value, AppError> {
        let resp = self
            .request(reqwest::Method::POST, "/api/users/", admin_token)
            .json(&serde_json::json!({
                "username": username,
                "password": password,
                "email": email,
            }))
            .send()
            .await?;
        check_upstream_status("paperless", &resp)?;
        Ok(resp.json().await?)
    }

    /// Get a token for a user by logging in.
    pub async fn get_token(&self, username: &str, password: &str) -> Result<Value, AppError> {
        let resp = self
            .http
            .post(format!("{}/api/token/", self.base_url))
            .header("accept", "application/json; version=9")
            .json(&serde_json::json!({
                "username": username,
                "password": password,
            }))
            .send()
            .await?;
        check_upstream_status("paperless", &resp)?;
        Ok(resp.json().await?)
    }
}
