use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use serde::Serialize;
use tauri::{Emitter, Manager};
use serde_json::json;

use crate::recorder::ffmpeg_path;
use crate::voice_db;
use crate::voice_db::{VoiceSession, TranscriptSegment, SessionNotes};

pub struct MeetingRecording {
    pub session_id: String,
    pub wav_path: PathBuf,
    pub process: Child,
    pub started_at: std::time::Instant,
}

static ACTIVE_MEETING: OnceLock<Mutex<Option<MeetingRecording>>> = OnceLock::new();

fn get_active() -> &'static Mutex<Option<MeetingRecording>> {
    ACTIVE_MEETING.get_or_init(|| Mutex::new(None))
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
    let mut guard = get_active().lock().unwrap();
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
        .stderr(Stdio::null())
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
    let mut guard = get_active().lock().unwrap();
    let recording = guard.take().ok_or("no active meeting recording")?;

    let session_id = recording.session_id.clone();
    let wav_path = recording.wav_path.clone();
    let elapsed = recording.started_at.elapsed();

    // Drop the process — closes stdin → FFmpeg sees EOF → finalizes WAV
    drop(recording);

    // Let FFmpeg finalize the WAV header
    std::thread::sleep(std::time::Duration::from_millis(500));

    let ended_at = chrono::Utc::now().timestamp_millis();
    let duration_sec = elapsed.as_secs() as i64;

    voice_db::finish_session(&session_id, ended_at, duration_sec)?;

    let model_path = app
        .path()
        .resource_dir()
        .map(|p| p.join("resources/ggml-small.en-q8_0.bin"))
        .unwrap_or_else(|_| PathBuf::from("src-tauri/resources/ggml-small.en-q8_0.bin"));

    let session_id_clone = session_id.clone();
    std::thread::spawn(move || {
        transcribe_meeting_audio(app, session_id_clone, wav_path, model_path);
    });

    Ok(session_id)
}

#[tauri::command]
pub fn meeting_get_elapsed() -> Result<u64, String> {
    let guard = get_active().lock().unwrap();
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
    model_path: PathBuf,
) {
    // Decode WAV to raw f32le at 16kHz mono via FFmpeg
    let ffmpeg = ffmpeg_path(&app);

    let decode_output = match Command::new(&ffmpeg)
        .args([
            "-i",
            wav_path.to_str().unwrap_or(""),
            "-f", "f32le",
            "-ar", "16000",
            "-ac", "1",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[meeting] ffmpeg decode failed: {e}");
            let _ = app.emit("meeting-transcription-error", json!({"session_id": session_id, "error": e.to_string()}));
            let _ = voice_db::update_session_status(&session_id, "error");
            return;
        }
    };

    let bytes = decode_output.stdout;
    // Convert raw bytes to f32 samples (4 bytes each, little-endian)
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();

    if samples.is_empty() {
        let _ = voice_db::complete_session(&session_id);
        let _ = app.emit("meeting-transcription-complete", json!({"session_id": session_id}));
        return;
    }

    // Load Whisper model
    let engine = match crate::transcription::WhisperEngine::new(&model_path) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[meeting] failed to load whisper model: {e}");
            let _ = app.emit("meeting-transcription-error", json!({"session_id": session_id, "error": e.to_string()}));
            let _ = voice_db::update_session_status(&session_id, "error");
            return;
        }
    };

    // Chunk into 30-second segments (30s × 16000 samples/s)
    const CHUNK_SAMPLES: usize = 480_000;
    let ms_per_sample = 1000.0_f64 / 16000.0_f64;

    for (chunk_idx, chunk) in samples.chunks(CHUNK_SAMPLES).enumerate() {
        let offset = chunk_idx * CHUNK_SAMPLES;
        let start_ms = (offset as f64 * ms_per_sample) as i64;
        let end_ms = ((offset + chunk.len()) as f64 * ms_per_sample) as i64;

        match engine.transcribe(chunk) {
            Ok(text) if !text.trim().is_empty() => {
                let text = text.trim().to_string();
                if let Err(e) = voice_db::insert_segment(&session_id, &text, start_ms, end_ms) {
                    eprintln!("[meeting] insert_segment error: {e}");
                }
                let _ = app.emit(
                    "meeting-transcript-segment",
                    json!({
                        "session_id": session_id,
                        "text": text,
                        "start_ms": start_ms,
                        "end_ms": end_ms,
                    }),
                );
            }
            Ok(_) => {
                // Empty transcription for this chunk — skip
            }
            Err(e) => {
                eprintln!("[meeting] transcription error at chunk {chunk_idx}: {e}");
            }
        }
    }

    let _ = voice_db::complete_session(&session_id);
    let _ = app.emit("meeting-transcription-complete", json!({"session_id": session_id}));
}
