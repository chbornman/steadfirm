//! AI classification service — direct HTTP to LLM providers.
//!
//! Supports Anthropic (`/v1/messages`) and any OpenAI-compatible server
//! (Ollama, vLLM, llama.cpp) via direct `reqwest` calls to
//! `/v1/chat/completions`. Both paths use plain content extraction
//! with JSON fence stripping — no tool calling, no SDK dependencies.

use std::time::Instant;

use anyhow::{Context, Result};
use futures::StreamExt;
use tokio::sync::mpsc;

use crate::config::Config;
use crate::constants::{CLASSIFY_MAX_TOKENS, DEFAULT_ANTHROPIC_MODEL, DEFAULT_LOCAL_MODEL};
use steadfirm_shared::classify::{ClassifyDebugInfo, FileEntry, LlmClassifyResult};

// ─── System prompt ───────────────────────────────────────────────────

const CLASSIFICATION_SYSTEM_PROMPT: &str = r#"You are a file classification assistant for a personal cloud platform called Steadfirm. Your job is to look at file metadata (filename, MIME type, size, folder path) and determine which service each file should be routed to.

## Available services

- **photos**: Personal photos and home videos. Managed by Immich. Includes camera photos (JPG, HEIC, RAW), screenshots, and personal/home videos (phone recordings, family videos, GoPro footage, etc.).
- **media**: Movies, TV shows, and music. Managed by Jellyfin. Includes ripped/downloaded movies and TV episodes (often with scene release naming like "Movie.Name.2024.1080p.BluRay.x264"), and music files that are clearly part of a music library.
- **documents**: Documents for OCR and archival. Managed by Paperless-ngx. Includes Office docs, scanned documents, invoices, receipts, tax forms, contracts, and other paperwork. PDFs that are clearly administrative/business documents belong here.
- **audiobooks**: Audiobook files. Managed by Audiobookshelf. Includes M4B files, and MP3/M4A/FLAC files that are clearly audiobook chapters (not music). Audiobookshelf expects files organized as Author/Title/files.
- **reading**: Ebooks, comics, and manga. Managed by Kavita. Includes EPUB, MOBI, CBZ, CBR, and other ebook/comic formats. PDFs that are clearly books (novels, textbooks, technical books, manuals) belong here rather than in documents.
- **files**: Catch-all for anything that doesn't clearly fit elsewhere. Managed by Steadfirm's own storage.

## Key distinctions to make

### Movies vs personal videos
- **Movie indicators**: Scene release naming patterns (resolution tags like 1080p/2160p, codec tags like x264/x265, source tags like BluRay/WEB-DL), large file sizes (>2GB), folder names like "Movies"
- **Personal video indicators**: Camera-generated names (IMG_*, VID_*, PXL_*, MVI_*), timestamp-based names (20240315_143022), small-medium sizes (<500MB), folders like "DCIM" or date-based folders

### Music vs audiobooks
- **Music indicators**: Short duration files (3-7 minutes typical), artist/album folder structure, genre-related folder names
- **Audiobook indicators**: Long duration files, chapter numbering in filenames, folder names containing author names or book titles, keywords like "audiobook", "chapter", "narrated", "unabridged"
- **For audiobooks**: Also infer the author and book title from the folder path and filenames. This is critical for organizing them in Audiobookshelf.

### PDFs: documents vs reading
- **Document indicators**: Invoice/receipt/statement names, scan-like naming (Scan_001, doc_20240315), business/administrative filenames, small sizes typical of scanned pages
- **Reading indicators**: Book titles, author names, publisher names, ISBN patterns, textbook/manual names, filenames like "Clean_Code_Robert_Martin.pdf" or "The_Art_of_War.pdf"

### Comics/manga vs photos
- **Comics/manga**: CBZ/CBR/CB7 archives, folders with sequential numbered images that are clearly manga pages (chapter numbering, volume numbering), image sequences with manga/comic naming patterns
- **Photos**: Individual photos, camera rolls, screenshots — NOT sequential comic/manga page images

## Input format

You receive a JSON array of files, each with:
- `index`: position in the array (use this in your response)
- `filename`: the file's name
- `mime_type`: MIME type
- `size_bytes`: file size
- `relative_path`: path within a dropped folder (may be null for loose files)

