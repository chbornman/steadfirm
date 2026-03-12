//! JSON classification endpoint (non-streaming, backwards compatible).

use std::collections::HashMap;

use axum::{extract::State, Json};
use serde::Deserialize;

use crate::auth::AuthUser;
use crate::constants::{AI_CONFIDENCE_THRESHOLD, CLASSIFY_BATCH_SIZE};
use crate::error::AppError;
use crate::AppState;
use steadfirm_shared::classify::{ClassifyResponse, FileEntry};

use super::heuristics::heuristic_classify;
use super::llm::{build_all_groups, parse_service, LlmMetadataMap};

#[derive(Debug, Deserialize)]
pub struct ClassifyRequest {
    files: Vec<FileEntry>,
}

/// POST /api/v1/classify
pub async fn classify(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(request): Json<ClassifyRequest>,
) -> Result<Json<ClassifyResponse>, AppError> {
    let file_count = request.files.len();
    tracing::info!(file_count, "classify request received");

    let mut results = request
        .files
        .iter()
        .enumerate()
        .map(|(i, f)| heuristic_classify(i, f))
        .collect::<Vec<_>>();

    let mut llm_metadata: LlmMetadataMap = HashMap::new();
    let mut debug_info = None;
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
