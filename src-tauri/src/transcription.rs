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

// ── placeholder stubs (filled in Tasks 6 & 7) ────────────────────────────────
pub struct WhisperEngine;
impl WhisperEngine {
    pub fn new(_path: &std::path::Path) -> anyhow::Result<Self> { Ok(Self) }
    pub fn transcribe(&self, _audio: &[f32]) -> anyhow::Result<String> { Ok(String::new()) }
}
pub fn resample_to_16k(samples: &[f32], _from_rate: u32) -> Vec<f32> { samples.to_vec() }
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
