//! Meeting recording and transcription pipeline.
//!
//! A meeting session progresses through the following states:
//! `recording` → `processing` → `complete` (or `error`).
//!
//! # Recording
//! [`meeting_start`] spawns an `ffmpeg` process that captures the default
//! microphone to a WAV file.  The session is stored in [`voice_db`] with
//! status `"recording"`.  Only one active recording is allowed at a time;
//! the running session is tracked in a process-wide
//! `OnceLock<Mutex<Option<MeetingRecording>>>`.
//!
//! # Transcription
//! [`meeting_stop`] kills ffmpeg, updates the session status to `"processing"`,
//! and spawns a background thread that resamples the WAV to 16 kHz and runs
//! Whisper via [`SharedWhisperEngine`].  Segments are written to the DB as they
//! arrive and emitted to the frontend as `meeting-transcript-segment` events.
//! On completion the status becomes `"complete"` and a
//! `meeting-transcription-complete` event is emitted.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use serde::Serialize;
use tauri::{Emitter, Manager};
use serde_json::json;

use crate::recorder::ffmpeg_path;
use crate::voice_db;
use crate::voice_db::{VoiceSession, TranscriptSegment, SessionNotes};
use crate::llm_config;

pub struct MeetingRecording {
    pub session_id: String,
    pub wav_path: PathBuf,
    pub process: Child,
    pub started_at: std::time::Instant,
}

// Singleton mutex for the in-progress meeting. OnceLock initializes it once; the inner
// Option<MeetingRecording> is None when idle and Some(...) while recording.
static ACTIVE_MEETING: OnceLock<Mutex<Option<MeetingRecording>>> = OnceLock::new();

fn get_active() -> &'static Mutex<Option<MeetingRecording>> {
    ACTIVE_MEETING.get_or_init(|| Mutex::new(None))
}

/// Lock the active-meeting slot, recovering from a poisoned mutex. A panic mid
/// operation poisons the lock; recovering the inner value lets later callers
/// proceed rather than cascading the panic.
fn active() -> std::sync::MutexGuard<'static, Option<MeetingRecording>> {
    get_active().lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Serialize)]
pub struct MeetingStartResult {
    pub session_id: String,
}

#[derive(Serialize)]
pub struct MeetingDetail {
    pub session: VoiceSession,
    pub segments: Vec<TranscriptSegment>,
    pub notes: Option<SessionNotes>,
}

