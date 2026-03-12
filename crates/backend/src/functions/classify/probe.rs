//! Audiobook file probing via ffprobe.

use axum::{extract::State, Json};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::services::ffprobe;
use crate::AppState;

/// POST /api/v1/classify/probe
///
/// Accepts multipart upload of audio files and runs ffprobe on each to
/// extract ID3 tags, duration, and embedded cover art.
pub async fn probe_audiobook_files(
    State(_state): State<AppState>,
    _user: AuthUser,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<Vec<steadfirm_shared::classify::AudioFileProbe>>, AppError> {
    let mut probes: Vec<(usize, steadfirm_shared::classify::AudioFileProbe)> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        let file_index: usize = match field_name.parse() {
            Ok(idx) => idx,
            Err(_) => continue,
        };

        let filename = field.file_name().unwrap_or("audio.mp3").to_string();
        let data = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("failed to read file: {e}")))?;

        match ffprobe::probe_bytes(&data, &filename).await {
            Ok(result) => {
                let mut probe = result.to_audio_file_probe(file_index);
                if probe.track_number.is_none() {
                    probe.track_number = ffprobe::parse_track_from_filename(&filename);
                }
                probes.push((file_index, probe));
            }
            Err(e) => {
                tracing::warn!(file_index, filename = %filename, error = %e, "ffprobe failed");
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

    probes.sort_by_key(|(idx, _)| *idx);
    let results: Vec<_> = probes.into_iter().map(|(_, p)| p).collect();

    Ok(Json(results))
}
