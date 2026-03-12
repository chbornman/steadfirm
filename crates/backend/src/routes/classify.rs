//! File classification endpoints — heuristics + LLM.
//!
//! Two endpoints:
//! - `POST /api/v1/classify`        — JSON request/response (original)
//! - `POST /api/v1/classify/stream`  — SSE streaming response
//!
//! The streaming endpoint sends individual classification results as they
//! become available: heuristic results instantly, then LLM results after
//! the API call completes. This lets the frontend animate files into
//! their service category buckets in real time.

use std::collections::HashMap;
use std::convert::Infallible;

use axum::{
    extract::State,
    response::sse::{Event, Sse},
    routing::post,
    Json, Router,
};
use futures::Stream;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::constants::{AI_CONFIDENCE_THRESHOLD, CLASSIFY_BATCH_SIZE};
use crate::error::AppError;
use crate::services::ai::{extract_json_from_text, ClassifyStreamEvent};
use crate::AppState;
use steadfirm_shared::classify::{
    AudiobookGroup, ClassifyDebugInfo, ClassifyResponse, FileClassificationResult, FileEntry,
    LlmClassifyResult, LlmFileClassification,
};
use steadfirm_shared::ServiceKind;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(classify))
        .route("/stream", post(classify_stream))
        .route("/provider", axum::routing::get(get_provider))
        .route("/provider", axum::routing::put(set_provider))
}

#[derive(Debug, Deserialize)]
struct ClassifyRequest {
    files: Vec<FileEntry>,
}

// ─── SSE event data types ────────────────────────────────────────────

/// Sent for each high-confidence file classified by heuristics alone.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SseHeuristic {
    index: usize,
    service: ServiceKind,
    confidence: f32,
}

/// Phase status update.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SseStatus {
    phase: &'static str,
    /// Number of files still pending LLM classification.
    pending: usize,
}

/// Sent for each file classified by the LLM.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SseClassification {
    index: usize,
    service: ServiceKind,
    confidence: f32,
    reasoning: Option<String>,
    ai_classified: bool,
}

/// Batch index → global file index mapping, sent before tokens stream.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SseIndexMap {
    /// `index_map[batch_idx]` = global file index
    index_map: Vec<usize>,
}

/// Final event with authoritative classifications, audiobook groups, and debug info.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SseDone {
    /// Authoritative classifications from the LLM (global indices).
    /// Frontend replaces any partial-parse results with these.
    classifications: Vec<SseClassification>,
    audiobook_groups: Vec<AudiobookGroup>,
    debug_info: Option<ClassifyDebugInfo>,
}

// ─── SSE streaming endpoint ──────────────────────────────────────────

/// Emit a `log` SSE event that the frontend pipes straight to
/// `console.log` — gives full visibility into the backend pipeline
/// from the browser DevTools console.
macro_rules! sse_log {
    ($($arg:tt)*) => {
        Ok(Event::default().event("log").data(format!($($arg)*)))
    };
}

