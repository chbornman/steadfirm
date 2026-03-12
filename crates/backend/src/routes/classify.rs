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
    LlmClassifyResult, LlmFileClassification, MovieGroup, MusicAlbumGroup, ReadingGroup,
    ReadingVolume, TvEpisode, TvShowGroup,
};
use steadfirm_shared::ServiceKind;

/// LLM metadata indexed by global file index, used by group detectors
/// to enhance regex-parsed metadata with LLM-inferred clean titles,
/// years, series info, etc.
type LlmMetadataMap = HashMap<usize, LlmFileClassification>;

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

/// Final event with authoritative classifications, all groups, and debug info.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SseDone {
    /// Authoritative classifications from the LLM (global indices).
    /// Frontend replaces any partial-parse results with these.
    classifications: Vec<SseClassification>,
    audiobook_groups: Vec<AudiobookGroup>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tv_show_groups: Vec<TvShowGroup>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    movie_groups: Vec<MovieGroup>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    music_groups: Vec<MusicAlbumGroup>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    reading_groups: Vec<ReadingGroup>,
    debug_info: Option<ClassifyDebugInfo>,
}

// ─── Group builder helpers ───────────────────────────────────────────

/// Build all group types from classification results.
type AllGroups = (
    Vec<AudiobookGroup>,
    Vec<TvShowGroup>,
    Vec<MovieGroup>,
    Vec<MusicAlbumGroup>,
    Vec<ReadingGroup>,
);

fn build_all_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
    llm_metadata: &LlmMetadataMap,
) -> AllGroups {
    let audiobook_groups = detect_audiobook_groups(files, results, llm_metadata);
    let tv_show_groups = detect_tv_show_groups(files, results, llm_metadata);

    // Collect all TV show file indices to exclude from movie detection
    let tv_file_indices: std::collections::HashSet<usize> = tv_show_groups
        .iter()
        .flat_map(|g| g.file_indices.iter().copied())
        .collect();

    let movie_groups = detect_movie_groups(files, results, &tv_file_indices, llm_metadata);
    let music_groups = detect_music_groups(files, results, llm_metadata);
    let reading_groups = detect_reading_groups(files, results, llm_metadata);

    (
        audiobook_groups,
        tv_show_groups,
        movie_groups,
        music_groups,
        reading_groups,
    )
}