#[tauri::command]
pub fn meeting_start(app: tauri::AppHandle, title: String) -> Result<MeetingStartResult, String> {
    let mut guard = active();
    if guard.is_some() {
        return Err("a meeting recording is already active".into());
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let wav_path = voice_db::voice_dir().join(format!("{session_id}.wav"));

    let ffmpeg = ffmpeg_path(&app);
    let process = Command::new(&ffmpeg)
        .args([
            "-f", "avfoundation",
            "-i", ":0",
            "-ar", "16000",
            "-ac", "1",
            "-y",
            wav_path.to_str().ok_or("invalid wav path")?,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit()) // surface permission/codec errors in logs
        .spawn()
        .map_err(|e| format!("spawn ffmpeg for meeting: {e}"))?;

    voice_db::create_session(&session_id, &title, "meeting")?;

    *guard = Some(MeetingRecording {
        session_id: session_id.clone(),
        wav_path,
        process,
        started_at: std::time::Instant::now(),
    });

    Ok(MeetingStartResult { session_id })
}

#[tauri::command]
pub fn meeting_stop(app: tauri::AppHandle) -> Result<String, String> {
    let mut guard = active();
    let recording = guard.take().ok_or("no active meeting recording")?;

    let MeetingRecording { session_id, wav_path, process: mut proc, started_at } = recording;
    let elapsed = started_at.elapsed();

    // Close stdin → FFmpeg sees EOF and finalizes the WAV header
    // Then wait for FFmpeg to exit (reaps the zombie, no sleep needed)
    if let Some(stdin) = proc.stdin.take() {
        drop(stdin); // explicit stdin close triggers FFmpeg shutdown
    }
    let _ = proc.wait(); // block until FFmpeg exits (usually < 200ms)

    let ended_at = chrono::Utc::now().timestamp_millis();
    let duration_sec = elapsed.as_secs() as i64;

    // Finish session in DB BEFORE spawning background thread so DB is
    // consistent before meeting_stop returns to the frontend.
    voice_db::finish_session(&session_id, ended_at, duration_sec)?;

    let session_id_clone = session_id.clone();
    std::thread::spawn(move || {
        transcribe_meeting_audio(app, session_id_clone, wav_path);
    });

    Ok(session_id)
}

#[tauri::command]
pub fn meeting_get_elapsed() -> Result<u64, String> {
    let guard = active();
    match guard.as_ref() {
        None => Err("no active meeting recording".into()),
        Some(r) => Ok(r.started_at.elapsed().as_secs()),
    }
}

#[tauri::command]
pub fn meeting_save_notes(session_id: String, notes: String) -> Result<(), String> {
    voice_db::upsert_notes(&session_id, Some(&notes))
}

#[tauri::command]
pub fn meeting_list() -> Result<Vec<VoiceSession>, String> {
    voice_db::list_sessions()
}

#[tauri::command]
pub fn meeting_get(session_id: String) -> Result<MeetingDetail, String> {
    let session = voice_db::get_session(&session_id)?
        .ok_or_else(|| format!("session not found: {session_id}"))?;
    let segments = voice_db::get_segments(&session_id)?;
    let notes = voice_db::get_notes(&session_id)?;
    Ok(MeetingDetail { session, segments, notes })
}

#[tauri::command]
pub fn meeting_delete(session_id: String) -> Result<(), String> {
    // Refuse to delete a session that is currently being recorded.
    let guard = active();
    if guard.as_ref().map_or(false, |r| r.session_id == session_id) {
        return Err("cannot delete a session that is currently recording".into());
    }
    drop(guard);

    voice_db::delete_session(&session_id)?;

    // Best-effort removal of the raw WAV. This is the common case for the delete
    // action: a session stuck in "recording" (app crashed mid-record) still has
    // its large WAV on disk. A missing file is fine — a transcribed session has
    // already had its WAV removed.
    let wav_path = voice_db::voice_dir().join(format!("{session_id}.wav"));
    if let Err(e) = std::fs::remove_file(&wav_path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            eprintln!("[meeting] failed to delete WAV for {session_id}: {e}");
        }
    }
    Ok(())
}

#[tauri::command]
pub fn meeting_search(query: String) -> Result<Vec<VoiceSession>, String> {
    if query.is_empty() {
        return voice_db::list_sessions();
    }
    let ids = voice_db::search_sessions(&query)?;
    let mut sessions = Vec::new();
    for id in ids {
        if let Some(s) = voice_db::get_session(&id)? {
            sessions.push(s);
        }
    }
    Ok(sessions)
}

fn transcribe_meeting_audio(
    app: tauri::AppHandle,
    session_id: String,
    wav_path: PathBuf,
) {
    let result = run_transcription(&app, &session_id, &wav_path);

    // Always delete the WAV — it's no longer needed whether we succeeded or not.
    // WAV files are large (~115 MB/hr) and orphaned files fill disk fast.
    if let Err(e) = std::fs::remove_file(&wav_path) {
        eprintln!("[meeting] failed to delete WAV after transcription: {e}");
    }

    // Single owner of the terminal state transition + event, so success and
    // failure can't drift apart.
    match result {
        Ok(()) => {
            let _ = voice_db::complete_session(&session_id);
            let _ = app.emit("meeting-transcription-complete", json!({"session_id": &session_id}));
        }
        Err(e) => {
            eprintln!("[meeting] transcription failed: {e}");
            let _ = voice_db::update_session_status(&session_id, "error");
            let _ = app.emit(
                "meeting-transcription-error",
                json!({"session_id": &session_id, "error": e}),
            );
        }
    }
}

/// Inner transcription logic. Returns `Err` on any fatal error; the caller owns
/// the resulting DB status update, the completion/error event, and WAV cleanup.
fn run_transcription(
    app: &tauri::AppHandle,
    session_id: &str,
    wav_path: &Path,
) -> Result<(), String> {
    let ffmpeg = ffmpeg_path(app);
    let wav_str = wav_path.to_str().ok_or("invalid WAV path (non-UTF-8)")?;

    let decode_output = Command::new(&ffmpeg)
        .args(["-i", wav_str, "-f", "f32le", "-ar", "16000", "-ac", "1", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("ffmpeg decode failed: {e}"))?;

    let samples: Vec<f32> = decode_output
        .stdout
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();

    if samples.is_empty() {
        // Nothing to transcribe — an empty meeting still completes successfully.
        return Ok(());
    }

    let engine_state = app
        .try_state::<crate::transcription::SharedWhisperEngine>()
        .ok_or("Whisper engine not available (model failed to load)")?;

    const CHUNK_SAMPLES: usize = 480_000; // 30s × 16 000 samples/s
    let ms_per_sample = 1000.0_f64 / 16000.0_f64;

    for (chunk_idx, chunk) in samples.chunks(CHUNK_SAMPLES).enumerate() {
        let offset = chunk_idx * CHUNK_SAMPLES;
        let start_ms = (offset as f64 * ms_per_sample) as i64;
        let end_ms = ((offset + chunk.len()) as f64 * ms_per_sample) as i64;

        let text_result = {
            let eng = engine_state.0.lock().unwrap_or_else(|e| e.into_inner());
            eng.transcribe(chunk)
        };
        match text_result {
            Ok(text) if !text.trim().is_empty() => {
                let text = text.trim().to_string();
                if let Err(e) = voice_db::insert_segment(session_id, &text, start_ms, end_ms) {
                    eprintln!("[meeting] insert_segment error: {e}");
                }
                let _ = app.emit(
                    "meeting-transcript-segment",
                    json!({"session_id": session_id, "text": text, "start_ms": start_ms, "end_ms": end_ms}),
                );
            }
            Ok(_) => {}
            // A per-chunk transcription error is non-fatal — log and keep going.
            Err(e) => eprintln!("[meeting] transcription error at chunk {chunk_idx}: {e}"),
        }
    }

    Ok(())
}

// ── Claude API summary generation ────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
struct SummaryOutput {
    summary: String,
    action_items: String,
    decisions: String,
}

#[tauri::command]
pub fn meeting_generate_summary(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    let segments = voice_db::get_segments(&session_id)?;
    if segments.is_empty() {
        return Err("No transcript available".into());
    }
    let notes = voice_db::get_notes(&session_id)?;

    let sid = session_id;
    let config = llm_config::load_config();
    let api_key = llm_config::get_api_key(&config)?;

    tauri::async_runtime::spawn(async move {
        match generate_summary_inner(&config, &segments, &notes, &api_key).await {
            Ok((summary, action_items, decisions)) => {
                match voice_db::update_ai_output(&sid, &summary, &action_items, &decisions) {
                    Ok(_) => {
                        let _ = app.emit("meeting-summary-ready", json!({
                            "session_id": &sid, "summary": summary, "action_items": action_items, "decisions": decisions
                        }));
                    }
                    Err(e) => {
                        // Persist failed — try upsert_notes first to create the row, then retry
                        let _ = voice_db::upsert_notes(&sid, None);
                        match voice_db::update_ai_output(&sid, &summary, &action_items, &decisions) {
                            Ok(_) => {
                                let _ = app.emit("meeting-summary-ready", json!({
                                    "session_id": &sid, "summary": summary, "action_items": action_items, "decisions": decisions
                                }));
                            }
                            Err(e2) => {
                                eprintln!("[meeting] update_ai_output failed twice: {e} / {e2}");
                                let _ = app.emit("meeting-summary-error", json!({
                                    "session_id": &sid, "error": format!("Failed to save summary: {e2}")
                                }));
                            }
                        }
                    }
                }
            }
            Err(e) => {
                let _ = app.emit(
                    "meeting-summary-error",
                    json!({"session_id": &sid, "error": e}),
                );
            }
        }
    });

    Ok(())
}

async fn generate_summary_inner(
    config: &llm_config::LlmConfig,
    segments: &[voice_db::TranscriptSegment],
    notes: &Option<voice_db::SessionNotes>,
    api_key: &str,
) -> Result<(String, String, String), String> {
    let transcript = segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    let raw_notes = notes
        .as_ref()
        .and_then(|n| n.raw_notes.as_deref())
        .unwrap_or("");

    let system_prompt = "You are a meeting assistant. Analyze the transcript and notes provided, \
        then return ONLY a JSON object with no other text. \
        The JSON object must have exactly three fields: \
        \"summary\" (a 3-5 sentence executive summary), \
        \"action_items\" (newline-separated list prefixed with \"- \"), \
        \"decisions\" (newline-separated list prefixed with \"- \"). \
        Do not invent facts. If there are no action items or decisions, use an empty string. \
        Return ONLY the JSON object, no markdown, no explanation.";

    let user_message = format!("TRANSCRIPT:\n{transcript}\n\nNOTES:\n{raw_notes}");

    let text = llm_config::call_llm(config, api_key, Some(system_prompt), &user_message, 2048).await?;

    // Extract JSON from response — model may wrap in ```json...```
    let start = text.find('{').ok_or("no JSON object in LLM response")?;
    let end = text.rfind('}').ok_or("no closing brace in LLM response")?;
    let json_str = &text[start..=end];

    let output: SummaryOutput = serde_json::from_str(json_str)
        .map_err(|e| format!("failed to parse summary JSON: {e}\nraw: {json_str}"))?;

    Ok((output.summary, output.action_items, output.decisions))
}