/// POST /api/v1/classify/stream
///
/// Streams classification results as SSE events:
///   1. `log`        — debug breadcrumbs forwarded to browser console
///   2. `heuristic`  — one per high-confidence file (instant)
///   3. `status`     — phase changes
///   4. `classification` — one per LLM-classified file
///   5. `done`       — final event with audiobook groups + debug info
///   6. `error`      — if LLM call fails
async fn classify_stream(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(request): Json<ClassifyRequest>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = async_stream::stream! {
        let file_count = request.files.len();
        tracing::info!(file_count, "classify stream started");
        yield sse_log!("[classify] stream started — {} files", file_count);

        // ── Step 1: Heuristic classification ──
        let mut results: Vec<FileClassificationResult> = Vec::with_capacity(file_count);
        let mut heuristic_high = 0usize;
        let mut heuristic_low = 0usize;

        for (i, file) in request.files.iter().enumerate() {
            let result = heuristic_classify(i, file);
            results.push(result.clone());

            // Only send heuristic events for high-confidence files.
            // Low-confidence files will wait for the LLM.
            if result.confidence >= AI_CONFIDENCE_THRESHOLD {
                heuristic_high += 1;
                if let Ok(data) = serde_json::to_string(&SseHeuristic {
                    index: i,
                    service: result.service,
                    confidence: result.confidence,
                }) {
                    yield Ok(Event::default().event("heuristic").data(data));
                }
            } else {
                heuristic_low += 1;
            }
        }

        yield sse_log!(
            "[classify] heuristics done — {} high-confidence, {} low-confidence (threshold={})",
            heuristic_high, heuristic_low, AI_CONFIDENCE_THRESHOLD
        );

        // ── Step 2: LLM classification for low-confidence files ──
        let low_confidence: Vec<(usize, &FileEntry)> = results
            .iter()
            .enumerate()
            .filter(|(_, r)| r.confidence < AI_CONFIDENCE_THRESHOLD)
            .map(|(i, _)| (i, &request.files[i]))
            .collect();

        if low_confidence.is_empty() {
            yield sse_log!("[classify] all files classified by heuristics — skipping LLM");
            // All files classified by heuristics — skip LLM
            let audiobook_groups = detect_audiobook_groups(&request.files, &results);
            yield sse_log!("[classify] audiobook groups: {}", audiobook_groups.len());
            if let Ok(data) = serde_json::to_string(&SseDone {
                classifications: vec![],
                audiobook_groups,
                debug_info: None,
            }) {
                yield sse_log!("[classify] sending done event");
                yield Ok(Event::default().event("done").data(data));
            }
        } else if !state.ai.read().await.is_enabled() {
            yield sse_log!(
                "[classify] AI is DISABLED — sending {} files with heuristic fallback",
                low_confidence.len()
            );
            // AI disabled — send remaining files with heuristic results
            for &(global_idx, _) in &low_confidence {
                if let Some(result) = results.get(global_idx) {
                    if let Ok(data) = serde_json::to_string(&SseClassification {
                        index: global_idx,
                        service: result.service,
                        confidence: result.confidence,
                        reasoning: None,
                        ai_classified: false,
                    }) {
                        yield Ok(Event::default().event("classification").data(data));
                    }
                }
            }

            let audiobook_groups = detect_audiobook_groups(&request.files, &results);
            yield sse_log!("[classify] audiobook groups: {}", audiobook_groups.len());
            if let Ok(data) = serde_json::to_string(&SseDone {
                classifications: vec![],
                audiobook_groups,
                debug_info: None,
            }) {
                yield sse_log!("[classify] sending done event (AI disabled path)");
                yield Ok(Event::default().event("done").data(data));
            }
        } else {
            {
                let ai = state.ai.read().await;
                yield sse_log!(
                    "[classify] AI enabled (provider={}, model={}) — sending {} files to LLM",
                    ai.active_provider(),
                    ai.active_model(),
                    low_confidence.len()
                );
            }

            // Send status: classifying
            if let Ok(data) = serde_json::to_string(&SseStatus {
                phase: "classifying",
                pending: low_confidence.len(),
            }) {
                yield Ok(Event::default().event("status").data(data));
            }

            // Build LLM entries
            let llm_entries: Vec<FileEntry> = low_confidence
                .iter()
                .map(|(_, entry)| (*entry).clone())
                .collect();

            // Process in batches with token-level streaming
            for (batch_idx, chunk) in llm_entries.chunks(CLASSIFY_BATCH_SIZE).enumerate() {
                yield sse_log!(
                    "[classify] LLM batch {} — {} files (streaming)",
                    batch_idx, chunk.len()
                );

                // Build the index map: batch_idx → global file index
                let batch_start = batch_idx * CLASSIFY_BATCH_SIZE;
                let index_map: Vec<usize> = (0..chunk.len())
                    .map(|i| low_confidence[batch_start + i].0)
                    .collect();

                // Send index map so frontend can resolve batch indices → global indices
                if let Ok(data) = serde_json::to_string(&SseIndexMap {
                    index_map: index_map.clone(),
                }) {
                    yield Ok(Event::default().event("index_map").data(data));
                }

                let start = std::time::Instant::now();

                // Start streaming from the LLM
                match state.ai.read().await.classify_stream(chunk) {
                    Ok((mut rx, meta)) => {
                        // Relay token events from the LLM to the browser
                        let mut stream_error: Option<String> = None;
                        let mut raw_text = String::new();

                        while let Some(event) = rx.recv().await {
                            match event {
                                ClassifyStreamEvent::Token(token) => {
                                    yield Ok(Event::default().event("token").data(token));
                                }
                                ClassifyStreamEvent::Done(text) => {
                                    raw_text = text;
                                    break;
                                }
                                ClassifyStreamEvent::Error(err, partial_text) => {
                                    raw_text = partial_text;
                                    stream_error = Some(err);
                                    break;
                                }
                            }
                        }

                        let duration_ms = start.elapsed().as_millis() as u64;

                        if let Some(err) = stream_error {
                            tracing::warn!(%err, raw_text_len = raw_text.len(), "LLM streaming failed");
                            yield sse_log!("[classify] LLM STREAM ERROR: {}", err);
                            yield Ok(Event::default().event("error").data(
                                format!("LLM classification failed: {err}")
                            ));

                            // Parse partial results from accumulated text before truncation.
                            // This rescues files the LLM successfully classified before the error.
                            let mut partial_classifications = Vec::new();
                            if !raw_text.is_empty() {
                                yield sse_log!(
                                    "[classify] attempting partial parse of {} bytes of accumulated text",
                                    raw_text.len()
                                );

                                if let Some(json_value) = extract_json_from_text(&raw_text) {
                                     if let Ok(llm_result) = parse_llm_result(json_value) {
                                        for llm_file in &llm_result.files {
                                            if let Some(&(global_idx, _)) = low_confidence.get(batch_start + llm_file.index) {
                                                let service = parse_service(&llm_file.service);
                                                let confidence = llm_file.confidence.clamp(0.0, 1.0);
                                                let reasoning = Some(llm_file.reasoning.clone());

                                                if let Some(result) = results.get_mut(global_idx) {
                                                    result.service = service;
                                                    result.confidence = confidence;
                                                    result.reasoning = reasoning.clone();
                                                    result.ai_classified = true;
                                                }

                                                partial_classifications.push(SseClassification {
                                                    index: global_idx,
                                                    service,
                                                    confidence,
                                                    reasoning,
                                                    ai_classified: true,
                                                });
                                            }
                                        }
                                        yield sse_log!(
                                            "[classify] rescued {} partial classifications from truncated response",
                                            partial_classifications.len()
                                        );
                                    }
                                }
                            }

                            // Emit heuristic fallback ONLY for files that weren't
                            // rescued from the partial parse above.
                            let mut fallback_count = 0usize;
                            for &(global_idx, _) in &low_confidence {
                                if let Some(result) = results.get(global_idx) {
                                    if !result.ai_classified {
                                        fallback_count += 1;
                                        if let Ok(data) = serde_json::to_string(&SseClassification {
                                            index: global_idx,
                                            service: result.service,
                                            confidence: result.confidence,
                                            reasoning: None,
                                            ai_classified: false,
                                        }) {
                                            yield Ok(Event::default().event("classification").data(data));
                                        }
                                    }
                                }
                            }
                            yield sse_log!(
                                "[classify] sent heuristic fallback for {} unclassified files",
                                fallback_count
                            );

                            // Send done event so the frontend can finalize.
                            let audiobook_groups = detect_audiobook_groups(&request.files, &results);
                            yield sse_log!(
                                "[classify] audiobook groups: {} (error recovery path)",
                                audiobook_groups.len()
                            );

                            let debug_info = Some(ClassifyDebugInfo {
                                system_prompt: meta.system_prompt.clone(),
                                user_prompt: meta.user_prompt.clone(),
                                raw_response: Some(raw_text.clone()),
                                model: meta.model.clone(),
                                provider: meta.provider.clone(),
                                file_count: meta.file_count,
                                duration_ms: start.elapsed().as_millis() as u64,
                            });

                            if let Ok(data) = serde_json::to_string(&SseDone {
                                classifications: partial_classifications,
                                audiobook_groups,
                                debug_info,
                            }) {
                                yield sse_log!("[classify] sending done event (error recovery path)");
                                yield Ok(Event::default().event("done").data(data));
                            }
                        } else {
                            yield sse_log!(
                                "[classify] LLM batch {} stream complete ({}ms, {} bytes)",
                                batch_idx, duration_ms, raw_text.len()
                            );

                            // Parse the accumulated response
                            let mut classifications = Vec::new();

                            match extract_json_from_text(&raw_text) {
                                Some(json_value) => {
                                    match parse_llm_result(json_value) {
                                        Ok(llm_result) => {
                                            for llm_file in &llm_result.files {
                                                if let Some(&(global_idx, _)) = low_confidence.get(batch_start + llm_file.index) {
                                                    let service = parse_service(&llm_file.service);
                                                    let confidence = llm_file.confidence.clamp(0.0, 1.0);
                                                    let reasoning = Some(llm_file.reasoning.clone());

                                                    // Update local results for audiobook grouping
                                                    if let Some(result) = results.get_mut(global_idx) {
                                                        result.service = service;
                                                        result.confidence = confidence;
                                                        result.reasoning = reasoning.clone();
                                                        result.ai_classified = true;
                                                    }

                                                    yield sse_log!(
                                                        "[classify]   file[{}] → {:?} ({:.0}%) — {}",
                                                        global_idx, service, confidence * 100.0, llm_file.reasoning
                                                    );

                                                    classifications.push(SseClassification {
                                                        index: global_idx,
                                                        service,
                                                        confidence,
                                                        reasoning,
                                                        ai_classified: true,
                                                    });
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            tracing::warn!(%e, "LLM response JSON schema mismatch");
                                            yield sse_log!("[classify] LLM parse error: {}", e);
                                            yield Ok(Event::default().event("error").data(
                                                format!("LLM response parse error: {e}")
                                            ));
                                        }
                                    }
                                }
                                None => {
                                    tracing::warn!("Could not extract JSON from LLM response");
                                    yield sse_log!(
                                        "[classify] could not extract JSON from response: {}",
                                        &raw_text[..raw_text.len().min(200)]
                                    );
                                    yield Ok(Event::default().event("error").data(
                                        "Could not extract JSON from LLM response"
                                    ));
                                }
                            }

                            let debug_info = Some(ClassifyDebugInfo {
                                system_prompt: meta.system_prompt,
                                user_prompt: meta.user_prompt,
                                raw_response: Some(raw_text),
                                model: meta.model,
                                provider: meta.provider,
                                file_count: meta.file_count,
                                duration_ms,
                            });

                            // ── Step 3: Audiobook grouping ──
                            let audiobook_groups = detect_audiobook_groups(&request.files, &results);

                            tracing::info!(
                                file_count,
                                audiobook_groups = audiobook_groups.len(),
                                "classify stream complete"
                            );

                            yield sse_log!(
                                "[classify] stream complete — {} classifications, {} audiobook groups",
                                classifications.len(), audiobook_groups.len()
                            );

                            if let Ok(data) = serde_json::to_string(&SseDone {
                                classifications,
                                audiobook_groups,
                                debug_info,
                            }) {
                                yield Ok(Event::default().event("done").data(data));
                            }
                        }
                    }
                    Err(err) => {
                        tracing::warn!(%err, "Failed to start LLM stream");
                        yield sse_log!("[classify] LLM start error: {}", err);
                        yield Ok(Event::default().event("error").data(
                            format!("LLM classification failed: {err}")
                        ));

                        // Send heuristic fallback for all low-confidence files
                        for &(global_idx, _) in &low_confidence {
                            if let Some(result) = results.get(global_idx) {
                                if let Ok(data) = serde_json::to_string(&SseClassification {
                                    index: global_idx,
                                    service: result.service,
                                    confidence: result.confidence,
                                    reasoning: None,
                                    ai_classified: false,
                                }) {
                                    yield Ok(Event::default().event("classification").data(data));
                                }
                            }
                        }

                        // Send done event so frontend can finalize
                        let audiobook_groups = detect_audiobook_groups(&request.files, &results);
                        if let Ok(data) = serde_json::to_string(&SseDone {
                            classifications: vec![],
                            audiobook_groups,
                            debug_info: None,
                        }) {
                            yield sse_log!("[classify] sending done event (LLM start error path)");
                            yield Ok(Event::default().event("done").data(data));
                        }
                    }
                }
            }
        }

        yield sse_log!("[classify] stream ended");
    };

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keep-alive"),
    )
}

// ─── Dev-only: provider switching ────────────────────────────────────

#[derive(Serialize)]
struct ProviderInfo {
    provider: String,
    model: String,
    enabled: bool,
}

/// GET /api/v1/classify/provider — current AI provider info.
async fn get_provider(State(state): State<AppState>, _user: AuthUser) -> Json<ProviderInfo> {
    let ai = state.ai.read().await;
    Json(ProviderInfo {
        provider: ai.active_provider().to_string(),
        model: ai.active_model().to_string(),
        enabled: ai.is_enabled(),
    })
}

#[derive(Debug, Deserialize)]
struct SetProviderRequest {
    provider: String,
}

/// PUT /api/v1/classify/provider — switch LLM provider at runtime.
async fn set_provider(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(req): Json<SetProviderRequest>,
) -> Json<ProviderInfo> {
    let mut ai = state.ai.write().await;
    ai.switch_provider(&state.config, &req.provider);
    Json(ProviderInfo {
        provider: ai.active_provider().to_string(),
        model: ai.active_model().to_string(),
        enabled: ai.is_enabled(),
    })
}

// ─── Original JSON endpoint (kept for backwards compatibility) ───────

/// POST /api/v1/classify
async fn classify(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(request): Json<ClassifyRequest>,
) -> Result<Json<ClassifyResponse>, AppError> {
    let file_count = request.files.len();
    tracing::info!(file_count, "classify request received");

    let mut results: Vec<FileClassificationResult> = request
        .files
        .iter()
        .enumerate()
        .map(|(i, f)| heuristic_classify(i, f))
        .collect();

    let mut debug_info: Option<ClassifyDebugInfo> = None;
    if state.ai.read().await.is_enabled() {
        let low_confidence: Vec<(usize, &FileEntry)> = results
            .iter()
            .enumerate()
            .filter(|(_, r)| r.confidence < AI_CONFIDENCE_THRESHOLD)
            .map(|(i, _)| (i, &request.files[i]))
            .collect();

        if !low_confidence.is_empty() {
            tracing::info!(
                low_confidence_count = low_confidence.len(),
                "sending files to LLM for classification"
            );

            let llm_entries: Vec<FileEntry> = low_confidence
                .iter()
                .map(|(_, entry)| (*entry).clone())
                .collect();

            for chunk in llm_entries.chunks(CLASSIFY_BATCH_SIZE) {
                match state.ai.read().await.classify(chunk).await {
                    Ok(output) => {
                        for llm_file in &output.result.files {
                            if let Some(&(global_idx, _)) = low_confidence.get(llm_file.index) {
                                if let Some(result) = results.get_mut(global_idx) {
                                    let service = parse_service(&llm_file.service);
                                    result.service = service;
                                    result.confidence = llm_file.confidence.clamp(0.0, 1.0);
                                    result.reasoning = Some(llm_file.reasoning.clone());
                                    result.ai_classified = true;
                                }
                            }
                        }
                        debug_info = Some(output.debug_info);
                    }
                    Err(err) => {
                        tracing::warn!(%err, "LLM classification failed, keeping heuristic results");
                    }
                }
            }
        }
    }

    let audiobook_groups = detect_audiobook_groups(&request.files, &results);

    tracing::info!(
        file_count,
        audiobook_groups = audiobook_groups.len(),
        "classify response ready"
    );

    Ok(Json(ClassifyResponse {
        files: results,
        audiobook_groups,
        debug_info,
    }))
}

// ─── Server-side heuristics ──────────────────────────────────────────

fn heuristic_classify(index: usize, file: &FileEntry) -> FileClassificationResult {
    let ext = file
        .filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();

    let (service, confidence) = match ext.as_str() {
        // Photos — unambiguous
        "jpg" | "jpeg" | "heic" | "png" | "webp" | "gif" | "raw" | "dng" | "cr2" | "arw"
        | "nef" | "orf" => (ServiceKind::Photos, 0.95),

        // Documents — unambiguous (archival/office formats)
        "docx" | "doc" | "xlsx" | "xls" | "odt" | "ods" | "pptx" | "ppt" | "txt" | "rtf"
        | "csv" => (ServiceKind::Documents, 0.92),

        // Reading — ebooks are always for reading
        "epub" | "mobi" | "azw" | "azw3" | "fb2" => (ServiceKind::Reading, 0.95),

        // Reading — comics/manga are always for reading
        "cbz" | "cbr" | "cb7" | "cbt" | "cba" => (ServiceKind::Reading, 0.95),

        // PDF — could be a document to archive or a book to read; let LLM decide
        "pdf" => (ServiceKind::Documents, 0.5),

        // M4B is always an audiobook
        "m4b" => (ServiceKind::Audiobooks, 0.98),

        // Video — could be personal, movie, or TV; let LLM decide
        "mp4" | "mov" | "mkv" | "avi" | "wmv" | "webm" | "flv" | "m4v" | "ts" => {
            (ServiceKind::Media, 0.5)
        }

        // Audio — could be music or audiobook; let LLM decide
        "mp3" | "flac" | "ogg" | "aac" | "wma" | "opus" | "m4a" | "wav" => {
            (ServiceKind::Media, 0.5)
        }

        // MIME fallbacks
        _ => {
            if file.mime_type.starts_with("image/") {
                (ServiceKind::Photos, 0.9)
            } else if file.mime_type.starts_with("video/") || file.mime_type.starts_with("audio/") {
                (ServiceKind::Media, 0.5)
            } else {
                (ServiceKind::Files, 1.0)
            }
        }
    };

    FileClassificationResult {
        index,
        service,
        confidence,
        reasoning: None,
        ai_classified: false,
    }
}

/// Parse an LLM JSON response into `LlmClassifyResult`, handling multiple
/// formats small/local models may return:
///   - `{"files": [...]}` — expected wrapper
///   - `[{...}, ...]`     — bare array of file classifications
///   - `{...}`            — bare single file classification object
fn parse_llm_result(value: serde_json::Value) -> Result<LlmClassifyResult, serde_json::Error> {
    // Try the expected format first
    if let Ok(result) = serde_json::from_value::<LlmClassifyResult>(value.clone()) {
        return Ok(result);
    }
    // Try bare array
    if let Ok(files) = serde_json::from_value::<Vec<LlmFileClassification>>(value.clone()) {
        return Ok(LlmClassifyResult { files });
    }
    // Try bare single object
    if let Ok(file) = serde_json::from_value::<LlmFileClassification>(value.clone()) {
        return Ok(LlmClassifyResult { files: vec![file] });
    }
    // Fall through to the original error for diagnostics
    serde_json::from_value::<LlmClassifyResult>(value)
}

fn parse_service(s: &str) -> ServiceKind {
    match s {
        "photos" => ServiceKind::Photos,
        "media" => ServiceKind::Media,
        "documents" => ServiceKind::Documents,
        "audiobooks" => ServiceKind::Audiobooks,
        "reading" => ServiceKind::Reading,
        _ => ServiceKind::Files,
    }
}

// ─── Audiobook grouping ──────────────────────────────────────────────

fn detect_audiobook_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
) -> Vec<AudiobookGroup> {
    let audiobook_indices: Vec<usize> = results
        .iter()
        .enumerate()
        .filter(|(_, r)| matches!(r.service, ServiceKind::Audiobooks))
        .map(|(i, _)| i)
        .collect();

    if audiobook_indices.is_empty() {
        return vec![];
    }

    let mut folder_groups: HashMap<String, Vec<usize>> = HashMap::new();

    for &idx in &audiobook_indices {
        let file = &files[idx];
        let folder_key = match &file.relative_path {
            Some(path) => {
                let parts: Vec<&str> = path.split('/').collect();
                if parts.len() >= 2 {
                    parts[..parts.len() - 1].join("/")
                } else {
                    "ungrouped".to_string()
                }
            }
            None => "ungrouped".to_string(),
        };
        folder_groups.entry(folder_key).or_default().push(idx);
    }

    let mut groups = Vec::new();

    for (folder_path, indices) in &folder_groups {
        if folder_path == "ungrouped" {
            for &idx in indices {
                let file = &files[idx];
                let title = file
                    .filename
                    .rsplit('.')
                    .next_back()
                    .unwrap_or(&file.filename)
                    .to_string();
                groups.push(AudiobookGroup {
                    title,
                    author: None,
                    file_indices: vec![idx],
                });
            }
            continue;
        }

        let segments: Vec<&str> = folder_path.split('/').collect();

        let (author, title) = match segments.len() {
            0 => (None, folder_path.clone()),
            1 => (None, segments[0].to_string()),
            _ => (Some(segments[0].to_string()), segments[1..].join(" - ")),
        };

        groups.push(AudiobookGroup {
            title,
            author,
            file_indices: indices.clone(),
        });
    }

    groups
}
