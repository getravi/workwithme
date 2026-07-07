//! Application entry point — delegates immediately to `workwithme_lib::run()`.
//! The `windows_subsystem = "windows"` attribute suppresses the console window
//! in release builds on Windows.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    workwithme_lib::run()
}
