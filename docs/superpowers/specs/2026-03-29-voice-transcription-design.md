# Voice Transcription with Global Hotkey — Design Spec

**Date:** 2026-03-29
**Status:** Approved

---

## Overview

A system-wide push-to-talk dictation feature. Hold `Cmd+Shift+Space` anywhere on the system to record speech; utterances are transcribed incrementally using a bundled Whisper model and typed into whatever app is currently active.

---

## User Flow

1. User holds `Cmd+Shift+Space` from any app
2. Menu bar icon switches to animated red mic — recording begins
3. As the user speaks, silence gaps trigger per-utterance transcription (~0.5–1s lag per phrase)
4. Each transcribed utterance is typed into the currently active app via `enigo`
5. User releases `Cmd+Shift+Space` — recording stops, menu bar icon returns to normal
6. Any audio buffered at release is flushed and transcribed as a final utterance

---

## Architecture

Everything runs on the Rust/native side. The frontend (webview) is not involved in recording, transcription, or pasting.

```
Hotkey pressed (tauri-plugin-global-shortcut)
  → AudioRecorder starts cpal stream → ring buffer
  → SilenceDetector watches energy level
      → on silence gap: flush chunk → WAV file → WhisperEngine
      → transcript → enigo types into active app
Hotkey released
  → flush remaining buffer → final transcription
  → AudioRecorder stops
  → tray icon returns to idle state
```

### State Machine

```
Idle
  → [hotkey pressed] → Recording
Recording
  → [utterance boundary detected] → Transcribing (async, recording continues)
  → [hotkey released] → Flushing
Transcribing
  → [transcript ready] → type via enigo → back to Recording
Flushing
  → [final transcript ready] → type via enigo → Idle
```

---

## Components

### New Files

**`src-tauri/src/audio.rs`**
- Owns the `cpal` input stream
- Writes samples into a shared ring buffer (f32 PCM, 16kHz mono)
- Exposes `start()` / `stop()` / `drain() -> Vec<f32>`

**`src-tauri/src/transcription.rs`**
- `WhisperEngine`: loads `ggml-small.en-q8_0.bin` from bundled resources at app startup, holds the model in memory
- `SilenceDetector`: energy threshold VAD — emits chunk boundaries when RMS drops below threshold for >300ms
- `transcribe(audio: &[f32]) -> String`: synchronous whisper-rs call, runs on a dedicated thread pool (1 thread to avoid model contention)
- `type_text(text: &str)`: uses `enigo` to type the transcript into the active app

### Modified Files

**`src-tauri/src/lib.rs`**
- Load `WhisperEngine` at startup, store in `Arc<Mutex<WhisperEngine>>` managed state
- Register global shortcut `CmdOrCtrl+Shift+Space` via `tauri-plugin-global-shortcut`
- On press: call `audio::start()`, set tray icon to red mic frames
- On release: call `audio::stop()`, flush remaining audio, restore tray icon

**`src-tauri/Cargo.toml`**
```toml
tauri-plugin-global-shortcut = "2"
tauri-plugin-tray = "2"
cpal = "0.15"
whisper-rs = "0.11"
enigo = "0.2"
hound = "3"           # WAV writing for whisper-rs input
```

**`src-tauri/tauri.conf.json`**
- Add `tauri-plugin-global-shortcut` and `tauri-plugin-tray` to plugins
- Add `"resources": ["resources/ggml-small.en-q8_0.bin"]` to bundle

---

## Model

- **File:** `ggml-small.en-q8_0.bin`
- **Size:** ~190MB
- **Source:** https://huggingface.co/ggerganov/whisper.cpp (download once, commit to `src-tauri/resources/`)
- **Language:** English only (`.en` variant — more accurate and smaller than multilingual)
- **Loading:** at app startup via `whisper_rs::WhisperContext::new_with_params(model_path, params)`
- **Inference:** 16kHz mono f32 PCM input; `whisper-rs` handles all preprocessing

---

## VAD (Silence Detection)

Simple energy-based approach — no ML model needed:

- Window size: 20ms (320 samples at 16kHz)
- Silence threshold: RMS < 0.01 (configurable)
- Silence duration to trigger chunk: 300ms
- Minimum chunk length: 500ms (discard very short clips to avoid noise)
- Maximum chunk length: 10s (force-flush long utterances to bound latency)

---

## Visual Feedback — Menu Bar Tray Icon

Two icon states managed by `tauri-plugin-tray`:

| State | Icon | Animation |
|-------|------|-----------|
| Idle | `icons/tray-mic.png` (monochrome, 22×22) | None |
| Recording | `icons/tray-mic-red-0.png` … `tray-mic-red-2.png` | Swap frames every 400ms via `tokio::time::interval` |

Icons: 22×22px PNG, monochrome idle, red fill for active frames. Template images on macOS (suffix `Template`) adapt to light/dark menu bar automatically for the idle state.

---

## Permissions

**`entitlements.plist`** — microphone entitlement already present:
```xml
<key>com.apple.security.device.microphone</key>
<true/>
```

**`tauri.conf.json` capabilities** — add `global-shortcut:allow-register` and `tray:default` permissions.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Mic permission denied | Show native notification: "Microphone access required for dictation" |
| Model file missing | Log error at startup, global shortcut silently disabled |
| Whisper inference error | Skip utterance, continue recording |
| `enigo` typing fails | Fall back to clipboard paste (`Cmd+V`) via `arboard` |

---

## Testing

- Unit test `SilenceDetector` with synthetic PCM data (silence + speech + silence)
- Unit test `transcribe()` with a short known WAV fixture → assert non-empty string
- Integration test: simulate hotkey press/release, assert `enigo` received typed text
- Manual: hold hotkey, speak a sentence, verify text appears in TextEdit

---

## Out of Scope

- Multilingual support (English-only model)
- Continuous background transcription without hotkey
- Whisper model selection UI (fixed to `small.en`)
- Windows / Linux support (macOS only for this iteration)
