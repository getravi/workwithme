mod server;
mod audio;
mod transcription;

use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState, Modifiers, Code};

/// Shared state for the dictation session.
struct DictationState {
    detector: transcription::SilenceDetector,
    is_recording: bool,
    chunk_tx: std::sync::mpsc::SyncSender<(Vec<f32>, u32)>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Channel: audio chunks (samples, native_rate) → transcription worker thread
    let (chunk_tx, chunk_rx) = std::sync::mpsc::sync_channel::<(Vec<f32>, u32)>(8);

    let recorder = Arc::new(Mutex::new(audio::AudioRecorder::new()));

    let dictation = Arc::new(Mutex::new(DictationState {
        detector: transcription::SilenceDetector::new(44100, 0.01, 300, 500, 10000),
        is_recording: false,
        chunk_tx,
    }));

    let recording_flag = Arc::new(Mutex::new(false));

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin({
            let dictation = dictation.clone();
            let recorder = recorder.clone();
            let recording_flag = recording_flag.clone();
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if !shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::Space) {
                        return;
                    }
                    match event.state() {
                        ShortcutState::Pressed => {
                            // Quick check: already recording?
                            {
                                let d = dictation.lock().unwrap();
                                if d.is_recording { return; }
                            }
                            // Start recorder OUTSIDE the dictation lock (may block for mic permission dialog)
                            let native_rate = {
                                let mut rec = recorder.lock().unwrap();
                                match rec.start() {
                                    Ok(()) => rec.native_sample_rate,
                                    Err(e) => {
                                        eprintln!("[dictation] failed to start: {e}");
                                        return;
                                    }
                                }
                            };
                            // Commit state
                            let mut d = dictation.lock().unwrap();
                            d.detector = transcription::SilenceDetector::new(native_rate, 0.01, 300, 500, 10000);
                            d.is_recording = true;
                            *recording_flag.lock().unwrap() = true;
                            set_tray_recording(app, true);
                        }
                        ShortcutState::Released => {
                            let mut d = dictation.lock().unwrap();
                            if !d.is_recording { return; }
                            // Drain final audio from recorder
                            let (remaining, native_rate) = {
                                let rec = recorder.lock().unwrap();
                                (rec.drain(), rec.native_sample_rate)
                            };
                            if let Some(chunk) = d.detector.push(&remaining).or_else(|| d.detector.flush()) {
                                let _ = d.chunk_tx.try_send((chunk, native_rate));
                            }
                            // Stop recorder (outside dictation lock to avoid lock ordering issues)
                            drop(d); // release dictation lock first
                            recorder.lock().unwrap().stop();
                            // Re-acquire dictation lock to update state
                            let mut d = dictation.lock().unwrap();
                            d.is_recording = false;
                            *recording_flag.lock().unwrap() = false;
                            set_tray_recording(app, false);
                        }
                    }
                })
                .build()
        })
        .setup(move |app| {
            // Build tray icon
            let icon_path = app.path().resource_dir()
                .map(|p| p.join("icons/tray-mic.png"))
                .unwrap_or_else(|_| std::path::PathBuf::from("src-tauri/icons/tray-mic.png"));
            let mut tray_builder = tauri::tray::TrayIconBuilder::with_id("dictation")
                .tooltip("Work With Me — hold Cmd+Shift+Space to dictate");
            if let Ok(img) = tauri::image::Image::from_path(&icon_path) {
                tray_builder = tray_builder.icon(img);
            }
            tray_builder.build(app.handle())?;

            // Register global shortcut
            app.global_shortcut().register("Super+Shift+Space")?;

            // Load whisper model on background thread, then run transcription worker
            let model_path = app.path().resource_dir()
                .map(|p| p.join("resources/ggml-small.en-q8_0.bin"))
                .unwrap_or_else(|_| std::path::PathBuf::from("src-tauri/resources/ggml-small.en-q8_0.bin"));

            std::thread::spawn(move || {
                match transcription::WhisperEngine::new(&model_path) {
                    Ok(engine) => {
                        println!("[dictation] whisper model loaded");
                        let engine = Arc::new(engine);
                        while let Ok((chunk, native_rate)) = chunk_rx.recv() {
                            let resampled = transcription::resample_to_16k(&chunk, native_rate);
                            match engine.transcribe(&resampled) {
                                Ok(text) if !text.trim().is_empty() => {
                                    println!("[dictation] → {text}");
                                    transcription::type_text(&text);
                                }
                                Ok(_) => {}
                                Err(e) => eprintln!("[dictation] transcription error: {e}"),
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[dictation] failed to load model: {e}");
                        eprintln!("[dictation] voice dictation disabled");
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
            std::thread::spawn(move || {
                let frames = ["tray-mic-red-0.png", "tray-mic-red-1.png", "tray-mic-red-2.png"];
                let mut frame = 0usize;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    if *recording_flag_anim.lock().unwrap() {
                        if let Some(tray) = handle.tray_by_id("dictation") {
                            let icon_name = frames[frame % frames.len()];
                            if let Ok(path) = handle.path().resource_dir()
                                .map(|p| p.join(format!("icons/{icon_name}")))
                            {
                                if let Ok(img) = tauri::image::Image::from_path(&path) {
                                    let _ = tray.set_icon(Some(img));
                                }
                            }
                            frame += 1;
                        }
                    }
                }
            });

            // Polling thread: feeds mic samples to SilenceDetector every 20ms for streaming transcription
            let dictation_poll = dictation.clone();
            let recorder_poll = recorder.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                    let is_recording = dictation_poll.lock().unwrap().is_recording;
                    if !is_recording { continue; }
                    let (samples, native_rate) = {
                        let rec = recorder_poll.lock().unwrap();
                        (rec.drain(), rec.native_sample_rate)
                    };
                    if samples.is_empty() { continue; }
                    let mut d = dictation_poll.lock().unwrap();
                    if let Some(chunk) = d.detector.push(&samples) {
                        let _ = d.chunk_tx.try_send((chunk, native_rate));
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn set_tray_recording(app: &tauri::AppHandle, recording: bool) {
    if let Some(tray) = app.tray_by_id("dictation") {
        let icon_name = if recording { "tray-mic-red-0.png" } else { "tray-mic.png" };
        if let Ok(path) = app.path().resource_dir()
            .map(|p| p.join(format!("icons/{icon_name}")))
        {
            if let Ok(img) = tauri::image::Image::from_path(&path) {
                let _ = tray.set_icon(Some(img));
            }
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