/// Build an SseDone event with all groups.
fn build_sse_done(
    classifications: Vec<SseClassification>,
    files: &[FileEntry],
    results: &[FileClassificationResult],
    debug_info: Option<ClassifyDebugInfo>,
    llm_metadata: &LlmMetadataMap,
) -> SseDone {
    let (audiobook_groups, tv_show_groups, movie_groups, music_groups, reading_groups) =
        build_all_groups(files, results, llm_metadata);
    SseDone {
        classifications,
        audiobook_groups,
        tv_show_groups,
        movie_groups,
        music_groups,
        reading_groups,
        debug_info,
    }
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

        // LLM metadata map — populated during LLM classification, used by
        // group detectors to enhance regex-parsed metadata with clean titles.
        let mut llm_metadata: LlmMetadataMap = HashMap::new();

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
            let done = build_sse_done(vec![], &request.files, &results, None, &llm_metadata);
            yield sse_log!("[classify] groups: {} audiobooks, {} tv shows, {} movies, {} music, {} reading",
                done.audiobook_groups.len(), done.tv_show_groups.len(),
                done.movie_groups.len(), done.music_groups.len(), done.reading_groups.len());
            if let Ok(data) = serde_json::to_string(&done) {
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

            let done = build_sse_done(vec![], &request.files, &results, None, &llm_metadata);
            yield sse_log!("[classify] groups: {} audiobooks, {} tv shows, {} movies, {} music, {} reading (AI disabled)",
                done.audiobook_groups.len(), done.tv_show_groups.len(),
                done.movie_groups.len(), done.music_groups.len(), done.reading_groups.len());
            if let Ok(data) = serde_json::to_string(&done) {
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

                                                // Store LLM metadata for group detectors
                                                llm_metadata.insert(global_idx, llm_file.clone());

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
                            let debug_info = Some(ClassifyDebugInfo {
                                system_prompt: meta.system_prompt.clone(),
                                user_prompt: meta.user_prompt.clone(),
                                raw_response: Some(raw_text.clone()),
                                model: meta.model.clone(),
                                provider: meta.provider.clone(),
                                file_count: meta.file_count,
                                duration_ms: start.elapsed().as_millis() as u64,
                            });

                            let done = build_sse_done(partial_classifications, &request.files, &results, debug_info, &llm_metadata);
                            yield sse_log!("[classify] sending done event (error recovery path)");
                            if let Ok(data) = serde_json::to_string(&done) {
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

                                    // Update local results for group detection
                                                     if let Some(result) = results.get_mut(global_idx) {
                                                         result.service = service;
                                                         result.confidence = confidence;
                                                         result.reasoning = reasoning.clone();
                                                         result.ai_classified = true;
                                                     }

                                                     // Store LLM metadata for group detectors
                                                     llm_metadata.insert(global_idx, llm_file.clone());

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

                            // ── Step 3: Build all groups ──
                            let done = build_sse_done(classifications, &request.files, &results, debug_info, &llm_metadata);

                            tracing::info!(
                                file_count,
                                audiobook_groups = done.audiobook_groups.len(),
                                tv_show_groups = done.tv_show_groups.len(),
                                movie_groups = done.movie_groups.len(),
                                music_groups = done.music_groups.len(),
                                reading_groups = done.reading_groups.len(),
                                "classify stream complete"
                            );

                            yield sse_log!(
                                "[classify] stream complete — {} audiobooks, {} tv shows, {} movies, {} music, {} reading",
                                done.audiobook_groups.len(), done.tv_show_groups.len(),
                                done.movie_groups.len(), done.music_groups.len(), done.reading_groups.len()
                            );

                            if let Ok(data) = serde_json::to_string(&done) {
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
                        let done = build_sse_done(vec![], &request.files, &results, None, &llm_metadata);
                        if let Ok(data) = serde_json::to_string(&done) {
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

    let mut llm_metadata: LlmMetadataMap = HashMap::new();
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
                                // Store LLM metadata for group detectors
                                llm_metadata.insert(global_idx, llm_file.clone());
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

    let (audiobook_groups, tv_show_groups, movie_groups, music_groups, reading_groups) =
        build_all_groups(&request.files, &results, &llm_metadata);

    tracing::info!(
        file_count,
        audiobook_groups = audiobook_groups.len(),
        tv_show_groups = tv_show_groups.len(),
        movie_groups = movie_groups.len(),
        music_groups = music_groups.len(),
        reading_groups = reading_groups.len(),
        "classify response ready"
    );

    Ok(Json(ClassifyResponse {
        files: results,
        audiobook_groups,
        tv_show_groups,
        movie_groups,
        music_groups,
        reading_groups,
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

        // Video — check for TV show patterns before deferring to LLM
        "mp4" | "mov" | "mkv" | "avi" | "wmv" | "webm" | "flv" | "m4v" | "ts" => {
            heuristic_classify_video(file)
        }

        // Subtitle files — follow their associated video
        "srt" | "ass" | "ssa" | "sub" | "idx" | "vtt" => heuristic_classify_video(file),

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

/// Enhanced heuristic for video/subtitle files that checks for TV show
/// patterns (S##E##) and movie-like naming before deferring to the LLM.
fn heuristic_classify_video(file: &FileEntry) -> (ServiceKind, f32) {
    let lower_name = file.filename.to_lowercase();
    let lower_path = file.relative_path.as_deref().unwrap_or("").to_lowercase();
    let combined = format!("{} {}", lower_path, lower_name);

    // Strong TV show signal: S##E## pattern
    if parse_season_episode(&combined).is_some() {
        return (ServiceKind::Media, 0.92);
    }

    // Check for "Season" folder in path
    if lower_path.contains("season ") || lower_path.contains("season_") {
        return (ServiceKind::Media, 0.90);
    }

    // Movie-like: has year in parentheses and/or scene release tags
    let has_year_parens = combined
        .find('(')
        .and_then(|start| {
            let rest = &combined[start + 1..];
            rest.find(')').and_then(|end| {
                let inside = &rest[..end];
                if inside.len() == 4 && inside.chars().all(|c| c.is_ascii_digit()) {
                    let year: u32 = inside.parse().unwrap_or(0);
                    if (1920..=2030).contains(&year) {
                        return Some(());
                    }
                }
                None
            })
        })
        .is_some();

    let has_resolution = crate::constants::RESOLUTION_TAGS
        .iter()
        .any(|tag| combined.contains(tag));

    let has_source = crate::constants::SOURCE_TAGS
        .iter()
        .any(|tag| combined.contains(tag));

    if has_year_parens && (has_resolution || has_source) {
        return (ServiceKind::Media, 0.88);
    }
    if has_year_parens {
        return (ServiceKind::Media, 0.80);
    }
    if has_resolution || has_source {
        return (ServiceKind::Media, 0.70);
    }

    // Default: ambiguous, let LLM decide
    (ServiceKind::Media, 0.5)
}

/// Parse S##E## patterns from a string, returning (season, episode, optional end_episode).
fn parse_season_episode(s: &str) -> Option<(u32, u32, Option<u32>)> {
    // Match patterns: S01E02, S1E2, s01e02, S01E01-E02, S01E01E02
    let lower = s.to_lowercase();
    let bytes = lower.as_bytes();

    for i in 0..bytes.len().saturating_sub(3) {
        if bytes[i] != b's' {
            continue;
        }

        // Check it's a word boundary before 's'
        if i > 0 && bytes[i - 1].is_ascii_alphanumeric() {
            continue;
        }

        // Parse season number
        let season_start = i + 1;
        let mut j = season_start;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            j += 1;
        }
        if j == season_start || j >= bytes.len() {
            continue;
        }
        let season: u32 = match lower[season_start..j].parse() {
            Ok(n) => n,
            Err(_) => continue,
        };

        if bytes[j] != b'e' {
            continue;
        }

        // Parse episode number
        let ep_start = j + 1;
        let mut k = ep_start;
        while k < bytes.len() && bytes[k].is_ascii_digit() {
            k += 1;
        }
        if k == ep_start {
            continue;
        }
        let episode: u32 = match lower[ep_start..k].parse() {
            Ok(n) => n,
            Err(_) => continue,
        };

        // Check for multi-episode: -E## or E##
        let mut episode_end: Option<u32> = None;
        if k < bytes.len() {
            let next_start = if bytes[k] == b'-' && k + 1 < bytes.len() && bytes[k + 1] == b'e' {
                k + 2
            } else if bytes[k] == b'e' {
                k + 1
            } else {
                0
            };
            if next_start > 0 && next_start < bytes.len() {
                let mut m = next_start;
                while m < bytes.len() && bytes[m].is_ascii_digit() {
                    m += 1;
                }
                if m > next_start {
                    if let Ok(end_ep) = lower[next_start..m].parse::<u32>() {
                        if end_ep > episode {
                            episode_end = Some(end_ep);
                        }
                    }
                }
            }
        }

        return Some((season, episode, episode_end));
    }

    None
}

/// Extract a movie title and year from a filename, stripping scene release tags.
fn parse_movie_name(filename: &str) -> (String, Option<String>, Option<String>, Option<String>) {
    let stem = filename
        .rsplit('.')
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(".");
    let working = if stem.is_empty() { filename } else { &stem };

    // Replace common separators with spaces
    let normalized: String = working
        .chars()
        .map(|c| if c == '.' || c == '_' { ' ' } else { c })
        .collect();

    let mut title_end = normalized.len();
    let mut year: Option<String> = None;
    let mut resolution: Option<String> = None;
    let mut source: Option<String> = None;

    // Find year in parentheses: (2019)
    if let Some(paren_start) = normalized.find('(') {
        let rest = &normalized[paren_start + 1..];
        if let Some(paren_end) = rest.find(')') {
            let inside = &rest[..paren_end];
            if inside.len() == 4 && inside.chars().all(|c| c.is_ascii_digit()) {
                let y: u32 = inside.parse().unwrap_or(0);
                if (1920..=2030).contains(&y) {
                    year = Some(inside.to_string());
                    title_end = paren_start;
                }
            }
        }
    }

    // If no parens year, look for bare 4-digit year
    if year.is_none() {
        let lower = normalized.to_lowercase();
        for word in lower.split_whitespace() {
            if word.len() == 4 && word.chars().all(|c| c.is_ascii_digit()) {
                let y: u32 = word.parse().unwrap_or(0);
                if (1920..=2030).contains(&y) {
                    year = Some(word.to_string());
                    if let Some(pos) = lower.find(word) {
                        title_end = title_end.min(pos);
                    }
                    break;
                }
            }
        }
    }

    // Extract resolution and source tags
    let lower = normalized.to_lowercase();
    for tag in crate::constants::RESOLUTION_TAGS {
        if lower.contains(tag) {
            resolution = Some(tag.to_string());
            if let Some(pos) = lower.find(tag) {
                title_end = title_end.min(pos);
            }
            break;
        }
    }

    for tag in crate::constants::SOURCE_TAGS {
        if lower.contains(tag) {
            source = Some(tag.to_string());
            if let Some(pos) = lower.find(tag) {
                title_end = title_end.min(pos);
            }
            break;
        }
    }

    // Also cut at codec tags
    for tag in crate::constants::CODEC_TAGS {
        if let Some(pos) = lower.find(tag) {
            title_end = title_end.min(pos);
        }
    }

    let title = normalized[..title_end].trim().to_string();

    (title, year, resolution, source)
}

/// Extract a TV show series name from a filename by finding text before S##E##.
fn parse_series_name_from_filename(filename: &str) -> String {
    let stem = filename
        .rsplit('.')
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(".");
    let working = if stem.is_empty() { filename } else { &stem };

    // Replace separators
    let normalized: String = working
        .chars()
        .map(|c| if c == '.' || c == '_' { ' ' } else { c })
        .collect();

    // Find S##E## and take everything before it as the series name
    let lower = normalized.to_lowercase();
    for i in 0..lower.len().saturating_sub(3) {
        let bytes = lower.as_bytes();
        if bytes[i] == b's'
            && (i == 0 || !bytes[i - 1].is_ascii_alphanumeric())
            && i + 1 < bytes.len()
            && bytes[i + 1].is_ascii_digit()
        {
            // Check it's actually S##E## pattern
            let rest = &lower[i..];
            if parse_season_episode(rest).is_some() {
                let before = normalized[..i].trim();
                if !before.is_empty() {
                    return before.to_string();
                }
            }
        }
    }

    // Fallback: strip known tags and return what's left
    let (title, _, _, _) = parse_movie_name(filename);
    title
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
    llm_metadata: &LlmMetadataMap,
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
                // Use LLM metadata for clean title/author/series when available
                let (title, author, series) =
                    if let Some(llm) = llm_metadata.get(&idx).and_then(|l| l.audiobook_metadata.as_ref()) {
                        (
                            llm.title.clone(),
                            llm.author.clone(),
                            llm.series.clone(),
                        )
                    } else {
                        let t = file
                            .filename
                            .rsplit('.')
                            .next_back()
                            .unwrap_or(&file.filename)
                            .to_string();
                        (t, None, None)
                    };
                groups.push(AudiobookGroup {
                    title,
                    author,
                    series,
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

        // Enhance with LLM metadata from the first file in this group
        let llm_ab = indices
            .first()
            .and_then(|&idx| llm_metadata.get(&idx))
            .and_then(|l| l.audiobook_metadata.as_ref());

        let final_title = llm_ab.map(|m| m.title.clone()).unwrap_or(title);
        let final_author = llm_ab
            .and_then(|m| m.author.clone())
            .or(author);
        let final_series = llm_ab
            .and_then(|m| m.series.clone())
            .or(series);

        let cover_index = cover_images.get(folder_path).copied();

        groups.push(AudiobookGroup {
            title: final_title,
            author: final_author,
            series: final_series,
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

// ─── TV Show grouping ────────────────────────────────────────────────

/// Detect TV show groups from files classified as media that contain S##E## patterns.
fn detect_tv_show_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
    llm_metadata: &LlmMetadataMap,
) -> Vec<TvShowGroup> {
    let video_exts: std::collections::HashSet<&str> =
        crate::constants::VIDEO_EXTENSIONS.iter().copied().collect();
    let subtitle_exts: std::collections::HashSet<&str> = crate::constants::SUBTITLE_EXTENSIONS
        .iter()
        .copied()
        .collect();

    // Collect media files that have S##E## patterns
    type EpisodeEntry = (usize, u32, u32, Option<u32>, Option<String>);
    let mut show_episodes: HashMap<String, Vec<EpisodeEntry>> = HashMap::new();

    for (i, result) in results.iter().enumerate() {
        if !matches!(result.service, ServiceKind::Media) {
            continue;
        }
        let file = &files[i];
        let ext = file
            .filename
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_lowercase();

        if !video_exts.contains(ext.as_str()) {
            continue;
        }

        let combined = format!(
            "{} {}",
            file.relative_path.as_deref().unwrap_or(""),
            file.filename
        )
        .to_lowercase();

        // Check LLM metadata first for TV show identification
        let llm_tv = llm_metadata
            .get(&i)
            .and_then(|l| l.media_metadata.as_ref())
            .filter(|m| m.media_type == "tv_show");

        if let Some((season, episode, episode_end)) = parse_season_episode(&combined) {
            // Regex found S##E## — use LLM metadata for series name if available
            let series_name = llm_tv
                .map(|m| m.title.clone())
                .unwrap_or_else(|| infer_series_name(file));
            show_episodes.entry(series_name).or_default().push((
                i,
                season,
                episode,
                episode_end,
                parse_episode_title(file),
            ));
        } else if let Some(tv) = llm_tv {
            // No S##E## in filename, but LLM identified as TV show with
            // season/episode metadata — use LLM values
            if let (Some(season), Some(episode)) = (tv.season, tv.episode) {
                let series_name = tv.title.clone();
                show_episodes.entry(series_name).or_default().push((
                    i,
                    season,
                    episode,
                    tv.episode_end,
                    parse_episode_title(file),
                ));
            }
        }
    }

    if show_episodes.is_empty() {
        return vec![];
    }

    // Build groups and find associated subtitle files
    let mut groups = Vec::new();

    for (series_name, episodes) in &show_episodes {
        let video_indices: Vec<usize> = episodes.iter().map(|(idx, ..)| *idx).collect();

        // Find subtitle files in the same folders
        let video_folders: std::collections::HashSet<String> = video_indices
            .iter()
            .filter_map(|&idx| folder_of(&files[idx]))
            .collect();

        let subtitle_indices: Vec<usize> = files
            .iter()
            .enumerate()
            .filter(|(_, file)| {
                let ext = file
                    .filename
                    .rsplit('.')
                    .next()
                    .unwrap_or("")
                    .to_lowercase();
                if !subtitle_exts.contains(ext.as_str()) {
                    return false;
                }
                if let Some(folder) = folder_of(file) {
                    video_folders.contains(&folder)
                } else {
                    false
                }
            })
            .map(|(i, _)| i)
            .collect();

        // Try to extract year — prefer LLM metadata, fall back to regex
        let llm_tv_meta = video_indices
            .first()
            .and_then(|&idx| llm_metadata.get(&idx))
            .and_then(|l| l.media_metadata.as_ref())
            .filter(|m| m.media_type == "tv_show");

        let year = llm_tv_meta
            .and_then(|m| m.year.clone())
            .or_else(|| extract_year_from_folder_or_name(series_name));

        let clean_name = if let Some(ref y) = year {
            // Strip year from series name
            let stripped = series_name.replace(&format!("({y})"), "").replace(y, "");
            stripped.trim().trim_end_matches(" -").trim().to_string()
        } else {
            series_name.clone()
        };

        let mut tv_episodes: Vec<TvEpisode> = episodes
            .iter()
            .map(|(idx, season, episode, episode_end, title)| TvEpisode {
                season: *season,
                episode: *episode,
                episode_end: *episode_end,
                title: title.clone(),
                file_index: *idx,
            })
            .collect();

        // Sort episodes by season then episode number
        tv_episodes.sort_by(|a, b| a.season.cmp(&b.season).then(a.episode.cmp(&b.episode)));

        let mut all_indices = video_indices;
        all_indices.extend(&subtitle_indices);

        groups.push(TvShowGroup {
            series_name: clean_name,
            year,
            episodes: tv_episodes,
            file_indices: all_indices,
            subtitle_indices,
        });
    }

    groups
}

/// Infer the series name from a file's folder structure or filename.
fn infer_series_name(file: &FileEntry) -> String {
    if let Some(ref path) = file.relative_path {
        let segments: Vec<&str> = path.split('/').collect();
        if segments.len() >= 2 {
            // First folder segment is typically the series name
            return segments[0].to_string();
        }
    }
    // Fall back to parsing from filename
    parse_series_name_from_filename(&file.filename)
}

/// Try to parse an episode title from a filename.
/// Looks for text after S##E## and before quality/source tags.
fn parse_episode_title(file: &FileEntry) -> Option<String> {
    let stem = file
        .filename
        .rsplit('.')
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(".");
    let working = if stem.is_empty() {
        &file.filename
    } else {
        &stem
    };

    let normalized: String = working
        .chars()
        .map(|c| if c == '.' || c == '_' { ' ' } else { c })
        .collect();

    let lower = normalized.to_lowercase();

    // Find end of S##E## pattern
    if let Some((_, _, _)) = parse_season_episode(&lower) {
        // Find position after S##E##
        for i in 0..lower.len().saturating_sub(3) {
            let bytes = lower.as_bytes();
            if bytes[i] == b's'
                && (i == 0 || !bytes[i - 1].is_ascii_alphanumeric())
                && parse_season_episode(&lower[i..]).is_some()
            {
                // Skip past the S##E##(E##) part
                let mut j = i + 1;
                // Skip season digits
                while j < bytes.len() && bytes[j].is_ascii_digit() {
                    j += 1;
                }
                // Skip 'e' + episode digits
                if j < bytes.len() && bytes[j] == b'e' {
                    j += 1;
                    while j < bytes.len() && bytes[j].is_ascii_digit() {
                        j += 1;
                    }
                }
                // Skip possible -E## for multi-episode
                if j < bytes.len() && bytes[j] == b'-' {
                    j += 1;
                    if j < bytes.len() && bytes[j] == b'e' {
                        j += 1;
                        while j < bytes.len() && bytes[j].is_ascii_digit() {
                            j += 1;
                        }
                    }
                }

                let after = normalized[j..].trim_start_matches([' ', '-']);

                if after.is_empty() {
                    return None;
                }

                // Cut at resolution/source/codec tags
                let after_lower = after.to_lowercase();
                let mut end = after.len();
                for tag in crate::constants::RESOLUTION_TAGS
                    .iter()
                    .chain(crate::constants::SOURCE_TAGS.iter())
                    .chain(crate::constants::CODEC_TAGS.iter())
                {
                    if let Some(pos) = after_lower.find(tag) {
                        end = end.min(pos);
                    }
                }

                let title = after[..end].trim();
                if !title.is_empty() {
                    return Some(title.to_string());
                }
                return None;
            }
        }
    }

    None
}

/// Get the folder path of a file (everything before the last `/`).
fn folder_of(file: &FileEntry) -> Option<String> {
    file.relative_path.as_ref().and_then(|p| {
        let parts: Vec<&str> = p.split('/').collect();
        if parts.len() >= 2 {
            Some(parts[..parts.len() - 1].join("/"))
        } else {
            None
        }
    })
}

/// Extract a 4-digit year from a string like "Breaking Bad (2008)".
fn extract_year_from_folder_or_name(name: &str) -> Option<String> {
    // Check for (year) pattern
    if let Some(start) = name.find('(') {
        let rest = &name[start + 1..];
        if let Some(end) = rest.find(')') {
            let inside = &rest[..end];
            if inside.len() == 4 && inside.chars().all(|c| c.is_ascii_digit()) {
                let y: u32 = inside.parse().unwrap_or(0);
                if (1920..=2030).contains(&y) {
                    return Some(inside.to_string());
                }
            }
        }
    }
    None
}

// ─── Movie grouping ─────────────────────────────────────────────────

/// Detect movie groups from media files that aren't part of TV shows.
fn detect_movie_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
    tv_show_file_indices: &std::collections::HashSet<usize>,
    llm_metadata: &LlmMetadataMap,
) -> Vec<MovieGroup> {
    let video_exts: std::collections::HashSet<&str> =
        crate::constants::VIDEO_EXTENSIONS.iter().copied().collect();
    let subtitle_exts: std::collections::HashSet<&str> = crate::constants::SUBTITLE_EXTENSIONS
        .iter()
        .copied()
        .collect();

    let mut groups = Vec::new();

    for (i, result) in results.iter().enumerate() {
        if !matches!(result.service, ServiceKind::Media) {
            continue;
        }
        if tv_show_file_indices.contains(&i) {
            continue;
        }

        let file = &files[i];
        let ext = file
            .filename
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_lowercase();

        if !video_exts.contains(ext.as_str()) {
            continue;
        }

        let (parsed_title, parsed_year, resolution, source) = parse_movie_name(&file.filename);

        // Use LLM metadata for clean title/year when available
        let llm_movie = llm_metadata
            .get(&i)
            .and_then(|l| l.media_metadata.as_ref())
            .filter(|m| m.media_type == "movie");

        let title = llm_movie
            .map(|m| m.title.clone())
            .unwrap_or(parsed_title);
        let year = llm_movie
            .and_then(|m| m.year.clone())
            .or(parsed_year);

        if title.is_empty() {
            continue;
        }

        // Find subtitle files in the same folder
        let movie_folder = folder_of(file);
        let subtitle_indices: Vec<usize> = if let Some(ref folder) = movie_folder {
            files
                .iter()
                .enumerate()
                .filter(|(idx, f)| {
                    *idx != i
                        && !tv_show_file_indices.contains(idx)
                        && subtitle_exts.contains(
                            f.filename
                                .rsplit('.')
                                .next()
                                .unwrap_or("")
                                .to_lowercase()
                                .as_str(),
                        )
                        && folder_of(f).as_ref() == Some(folder)
                })
                .map(|(idx, _)| idx)
                .collect()
        } else {
            vec![]
        };

        // Find extra files (nfo, images) in the same folder
        let extra_exts = ["nfo", "jpg", "jpeg", "png", "webp"];
        let extra_indices: Vec<usize> = if let Some(ref folder) = movie_folder {
            files
                .iter()
                .enumerate()
                .filter(|(idx, f)| {
                    *idx != i
                        && !tv_show_file_indices.contains(idx)
                        && !subtitle_indices.contains(idx)
                        && extra_exts.contains(
                            &f.filename
                                .rsplit('.')
                                .next()
                                .unwrap_or("")
                                .to_lowercase()
                                .as_str(),
                        )
                        && folder_of(f).as_ref() == Some(folder)
                })
                .map(|(idx, _)| idx)
                .collect()
        } else {
            vec![]
        };

        groups.push(MovieGroup {
            title,
            year,
            resolution,
            source,
            file_index: i,
            subtitle_indices,
            extra_indices,
        });
    }

    groups
}

// ─── Music grouping ─────────────────────────────────────────────────

/// Detect music album groups from media files that have music-like folder structures.
fn detect_music_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
    llm_metadata: &LlmMetadataMap,
) -> Vec<MusicAlbumGroup> {
    let audio_exts: std::collections::HashSet<&str> = crate::constants::MUSIC_AUDIO_EXTENSIONS
        .iter()
        .copied()
        .collect();

    // Collect audio files classified as media that look like music
    // (i.e., in folders with music keywords, or not in audiobook folders)
    let mut folder_groups: HashMap<String, Vec<usize>> = HashMap::new();

    for (i, result) in results.iter().enumerate() {
        if !matches!(result.service, ServiceKind::Media) {
            continue;
        }
        let file = &files[i];
        let ext = file
            .filename
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_lowercase();

        if !audio_exts.contains(ext.as_str()) {
            continue;
        }

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
        folder_groups.entry(folder_key).or_default().push(i);
    }

    if folder_groups.is_empty() {
        return vec![];
    }

    let mut groups = Vec::new();

    for (folder_path, indices) in &folder_groups {
        if indices.is_empty() {
            continue;
        }

        // Infer artist/album from folder structure
        let segments: Vec<&str> = folder_path.split('/').collect();
        let (artist, album) = match segments.len() {
            0 | 1 => {
                // Single folder or ungrouped — use folder name as album
                if folder_path == "ungrouped" {
                    (None, "Unknown Album".to_string())
                } else {
                    (
                        None,
                        segments.last().unwrap_or(&"Unknown Album").to_string(),
                    )
                }
            }
            2 => {
                // Artist/Album
                (Some(segments[0].to_string()), segments[1].to_string())
            }
            _ => {
                // Deeper: take last two segments as Artist/Album
                let album_idx = segments.len() - 1;
                let artist_idx = segments.len() - 2;
                (
                    Some(segments[artist_idx].to_string()),
                    segments[album_idx].to_string(),
                )
            }
        };

        // Find cover art in the same folder
        let cover_index = files
            .iter()
            .enumerate()
            .find(|(_, file)| {
                if !is_cover_image(&file.filename) {
                    return false;
                }
                if let Some(ref path) = file.relative_path {
                    let parts: Vec<&str> = path.split('/').collect();
                    if parts.len() >= 2 {
                        return parts[..parts.len() - 1].join("/") == *folder_path;
                    }
                }
                false
            })
            .map(|(idx, _)| idx);

        // Extract year from album folder name (e.g., "2019 - Album Name" or "(2019)")
        let year = extract_year_from_folder_or_name(&album).or_else(|| {
            // Check for "YYYY - Album" pattern
            let trimmed = album.trim();
            if trimmed.len() >= 4 && trimmed[..4].chars().all(|c| c.is_ascii_digit()) {
                let y: u32 = trimmed[..4].parse().unwrap_or(0);
                if (1920..=2030).contains(&y) {
                    return Some(trimmed[..4].to_string());
                }
            }
            None
        });

        // Enhance with LLM metadata from the first file in this group
        let llm_music = indices
            .first()
            .and_then(|&idx| llm_metadata.get(&idx))
            .and_then(|l| l.media_metadata.as_ref())
            .filter(|m| m.media_type == "music");

        let final_album = llm_music
            .and_then(|m| m.album.clone())
            .unwrap_or(album);
        let final_artist = llm_music
            .and_then(|m| m.artist.clone())
            .or(artist);
        let final_year = llm_music
            .and_then(|m| m.year.clone())
            .or(year);

        groups.push(MusicAlbumGroup {
            album: final_album,
            artist: final_artist,
            year: final_year,
            file_indices: indices.clone(),
            cover_index,
            probe_data: None,
        });
    }

    groups
}

// ─── Reading grouping ───────────────────────────────────────────────

/// Detect reading groups from files classified as reading.
fn detect_reading_groups(
    files: &[FileEntry],
    results: &[FileClassificationResult],
    llm_metadata: &LlmMetadataMap,
) -> Vec<ReadingGroup> {
    let reading_exts: std::collections::HashSet<&str> = crate::constants::EBOOK_EXTENSIONS
        .iter()
        .chain(crate::constants::COMIC_EXTENSIONS.iter())
        .copied()
        .collect();

    // Collect reading files
    let mut folder_groups: HashMap<String, Vec<usize>> = HashMap::new();

    for (i, result) in results.iter().enumerate() {
        if !matches!(result.service, ServiceKind::Reading) {
            continue;
        }
        let file = &files[i];
        let ext = file
            .filename
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_lowercase();

        // Also include PDFs that were classified as reading by the LLM
        if !reading_exts.contains(ext.as_str()) && ext != "pdf" {
            continue;
        }

        // Use LLM series name if available, fall back to folder/filename parsing
        let folder_key = if let Some(series) = llm_metadata
            .get(&i)
            .and_then(|l| l.reading_metadata.as_ref())
            .and_then(|m| m.series.clone())
        {
            series
        } else {
            match &file.relative_path {
                Some(path) => {
                    let parts: Vec<&str> = path.split('/').collect();
                    if parts.len() >= 2 {
                        // Use first folder segment as series name
                        parts[0].to_string()
                    } else {
                        infer_reading_series(&file.filename)
                    }
                }
                None => infer_reading_series(&file.filename),
            }
        };
        folder_groups.entry(folder_key).or_default().push(i);
    }

    if folder_groups.is_empty() {
        return vec![];
    }

    let mut groups = Vec::new();

    for (series_name, indices) in &folder_groups {
        let mut volumes: Vec<ReadingVolume> = indices
            .iter()
            .map(|&idx| {
                let file = &files[idx];
                let ext = file
                    .filename
                    .rsplit('.')
                    .next()
                    .unwrap_or("")
                    .to_lowercase();

                let (parsed_number, parsed_title, is_special) = parse_reading_volume(&file.filename);

                // Enhance with LLM metadata for volume/title
                let llm_reading = llm_metadata
                    .get(&idx)
                    .and_then(|l| l.reading_metadata.as_ref());

                let number = llm_reading
                    .and_then(|m| m.volume.clone())
                    .or(parsed_number);
                let title = llm_reading
                    .map(|m| Some(m.title.clone()))
                    .unwrap_or(parsed_title);

                ReadingVolume {
                    number,
                    title,
                    format: ext,
                    is_special,
                    file_index: idx,
                }
            })
            .collect();

        // Sort by volume number
        volumes.sort_by(|a, b| {
            let num_a = a
                .number
                .as_ref()
                .and_then(|n| n.parse::<f64>().ok())
                .unwrap_or(f64::MAX);
            let num_b = b
                .number
                .as_ref()
                .and_then(|n| n.parse::<f64>().ok())
                .unwrap_or(f64::MAX);
            num_a
                .partial_cmp(&num_b)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        groups.push(ReadingGroup {
            series_name: series_name.clone(),
            volumes,
            file_indices: indices.clone(),
        });
    }

    groups
}

/// Infer a series name from a reading filename by stripping volume/issue indicators.
fn infer_reading_series(filename: &str) -> String {
    let stem = filename
        .rsplit('.')
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(".");
    let working = if stem.is_empty() { filename } else { &stem };

    let normalized: String = working
        .chars()
        .map(|c| if c == '_' { ' ' } else { c })
        .collect();

    let lower = normalized.to_lowercase();

    // Strip volume indicators and everything after
    for prefix in crate::constants::READING_VOLUME_PREFIXES {
        if let Some(pos) = lower.find(prefix) {
            let before = normalized[..pos].trim();
            if !before.is_empty() {
                return before.trim_end_matches([' ', '-', '_']).to_string();
            }
        }
    }

    // Strip trailing numbers (e.g., "Series Name 01")
    let trimmed = normalized.trim_end_matches(|c: char| c.is_ascii_digit() || c == ' ' || c == '.');
    if !trimmed.is_empty() && trimmed.len() < normalized.len() {
        return trimmed.trim_end_matches([' ', '-', '_']).to_string();
    }

    normalized
}

/// Parse volume/issue number and title from a reading filename.
fn parse_reading_volume(filename: &str) -> (Option<String>, Option<String>, bool) {
    let stem = filename
        .rsplit('.')
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(".");
    let working = if stem.is_empty() { filename } else { &stem };

    let normalized: String = working
        .chars()
        .map(|c| if c == '_' { ' ' } else { c })
        .collect();

    let lower = normalized.to_lowercase();

    // Check for special markers
    let is_special = crate::constants::READING_SPECIAL_MARKERS
        .iter()
        .any(|marker| {
            lower
                .split(|c: char| !c.is_ascii_alphanumeric())
                .any(|word| word == *marker)
        });

    // Try to extract volume number
    for prefix in crate::constants::READING_VOLUME_PREFIXES {
        if let Some(pos) = lower.find(prefix) {
            let after = &lower[pos + prefix.len()..];
            let num: String = after
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if !num.is_empty() {
                let title = after[num.len()..]
                    .trim()
                    .trim_start_matches(['-', ' '])
                    .to_string();
                let title = if title.is_empty() { None } else { Some(title) };
                return (
                    Some(num.trim_end_matches('.').to_string()),
                    title,
                    is_special,
                );
            }
        }
    }

    // Try trailing number: "Series Name 01" or "Series Name - 01"
    let parts: Vec<&str> = normalized.split_whitespace().collect();
    if let Some(last) = parts.last() {
        let num: String = last
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if !num.is_empty() && num.len() == last.len() {
            return (
                Some(num.trim_end_matches('.').to_string()),
                None,
                is_special,
            );
        }
    }

    (None, None, is_special)
}
