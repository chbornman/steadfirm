//! SSE streaming classification endpoint.

use std::collections::HashMap;
use std::convert::Infallible;

use axum::{
    extract::State,
    response::sse::{Event, Sse},
    Json,
};
use futures::Stream;
use serde::Deserialize;

use crate::auth::AuthUser;
use crate::constants::{AI_CONFIDENCE_THRESHOLD, CLASSIFY_BATCH_SIZE};
use crate::services::ai::{extract_json_from_text, ClassifyStreamEvent};
use crate::AppState;
use steadfirm_shared::classify::{ClassifyDebugInfo, FileEntry};

use super::heuristics::heuristic_classify;
use super::llm::{
    build_sse_done, parse_llm_result, parse_service, LlmMetadataMap, SseClassification,
    SseHeuristic, SseIndexMap, SseStatus,
};

#[derive(Debug, Deserialize)]
pub struct ClassifyRequest {
    pub files: Vec<FileEntry>,
}

/// Emit a `log` SSE event that the frontend pipes straight to
/// `console.log`.
macro_rules! sse_log {
    ($($arg:tt)*) => {
        Ok(Event::default().event("log").data(format!($($arg)*)))
    };
}

/// POST /api/v1/classify/stream
pub async fn classify_stream(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(request): Json<ClassifyRequest>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = async_stream::stream! {
        let file_count = request.files.len();
        tracing::info!(file_count, "classify stream started");
        yield sse_log!("[classify] stream started — {} files", file_count);

        let mut llm_metadata: LlmMetadataMap = HashMap::new();

        // ── Step 1: Heuristic classification ──
        let mut results = Vec::with_capacity(file_count);
        let mut heuristic_high = 0usize;
        let mut heuristic_low = 0usize;

        for (i, file) in request.files.iter().enumerate() {
            let result = heuristic_classify(i, file);
            results.push(result.clone());

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

            if let Ok(data) = serde_json::to_string(&SseStatus {
                phase: "classifying",
                pending: low_confidence.len(),
            }) {
                yield Ok(Event::default().event("status").data(data));
            }

            let llm_entries: Vec<FileEntry> = low_confidence
                .iter()
                .map(|(_, entry)| (*entry).clone())
                .collect();

            for (batch_idx, chunk) in llm_entries.chunks(CLASSIFY_BATCH_SIZE).enumerate() {
                yield sse_log!(
                    "[classify] LLM batch {} — {} files (streaming)",
                    batch_idx, chunk.len()
                );

                let batch_start = batch_idx * CLASSIFY_BATCH_SIZE;
                let index_map: Vec<usize> = (0..chunk.len())
                    .map(|i| low_confidence[batch_start + i].0)
                    .collect();

                if let Ok(data) = serde_json::to_string(&SseIndexMap {
                    index_map: index_map.clone(),
                }) {
                    yield Ok(Event::default().event("index_map").data(data));
                }

                let start = std::time::Instant::now();

                match state.ai.read().await.classify_stream(chunk) {
                    Ok((mut rx, meta)) => {
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

                                                    if let Some(result) = results.get_mut(global_idx) {
                                                        result.service = service;
                                                        result.confidence = confidence;
                                                        result.reasoning = reasoning.clone();
                                                        result.ai_classified = true;
                                                    }

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
