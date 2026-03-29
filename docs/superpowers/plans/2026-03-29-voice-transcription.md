# Voice Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add system-wide push-to-talk dictation via `Cmd+Shift+Space` that transcribes speech and types it into the currently active app.

**Architecture:** A global hotkey registered from Rust starts mic capture via `cpal`. A silence-based VAD chunks audio into utterances. Each chunk is resampled to 16kHz, transcribed by `whisper-rs` (bundled `ggml-small.en-q8_0.bin`) on a background thread, and typed into the active app via `enigo`. A menu bar tray icon animates red while recording.

**Tech Stack:** `whisper-rs 0.14` (metal feature), `cpal 0.15`, `enigo 0.2`, `tauri-plugin-global-shortcut 2`, `tauri` with `tray-icon` feature

---

## File Map

**Created:**
- `src-tauri/src/audio.rs` — `AudioRecorder`: cpal input stream, mono-mix, drain to `Vec<f32>`
- `src-tauri/src/transcription.rs` — `SilenceDetector`, `WhisperEngine`, `resample_to_16k`, `type_text`
- `src-tauri/resources/ggml-small.en-q8_0.bin` — bundled model (downloaded, gitignored)
- `src-tauri/icons/tray-mic.png` — idle tray icon (22×22, gray mic)
- `src-tauri/icons/tray-mic-red-0.png`, `tray-mic-red-1.png`, `tray-mic-red-2.png` — recording frames

**Modified:**
- `src-tauri/Cargo.toml` — new dependencies
- `src-tauri/src/lib.rs` — plugin setup, global shortcut handler, tray, transcription worker thread
- `src-tauri/tauri.conf.json` — add `resources` array

---

## Task 1: Add Cargo.toml dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add dependencies**

Open `src-tauri/Cargo.toml` and add inside `[dependencies]`:

```toml
# Voice transcription
tauri-plugin-global-shortcut = "2"
cpal = "0.15"
whisper-rs = { version = "0.14", features = ["metal"] }
enigo = "0.2"
```

Also update the existing `tauri` dependency to add the `tray-icon` feature (tray is built into Tauri v2 core, not a separate plugin):

```toml
tauri = { version = "2", features = ["tray-icon"] }
```

- [ ] **Step 2: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with no errors. whisper-rs will compile whisper.cpp (takes 2–5 min first time — requires `cmake` and Xcode CLT).

If cmake missing: `brew install cmake`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add voice transcription dependencies"
```

---

## Task 2: Download model and configure bundle resources

**Files:**
- Create: `src-tauri/resources/ggml-small.en-q8_0.bin`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create resources directory and download model**

```bash
mkdir -p src-tauri/resources
curl -L --progress-bar \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q8_0.bin" \
  -o src-tauri/resources/ggml-small.en-q8_0.bin
