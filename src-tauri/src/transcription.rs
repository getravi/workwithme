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
    /// How many samples have been analysed (frame cursor into buffer)
    cursor: usize,
    /// Accumulated non-silent (speech) samples seen so far in this buffer
    speech_samples: usize,
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
        debug_assert!(sample_rate > 0, "sample_rate must be > 0");
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
            cursor: 0,
            speech_samples: 0,
        }
    }

    /// Push samples. Returns `Some(chunk)` when an utterance boundary is detected.
    pub fn push(&mut self, samples: &[f32]) -> Option<Vec<f32>> {
        self.buffer.extend_from_slice(samples);

        // Force-split if buffer exceeds max
        if self.buffer.len() >= self.max_chunk_samples {
            return Some(self.take_buffer());
        }

        // Process complete 20ms frames using a cursor so the full buffer is preserved
        while self.cursor + self.frame_size <= self.buffer.len() {
            let frame = &self.buffer[self.cursor..self.cursor + self.frame_size];
            let rms = rms(frame);
            if rms < self.threshold {
                self.silent_frames += 1;
            } else {
                self.silent_frames = 0;
                self.speech_samples += self.frame_size;
            }
            self.cursor += self.frame_size;
            if self.silent_frames >= self.silence_frames_needed
                && self.speech_samples >= self.min_chunk_samples
            {
                return Some(self.take_buffer());
            }
        }
        None
    }

    /// Flush any remaining buffered audio (call on hotkey release).
    pub fn flush(&mut self) -> Option<Vec<f32>> {
        if self.buffer.len() >= self.min_chunk_samples {
            Some(self.take_buffer())
        } else {
            self.buffer.clear();
            self.cursor = 0;
            self.speech_samples = 0;
            None
        }
    }

    fn take_buffer(&mut self) -> Vec<f32> {
        self.silent_frames = 0;
        self.cursor = 0;
        self.speech_samples = 0;
        std::mem::take(&mut self.buffer)
    }
}

fn rms(samples: &[f32]) -> f32 {
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

// ── WhisperEngine ─────────────────────────────────────────────────────────────
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
        params.set_suppress_nst(true);

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

    #[test]
    #[ignore]
    fn load_model() {
        let path = std::path::PathBuf::from("resources/ggml-small.en-q8_0.bin");
        if !path.exists() {
            println!("model not found at {:?}, skipping", path);
            return;
        }
        let engine = WhisperEngine::new(&path).expect("model load failed");
        let result = engine.transcribe(&vec![0.0f32; 1600]);
        assert!(result.is_ok());
        println!("transcribe result: {:?}", result.unwrap());
    }
}