## Output format

Return a JSON object with a `files` array. For each file provide:
- `index`: same as input
- `service`: one of "photos", "media", "documents", "audiobooks", "reading", "files"
- `confidence`: 0.0 to 1.0
- `reasoning`: brief explanation (1 sentence)
- `audiobook_metadata`: if service is "audiobooks", include `title`, `author` (optional), `series` (optional). Otherwise null.

Output ONLY the raw JSON — no markdown fencing, no explanation."#;

// ─── Classifier ──────────────────────────────────────────────────────

/// Result from an AI classification call, including debug info.
pub struct AiClassifyOutput {
    /// The structured classification result.
    pub result: LlmClassifyResult,
    /// Debug info for the dev panel.
    pub debug_info: ClassifyDebugInfo,
}

/// Events emitted during streaming LLM classification.
#[derive(Debug)]
pub enum ClassifyStreamEvent {
    /// A text token from the LLM response.
    Token(String),
    /// The LLM stream completed. Contains the full accumulated response text.
    Done(String),
    /// An error occurred during streaming.
    /// Contains `(error_message, accumulated_text_so_far)`.
    Error(String, String),
}

/// Metadata known before the LLM stream starts (for building debug info later).
pub struct StreamMeta {
    pub system_prompt: String,
    pub user_prompt: String,
    pub model: String,
    pub provider: String,
    pub file_count: usize,
}

/// AI-powered file classifier.
///
/// Both providers use direct `reqwest` calls with plain content extraction
/// and JSON fence stripping — no tool calling, no SDK dependencies.
///
/// - Anthropic: `POST /v1/messages` with `x-api-key` auth.
/// - OpenAI-compatible: `POST /v1/chat/completions` with Bearer auth.
pub struct AiClassifier {
    /// Whether AI classification is available (API key configured, etc.)
    enabled: bool,
    provider: LlmProvider,
    model: String,
    /// Shared reqwest client for OpenAI-compatible calls.
    http: reqwest::Client,
}

enum LlmProvider {
    Anthropic { api_key: String },
    OpenAi { base_url: String, api_key: String },
    Disabled,
}

impl AiClassifier {
    /// Create a new classifier from the app config.
    pub fn from_config(config: &Config) -> Self {
        let provider_name = config.llm_provider.to_lowercase();

        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("failed to build AI HTTP client");

        match provider_name.as_str() {
            "anthropic" => {
                let api_key = config.anthropic_api_key.clone();
                let enabled = !api_key.is_empty();
                let model = if config.llm_model.is_empty() {
                    DEFAULT_ANTHROPIC_MODEL.to_string()
                } else {
                    config.llm_model.clone()
                };

                if !enabled {
                    tracing::warn!("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty; AI classification disabled");
                }

                Self {
                    enabled,
                    provider: LlmProvider::Anthropic { api_key },
                    model,
                    http,
                }
            }
            "openai" | "local" | "ollama" => {
                let base_url = config.local_llm_base_url.clone();
                let api_key = config.local_llm_api_key.clone();
                let model = if config.llm_model.is_empty() {
                    DEFAULT_LOCAL_MODEL.to_string()
                } else {
                    config.llm_model.clone()
                };

                tracing::info!(
                    base_url = %base_url,
                    model = %model,
                    "OpenAI-compatible LLM configured"
                );

                Self {
                    enabled: true,
                    provider: LlmProvider::OpenAi { base_url, api_key },
                    model,
                    http,
                }
            }
            "none" | "disabled" | "" => {
                tracing::info!("LLM classification disabled (LLM_PROVIDER={provider_name})");
                Self {
                    enabled: false,
                    provider: LlmProvider::Disabled,
                    model: String::new(),
                    http,
                }
            }
            _ => {
                tracing::warn!("Unknown LLM_PROVIDER={provider_name}; AI classification disabled");
                Self {
                    enabled: false,
                    provider: LlmProvider::Disabled,
                    model: String::new(),
                    http,
                }
            }
        }
    }

    /// Whether AI classification is available.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// The currently active provider name.
    pub fn active_provider(&self) -> &str {
        self.provider_name()
    }

