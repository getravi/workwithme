use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use serde::{Deserialize, Serialize};
use tauri::Manager;

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

#[tauri::command]
pub fn recording_get_duration(app: tauri::AppHandle, path: String) -> Result<u64, String> {
    let ffmpeg = ffmpeg_path(&app);
    let output = Command::new(&ffmpeg)
        .args(["-i", &path])
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .output()
        .map_err(|e| format!("ffmpeg error: {e}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_duration_from_output(&stderr)
}

fn parse_duration_from_output(output: &str) -> Result<u64, String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Duration:") {
            // "Duration: HH:MM:SS.ss, ..."
            let after_colon = trimmed.trim_start_matches("Duration:").trim();
            let dur_str = after_colon.split(',').next().unwrap_or("").trim();
            return parse_duration_str(dur_str);
        }
    }
    Err("Duration not found in ffmpeg output".into())
}

fn parse_duration_str(s: &str) -> Result<u64, String> {
    // "HH:MM:SS.ss"
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 3 {
        return Err(format!("unexpected duration format: {s}"));
    }
    let h: u64 = parts[0].parse().map_err(|_| format!("parse hours: {}", parts[0]))?;
    let m: u64 = parts[1].parse().map_err(|_| format!("parse minutes: {}", parts[1]))?;
    let sec_frac: Vec<&str> = parts[2].split('.').collect();
    let sec: u64 = sec_frac[0].parse().map_err(|_| format!("parse seconds: {}", sec_frac[0]))?;
    let ms: u64 = if sec_frac.len() > 1 {
        let frac = sec_frac[1];
        let v: u64 = frac.parse().unwrap_or(0);
        match frac.len() {
            1 => v * 100,
            2 => v * 10,
            _ => v,
        }
    } else {
        0
    };
    Ok(h * 3_600_000 + m * 60_000 + sec * 1_000 + ms)
}

#[tauri::command]
pub fn recording_export(
    app: tauri::AppHandle,
    input: String,
    output: String,
    start_ms: u64,
    end_ms: u64,
) -> Result<(), String> {
    let ffmpeg = ffmpeg_path(&app);
    let start_s = format!("{:.3}", start_ms as f64 / 1000.0);
    let end_s = format!("{:.3}", end_ms as f64 / 1000.0);
    let status = Command::new(&ffmpeg)
        .args([
            "-ss", &start_s,
            "-i", &input,
            "-to", &end_s,
            "-c", "copy",
            "-y",
            &output,
        ])
        .status()
        .map_err(|e| format!("ffmpeg export error: {e}"))?;
    if !status.success() {
        return Err(format!("ffmpeg export failed: {status}"));
    }
    Ok(())
}

#[tauri::command]
pub fn recording_extract_thumbnail(app: tauri::AppHandle, path: String) -> Result<String, String> {
    use base64::Engine;
    let ffmpeg = ffmpeg_path(&app);
    let output = Command::new(&ffmpeg)
        .args([
            "-i", &path,
            "-vframes", "1",
            "-f", "image2pipe",
            "-vcodec", "png",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("ffmpeg thumbnail error: {e}"))?;
    if output.stdout.is_empty() {
        return Err("empty thumbnail output from ffmpeg".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&output.stdout))
}

static PENDING_TRIM_PATH: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn get_pending_trim() -> &'static Mutex<Option<String>> {
    PENDING_TRIM_PATH.get_or_init(|| Mutex::new(None))
}

/// Opens the region-selection overlay for recording (transparent fullscreen canvas).
#[tauri::command]
pub fn open_region_select_recording(app: tauri::AppHandle) -> Result<(), String> {
    let screens = screenshots::Screen::all().unwrap_or_default();
    let (min_x, min_y, max_x, max_y) = screen_bounds(&screens);
    tauri::WebviewWindowBuilder::new(
        &app,
        "region-select-recording",
        tauri::WebviewUrl::App("region-select-recording.html".into()),
    )
    .inner_size((max_x - min_x) as f64, (max_y - min_y) as f64)
    .position(min_x as f64, min_y as f64)
    .transparent(true)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .focused(true)
    .resizable(false)
    .build()
    .map(|_| ())
    .map_err(|e| format!("open region-select-recording: {e}"))
}

/// Opens the recording pill. The pill calls `recording_get_current_session` on mount.
#[tauri::command]
pub fn open_recording_pill(app: tauri::AppHandle) -> Result<(), String> {
    // Close any existing pill first
    if let Some(w) = app.get_webview_window("recording-pill") {
        let _ = w.close();
    }
    let pill = tauri::WebviewWindowBuilder::new(
        &app,
        "recording-pill",
        tauri::WebviewUrl::App("recording-pill.html".into()),
    )
    .inner_size(180.0, 44.0)
    .always_on_top(true)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .resizable(false)
    .build()
    .map_err(|e| format!("open recording-pill: {e}"))?;

    // Position bottom-center of primary monitor
    if let Ok(Some(monitor)) = pill.primary_monitor() {
        let sf = monitor.scale_factor();
        let mw = monitor.size().width as f64 / sf;
        let mh = monitor.size().height as f64 / sf;
        let _ = pill.set_position(tauri::LogicalPosition::new(mw / 2.0 - 90.0, mh - 90.0));
    }
    Ok(())
}

/// Opens the trim editor. Stores the raw_path so the editor can call `recording_get_trim_path`.
#[tauri::command]
pub fn open_trim_editor(app: tauri::AppHandle, raw_path: String) -> Result<(), String> {
    *get_pending_trim().lock().unwrap() = Some(raw_path);
    tauri::WebviewWindowBuilder::new(
        &app,
        "trim-editor",
        tauri::WebviewUrl::App("trim-editor.html".into()),
    )
    .inner_size(900.0, 600.0)
    .decorations(true)
    .resizable(true)
    .title("Trim Recording")
    .build()
    .map(|_| ())
    .map_err(|e| format!("open trim-editor: {e}"))
}

/// Called by the trim editor on mount to retrieve the raw MP4 path.
#[tauri::command]
pub fn recording_get_trim_path() -> Result<Option<String>, String> {
    Ok(get_pending_trim().lock().unwrap().take())
}

fn screen_bounds(screens: &[screenshots::Screen]) -> (i32, i32, i32, i32) {
    if screens.is_empty() {
        return (0, 0, 1920, 1080);
    }
    let min_x = screens.iter().map(|s| s.display_info.x).min().unwrap_or(0);
    let min_y = screens.iter().map(|s| s.display_info.y).min().unwrap_or(0);
    let max_x = screens
        .iter()
        .map(|s| {
            s.display_info.x
                + (s.display_info.width as f64 / s.display_info.scale_factor as f64) as i32
        })
        .max()
        .unwrap_or(1920);
    let max_y = screens
        .iter()
        .map(|s| {
            s.display_info.y
                + (s.display_info.height as f64 / s.display_info.scale_factor as f64) as i32
        })
        .max()
        .unwrap_or(1080);
    (min_x, min_y, max_x, max_y)
}
