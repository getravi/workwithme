//! Capture library — screen captures and recordings stored locally.
//!
//! Sub-modules:
//! - [`db`] — SQLite CRUD and FTS5 full-text search
//! - [`ocr`] — Apple Vision background OCR (macOS only)
//! - [`commands`] — Tauri command handlers exposed to the frontend

pub mod db;
pub mod ocr;
pub mod commands;

pub use commands::*;