    /// The currently active model name.
    pub fn active_model(&self) -> &str {
        &self.model
    }

    /// Switch the active provider at runtime (dev-only).
    ///
    /// Rebuilds the classifier with the new provider using the original
    /// config values. The `http` client is reused.
    pub fn switch_provider(&mut self, config: &Config, provider: &str) {
        let http = self.http.clone();
        let provider_lower = provider.to_lowercase();

        match provider_lower.as_str() {
            "anthropic" => {
                let api_key = config.anthropic_api_key.clone();
                let enabled = !api_key.is_empty();
                let model = if config.llm_model.is_empty() {
                    DEFAULT_ANTHROPIC_MODEL.to_string()
                } else {
                    config.llm_model.clone()
                };
                tracing::info!(model = %model, "switched to Anthropic provider");
                self.enabled = enabled;
                self.provider = LlmProvider::Anthropic { api_key };
                self.model = model;
                self.http = http;
            }
            "openai" | "local" | "ollama" => {
                let base_url = config.local_llm_base_url.clone();
                let api_key = config.local_llm_api_key.clone();
                let model = if config.llm_model.is_empty() {
                    DEFAULT_LOCAL_MODEL.to_string()
                } else {
                    config.llm_model.clone()
                };
                tracing::info!(model = %model, base_url = %base_url, "switched to local LLM provider");
                self.enabled = true;
                self.provider = LlmProvider::OpenAi { base_url, api_key };
                self.model = model;
                self.http = http;
            }
            _ => {
                tracing::warn!(provider = %provider, "unknown provider, disabling AI");
                self.enabled = false;
                self.provider = LlmProvider::Disabled;
                self.model = String::new();
                self.http = http;
            }
        }
    }

    /// Classify a batch of files using the LLM.
    ///
    /// Returns the structured result plus debug info for the dev panel.
    pub async fn classify(&self, files: &[FileEntry]) -> Result<AiClassifyOutput> {
        if !self.enabled {
            anyhow::bail!("AI classification is not enabled");
        }

        if files.is_empty() {
            return Ok(AiClassifyOutput {
                result: LlmClassifyResult { files: vec![] },
                debug_info: ClassifyDebugInfo {
                    system_prompt: String::new(),
                    user_prompt: String::new(),
                    raw_response: None,
                    model: self.model.clone(),
                    provider: self.provider_name().to_string(),
                    file_count: 0,
                    duration_ms: 0,
                },
            });
        }

        let user_prompt = build_user_prompt(files);
        let file_count = files.len();

        tracing::info!(
            file_count,
            model = %self.model,
            provider = %self.provider_name(),
            "calling LLM for file classification"
        );

        let start = Instant::now();

        let (result, raw_response) = match &self.provider {
            LlmProvider::Anthropic { api_key } => {
                self.classify_anthropic(api_key, &user_prompt).await?
            }
            LlmProvider::OpenAi { base_url, api_key } => {
                self.classify_openai(base_url, api_key, &user_prompt)
                    .await?
            }
            LlmProvider::Disabled => unreachable!(),
        };

        let duration_ms = start.elapsed().as_millis() as u64;

        tracing::info!(
            result_count = result.files.len(),
            duration_ms,
            "LLM classification complete"
        );

        let debug_info = ClassifyDebugInfo {
            system_prompt: CLASSIFICATION_SYSTEM_PROMPT.to_string(),
            user_prompt,
            raw_response,
            model: self.model.clone(),
            provider: self.provider_name().to_string(),
            file_count,
            duration_ms,
        };

        Ok(AiClassifyOutput { result, debug_info })
    }

