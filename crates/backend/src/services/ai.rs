//! AI classification service using Rig for LLM-backed file classification.
//!
//! Supports both Anthropic (Claude) and any OpenAI-compatible server
//! (Ollama, vLLM, llama.cpp) via the `LLM_PROVIDER` config.

use std::time::Instant;

use anyhow::{Context, Result};
use rig::client::{CompletionClient, ProviderClient};
use rig::providers::{anthropic, openai};

use crate::config::Config;
use crate::constants::{DEFAULT_ANTHROPIC_MODEL, DEFAULT_LOCAL_MODEL};
use steadfirm_shared::classify::{ClassifyDebugInfo, FileEntry, LlmClassifyResult};

// ─── System prompt ───────────────────────────────────────────────────

const CLASSIFICATION_SYSTEM_PROMPT: &str = r#"You are a file classification assistant for a personal cloud platform called Steadfirm. Your job is to look at file metadata (filename, MIME type, size, folder path) and determine which service each file should be routed to.

## Available services

- **photos**: Personal photos and home videos. Managed by Immich. Includes camera photos (JPG, HEIC, RAW), screenshots, and personal/home videos (phone recordings, family videos, GoPro footage, etc.).
- **media**: Movies, TV shows, and music. Managed by Jellyfin. Includes ripped/downloaded movies and TV episodes (often with scene release naming like "Movie.Name.2024.1080p.BluRay.x264"), and music files that are clearly part of a music library.
- **documents**: Documents for OCR and archival. Managed by Paperless-ngx. Includes PDFs, Office docs, scanned documents.
- **audiobooks**: Audiobook files. Managed by Audiobookshelf. Includes M4B files, and MP3/M4A/FLAC files that are clearly audiobook chapters (not music). Audiobookshelf expects files organized as Author/Title/files.
- **files**: Catch-all for anything that doesn't clearly fit elsewhere. Managed by Steadfirm's own storage.

## Key distinctions to make

### Movies vs personal videos
- **Movie indicators**: Scene release naming patterns (resolution tags like 1080p/2160p, codec tags like x264/x265, source tags like BluRay/WEB-DL), large file sizes (>2GB), folder names like "Movies"
- **Personal video indicators**: Camera-generated names (IMG_*, VID_*, PXL_*, MVI_*), timestamp-based names (20240315_143022), small-medium sizes (<500MB), folders like "DCIM" or date-based folders

### Music vs audiobooks
- **Music indicators**: Short duration files (3-7 minutes typical), artist/album folder structure, genre-related folder names
- **Audiobook indicators**: Long duration files, chapter numbering in filenames, folder names containing author names or book titles, keywords like "audiobook", "chapter", "narrated", "unabridged"
- **For audiobooks**: Also infer the author and book title from the folder path and filenames. This is critical for organizing them in Audiobookshelf.

## Input format

You receive a JSON array of files, each with:
- `index`: position in the array (use this in your response)
- `filename`: the file's name
- `mime_type`: MIME type
- `size_bytes`: file size
- `relative_path`: path within a dropped folder (may be null for loose files)

## Output format

Return a JSON object matching the `LlmClassifyResult` schema exactly. For each file provide:
- `index`: same as input
- `service`: one of "photos", "media", "documents", "audiobooks", "files"
- `confidence`: 0.0 to 1.0
- `reasoning`: brief explanation (1 sentence)
- `audiobook_metadata`: if service is "audiobooks", include `title`, `author` (optional), `series` (optional)

Be concise in reasoning. Focus on the strongest signal for your classification."#;

// ─── Classifier ──────────────────────────────────────────────────────

/// Result from an AI classification call, including debug info.
pub struct AiClassifyOutput {
    /// The structured classification result.
    pub result: LlmClassifyResult,
    /// Debug info for the dev panel.
    pub debug_info: ClassifyDebugInfo,
}

/// AI-powered file classifier. Wraps a Rig extractor that calls the
/// configured LLM provider.
pub struct AiClassifier {
    /// Whether AI classification is available (API key configured, etc.)
    enabled: bool,
    provider: LlmProvider,
    model: String,
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

                Self {
                    enabled: true,
                    provider: LlmProvider::OpenAi { base_url, api_key },
                    model,
                }
            }
            "none" | "disabled" | "" => {
                tracing::info!("LLM classification disabled (LLM_PROVIDER={provider_name})");
                Self {
                    enabled: false,
                    provider: LlmProvider::Disabled,
                    model: String::new(),
                }
            }
            _ => {
                tracing::warn!("Unknown LLM_PROVIDER={provider_name}; AI classification disabled");
                Self {
                    enabled: false,
                    provider: LlmProvider::Disabled,
                    model: String::new(),
                }
            }
        }
    }

    /// Whether AI classification is available.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Classify a batch of files using the LLM.
    ///
    /// The `files` slice contains only the low-confidence files that need
    /// AI help. Returns the structured result plus debug info for the
    /// dev panel.
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

        // Build the user prompt with the file metadata
        let user_prompt = build_user_prompt(files);
        let file_count = files.len();

        tracing::info!(
            file_count,
            model = %self.model,
            "calling LLM for file classification"
        );

        let start = Instant::now();

        let result = match &self.provider {
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
            raw_response: None, // Rig extractor doesn't expose raw response
            model: self.model.clone(),
            provider: self.provider_name().to_string(),
            file_count,
            duration_ms,
        };

        Ok(AiClassifyOutput { result, debug_info })
    }

    /// Human-readable provider name for debug info.
    fn provider_name(&self) -> &str {
        match &self.provider {
            LlmProvider::Anthropic { .. } => "anthropic",
            LlmProvider::OpenAi { .. } => "openai",
            LlmProvider::Disabled => "disabled",
        }
    }

    async fn classify_anthropic(
        &self,
        api_key: &str,
        user_prompt: &str,
    ) -> Result<LlmClassifyResult> {
        let client = anthropic::Client::from_val(api_key.to_string());

        let extractor = client
            .extractor::<LlmClassifyResult>(&self.model)
            .preamble(CLASSIFICATION_SYSTEM_PROMPT)
            .build();

        let result: LlmClassifyResult = match extractor.extract(user_prompt).await {
            Ok(r) => r,
            Err(e) => {
                tracing::error!(error = %e, debug = ?e, "Anthropic extraction failed");
                return Err(anyhow::anyhow!("Anthropic extraction failed: {e:#}"));
            }
        };

        Ok(result)
    }

    async fn classify_openai(
        &self,
        base_url: &str,
        api_key: &str,
        user_prompt: &str,
    ) -> Result<LlmClassifyResult> {
        // For OpenAI-compatible servers (Ollama, vLLM, etc.)
        let client = openai::Client::builder()
            .api_key(api_key)
            .base_url(base_url)
            .build()
            .context("Failed to build OpenAI-compatible client")?;

        let extractor = client
            .extractor::<LlmClassifyResult>(&self.model)
            .preamble(CLASSIFICATION_SYSTEM_PROMPT)
            .build();

        let result: LlmClassifyResult = extractor
            .extract(user_prompt)
            .await
            .context("OpenAI-compatible extraction failed")?;

        Ok(result)
    }
}

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
