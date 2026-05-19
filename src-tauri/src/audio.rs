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

// SAFETY: cpal::Stream on macOS (CoreAudio) is !Send because AudioUnit has thread affinity —
// it must be created and destroyed on the same thread. This is safe here because:
// 1. `_stream` is created in `start()`, called only from the global shortcut handler
//    which on macOS dispatches on the main thread.
// 2. `_stream` is dropped in `stop()`, also called only from the shortcut handler on
//    the main thread.
// 3. The polling thread accesses `AudioRecorder` via `drain()` which only touches
//    `buffer: Arc<Mutex<Vec<f32>>>` — it never accesses `_stream`. Thread affinity preserved.
unsafe impl Send for AudioRecorder {}

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
        self.buffer.lock().expect("mutex poisoned: audio buffer").clear();
    }

    /// Take all buffered samples, leaving the buffer empty.
    pub fn drain(&self) -> Vec<f32> {
        std::mem::take(&mut self.buffer.lock().expect("mutex poisoned: audio buffer"))
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
    buffer.lock().expect("mutex poisoned: audio buffer").extend_from_slice(&mono);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_push_mono(data: &[f32], channels: usize) -> Vec<f32> {
        let buf = Arc::new(Mutex::new(Vec::new()));
        push_mono(data, channels, &buf);
        buf.lock().unwrap().clone()
    }

    #[test]
    fn mono_passthrough() {
        let samples = vec![0.1, 0.2, 0.3];
        assert_eq!(run_push_mono(&samples, 1), samples);
    }

    #[test]
    fn stereo_downmix_averages_pairs() {
        // Interleaved L/R: [0.0, 1.0, 0.4, 0.6]  → mono: [0.5, 0.5]
        let data = vec![0.0_f32, 1.0, 0.4, 0.6];
        let out = run_push_mono(&data, 2);
        assert_eq!(out.len(), 2);
        assert!((out[0] - 0.5).abs() < 1e-6);
        assert!((out[1] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn quad_channel_averaging() {
        // 4 channels all 1.0 → mono 1.0
        let data = vec![1.0_f32; 8]; // two frames of 4 ch
        let out = run_push_mono(&data, 4);
        assert_eq!(out.len(), 2);
        assert!((out[0] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn empty_input_produces_empty_output() {
        assert_eq!(run_push_mono(&[], 1), vec![]);
        assert_eq!(run_push_mono(&[], 2), vec![]);
    }

    #[test]
    fn push_mono_appends_to_existing_buffer() {
        let buf = Arc::new(Mutex::new(vec![0.5_f32]));
        push_mono(&[0.1, 0.2], 1, &buf);
        let result = buf.lock().unwrap().clone();
        assert_eq!(result, vec![0.5, 0.1, 0.2]);
    }
}
