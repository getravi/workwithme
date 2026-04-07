use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use serde::{Deserialize, Serialize};
use screenshots::Screen as ScreenInfo;

pub struct RecordingSession {
    pub id: String,
    pub raw_path: String,
    pub process: Child,
    pub started_at: std::time::Instant,
}

static ACTIVE_RECORDING: OnceLock<Mutex<Option<RecordingSession>>> = OnceLock::new();

fn get_active() -> &'static Mutex<Option<RecordingSession>> {
    ACTIVE_RECORDING.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
pub struct MicDevice {
    pub index: u32,
    pub name: String,
}

pub fn ffmpeg_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .map(|p| p.join("ffmpeg"))
        .unwrap_or_else(|_| PathBuf::from("ffmpeg"))
}

#[tauri::command]
pub fn recording_list_mics(app: tauri::AppHandle) -> Result<Vec<MicDevice>, String> {
    let ffmpeg = ffmpeg_path(&app);
    let output = Command::new(&ffmpeg)
        .args(["-f", "avfoundation", "-list_devices", "true", "-i", ""])
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .output()
        .map_err(|e| format!("ffmpeg not found: {e}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(parse_audio_devices(&stderr))
}

fn parse_audio_devices(output: &str) -> Vec<MicDevice> {
    let mut devices = Vec::new();
    let mut in_audio = false;
    for line in output.lines() {
        if line.contains("AVFoundation audio devices") {
            in_audio = true;
            continue;
        }
        if !in_audio {
            continue;
        }
        // Lines look like: [AVFoundation indev @ 0x...] [0] Built-in Microphone
        if let Some(bracket) = line.rfind('[') {
            let tail = &line[bracket + 1..];
            if let Some(end) = tail.find(']') {
                let idx_str = &tail[..end];
                if let Ok(index) = idx_str.parse::<u32>() {
                    let name = tail[end + 1..].trim().to_string();
                    if !name.is_empty() {
                        devices.push(MicDevice { index, name });
                    }
                }
            }
        }
    }
    devices
}

/// Returns the avfoundation video device index for the first "Capture screen" device,
/// or "1" as the default fallback.
pub fn find_screen_device_index(output: &str) -> String {
    let mut in_video = false;
    for line in output.lines() {
        if line.contains("AVFoundation video devices") {
            in_video = true;
            continue;
        }
        if in_video && line.contains("AVFoundation audio devices") {
            break;
        }
        if in_video && line.to_lowercase().contains("capture screen") {
            if let Some(bracket) = line.rfind('[') {
                let tail = &line[bracket + 1..];
                if let Some(end) = tail.find(']') {
                    let idx_str = &tail[..end];
                    if idx_str.parse::<u32>().is_ok() {
                        return idx_str.to_string();
                    }
                }
            }
        }
    }
    "1".to_string()
}

#[tauri::command]
pub fn recording_start(
    app: tauri::AppHandle,
    region: Option<Rect>,
    mic_device_index: Option<u32>,
) -> Result<String, String> {
    let ffmpeg = ffmpeg_path(&app);

    // List devices to find screen index
    let list_output = Command::new(&ffmpeg)
        .args(["-f", "avfoundation", "-list_devices", "true", "-i", ""])
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .output()
        .map_err(|e| format!("ffmpeg error listing devices: {e}"))?;
    let list_stderr = String::from_utf8_lossy(&list_output.stderr);
    let screen_idx = find_screen_device_index(&list_stderr);

    let session_id = uuid::Uuid::new_v4().to_string();
    let raw_path = std::env::temp_dir()
        .join(format!("workwithme-rec-{session_id}.mp4"))
        .to_string_lossy()
        .to_string();

    // Build ffmpeg args
    let mut args: Vec<String> = vec![
        "-f".into(),
        "avfoundation".into(),
        "-capture_cursor".into(),
        "1".into(),
        "-capture_mouse_clicks".into(),
        "1".into(),
        "-framerate".into(),
        "30".into(),
    ];

    // Input: "video_idx:audio_idx" or just "video_idx"
    let input = match mic_device_index {
        Some(mic_idx) => format!("{screen_idx}:{mic_idx}"),
        None => screen_idx.clone(),
    };
    args.extend(["-i".into(), input]);

    // Video codec
    args.extend([
        "-vcodec".into(),
        "libx264".into(),
        "-preset".into(),
        "ultrafast".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
    ]);

    // Optional crop for region recording
    if let Some(ref r) = region {
        args.extend([
            "-vf".into(),
            format!("crop={}:{}:{}:{}", r.width, r.height, r.x, r.y),
        ]);
    }

    // Audio codec (only if mic selected)
    if mic_device_index.is_some() {
        args.extend(["-acodec".into(), "aac".into(), "-b:a".into(), "128k".into()]);
    }

    args.push(raw_path.clone());

    let process = Command::new(&ffmpeg)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn ffmpeg: {e}"))?;

    // Replace any existing session
    let mut guard = get_active().lock().unwrap();
    if let Some(mut existing) = guard.take() {
        if let Some(stdin) = existing.process.stdin.as_mut() {
            let _ = stdin.write_all(b"q\n");
        }
        let _ = existing.process.wait();
    }
    *guard = Some(RecordingSession {
        id: session_id.clone(),
        raw_path,
        process,
        started_at: std::time::Instant::now(),
    });

    Ok(session_id)
}

#[tauri::command]
pub fn recording_stop(session_id: String) -> Result<String, String> {
    let mut guard = get_active().lock().unwrap();
    match guard.as_ref().map(|s| s.id.as_str()) {
        None => return Err("no active recording".into()),
        Some(id) if id != session_id => {
            return Err(format!("session_id mismatch: active={id}"))
        }
        _ => {}
    }
    let mut session = guard.take().unwrap();
    let raw_path = session.raw_path.clone();

    // Send 'q' to stdin so FFmpeg flushes and finalizes the MP4
    if let Some(stdin) = session.process.stdin.as_mut() {
        let _ = stdin.write_all(b"q\n");
    }
    let _ = session.process.wait();

    Ok(raw_path)
}

#[tauri::command]
pub fn recording_get_elapsed(session_id: String) -> Result<u64, String> {
    let guard = get_active().lock().unwrap();
    match guard.as_ref() {
        None => Err("no active recording".into()),
        Some(s) if s.id != session_id => Err("session_id mismatch".into()),
        Some(s) => Ok(s.started_at.elapsed().as_millis() as u64),
    }
}

/// Returns the current active session ID, or None if not recording.
/// Called by the pill window on mount to retrieve the session_id it needs.
#[tauri::command]
pub fn recording_get_current_session() -> Result<Option<String>, String> {
    Ok(get_active().lock().unwrap().as_ref().map(|s| s.id.clone()))
}