    /// Start streaming classification for a batch of files.
    ///
    /// Spawns a background task that reads the LLM streaming response
    /// and sends `Token`/`Done`/`Error` events through the channel.
    /// Returns the receiver and metadata for building debug info later.
    pub fn classify_stream(
        &self,
        files: &[FileEntry],
    ) -> Result<(mpsc::Receiver<ClassifyStreamEvent>, StreamMeta)> {
        if !self.enabled {
            anyhow::bail!("AI classification is not enabled");
        }

        let user_prompt = build_user_prompt(files);
        let meta = StreamMeta {
            system_prompt: CLASSIFICATION_SYSTEM_PROMPT.to_string(),
            user_prompt: user_prompt.clone(),
            model: self.model.clone(),
            provider: self.provider_name().to_string(),
            file_count: files.len(),
        };

        let (tx, rx) = mpsc::channel(256);

        tracing::info!(
            file_count = files.len(),
            model = %self.model,
            provider = %self.provider_name(),
            "starting streaming LLM classification"
        );

        match &self.provider {
            LlmProvider::Anthropic { api_key } => {
                let http = self.http.clone();
                let model = self.model.clone();
                let api_key = api_key.clone();
                tokio::spawn(async move {
                    if let Err(e) =
                        stream_anthropic(&http, &api_key, &model, &user_prompt, &tx).await
                    {
                        let _ = tx
                            .send(ClassifyStreamEvent::Error(e.to_string(), String::new()))
                            .await;
                    }
                });
            }
            LlmProvider::OpenAi { base_url, api_key } => {
                let http = self.http.clone();
                let model = self.model.clone();
                let base_url = base_url.clone();
                let api_key = api_key.clone();
                tokio::spawn(async move {
                    if let Err(e) =
                        stream_openai(&http, &base_url, &api_key, &model, &user_prompt, &tx).await
                    {
                        let _ = tx
                            .send(ClassifyStreamEvent::Error(e.to_string(), String::new()))
                            .await;
                    }
                });
            }
            LlmProvider::Disabled => unreachable!(),
        }

        Ok((rx, meta))
    }

    /// Human-readable provider name for debug info.
    fn provider_name(&self) -> &str {
        match &self.provider {
            LlmProvider::Anthropic { .. } => "anthropic",
            LlmProvider::OpenAi { .. } => "openai",
            LlmProvider::Disabled => "disabled",
        }
    }

    // ─── Anthropic (direct reqwest to /v1/messages) ───────────────────

    /// Call the Anthropic Messages API directly via `reqwest`.
    ///
    /// - System prompt is a top-level `system` field (NOT in messages).
    /// - Auth uses `x-api-key` header (not `Authorization: Bearer`).
    /// - Response text lives at `content[0].text`.
    /// - Truncation signal: `stop_reason: "max_tokens"`.
    async fn classify_anthropic(
        &self,
        api_key: &str,
        user_prompt: &str,
    ) -> Result<(LlmClassifyResult, Option<String>)> {
        let url = "https://api.anthropic.com/v1/messages";

        let body = serde_json::json!({
            "model": self.model,
            "max_tokens": CLASSIFY_MAX_TOKENS,
            "system": CLASSIFICATION_SYSTEM_PROMPT,
            "messages": [
                { "role": "user", "content": user_prompt },
            ],
            "temperature": 0.3,
        });

        tracing::debug!(url = %url, model = %self.model, "sending Anthropic request");

        let resp = self
            .http
            .post(url)
            .header("Content-Type", "application/json")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .context("Anthropic API call failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::warn!(status = %status, body = %body, "Anthropic API error");
            anyhow::bail!("Anthropic API error {status}: {body}");
        }

        let response_body: serde_json::Value = resp
            .json()
            .await
            .context("Failed to parse Anthropic response as JSON")?;

        // Check for truncation
        if let Some(reason) = response_body["stop_reason"].as_str() {
            if reason == "max_tokens" {
                tracing::warn!("Anthropic response truncated (hit max_tokens)");
                anyhow::bail!(
                    "Anthropic response was truncated (hit max_tokens). \
                     Try fewer files per batch."
                );
            }
        }

        // Extract the content text — Anthropic puts it at content[0].text
        let content = response_body["content"][0]["text"]
            .as_str()
            .context("Missing content in Anthropic response")?;

        tracing::debug!(
            content_len = content.len(),
            content_preview = %&content[..content.len().min(200)],
            "Anthropic response received"
        );

        // Parse JSON from content (handles plain JSON, markdown fences, prose wrapping)
        let json_value = extract_json_from_text(content).context(format!(
            "Could not extract JSON from Anthropic response. Raw content:\n{}",
            &content[..content.len().min(500)]
        ))?;

        let result: LlmClassifyResult = serde_json::from_value(json_value).context(format!(
            "Anthropic response JSON doesn't match expected schema. Raw content:\n{}",
            &content[..content.len().min(500)]
        ))?;

        Ok((result, Some(content.to_string())))
    }