ls -lh src-tauri/resources/ggml-small.en-q8_0.bin
```

Expected: file ~190MB.

- [ ] **Step 2: Gitignore the model file**

Add to `.gitignore`:

```
# Whisper model — large binary, download via Task 2
src-tauri/resources/*.bin
```

- [ ] **Step 3: Add resource to tauri.conf.json bundle**

In `src-tauri/tauri.conf.json`, add a `"resources"` key inside `"bundle"`:

```json
"bundle": {
  "active": true,
  "targets": "all",
  "resources": ["resources/ggml-small.en-q8_0.bin"],
  "icon": [...]
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json .gitignore
git commit -m "chore: bundle whisper small.en model as Tauri resource"
```

---

## Task 3: Generate tray icons

**Files:**
- Create: `src-tauri/icons/tray-mic.png`
- Create: `src-tauri/icons/tray-mic-red-0.png`
- Create: `src-tauri/icons/tray-mic-red-1.png`
- Create: `src-tauri/icons/tray-mic-red-2.png`

- [ ] **Step 1: Install Pillow if needed**

```bash
pip3 install Pillow
```

- [ ] **Step 2: Run icon generation script**

Save to `/tmp/gen_icons.py` and run:

```python
#!/usr/bin/env python3
from PIL import Image, ImageDraw
import os

SIZE = 22

def draw_mic(color, alpha=255):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r, g, b = color
    c = (r, g, b, alpha)
    # Mic body (capsule)
    d.rounded_rectangle([(7, 2), (15, 13)], radius=4, fill=c)
    # Stand arc
    d.arc([(4, 9), (18, 18)], start=180, end=0, fill=c, width=2)
    # Stem
    d.line([(11, 18), (11, 20)], fill=c, width=2)
    # Base
    d.line([(7, 20), (15, 20)], fill=c, width=2)
    return img

os.makedirs("src-tauri/icons", exist_ok=True)

draw_mic((160, 160, 160)).save("src-tauri/icons/tray-mic.png")
draw_mic((220, 50, 50), 255).save("src-tauri/icons/tray-mic-red-0.png")
draw_mic((220, 50, 50), 180).save("src-tauri/icons/tray-mic-red-1.png")
draw_mic((220, 50, 50), 120).save("src-tauri/icons/tray-mic-red-2.png")
print("Icons written to src-tauri/icons/")
```

```bash
cd /Users/ravi/Documents/Dev/workwithme
python3 /tmp/gen_icons.py
```

- [ ] **Step 3: Verify icons exist**

```bash
ls -lh src-tauri/icons/tray-mic*.png
```

Expected: 4 files, each ~1KB.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/icons/tray-mic*.png
git commit -m "feat: add tray mic icons for voice recording states"
```

---

## Task 4: Implement audio.rs

**Files:**
- Create: `src-tauri/src/audio.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod audio;`)

- [ ] **Step 1: Create audio.rs**

```rust
// src-tauri/src/audio.rs
//! Microphone capture via cpal.
//! Captures at the device's native sample rate, mixes to mono.
//! Call `start()` to begin recording, `drain()` to take accumulated samples,
//! `stop()` to end the stream.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

pub struct AudioRecorder {
    /// Accumulated mono f32 samples at the device's native sample rate.
    pub buffer: Arc<Mutex<Vec<f32>>>,
    /// Native sample rate of the input device (set after `start()`).
    pub native_sample_rate: u32,
    // Holds the stream alive; dropping it stops capture.
    _stream: Option<cpal::Stream>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            buffer: Arc::new(Mutex::new(Vec::new())),
            native_sample_rate: 16000,
            _stream: None,
        }
    }

    /// Start capturing from the default input device.
    pub fn start(&mut self) -> anyhow::Result<()> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| anyhow::anyhow!("No default input device found"))?;

        let config = device.default_input_config()?;
        self.native_sample_rate = config.sample_rate().0;
        let channels = config.channels() as usize;
        let buffer = self.buffer.clone();

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| push_mono(data, channels, &buffer),
                |e| eprintln!("[audio] stream error: {e}"),
                None,
            )?,
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    let f32s: Vec<f32> = data.iter().map(|s| *s as f32 / i16::MAX as f32).collect();
                    push_mono(&f32s, channels, &buffer);
                },
                |e| eprintln!("[audio] stream error: {e}"),
                None,
            )?,
            cpal::SampleFormat::U16 => device.build_input_stream(
                &config.into(),
                move |data: &[u16], _| {
                    let f32s: Vec<f32> = data
                        .iter()
                        .map(|s| (*s as f32 / u16::MAX as f32) * 2.0 - 1.0)
                        .collect();
                    push_mono(&f32s, channels, &buffer);
                },
                |e| eprintln!("[audio] stream error: {e}"),
                None,
            )?,
            fmt => anyhow::bail!("Unsupported sample format: {fmt:?}"),
        };

        stream.play()?;
        self._stream = Some(stream);
        println!("[audio] recording at {}Hz", self.native_sample_rate);
        Ok(())
    }

    /// Stop the stream and discard buffered audio.
    pub fn stop(&mut self) {
        self._stream = None;
        self.buffer.lock().unwrap().clear();
    }

    /// Take all buffered samples, leaving the buffer empty.
    pub fn drain(&self) -> Vec<f32> {
        std::mem::take(&mut self.buffer.lock().unwrap())
    }
}

fn push_mono(data: &[f32], channels: usize, buffer: &Arc<Mutex<Vec<f32>>>) {
    let mono: Vec<f32> = if channels == 1 {
        data.to_vec()
    } else {
        data.chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    };
    buffer.lock().unwrap().extend_from_slice(&mono);
}
```

- [ ] **Step 2: Register module in lib.rs**

Add `mod audio;` at the top of `src-tauri/src/lib.rs` (after `mod server;`):

```rust
mod server;
mod audio;
mod transcription;
```

- [ ] **Step 3: Verify it compiles**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/audio.rs src-tauri/src/lib.rs
git commit -m "feat: add audio recorder module (cpal mic capture)"
```

---

## Task 5: Implement SilenceDetector with unit tests

**Files:**
- Create: `src-tauri/src/transcription.rs` (SilenceDetector section)

- [ ] **Step 1: Write failing tests**

Create `src-tauri/src/transcription.rs` with just the tests and a stub:

```rust
// src-tauri/src/transcription.rs

/// Silence-based Voice Activity Detector.
/// Accumulates samples and emits complete utterance chunks.
pub struct SilenceDetector {
    threshold: f32,
    silence_frames_needed: usize,
    min_chunk_samples: usize,
    max_chunk_samples: usize,
    frame_size: usize,
    buffer: Vec<f32>,
    silent_frames: usize,
}

impl SilenceDetector {
    /// Create a detector.
    ///
    /// - `sample_rate`: native recording rate (e.g. 44100)
    /// - `threshold`: RMS below this is silence (try 0.01)
    /// - `silence_ms`: consecutive silence needed to split (300)
    /// - `min_chunk_ms`: shortest utterance to keep (500)
    /// - `max_chunk_ms`: force-split after this long (10000)
    pub fn new(sample_rate: u32, threshold: f32, silence_ms: u32, min_chunk_ms: u32, max_chunk_ms: u32) -> Self {
        let frame_ms = 20u32;
        let frame_size = (sample_rate * frame_ms / 1000) as usize;
        let silence_frames_needed = (silence_ms / frame_ms) as usize;
        let min_chunk_samples = (sample_rate * min_chunk_ms / 1000) as usize;
        let max_chunk_samples = (sample_rate * max_chunk_ms / 1000) as usize;
        Self {
            threshold,
            silence_frames_needed,
            min_chunk_samples,
            max_chunk_samples,
            frame_size,
            buffer: Vec::new(),
            silent_frames: 0,
        }
    }

    /// Push samples. Returns `Some(chunk)` when an utterance boundary is detected.
    pub fn push(&mut self, samples: &[f32]) -> Option<Vec<f32>> {
        self.buffer.extend_from_slice(samples);

        // Force-split if buffer exceeds max
        if self.buffer.len() >= self.max_chunk_samples {
            return Some(self.take_buffer());
        }

        // Process complete 20ms frames
        while self.buffer.len() >= self.frame_size {
            let frame = &self.buffer[..self.frame_size];
            let rms = rms(frame);
            if rms < self.threshold {
                self.silent_frames += 1;
            } else {
                self.silent_frames = 0;
            }
            // Rotate frame out (keep processing)
            if self.silent_frames >= self.silence_frames_needed
                && self.buffer.len() >= self.min_chunk_samples
            {
                return Some(self.take_buffer());
            }
            // Advance by one frame
            self.buffer.drain(..self.frame_size);
        }
        None
    }

    /// Flush any remaining buffered audio (call on hotkey release).
    pub fn flush(&mut self) -> Option<Vec<f32>> {
        if self.buffer.len() >= self.min_chunk_samples {
            Some(self.take_buffer())
        } else {
            self.buffer.clear();
            None
        }
    }

    fn take_buffer(&mut self) -> Vec<f32> {
        self.silent_frames = 0;
        std::mem::take(&mut self.buffer)
    }
}

fn rms(samples: &[f32]) -> f32 {
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

// ── placeholder stubs (filled in Tasks 6 & 7) ────────────────────────────────
pub struct WhisperEngine;
impl WhisperEngine {
    pub fn new(_path: &std::path::Path) -> anyhow::Result<Self> { Ok(Self) }
    pub fn transcribe(&self, _audio: &[f32]) -> anyhow::Result<String> { Ok(String::new()) }
}
pub fn resample_to_16k(samples: &[f32], from_rate: u32) -> Vec<f32> { samples.to_vec() }
pub fn type_text(_text: &str) {}

// ── tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    fn make_detector() -> SilenceDetector {
        // 16kHz, threshold 0.01, 300ms silence, 500ms min, 10s max
        SilenceDetector::new(16000, 0.01, 300, 500, 10000)
    }

    fn silence(samples: usize) -> Vec<f32> {
        vec![0.0f32; samples]
    }

    fn speech(samples: usize) -> Vec<f32> {
        (0..samples).map(|i| (i as f32 * 0.1).sin() * 0.5).collect()
    }

    #[test]
    fn no_chunk_during_continuous_speech() {
        let mut d = make_detector();
        // Push 2s of speech — should not split
        let result = d.push(&speech(32000));
        assert!(result.is_none());
    }

    #[test]
    fn chunk_emitted_after_silence() {
        let mut d = make_detector();
        // 1s speech
        d.push(&speech(16000));
        // 400ms silence (> 300ms threshold)
        let result = d.push(&silence(6400));
        assert!(result.is_some(), "expected chunk after silence");
        let chunk = result.unwrap();
        assert!(chunk.len() >= 8000, "chunk should be >= 500ms");
    }

    #[test]
    fn short_utterance_not_emitted() {
        let mut d = make_detector();
        // Only 200ms of speech (< 500ms min)
        d.push(&speech(3200));
        let result = d.push(&silence(6400));
        assert!(result.is_none(), "too short to emit");
    }

    #[test]
    fn force_split_at_max_length() {
        let mut d = make_detector();
        // Push 11s of speech (> 10s max)
        let result = d.push(&speech(176000));
        assert!(result.is_some(), "should force-split at 10s");
    }

    #[test]
    fn flush_returns_buffered_audio() {
        let mut d = make_detector();
        d.push(&speech(16000)); // 1s
        let chunk = d.flush();
        assert!(chunk.is_some());
        assert_eq!(d.flush(), None, "buffer cleared after flush");
    }

    #[test]
    fn flush_ignores_short_buffer() {
        let mut d = make_detector();
        d.push(&speech(3200)); // 200ms only
        assert_eq!(d.flush(), None);
    }
}
```

- [ ] **Step 2: Run tests — verify they fail first**

```bash
cd src-tauri && cargo test transcription::tests 2>&1 | tail -20
```

Expected: compilation errors (stubs in place) or some logic failures — that's fine. Fix any compile errors only.

- [ ] **Step 3: Run tests — verify they pass**

```bash
cd src-tauri && cargo test transcription::tests -- --nocapture 2>&1 | tail -20
```

Expected:
```
test transcription::tests::no_chunk_during_continuous_speech ... ok
test transcription::tests::chunk_emitted_after_silence ... ok
test transcription::tests::short_utterance_not_emitted ... ok
test transcription::tests::force_split_at_max_length ... ok
test transcription::tests::flush_returns_buffered_audio ... ok
test transcription::tests::flush_ignores_short_buffer ... ok
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/transcription.rs src-tauri/src/lib.rs
git commit -m "feat: implement SilenceDetector VAD with unit tests"
```

---

## Task 6: Implement WhisperEngine and resample_to_16k

**Files:**
- Modify: `src-tauri/src/transcription.rs` (replace WhisperEngine + resample stubs)

- [ ] **Step 1: Replace the WhisperEngine stub and add resample_to_16k**

Replace the stub section in `transcription.rs` with:

```rust
use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};
use std::path::Path;

pub struct WhisperEngine {
    ctx: WhisperContext,
}

impl WhisperEngine {
    pub fn new(model_path: &Path) -> anyhow::Result<Self> {
        let params = WhisperContextParameters::default();
        let ctx = WhisperContext::new_with_params(
            model_path.to_str().ok_or_else(|| anyhow::anyhow!("invalid model path"))?,
            params,
        ).map_err(|e| anyhow::anyhow!("Failed to load whisper model: {e:?}"))?;
        Ok(Self { ctx })
    }

    /// Transcribe 16kHz mono f32 audio. Returns trimmed text or empty string.
    pub fn transcribe(&self, audio: &[f32]) -> anyhow::Result<String> {
        if audio.len() < 1600 {
            return Ok(String::new()); // too short
        }
        let mut state = self.ctx.create_state()
            .map_err(|e| anyhow::anyhow!("whisper state error: {e:?}"))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_suppress_non_speech_tokens(true);

        state.full(params, audio)
            .map_err(|e| anyhow::anyhow!("whisper inference error: {e:?}"))?;

        let n = state.full_n_segments()
            .map_err(|e| anyhow::anyhow!("segment count error: {e:?}"))?;

        let mut text = String::new();
        for i in 0..n {
            if let Ok(seg) = state.full_get_segment_text(i) {
                let t = seg.trim();
                if !t.is_empty() && t != "[BLANK_AUDIO]" {
                    if !text.is_empty() { text.push(' '); }
                    text.push_str(t);
                }
            }
        }
        Ok(text)
    }
}

/// Resample from `from_rate` Hz to 16000 Hz using linear interpolation.
/// Good enough quality for voice; no extra dependencies.
pub fn resample_to_16k(samples: &[f32], from_rate: u32) -> Vec<f32> {
    const TARGET: u32 = 16000;
    if from_rate == TARGET { return samples.to_vec(); }
    let ratio = from_rate as f64 / TARGET as f64;
    let out_len = (samples.len() as f64 / ratio) as usize;
    (0..out_len)
        .map(|i| {
            let src = i as f64 * ratio;
            let idx = src as usize;
            let frac = (src - idx as f64) as f32;
            let a = samples.get(idx).copied().unwrap_or(0.0);
            let b = samples.get(idx + 1).copied().unwrap_or(a);
            a + (b - a) * frac
        })
        .collect()
}
```

- [ ] **Step 2: Ensure all previous tests still pass**

```bash
cd src-tauri && cargo test transcription::tests 2>&1 | tail -10
```

Expected: all 6 tests pass.

- [ ] **Step 3: Smoke test model loading**

Add a temporary `#[test]` at the bottom of the `tests` module — only runs if the model exists:

```rust
#[test]
#[ignore] // run manually: cargo test load_model -- --ignored --nocapture
fn load_model() {
    let path = std::path::PathBuf::from("resources/ggml-small.en-q8_0.bin");
    if !path.exists() {
        eprintln!("model not found, skipping");
        return;
    }
    let engine = WhisperEngine::new(&path).expect("model load failed");
    // Empty audio → empty string, not an error
    let result = engine.transcribe(&vec![0.0f32; 1600]);
    assert!(result.is_ok());
    println!("transcribe result: {:?}", result.unwrap());
}
```

```bash
cd src-tauri && cargo test load_model -- --ignored --nocapture 2>&1 | tail -10
```

Expected: `ok` or `model not found, skipping`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/transcription.rs
git commit -m "feat: implement WhisperEngine and resample_to_16k"
```

---

## Task 7: Implement type_text

**Files:**
- Modify: `src-tauri/src/transcription.rs` (replace `type_text` stub)

- [ ] **Step 1: Replace the type_text stub**

Replace `pub fn type_text(_text: &str) {}` with:

```rust
use enigo::{Enigo, Keyboard, Settings};

/// Type `text` into the currently focused application.
/// Falls back to clipboard + Cmd+V if enigo fails.
pub fn type_text(text: &str) {
    let trimmed = text.trim();
    if trimmed.is_empty() { return; }

    match Enigo::new(&Settings::default()) {
        Ok(mut enigo) => {
            // Append a space so consecutive utterances don't run together
            let with_space = format!("{trimmed} ");
            if let Err(e) = enigo.text(&with_space) {
                eprintln!("[transcription] enigo error: {e}, falling back to clipboard");
                clipboard_paste(trimmed);
            }
        }
        Err(e) => {
            eprintln!("[transcription] enigo init error: {e}, falling back to clipboard");
            clipboard_paste(trimmed);
        }
    }
}

fn clipboard_paste(text: &str) {
    if arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .is_ok()
    {
        // Simulate Cmd+V
        if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
            use enigo::Key;
            let _ = enigo.key(Key::Meta, enigo::Direction::Press);
            let _ = enigo.key(Key::Unicode('v'), enigo::Direction::Click);
            let _ = enigo.key(Key::Meta, enigo::Direction::Release);
        }
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with no errors.

- [ ] **Step 3: All previous tests still pass**

```bash
cd src-tauri && cargo test transcription::tests 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/transcription.rs
git commit -m "feat: implement type_text with enigo and clipboard fallback"
```

---

## Task 8: Wire global shortcut, tray, and transcription worker in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Replace lib.rs with the full wired implementation**

```rust
// src-tauri/src/lib.rs
mod server;
mod audio;
mod transcription;

use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState, Modifiers, Code};

/// Shared state for the dictation session.
struct DictationState {
    recorder: audio::AudioRecorder,
    detector: transcription::SilenceDetector,
    is_recording: bool,
    chunk_tx: std::sync::mpsc::SyncSender<Vec<f32>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Channel: audio chunks → transcription worker thread
    let (chunk_tx, chunk_rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(8);

    // Build shared dictation state
    let dictation = Arc::new(Mutex::new(DictationState {
        recorder: audio::AudioRecorder::new(),
        detector: transcription::SilenceDetector::new(
            /* sample_rate — updated at first start; use 44100 as default */
            44100, 0.01, 300, 500, 10000,
        ),
        is_recording: false,
        chunk_tx,
    }));

    // Tray icon animation state
    let recording_flag = Arc::new(Mutex::new(false));

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin({
            let dictation = dictation.clone();
            let recording_flag = recording_flag.clone();
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if !shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::Space) {
                        return;
                    }
                    match event.state() {
                        ShortcutState::Pressed => {
                            let mut d = dictation.lock().unwrap();
                            if d.is_recording { return; }
                            match d.recorder.start() {
                                Ok(()) => {
                                    // Re-create detector with actual sample rate
                                    d.detector = transcription::SilenceDetector::new(
                                        d.recorder.native_sample_rate,
                                        0.01, 300, 500, 10000,
                                    );
                                    d.is_recording = true;
                                    *recording_flag.lock().unwrap() = true;
                                    set_tray_recording(app, true);
                                }
                                Err(e) => eprintln!("[dictation] failed to start: {e}"),
                            }
                        }
                        ShortcutState::Released => {
                            let mut d = dictation.lock().unwrap();
                            if !d.is_recording { return; }
                            // Flush remaining audio
                            let remaining = d.recorder.drain();
                            if let Some(chunk) = d.detector.push(&remaining)
                                .or_else(|| d.detector.flush())
                            {
                                let _ = d.chunk_tx.try_send(chunk);
                            }
                            d.recorder.stop();
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
            let icon = tauri::image::Image::from_path(
                app.path().resource_dir()
                    .map(|p| p.join("icons/tray-mic.png"))
                    .unwrap_or_else(|_| "src-tauri/icons/tray-mic.png".into())
            ).ok();
            let mut tray = tauri::tray::TrayIconBuilder::new()
                .id("dictation")
                .tooltip("Work With Me — hold Cmd+Shift+Space to dictate");
            if let Some(img) = icon {
                tray = tray.icon(img);
            }
            tray.build(app.handle())?;

            // Register global shortcut Cmd+Shift+Space
            app.global_shortcut().register("Super+Shift+Space")?;

            // Load whisper model
            let model_path = app.path().resource_dir()
                .map(|p| p.join("resources/ggml-small.en-q8_0.bin"))
                .unwrap_or_else(|_| "src-tauri/resources/ggml-small.en-q8_0.bin".into());

            std::thread::spawn(move || {
                match transcription::WhisperEngine::new(&model_path) {
                    Ok(engine) => {
                        println!("[dictation] whisper model loaded");
                        let engine = Arc::new(engine);
                        // Transcription worker: receive chunks, transcribe, type
                        while let Ok(chunk) = chunk_rx.recv() {
                            let resampled = transcription::resample_to_16k(&chunk, 44100);
                            // Note: we use a fixed 44100 here; a production improvement
                            // would pass native_sample_rate through the channel message.
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
                        eprintln!("[dictation] global hotkey will be disabled");
                    }
                }
            });

            // HTTP server (existing)
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
```

- [ ] **Step 2: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | tail -10
```

Expected: `Finished` with no errors. If `tauri_plugin_global_shortcut` import issues arise, check that `tauri-plugin-global-shortcut = "2"` is in Cargo.toml.

- [ ] **Step 3: All unit tests still pass**

```bash
cd src-tauri && cargo test transcription::tests 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: wire global shortcut, tray icon, and transcription worker"
```

---

## Task 9: Fix sample rate in transcription worker and build

**Files:**
- Modify: `src-tauri/src/lib.rs` (pass native_sample_rate through channel)
- Modify: `src-tauri/src/transcription.rs` (update chunk_tx message type)

The Task 8 implementation uses a hardcoded `44100` for resampling in the worker thread. Fix this by passing the sample rate alongside the audio chunk.

- [ ] **Step 1: Update the channel type to carry sample rate**

In `lib.rs`, change the channel type to `(Vec<f32>, u32)`:

```rust
// Change this line in DictationState:
chunk_tx: std::sync::mpsc::SyncSender<(Vec<f32>, u32)>,

// In the struct initializer:
chunk_tx: chunk_tx,  // (same name, just type changes)
```

Change `(chunk_tx, chunk_rx)` declaration:
```rust
let (chunk_tx, chunk_rx) = std::sync::mpsc::sync_channel::<(Vec<f32>, u32)>(8);
```

Update the chunk send in `ShortcutState::Released`:
```rust
let native_rate = d.recorder.native_sample_rate;
if let Some(chunk) = d.detector.push(&remaining).or_else(|| d.detector.flush()) {
    let _ = d.chunk_tx.try_send((chunk, native_rate));
}
```

Update the transcription worker receive loop:
```rust
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
```

Also update the ongoing push in the hotkey pressed handler — add a periodic drain loop using a background thread that polls the recorder buffer every 20ms and feeds the detector:

```rust
// Replace the Pressed arm with:
ShortcutState::Pressed => {
    let mut d = dictation.lock().unwrap();
    if d.is_recording { return; }
    match d.recorder.start() {
        Ok(()) => {
            d.detector = transcription::SilenceDetector::new(
                d.recorder.native_sample_rate,
                0.01, 300, 500, 10000,
            );
            d.is_recording = true;
            *recording_flag.lock().unwrap() = true;
            set_tray_recording(app, true);
        }
        Err(e) => eprintln!("[dictation] failed to start: {e}"),
    }
}
```

Add a polling thread in `setup()` that feeds the detector:

```rust
// In setup(), after the animation loop thread:
let dictation_poll = dictation.clone();
std::thread::spawn(move || {
    loop {
        std::thread::sleep(std::time::Duration::from_millis(20));
        let mut d = dictation_poll.lock().unwrap();
        if !d.is_recording { continue; }
        let samples = d.recorder.drain();
        if samples.is_empty() { continue; }
        let native_rate = d.recorder.native_sample_rate;
        if let Some(chunk) = d.detector.push(&samples) {
            let _ = d.chunk_tx.try_send((chunk, native_rate));
        }
    }
});
```

- [ ] **Step 2: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | tail -10
```

Expected: `Finished`.

- [ ] **Step 3: Run full test suite**

```bash
cd src-tauri && cargo test 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix: pass native sample rate through transcription channel"
```

---

## Task 10: Build and end-to-end manual test

**Files:** none (verification only)

- [ ] **Step 1: Build in dev mode**

```bash
pnpm tauri dev 2>&1 | grep -E "\[dictation\]|error|warning" | head -30
```

Expected log lines:
```
[dictation] whisper model loaded
```

- [ ] **Step 2: Verify tray icon appears**

Check the macOS menu bar — a small mic icon should appear next to the clock.

- [ ] **Step 3: Test dictation in TextEdit**

1. Open TextEdit → New Document
2. Click inside the document to focus it
3. Hold `Cmd+Shift+Space`
4. Menu bar icon should turn red/animate
5. Speak: *"Hello world this is a test"*
6. Pause (300ms silence)
7. Observe: transcribed text appears in TextEdit while still holding
8. Release `Cmd+Shift+Space`
9. Icon returns to gray

Expected: "Hello world this is a test" (or close) appears in TextEdit.

- [ ] **Step 4: Test in browser address bar**

1. Open Safari
2. Click the address bar
3. Hold `Cmd+Shift+Space`, speak a URL phrase, release
4. Text should appear in the address bar

- [ ] **Step 5: Test fallback — try with mic permission denied**

In System Settings → Privacy & Security → Microphone, remove the app.
Expected: `[dictation] failed to start: No default input device found` in logs, no crash.

Re-grant permission and verify it works again.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: voice transcription with global hotkey (Cmd+Shift+Space)"
```
