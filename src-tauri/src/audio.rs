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
