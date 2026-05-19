//! Tauri application library — sets up the app, registers commands, manages the tray icon,
//! and wires up the global keyboard shortcuts for voice dictation and capture actions.
//!
//! # Module layout
//! - [`server`] — Axum HTTP server (skills, sessions, files, MCP, OAuth, …)
//! - [`audio`] — cpal microphone capture
//! - [`transcription`] — Whisper VAD + inference pipeline
//! - [`capture`] — screenshot capture via the `screenshots` crate
//! - [`library`] — SQLite capture library with FTS5 and OCR indexing
//! - [`recorder`] — FFmpeg screen/audio recording
//! - [`voice_db`] — SQLite voice-note store
//! - [`meeting`] — meeting recorder sessions
//! - [`llm_config`] — LLM provider config, API-key keychain helpers, HTTP call helpers
//! - [`voice_shortcuts`] — global keyboard shortcut configuration + persistence

mod server;
mod audio;
mod transcription;
mod capture;
mod library;
mod recorder;
mod voice_db;
mod meeting;
mod llm_config;
mod voice_shortcuts;
#[cfg(target_os = "macos")]
mod window_capture;

// Tray icons embedded at compile time — avoids resource_dir() path issues in dev and production.
const TRAY_MIC: &[u8] = include_bytes!("../icons/tray-mic.png");
const TRAY_MIC_RED: [&[u8]; 3] = [
    include_bytes!("../icons/tray-mic-red-0.png"),
    include_bytes!("../icons/tray-mic-red-1.png"),
    include_bytes!("../icons/tray-mic-red-2.png"),
];

use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Shared state for the dictation session.
struct DictationState {
    detector: transcription::SilenceDetector,
    is_recording: bool,
    /// true = in-app mic button; false = global hotkey
    in_app_mode: bool,
    /// emit_event=true → send Tauri event to frontend; false → type into active window
    chunk_tx: std::sync::mpsc::SyncSender<(Vec<f32>, u32, bool)>,
}

/// Exposed to Tauri command handlers so the in-app mic button can drive the same pipeline.
struct InAppDictationState {
    dictation: Arc<Mutex<DictationState>>,
    recorder: Arc<Mutex<audio::AudioRecorder>>,
    recording_flag: Arc<AtomicBool>,
}

/// Returns true if the Whisper model loaded successfully at startup.
/// When false, voice dictation and meeting transcription are unavailable.
#[tauri::command]
fn whisper_model_available(app: tauri::AppHandle) -> bool {
    app.try_state::<transcription::SharedWhisperEngine>().is_some()
}

/// Expose the HTTP server auth token to the Tauri webview.
/// The token is required as `Authorization: Bearer <token>` on sensitive REST endpoints
/// (keychain, clipboard/paste, file browser).  Only the in-process webview can call this.
#[tauri::command]
fn get_server_token() -> String {
    server::server_token().to_string()
}

