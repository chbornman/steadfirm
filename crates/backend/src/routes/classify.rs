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
        .route("/probe", post(probe_audiobook_files))
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

// ─── Audiobook file probing ──────────────────────────────────────────

/// POST /api/v1/classify/probe
///
/// Accepts multipart upload of audio files and runs ffprobe on each to
/// extract ID3 tags, duration, and embedded cover art. Returns aggregated
/// probe data for populating the audiobook review UI.
///
/// This is called after classification identifies audiobook groups, so
/// the frontend can show accurate metadata before the user confirms upload.
async fn probe_audiobook_files(
    State(_state): State<AppState>,
    _user: AuthUser,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<Vec<steadfirm_shared::classify::AudioFileProbe>>, AppError> {
    use crate::services::ffprobe;

    let mut probes: Vec<(usize, steadfirm_shared::classify::AudioFileProbe)> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
    {
        // The field name is the file index as a string
        let field_name = field.name().unwrap_or("").to_string();
        let file_index: usize = match field_name.parse() {
            Ok(idx) => idx,
            Err(_) => continue, // skip non-index fields
        };

        let filename = field.file_name().unwrap_or("audio.mp3").to_string();
        let data = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("failed to read file: {e}")))?;

        match ffprobe::probe_bytes(&data, &filename).await {
            Ok(result) => {
                let mut probe = result.to_audio_file_probe(file_index);
                // If ffprobe didn't find a track number in ID3, try the filename
                if probe.track_number.is_none() {
                    probe.track_number = ffprobe::parse_track_from_filename(&filename);
                }
                probes.push((file_index, probe));
            }
            Err(e) => {
                tracing::warn!(file_index, filename = %filename, error = %e, "ffprobe failed");
                // Return a minimal probe with zero duration
                probes.push((
                    file_index,
                    steadfirm_shared::classify::AudioFileProbe {
                        file_index,
                        track_number: ffprobe::parse_track_from_filename(&filename),
                        disc_number: None,
                        duration_secs: 0.0,
                        title: None,
                        has_embedded_cover: false,
                    },
                ));
            }
        }
    }

    // Sort by file index
    probes.sort_by_key(|(idx, _)| *idx);
    let results: Vec<_> = probes.into_iter().map(|(_, p)| p).collect();

    Ok(Json(results))
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

        // Audio — check for audiobook signals before falling back to LLM
        "mp3" | "flac" | "ogg" | "aac" | "wma" | "opus" | "m4a" | "wav" => {
            heuristic_classify_audio(file)
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

/// Enhanced heuristic for audio files that checks for audiobook signals
/// before deferring to the LLM.
fn heuristic_classify_audio(file: &FileEntry) -> (ServiceKind, f32) {
    let lower_name = file.filename.to_lowercase();
    let lower_path = file.relative_path.as_deref().unwrap_or("").to_lowercase();

    let combined = format!("{} {}", lower_path, lower_name);

    // Strong audiobook signals in filename or path
    let audiobook_keywords = crate::constants::AUDIOBOOK_FILENAME_KEYWORDS;
    let has_audiobook_keyword = audiobook_keywords.iter().any(|kw| {
        // Match as whole word or prefix — "chapter01" should match "chapter"
        // but "chard" should not match "ch"
        let kw_len = kw.len();
        combined.match_indices(kw).any(|(pos, _)| {
            // Check it's a word boundary before the match
            let before_ok = pos == 0 || !combined.as_bytes()[pos - 1].is_ascii_alphanumeric();
            // Check after the keyword: either end, a digit, or non-alpha
            let after_pos = pos + kw_len;
            let after_ok = after_pos >= combined.len()
                || !combined.as_bytes()[after_pos].is_ascii_alphabetic();
            before_ok && after_ok
        })
    });

    // Check for sequential chapter numbering patterns
    let has_chapter_numbering = {
        let patterns = [
            // "01 - ", "01_", "01.", matches leading numbers
            lower_name
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .count()
                >= 2,
        ];
        patterns.iter().any(|p| *p)
    };

    // Check folder structure for audiobook-like patterns
    // e.g., "Author Name/Book Title/" has exactly 2+ levels and no music indicators
    let path_segments: Vec<&str> = lower_path.split('/').filter(|s| !s.is_empty()).collect();
    let has_bookish_folder = path_segments.len() >= 2
        && !lower_path.contains("music")
        && !lower_path.contains("album")
        && !lower_path.contains("discography")
        && !lower_path.contains("playlist");

    // If we have strong audiobook signals, classify with high confidence
    if has_audiobook_keyword && has_bookish_folder {
        return (ServiceKind::Audiobooks, 0.92);
    }
    if has_audiobook_keyword {
        return (ServiceKind::Audiobooks, 0.88);
    }
    // Sequential numbering in a bookish folder structure
    if has_chapter_numbering && has_bookish_folder {
        return (ServiceKind::Audiobooks, 0.75);
    }

    // Default: ambiguous, let LLM decide
    (ServiceKind::Media, 0.5)
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

/// Image extensions that might be a cover image.
const COVER_IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];

/// Check if a filename looks like a cover image.
fn is_cover_image(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    if !COVER_IMAGE_EXTENSIONS.contains(&ext) {
        return false;
    }
    let stem = lower.rsplit('.').next_back().unwrap_or(&lower);
    stem.contains("cover") || stem.contains("folder") || stem.contains("front")
}

/// Parse an ABS-style title folder name to extract metadata.
///
/// Supports patterns like:
///   - `Wizards First Rule`
///   - `1994 - Wizards First Rule`
///   - `Vol 1 - 1994 - Wizards First Rule {Sam Tsoutsouvas}`
///   - `Book 2 - Title - Subtitle`
fn parse_title_folder(
    folder_name: &str,
) -> (String, Option<String>, Option<String>, Option<String>) {
    let mut title = folder_name.to_string();
    let mut narrator: Option<String> = None;
    let mut year: Option<String> = None;
    let mut sequence: Option<String> = None;

    // Extract narrator from curly braces: {Narrator Name}
    if let Some(open) = title.find('{') {
        if let Some(close) = title.find('}') {
            if close > open {
                narrator = Some(title[open + 1..close].trim().to_string());
                title = format!("{}{}", &title[..open], &title[close + 1..]);
                title = title.trim().to_string();
            }
        }
    }

    // Split by " - " to parse segments
    let segments: Vec<&str> = title.split(" - ").map(|s| s.trim()).collect();

    if segments.len() >= 2 {
        let mut remaining = Vec::new();
        for seg in &segments {
            let trimmed = seg.trim_start_matches('(').trim_end_matches(')');
            // Check for year (4 digits)
            if year.is_none() && trimmed.len() == 4 && trimmed.chars().all(|c| c.is_ascii_digit()) {
                year = Some(trimmed.to_string());
                continue;
            }
            // Check for sequence: "Vol 1", "Volume 2", "Book 3", bare "1"
            if sequence.is_none() {
                let lower = trimmed.to_lowercase();
                let seq = extract_sequence(&lower);
                if seq.is_some() {
                    sequence = seq;
                    continue;
                }
            }
            remaining.push(*seg);
        }
        title = remaining.join(" - ");
    } else if !title.is_empty() {
        // Check for leading year: "1994 - Title" was already split above
        // Check for leading "(1994)" pattern in single-segment names
        let trimmed = title.trim_start_matches('(');
        if trimmed.len() >= 4 && trimmed[..4].chars().all(|c| c.is_ascii_digit()) {
            if let Some(rest) = trimmed.get(4..) {
                let rest = rest
                    .trim_start_matches(')')
                    .trim_start_matches(" - ")
                    .trim();
                if !rest.is_empty() {
                    year = Some(trimmed[..4].to_string());
                    title = rest.to_string();
                }
            }
        }
    }

    (title, year, sequence, narrator)
}

/// Try to extract a sequence number from a string like "vol 1", "book 2", "1", "1."
fn extract_sequence(s: &str) -> Option<String> {
    let prefixes = ["vol ", "vol. ", "volume ", "book "];
    for prefix in &prefixes {
        if let Some(rest) = s.strip_prefix(prefix) {
            let num: String = rest
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if !num.is_empty() {
                return Some(num.trim_end_matches('.').to_string());
            }
        }
    }
    // Check for bare number at start: "1 - Title" or "1. Title"
    let num: String = s
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if !num.is_empty() && num.len() <= 4 {
        let after = &s[num.len()..];
        if after.is_empty()
            || after.starts_with(". ")
            || after.starts_with(' ')
            || after.starts_with('.')
        {
            return Some(num.trim_end_matches('.').to_string());
        }
    }
    None
}

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

    // Also collect cover images that share folders with audiobook files
    let audiobook_folders: std::collections::HashSet<String> = audiobook_indices
        .iter()
        .filter_map(|&idx| {
            let file = &files[idx];
            file.relative_path.as_ref().and_then(|p| {
                let parts: Vec<&str> = p.split('/').collect();
                if parts.len() >= 2 {
                    Some(parts[..parts.len() - 1].join("/"))
                } else {
                    None
                }
            })
        })
        .collect();

    // Find cover images in audiobook folders (even if classified as photos)
    let cover_images: HashMap<String, usize> = files
        .iter()
        .enumerate()
        .filter_map(|(idx, file)| {
            if !is_cover_image(&file.filename) {
                return None;
            }
            file.relative_path.as_ref().and_then(|p| {
                let parts: Vec<&str> = p.split('/').collect();
                if parts.len() >= 2 {
                    let folder = parts[..parts.len() - 1].join("/");
                    if audiobook_folders.contains(&folder) {
                        return Some((folder, idx));
                    }
                }
                None
            })
        })
        .collect();

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
                    series: None,
                    series_sequence: None,
                    narrator: None,
                    year: None,
                    file_indices: vec![idx],
                    cover_index: None,
                    probe_data: None,
                });
            }
            continue;
        }

        let segments: Vec<&str> = folder_path.split('/').collect();

        // Parse ABS-style folder structure:
        //   Author/Series/Title  (3+ segments)
        //   Author/Title         (2 segments)
        //   Title                (1 segment)
        let (author, raw_title, series) = match segments.len() {
            0 => (None, folder_path.clone(), None),
            1 => (None, segments[0].to_string(), None),
            2 => (Some(segments[0].to_string()), segments[1].to_string(), None),
            _ => {
                // 3+ segments: Author/Series/Title (last segment is title)
                (
                    Some(segments[0].to_string()),
                    segments[segments.len() - 1].to_string(),
                    Some(segments[1..segments.len() - 1].join(" / ")),
                )
            }
        };

        // Parse the title folder for year, sequence, narrator
        let (title, parsed_year, parsed_sequence, parsed_narrator) = parse_title_folder(&raw_title);

        let cover_index = cover_images.get(folder_path).copied();

        groups.push(AudiobookGroup {
            title,
            author,
            series: series.or(None),
            series_sequence: parsed_sequence,
            narrator: parsed_narrator,
            year: parsed_year,
            file_indices: indices.clone(),
            cover_index,
            probe_data: None,
        });
    }

    groups
}
