use std::path::PathBuf;
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
) {
    // Decode WAV to raw f32le at 16kHz mono via FFmpeg
    let ffmpeg = ffmpeg_path(&app);

    let wav_str = match wav_path.to_str() {
        Some(s) => s,
        None => {
            eprintln!("[meeting] transcribe: invalid WAV path (non-UTF-8)");
            let _ = voice_db::update_session_status(&session_id, "error");
            let _ = app.emit("meeting-transcription-error", &session_id);
            return;
        }
    };

    let decode_output = match Command::new(&ffmpeg)
        .args([
            "-i",
            wav_str,
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

    // Get the shared Whisper engine from Tauri managed state
    let engine_state = match app.try_state::<crate::transcription::SharedWhisperEngine>() {
        Some(s) => s,
        None => {
            eprintln!("[meeting] Whisper engine not available (model failed to load)");
            let _ = voice_db::update_session_status(&session_id, "error");
            let _ = app.emit("meeting-transcription-error", json!({"session_id": &session_id, "error": "WhisperEngine not available"}));
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

        let text_result = {
            let eng = engine_state.0.lock().unwrap_or_else(|e| e.into_inner());
            eng.transcribe(chunk)
        };
        match text_result {
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

// ── Claude API summary generation ────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContent>,
}

#[derive(Debug, serde::Deserialize)]
struct ClaudeContent {
    text: String,
}

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

    let session_id_clone = session_id.clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let sid = session_id_clone;
        let config = llm_config::load_config();
        let api_key = match llm_config::get_api_key(&config) {
            Ok(k) => k,
            Err(e) => {
                let _ = app.emit("meeting-summary-error", json!({"session_id": &sid, "error": e}));
                return;
            }
        };
        match rt.block_on(async {
            generate_summary_inner(&sid, &segments, &notes, &api_key).await
        }) {
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
    _session_id: &str,
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

    let prompt = format!(
        "You are a meeting assistant. Analyze the following meeting transcript and notes, then return ONLY a JSON object with no other text.\n\n\
         The JSON object must have exactly three fields:\n\
         - \"summary\": a 3-5 sentence executive summary of the meeting\n\
         - \"action_items\": a newline-separated list of action items, each prefixed with \"- \"\n\
         - \"decisions\": a newline-separated list of decisions made, each prefixed with \"- \"\n\n\
         Do not invent facts not present in the transcript. If there are no action items or decisions, use an empty string for that field.\n\n\
         TRANSCRIPT:\n{transcript}\n\nNOTES:\n{raw_notes}\n\n\
         Return ONLY the JSON object, no markdown, no explanation.",
        transcript = transcript,
        raw_notes = raw_notes,
    );

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": "claude-sonnet-4-6",
        "max_tokens": 2048,
        "messages": [{"role": "user", "content": prompt}]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude API request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Claude API error {status}: {text}"));
    }

    let claude_resp: ClaudeResponse = response
        .json()
        .await
        .map_err(|e| format!("failed to parse Claude response: {e}"))?;

    let text = claude_resp
        .content
        .into_iter()
        .next()
        .map(|c| c.text)
        .ok_or_else(|| "Claude returned empty content".to_string())?;

    // Extract JSON from response — Claude may wrap in ```json...```
    let start = text.find('{').ok_or("no JSON object in Claude response")?;
    let end = text.rfind('}').ok_or("no closing brace in Claude response")?;
    let json_str = &text[start..=end];

    let output: SummaryOutput = serde_json::from_str(json_str)
        .map_err(|e| format!("failed to parse summary JSON: {e}\nraw: {json_str}"))?;

    Ok((output.summary, output.action_items, output.decisions))
}