    // ─── OpenAI-compatible (direct reqwest) ──────────────────────────

    /// Call a local/OpenAI-compatible server via `/v1/chat/completions`.
    ///
    /// Uses plain content mode (no tool calling) with JSON fence stripping.
    /// This works reliably with all local servers (llama.cpp, Ollama, vLLM).
    async fn classify_openai(
        &self,
        base_url: &str,
        api_key: &str,
        user_prompt: &str,
    ) -> Result<(LlmClassifyResult, Option<String>)> {
        let url = format!("{base_url}/v1/chat/completions");

        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": CLASSIFICATION_SYSTEM_PROMPT },
                { "role": "user", "content": user_prompt },
            ],
            "temperature": 0.3,
            "max_tokens": CLASSIFY_MAX_TOKENS,
        });

        tracing::debug!(url = %url, model = %self.model, "sending OpenAI-compatible request");

        let resp = self
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {api_key}"))
            .json(&body)
            .send()
            .await
            .context("OpenAI-compatible API call failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::warn!(status = %status, body = %body, "LLM API error");
            anyhow::bail!("LLM API error {status}: {body}");
        }

        let response_body: serde_json::Value = resp
            .json()
            .await
            .context("Failed to parse LLM response as JSON")?;

        // Check for truncation
        if let Some(reason) = response_body["choices"][0]["finish_reason"].as_str() {
            if reason == "length" {
                tracing::warn!("LLM response truncated (hit max_tokens)");
                anyhow::bail!(
                    "LLM response was truncated (hit max_tokens). \
                     Try fewer files per batch."
                );
            }
        }

        // Extract the content text
        let content = response_body["choices"][0]["message"]["content"]
            .as_str()
            .context("Missing content in LLM response")?;

        tracing::debug!(
            content_len = content.len(),
            content_preview = %&content[..content.len().min(200)],
            "LLM response received"
        );

        // Parse JSON from content (handles plain JSON, markdown fences, prose wrapping)
        let json_value = extract_json_from_text(content).context(format!(
            "Could not extract JSON from LLM response. Raw content:\n{}",
            &content[..content.len().min(500)]
        ))?;

        let result: LlmClassifyResult = serde_json::from_value(json_value).context(format!(
            "LLM response JSON doesn't match expected schema. Raw content:\n{}",
            &content[..content.len().min(500)]
        ))?;

        Ok((result, Some(content.to_string())))
    }
}

// ─── Streaming provider implementations ─────────────────────────────