/// Toggle recording for the in-app mic button.
/// Uses the same audio pipeline as the global hotkey but routes the transcript
/// back to the frontend via a "dictation-result" Tauri event instead of typing it.
#[tauri::command]
fn toggle_in_app_dictation(
    state: tauri::State<InAppDictationState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let is_recording = state.dictation.lock().expect("mutex poisoned: dictation state").is_recording;

    if !is_recording {
        // ── Start recording ────────────────────────────────────────────────
        let native_rate = {
            let mut rec = state.recorder.lock().expect("mutex poisoned: audio recorder");
            rec.start().map_err(|e| format!("mic error: {e}"))?;
            rec.native_sample_rate
        };
        let mut d = state.dictation.lock().expect("mutex poisoned: dictation state");
        d.detector = transcription::SilenceDetector::new(native_rate, 0.01, 300, 300, 10000);
        d.is_recording = true;
        d.in_app_mode = true;
        state.recording_flag.store(true, Ordering::Relaxed);
        set_tray_recording(&app, true);
        show_overlay_listening(&app);
    } else {
        // ── Stop recording + queue transcription ───────────────────────────
        let mut d = state.dictation.lock().expect("mutex poisoned: dictation state");
        // Only the same source that started recording may stop it.
        // If in_app_mode=false, the global hotkey owns this recording;
        // the in-app button must not interfere.
        if !d.in_app_mode {
            return Ok(());
        }
        let (remaining, native_rate) = {
            let rec = state.recorder.lock().expect("mutex poisoned: audio recorder");
            (rec.drain(), rec.native_sample_rate)
        };
        let chunk_to_send = d.detector.push(&remaining).or_else(|| d.detector.flush());
        d.is_recording = false;
        state.recording_flag.store(false, Ordering::Relaxed);
        let chunk_tx = d.chunk_tx.clone();
        drop(d);
        state.recorder.lock().expect("mutex poisoned: audio recorder").stop();
        set_tray_recording(&app, false);

        if let Some(chunk) = chunk_to_send {
            show_overlay_transcribing(&app);
            // emit_event=true: result goes back to frontend, not typed into active window
            if chunk_tx.send((chunk, native_rate, true)).is_err() {
                if let Some(w) = app.get_webview_window("transcribing") {
                    let _ = w.hide();
                }
            }
        } else {
            // Nothing to transcribe; hide the listening overlay
            if let Some(w) = app.get_webview_window("transcribing") {
                let _ = w.hide();
            }
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Channel: (samples, native_rate, emit_event) → transcription worker thread
    // emit_event=true → Tauri event (in-app mic); false → type_text (global hotkey)
    let (chunk_tx, chunk_rx) = std::sync::mpsc::sync_channel::<(Vec<f32>, u32, bool)>(8);

    let recorder = Arc::new(Mutex::new(audio::AudioRecorder::new()));

    let dictation = Arc::new(Mutex::new(DictationState {
        detector: transcription::SilenceDetector::new(44100, 0.01, 300, 500, 10000),
        is_recording: false,
        in_app_mode: false,
        chunk_tx,
    }));

    let recording_flag = Arc::new(AtomicBool::new(false));

    // Shutdown flag: set to true before app exit so background threads stop cleanly
    // instead of accessing half-torn-down Tauri state.
    let shutdown_flag = Arc::new(AtomicBool::new(false));

    // Load shortcuts config from disk once; share via Arc so the handler closure
    // can read the live config after voice_set_shortcut changes it at runtime.
    let shortcuts_arc = Arc::new(Mutex::new(voice_shortcuts::load()));

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin({
            let dictation = dictation.clone();
            let recorder = recorder.clone();
            let recording_flag = recording_flag.clone();
            let shortcuts_arc = shortcuts_arc.clone();
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    let sc = shortcuts_arc.lock().expect("mutex poisoned: shortcuts config").clone();
                    let is_dictate = voice_shortcuts::parse(&sc.dictate)
                        .map_or(false, |(m, c)| shortcut.matches(m, c));
                    let is_capture_region = voice_shortcuts::parse(&sc.capture_region)
                        .map_or(false, |(m, c)| shortcut.matches(m, c));
                    let is_capture_window = voice_shortcuts::parse(&sc.capture_window)
                        .map_or(false, |(m, c)| shortcut.matches(m, c));
                    let is_screen_recording = voice_shortcuts::parse(&sc.screen_recording)
                        .map_or(false, |(m, c)| shortcut.matches(m, c));
                    let is_new_meeting = voice_shortcuts::parse(&sc.new_meeting)
                        .map_or(false, |(m, c)| shortcut.matches(m, c));

                    if is_dictate {
                        match event.state() {
                            ShortcutState::Pressed => {
                                let is_recording = dictation.lock().expect("mutex poisoned: dictation state").is_recording;
                                if !is_recording {
                                    // ── Start recording ────────────────────────────
                                    // Start recorder OUTSIDE dictation lock (mic permission dialog may block)
                                    let native_rate = {
                                        let mut rec = recorder.lock().expect("mutex poisoned: audio recorder");
                                        match rec.start() {
                                            Ok(()) => rec.native_sample_rate,
                                            Err(e) => {
                                                eprintln!("[dictation] failed to start: {e}");
                                                return;
                                            }
                                        }
                                    };
                                    let mut d = dictation.lock().expect("mutex poisoned: dictation state");
                                    d.detector = transcription::SilenceDetector::new(native_rate, 0.01, 300, 300, 10000);
                                    d.is_recording = true;
                                    d.in_app_mode = false;
                                    recording_flag.store(true, Ordering::Relaxed);
                                    set_tray_recording(app, true);
                                    show_overlay_listening(app);
                                } else {
                                    // ── Stop recording + queue transcription ───────
                                    let mut d = dictation.lock().expect("mutex poisoned: dictation state");
                                    // Only the same source that started recording may stop it.
                                    // If in_app_mode=true, the in-app mic button owns this
                                    // recording; the global hotkey must not interfere.
                                    if d.in_app_mode {
                                        return;
                                    }
                                    let (remaining, native_rate) = {
                                        let rec = recorder.lock().expect("mutex poisoned: audio recorder");
                                        (rec.drain(), rec.native_sample_rate)
                                    };
                                    let chunk_to_send = d.detector.push(&remaining)
                                        .or_else(|| d.detector.flush());

                                    // Mark stopped WHILE holding dictation so the polling thread
                                    // immediately sees is_recording=false on its next tick and
                                    // won't drain after the recorder is stopped.
                                    d.is_recording = false;
                                    recording_flag.store(false, Ordering::Relaxed);
                                    let chunk_tx = d.chunk_tx.clone();
                                    drop(d); // release dictation — no further dictation lock needed

                                    // Stop recorder only after dictation is released and is_recording
                                    // is already false, so the poll thread cannot race here.
                                    recorder.lock().expect("mutex poisoned: audio recorder").stop();
                                    set_tray_recording(app, false);

                                    // Use blocking send — ensures no silent drops when channel is busy.
                                    // Worker processes chunks quickly (1-3s) so this rarely blocks.
                                    if let Some(chunk) = chunk_to_send {
                                        show_overlay_transcribing(app);
                                        // emit_event=false: type text into the active (external) window
                                        if chunk_tx.send((chunk, native_rate, false)).is_err() {
                                            // Worker thread died (model load failure); hide overlay
                                            if let Some(w) = app.get_webview_window("transcribing") {
                                                let _ = w.hide();
                                            }
                                        }
                                    } else {
                                        // Nothing to transcribe (too short / silence only); hide overlay
                                        if let Some(w) = app.get_webview_window("transcribing") {
                                            let _ = w.hide();
                                        }
                                    }
                                }
                            }
                            ShortcutState::Released => {
                                // Toggle mode: release is ignored; stop happens on next key press
                            }
                        }
                    } else if is_capture_region {
                        if event.state() == ShortcutState::Pressed {
                            if let Err(e) = capture::open_capture_overlay(app.clone()) {
                                eprintln!("[capture] failed to open overlay: {e}");
                            }
                        }
                    } else if is_capture_window {
                        if event.state() == ShortcutState::Pressed {
                            open_window_capture_overlay(app);
                        }
                    } else if is_screen_recording {
                        if event.state() == ShortcutState::Pressed {
                            open_recording_options_window(app);
                        }
                    } else if is_new_meeting {
                        if event.state() == ShortcutState::Pressed {
                            open_meeting_window(app);
                        }
                    }
                })
                .build()
        })
        .manage(InAppDictationState {
            dictation: dictation.clone(),
            recorder: recorder.clone(),
            recording_flag: recording_flag.clone(),
        })
        .manage(capture::CaptureState::new())
        .manage(voice_shortcuts::ShortcutsState(shortcuts_arc))
        .invoke_handler(tauri::generate_handler![
            toggle_in_app_dictation,
            capture::capture_region,
            capture::capture_fullscreen,
            capture::copy_image_to_clipboard,
            capture::copy_image_to_clipboard_from_path,
            capture::save_image_to_file,
            capture::open_capture_overlay,
            capture::open_editor_window,
            capture::get_captured_image,
            // window_capture is cfg(target_os = "macos") — acceptable since this
            // project is macOS-only.
            window_capture::get_window_list,
            window_capture::capture_window,
            library::library_save_draft,
            library::library_finalize,
            library::library_list,
            library::library_search,
            library::library_delete,
            library::library_save_video,
            recorder::recording_list_mics,
            recorder::recording_start,
            recorder::recording_stop,
            recorder::recording_get_elapsed,
            recorder::recording_get_current_session,
            recorder::recording_get_duration,
            recorder::recording_export,
            recorder::recording_extract_thumbnail,
            recorder::recording_get_trim_path,
            recorder::open_region_select_recording,
            recorder::open_recording_pill,
            recorder::open_trim_editor,
            // Meeting commands
            meeting::meeting_start,
            meeting::meeting_stop,
            meeting::meeting_get_elapsed,
            meeting::meeting_save_notes,
            meeting::meeting_list,
            meeting::meeting_get,
            meeting::meeting_search,
            meeting::meeting_delete,
            meeting::meeting_generate_summary,
            // LLM config commands
            llm_config::llm_get_config,
            llm_config::llm_save_config,
            llm_config::llm_set_api_key,
            llm_config::llm_test_connection,
            // Whisper model status
            whisper_model_available,
            // Server token (for webview to call protected HTTP endpoints)
            get_server_token,
            // Voice keyboard shortcuts
            voice_shortcuts::voice_get_shortcuts,
            voice_shortcuts::voice_set_shortcut,
        ])
        .setup(move |app| {
            // Build tray icon
            let capture_region_item = tauri::menu::MenuItem::with_id(
                app,
                "capture-region",
                "Capture Region",
                true,
                Some("Super+Ctrl+4"),
            )?;
            let capture_window_item = tauri::menu::MenuItem::with_id(
                app,
                "capture-window",
                "Capture Window",
                true,
                Some("Super+Ctrl+5"),
            )?;
            let capture_fullscreen_item = tauri::menu::MenuItem::with_id(
                app,
                "capture-fullscreen",
                "Capture Full Screen",
                true,
                None::<&str>,
            )?;
            let record_screen_item = tauri::menu::MenuItem::with_id(
                app,
                "record-screen",
                "Record Screen",
                true,
                Some("Super+Ctrl+6"),
            )?;
            let new_meeting_item = tauri::menu::MenuItem::with_id(
                app, "new-meeting", "New Meeting", true, Some("Super+Ctrl+7"),
            )?;
            let voice_memory_item = tauri::menu::MenuItem::with_id(
                app, "voice-memory", "Voice Memory", true, None::<&str>,
            )?;
            let quit_item = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let open_library_item = tauri::menu::MenuItem::with_id(app, "open-library", "Open Library", true, None::<&str>)?;
            let tray_menu = tauri::menu::MenuBuilder::new(app)
                .item(&capture_region_item)
                .item(&capture_window_item)
                .item(&capture_fullscreen_item)
                .item(&record_screen_item)
                .item(&new_meeting_item)
                .item(&voice_memory_item)
                .separator()
                .item(&open_library_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let app_handle_tray = app.handle().clone();
            let shutdown_flag_quit = shutdown_flag.clone();
            let mut tray_builder = tauri::tray::TrayIconBuilder::with_id("dictation")
                .tooltip("Work With Me — ⌘⇧Space: dictate | ⌘⌃7: new meeting | ⌘⌃4: capture region | ⌘⌃5: capture window")
                .menu(&tray_menu)
                .on_menu_event(move |_tray, event| {
                    match event.id().as_ref() {
                        "capture-region" => {
                            if let Err(e) = capture::open_capture_overlay(app_handle_tray.clone()) {
                                eprintln!("[capture] tray trigger failed: {e}");
                            }
                        }
                        "capture-window" => {
                            open_window_capture_overlay(&app_handle_tray);
                        }
                        "capture-fullscreen" => {
                            if let Err(e) = capture::capture_fullscreen(app_handle_tray.clone()) {
                                eprintln!("[capture] fullscreen capture failed: {e}");
                            }
                        }
                        "open-library" => {
                            open_library_window(&app_handle_tray);
                        }
                        "record-screen" => {
                            open_recording_options_window(&app_handle_tray);
                        }
                        "new-meeting" => { open_meeting_window(&app_handle_tray); }
                        "voice-memory" => { open_voice_memory_window(&app_handle_tray); }
                        "quit" => {
                            shutdown_flag_quit.store(true, Ordering::Relaxed);
                            app_handle_tray.exit(0);
                        }
                        _ => {}
                    }
                });
            if let Ok(img) = tauri::image::Image::from_bytes(TRAY_MIC) {
                tray_builder = tray_builder.icon(img);
            }
            tray_builder.build(app.handle())?;

            // Register global shortcuts from persisted config (or defaults)
            {
                let sc = app.state::<voice_shortcuts::ShortcutsState>();
                let config = sc.0.lock().expect("mutex poisoned: shortcuts config").clone();
                app.global_shortcut().register(config.dictate.as_str())?;
                app.global_shortcut().register(config.capture_region.as_str())?;
                app.global_shortcut().register(config.capture_window.as_str())?;
                app.global_shortcut().register(config.screen_recording.as_str())?;
                app.global_shortcut().register(config.new_meeting.as_str())?;
            }

            // Transcribing overlay — small floating pill shown while Whisper is running
            let overlay = tauri::WebviewWindowBuilder::new(
                app,
                "transcribing",
                tauri::WebviewUrl::App(std::path::PathBuf::from("transcribing.html")),
            )
            .inner_size(200.0, 48.0)
            .always_on_top(true)
            .decorations(false)
            .transparent(true)
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .resizable(false)
            .build()?;

            // Position at bottom-centre of primary monitor
            if let Ok(Some(monitor)) = overlay.primary_monitor() {
                let sf = monitor.scale_factor();
                let mw = monitor.size().width as f64 / sf;
                let mh = monitor.size().height as f64 / sf;
                let _ = overlay.set_position(tauri::LogicalPosition::new(
                    mw / 2.0 - 100.0,
                    mh - 90.0,
                ));
            }

            // Load Whisper model — shared between dictation and meeting transcription
            let model_path = app.path().resource_dir()
                .map(|p| p.join("resources/ggml-small.en-q8_0.bin"))
                .unwrap_or_else(|_| std::path::PathBuf::from("src-tauri/resources/ggml-small.en-q8_0.bin"));

            let engine_for_worker: Option<Arc<Mutex<transcription::WhisperEngine>>>;

            match transcription::WhisperEngine::new(&model_path) {
                Ok(engine) => {
                    println!("[whisper] model loaded");
                    let shared = Arc::new(Mutex::new(engine));
                    app.manage(transcription::SharedWhisperEngine(shared.clone()));
                    engine_for_worker = Some(shared);
                }
                Err(e) => {
                    eprintln!("[whisper] failed to load model: {e}");
                    eprintln!("[whisper] voice dictation and meeting transcription disabled");
                    if let Some(tray) = app.tray_by_id("dictation") {
                        let _ = tray.set_tooltip(Some("Work With Me — voice disabled (model not found)"));
                    }
                    engine_for_worker = None;
                }
            }

            // Transcription worker thread — runs only if model loaded
            let app_handle_worker = app.handle().clone();
            std::thread::spawn(move || {
                let Some(engine) = engine_for_worker else {
                    return; // model failed to load
                };
                while let Ok((chunk, native_rate, emit_event)) = chunk_rx.recv() {
                    let resampled = transcription::resample_to_16k(&chunk, native_rate);
                    let result = {
                        let eng = engine.lock().unwrap_or_else(|e| e.into_inner());
                        eng.transcribe(&resampled)
                    };
                    match result {
                        Ok(text) if !text.trim().is_empty() => {
                            println!("[dictation] → {text}");
                            if emit_event {
                                // In-app mic: send text back to the frontend via event
                                let _ = app_handle_worker.emit("dictation-result", text);
                            } else {
                                // Global hotkey: type text into the active window
                                transcription::type_text(&text);
                            }
                        }
                        Ok(_) => {}
                        Err(e) => eprintln!("[dictation] transcription error: {e}"),
                    }
                    // Hide overlay once this chunk is done (success or empty)
                    if let Some(w) = app_handle_worker.get_webview_window("transcribing") {
                        let _ = w.hide();
                    }
                }
            });

            // HTTP server
            std::thread::spawn(|| {
                let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
                rt.block_on(async { start_http_server().await });
            });

            // Tray animation loop
            let handle = app.handle().clone();
            let recording_flag_anim = recording_flag.clone();
            let shutdown_flag_anim = shutdown_flag.clone();
            std::thread::spawn(move || {
                let mut frame = 0usize;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    if shutdown_flag_anim.load(Ordering::Relaxed) { break; }
                    if recording_flag_anim.load(Ordering::Relaxed) {
                        if let Some(tray) = handle.tray_by_id("dictation") {
                            if let Ok(img) = tauri::image::Image::from_bytes(TRAY_MIC_RED[frame % 3]) {
                                let _ = tray.set_icon(Some(img));
                            }
                            frame += 1;
                        }
                    }
                }
            });

            // Polling thread: feeds mic samples to SilenceDetector every 20ms for streaming transcription
            let dictation_poll = dictation.clone();
            let recorder_poll = recorder.clone();
            let shutdown_flag_poll = shutdown_flag.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                    if shutdown_flag_poll.load(Ordering::Relaxed) { break; }
                    // Hold dictation lock for the entire drain→push cycle so the
                    // release handler cannot flush the detector between our drain and push.
                    let mut d = dictation_poll.lock().expect("mutex poisoned: dictation state");
                    if !d.is_recording { continue; }
                    let (samples, native_rate) = {
                        let rec = recorder_poll.lock().expect("mutex poisoned: audio recorder");
                        (rec.drain(), rec.native_sample_rate)
                    };
                    if samples.is_empty() { continue; }
                    if let Some(chunk) = d.detector.push(&samples) {
                        let emit = d.in_app_mode;
                        if let Err(e) = d.chunk_tx.try_send((chunk, native_rate, emit)) {
                            eprintln!("[dictation] poll chunk dropped (channel full): {e}");
                        }
                    }
                }
            });

            // Initialize voice DB
            if let Err(e) = voice_db::init_db() {
                eprintln!("[voice_db] DB init failed: {e}");
            }
            // Mark any sessions left in 'recording' state as 'error' (app crashed mid-recording)
            if let Ok(sessions) = voice_db::list_sessions() {
                for s in sessions {
                    if s.status == "recording" || s.status == "processing" {
                        let _ = voice_db::update_session_status(&s.id, "error");
                    }
                }
            }

            // Clean up agent sessions older than 30 days (~/.pi/sessions)
            match server::sessions::cleanup_expired_sessions() {
                Ok(n) if n > 0 => println!("[sessions] deleted {n} expired session(s)"),
                Ok(_) => {}
                Err(e) => eprintln!("[sessions] cleanup failed: {e}"),
            }

            // Initialize capture library DB and prune old entries
            if let Err(e) = library::db::init_db() {
                eprintln!("[library] DB init failed: {e}");
            } else {
                match library::db::prune() {
                    Ok(paths) => {
                        for p in &paths {
                            eprintln!("[library] pruned old capture: {p}");
                        }
                    }
                    Err(e) => eprintln!("[library] prune failed: {e}"),
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Show the overlay in "Listening…" state (recording just started).
fn show_overlay_listening(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("transcribing") {
        let _ = w.show();
    }
    let _ = app.emit("overlay-state", "listening");
}

/// Switch overlay to "Transcribing…" state (recording stopped, Whisper running).
/// The overlay is already visible from show_overlay_listening; this just updates the text.
fn show_overlay_transcribing(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("transcribing") {
        let _ = w.show(); // show in case we got here without a prior listening phase
    }
    let _ = app.emit("overlay-state", "transcribing");
}

fn open_library_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("library") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    if let Err(e) = tauri::WebviewWindowBuilder::new(
        app,
        "library",
        tauri::WebviewUrl::App("library.html".into()),
    )
    .inner_size(900.0, 640.0)
    .min_inner_size(600.0, 400.0)
    .decorations(true)
    .resizable(true)
    .title("Capture Library")
    .build()
    {
        eprintln!("[library] window build failed: {e}");
    }
}

// macOS-only: window_capture module is cfg(target_os = "macos") but this project
// targets macOS exclusively, so no cfg guard is needed here.
fn open_window_capture_overlay(app: &tauri::AppHandle) {
    // If the overlay is already open, focus it and return — same rationale as
    // open_capture_overlay: avoids blocking the tray menu event thread.
    if let Some(w) = app.get_webview_window("window-capture-overlay") {
        let _ = w.set_focus();
        return;
    }
    let screens = screenshots::Screen::all().unwrap_or_default();
    let (min_x, min_y, max_x, max_y) = recorder::screen_bounds(&screens);
    if let Err(e) = tauri::WebviewWindowBuilder::new(
        app,
        "window-capture-overlay",
        // Pass overlay origin for multi-monitor coordinate correction in frontend.
        tauri::WebviewUrl::App(
            format!("window-capture.html?ox={min_x}&oy={min_y}").into(),
        ),
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
    {
        eprintln!("[window-capture] overlay build failed: {e}");
    }
}

fn set_tray_recording(app: &tauri::AppHandle, recording: bool) {
    if let Some(tray) = app.tray_by_id("dictation") {
        let bytes = if recording { TRAY_MIC_RED[0] } else { TRAY_MIC };
        if let Ok(img) = tauri::image::Image::from_bytes(bytes) {
            let _ = tray.set_icon(Some(img));
        }
    }
}

async fn start_http_server() {
    server::oauth::validate_oauth_config();
    server::approval::init_approval_manager();
    if let Err(e) = server::plugins::init_plugins().await {
        eprintln!("[http-server] plugin initialization failed: {}", e);
    }
    if is_port_bound(4242) {
        println!("[http-server] port 4242 already in use — skipping auto-start");
        return;
    }
    println!("[http-server] starting on http://127.0.0.1:4242");
    match server::create_app().await {
        Ok(router) => {
            match tokio::net::TcpListener::bind("127.0.0.1:4242").await {
                Ok(listener) => {
                    if let Err(e) = axum::serve(listener, router).await {
                        eprintln!("[http-server] error: {e}");
                    }
                }
                Err(e) => eprintln!("[http-server] failed to bind: {e}"),
            }
        }
        Err(e) => eprintln!("[http-server] failed to create app: {e}"),
    }
}

fn is_port_bound(port: u16) -> bool {
    std::net::TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn open_recording_options_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("recording-options") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    if let Err(e) = tauri::WebviewWindowBuilder::new(
        app,
        "recording-options",
        tauri::WebviewUrl::App("recording-options.html".into()),
    )
    .inner_size(360.0, 220.0)
    .always_on_top(true)
    .decorations(true)
    .resizable(false)
    .title("Record Screen")
    .center()
    .build()
    {
        eprintln!("[recorder] options window build failed: {e}");
    }
}

fn open_meeting_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("meeting") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    if let Err(e) = tauri::WebviewWindowBuilder::new(
        app,
        "meeting",
        tauri::WebviewUrl::App("meeting.html".into()),
    )
    .inner_size(900.0, 640.0)
    .min_inner_size(700.0, 480.0)
    .decorations(true)
    .resizable(true)
    .title("Meeting Capture")
    .build()
    {
        eprintln!("[meeting] window build failed: {e}");
    }
}

fn open_voice_memory_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("voice-memory") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    if let Err(e) = tauri::WebviewWindowBuilder::new(
        app,
        "voice-memory",
        tauri::WebviewUrl::App("voice-memory.html".into()),
    )
    .inner_size(1000.0, 680.0)
    .min_inner_size(700.0, 500.0)
    .decorations(true)
    .resizable(true)
    .title("Voice Memory")
    .build()
    {
        eprintln!("[voice-memory] window build failed: {e}");
    }
}