/// Stream tokens from the Anthropic Messages API (`stream: true`).
///
/// Reads Anthropic SSE events and forwards text tokens through the channel.
/// - `content_block_delta` with `delta.text` → Token events
/// - `message_delta` with `stop_reason: "max_tokens"` → Error (truncated)
/// - `message_stop` → Done with full accumulated text
async fn stream_anthropic(
    http: &reqwest::Client,
    api_key: &str,
    model: &str,
    user_prompt: &str,
    tx: &mpsc::Sender<ClassifyStreamEvent>,
) -> Result<()> {
    let body = serde_json::json!({
        "model": model,
        "max_tokens": CLASSIFY_MAX_TOKENS,
        "system": CLASSIFICATION_SYSTEM_PROMPT,
        "messages": [
            { "role": "user", "content": user_prompt },
        ],
        "temperature": 0.3,
        "stream": true,
    });

    tracing::debug!(model = %model, "sending streaming Anthropic request");

    let resp = http
        .post("https://api.anthropic.com/v1/messages")
        .header("Content-Type", "application/json")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .context("Anthropic streaming API call failed")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Anthropic API error {status}: {body}");
    }

    let mut accumulated = String::new();
    let mut sse_buffer = String::new();
    let mut byte_stream = resp.bytes_stream();

    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.context("Error reading Anthropic stream chunk")?;
        let text = String::from_utf8_lossy(&chunk);
        sse_buffer.push_str(&text);

        // Parse complete SSE events from buffer (split on \n\n)
        while let Some(event_end) = sse_buffer.find("\n\n") {
            let event_text = sse_buffer[..event_end].to_string();
            sse_buffer = sse_buffer[event_end + 2..].to_string();

            let mut event_type = String::new();
            let mut data_lines = Vec::new();
            for line in event_text.lines() {
                if let Some(t) = line.strip_prefix("event: ") {
                    event_type = t.to_string();
                } else if let Some(d) = line.strip_prefix("data: ") {
                    data_lines.push(d.to_string());
                }
            }

            let data = data_lines.join("\n");
            if data.is_empty() {
                continue;
            }

            match event_type.as_str() {
                "content_block_delta" => {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
                        if let Some(token) = v["delta"]["text"].as_str() {
                            accumulated.push_str(token);
                            let _ = tx.send(ClassifyStreamEvent::Token(token.to_string())).await;
                        }
                    }
                }
                "message_delta" => {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
                        if v["delta"]["stop_reason"].as_str() == Some("max_tokens") {
                            tracing::warn!(
                                accumulated_len = accumulated.len(),
                                "Anthropic stream truncated (max_tokens)"
                            );
                            let _ = tx
                                .send(ClassifyStreamEvent::Error(
                                    "Response truncated (hit max_tokens). Try fewer files."
                                        .to_string(),
                                    accumulated,
                                ))
                                .await;
                            return Ok(());
                        }
                    }
                }
                "message_stop" => {
                    tracing::debug!(
                        accumulated_len = accumulated.len(),
                        "Anthropic stream complete"
                    );
                    let _ = tx.send(ClassifyStreamEvent::Done(accumulated)).await;
                    return Ok(());
                }
                _ => {} // message_start, content_block_start, content_block_stop, ping
            }
        }
    }

    // Stream ended without message_stop
    if !accumulated.is_empty() {
        tracing::warn!("Anthropic stream ended without message_stop, sending accumulated text");
        let _ = tx.send(ClassifyStreamEvent::Done(accumulated)).await;
    } else {
        let _ = tx
            .send(ClassifyStreamEvent::Error(
                "Anthropic stream ended unexpectedly with no content".to_string(),
                String::new(),
            ))
            .await;
    }

    Ok(())
}

/// Stream tokens from an OpenAI-compatible server (`stream: true`).
///
/// Reads OpenAI SSE events and forwards text tokens through the channel.
/// - `data: {"choices":[{"delta":{"content":"..."}}]}` → Token events
/// - `data: [DONE]` → Done with full accumulated text
/// - `finish_reason: "length"` → Error (truncated)
async fn stream_openai(
    http: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    user_prompt: &str,
    tx: &mpsc::Sender<ClassifyStreamEvent>,
) -> Result<()> {
    let url = format!("{base_url}/v1/chat/completions");

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": CLASSIFICATION_SYSTEM_PROMPT },
            { "role": "user", "content": user_prompt },
        ],
        "temperature": 0.3,
        "max_tokens": CLASSIFY_MAX_TOKENS,
        "stream": true,
    });

    tracing::debug!(url = %url, model = %model, "sending streaming OpenAI-compatible request");

    let resp = http
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&body)
        .send()
        .await
        .context("OpenAI-compatible streaming API call failed")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("LLM API error {status}: {body}");
    }

    let mut accumulated = String::new();
    let mut sse_buffer = String::new();
    let mut byte_stream = resp.bytes_stream();

    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.context("Error reading LLM stream chunk")?;
        let text = String::from_utf8_lossy(&chunk);
        sse_buffer.push_str(&text);

        // Parse complete SSE events from buffer
        while let Some(event_end) = sse_buffer.find("\n\n") {
            let event_text = sse_buffer[..event_end].to_string();
            sse_buffer = sse_buffer[event_end + 2..].to_string();

            // OpenAI SSE format: just "data: ..." lines (no "event:" lines)
            for line in event_text.lines() {
                let Some(data) = line.strip_prefix("data: ") else {
                    continue;
                };

                // [DONE] sentinel
                if data.trim() == "[DONE]" {
                    tracing::debug!(
                        accumulated_len = accumulated.len(),
                        "OpenAI stream complete"
                    );
                    let _ = tx.send(ClassifyStreamEvent::Done(accumulated)).await;
                    return Ok(());
                }

                if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                    // Check for truncation
                    if v["choices"][0]["finish_reason"].as_str() == Some("length") {
                        tracing::warn!(
                            accumulated_len = accumulated.len(),
                            "OpenAI stream truncated (length)"
                        );
                        let _ = tx
                            .send(ClassifyStreamEvent::Error(
                                "Response truncated (hit max_tokens). Try fewer files.".to_string(),
                                accumulated,
                            ))
                            .await;
                        return Ok(());
                    }

                    // Extract content token
                    if let Some(token) = v["choices"][0]["delta"]["content"].as_str() {
                        if !token.is_empty() {
                            accumulated.push_str(token);
                            let _ = tx.send(ClassifyStreamEvent::Token(token.to_string())).await;
                        }
                    }
                }
            }
        }
    }

    // Stream ended without [DONE]
    if !accumulated.is_empty() {
        tracing::warn!("OpenAI stream ended without [DONE], sending accumulated text");
        let _ = tx.send(ClassifyStreamEvent::Done(accumulated)).await;
    } else {
        let _ = tx
            .send(ClassifyStreamEvent::Error(
                "LLM stream ended unexpectedly with no content".to_string(),
                String::new(),
            ))
            .await;
    }

    Ok(())
}

// ─── JSON extraction from LLM text ──────────────────────────────────

/// Extract a JSON value from text that may contain markdown fences or prose.
///
/// Tries, in order:
/// 1. Direct parse (already valid JSON).
/// 2. Extract from `` ```json ... ``` `` or `` ``` ... ``` `` fences.
/// 3. Find the first `{` to last `}` span and parse that.
pub fn extract_json_from_text(text: &str) -> Option<serde_json::Value> {
    let trimmed = text.trim();

    // 1. Direct parse.
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Some(v);
    }

    // 2. Markdown fence.
    if let Some(start) = trimmed.find("```") {
        let after_fence = &trimmed[start + 3..];
        let content_start = after_fence.find('\n').map(|i| i + 1).unwrap_or(0);
        if let Some(end) = after_fence[content_start..].find("```") {
            let inner = after_fence[content_start..content_start + end].trim();
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(inner) {
                return Some(v);
            }
        }
    }

    // 3. First `{` to last `}`.
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if start < end {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&trimmed[start..=end]) {
                return Some(v);
            }
        }
    }

    None
}

// ─── Prompt builder ──────────────────────────────────────────────────

/// Build the user prompt containing file metadata as JSON.
fn build_user_prompt(files: &[FileEntry]) -> String {
    let file_descriptions: Vec<serde_json::Value> = files
        .iter()
        .enumerate()
        .map(|(i, f)| {
            serde_json::json!({
                "index": i,
                "filename": f.filename,
                "mime_type": f.mime_type,
                "size_bytes": f.size_bytes,
                "relative_path": f.relative_path,
            })
        })
        .collect();

    format!(
        "Classify the following {} file{}:\n\n```json\n{}\n```",
        files.len(),
        if files.len() == 1 { "" } else { "s" },
        serde_json::to_string_pretty(&file_descriptions).unwrap_or_default(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_plain_json() {
        let input = r#"{"files": [{"index": 0, "service": "photos"}]}"#;
        let v = extract_json_from_text(input).unwrap();
        assert!(v["files"].is_array());
    }

    #[test]
    fn extract_fenced_json() {
        let input = "```json\n{\"files\": [{\"index\": 0, \"service\": \"photos\"}]}\n```";
        let v = extract_json_from_text(input).unwrap();
        assert!(v["files"].is_array());
    }

    #[test]
    fn extract_fenced_no_lang_tag() {
        let input = "```\n{\"files\": []}\n```";
        let v = extract_json_from_text(input).unwrap();
        assert!(v["files"].is_array());
    }

    #[test]
    fn extract_json_with_prose() {
        let input =
            "Here is the classification:\n\n{\"files\": []}\n\nLet me know if you need changes.";
        let v = extract_json_from_text(input).unwrap();
        assert!(v["files"].is_array());
    }

    #[test]
    fn extract_returns_none_for_garbage() {
        assert!(extract_json_from_text("no json here").is_none());
    }
}
