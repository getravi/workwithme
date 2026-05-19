//! macOS window listing and per-window screenshot capture.
//!
//! Uses CoreGraphics (`CGWindowListCopyWindowInfo`, `CGWindowListCreateImageFromArray`)
//! via raw FFI to enumerate visible on-screen windows and capture them as PNG images.
//! The captured PNG is base64-encoded for transfer to the frontend.
//!
//! This module is compiled only on `target_os = "macos"`.

#![cfg(target_os = "macos")]

use base64::Engine;
use serde::Serialize;
use std::ffi::{c_void, CStr, CString};
use std::os::raw::{c_char, c_int, c_long};
use tauri::AppHandle;

use crate::capture;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct WindowInfo {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

// ── CoreFoundation / CoreGraphics raw FFI ────────────────────────────────────

type CFTypeRef = *const c_void;
type CFArrayRef = *const c_void;
type CFDictRef = *const c_void;

const CF_NUMBER_SINT32: c_int = 3;
const CF_NUMBER_FLOAT64: c_int = 13;
const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

const WIN_LIST_ON_SCREEN: u32 = 1 << 0;
const WIN_LIST_EXCLUDE_DESKTOP: u32 = 1 << 4;
const CG_NULL_WINDOW: u32 = 0;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFAllocatorDefault: CFTypeRef;
    fn CFArrayGetCount(arr: CFArrayRef) -> c_long;
    fn CFArrayGetValueAtIndex(arr: CFArrayRef, idx: c_long) -> CFTypeRef;
    fn CFDictionaryGetValue(dict: CFDictRef, key: CFTypeRef) -> CFTypeRef;
    fn CFNumberGetValue(n: CFTypeRef, theType: c_int, out: *mut c_void) -> bool;
    fn CFStringGetCStringPtr(s: CFTypeRef, enc: u32) -> *const c_char;
    fn CFStringGetLength(s: CFTypeRef) -> c_long;
    fn CFStringGetCString(s: CFTypeRef, buf: *mut c_char, buf_size: c_long, enc: u32) -> bool;
    fn CFStringCreateWithCString(alloc: CFTypeRef, c_str: *const c_char, enc: u32) -> CFTypeRef;
    fn CFRelease(cf: CFTypeRef);
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CFArrayRef;
    static kCGWindowNumber: CFTypeRef;
    static kCGWindowOwnerName: CFTypeRef;
    static kCGWindowName: CFTypeRef;
    static kCGWindowBounds: CFTypeRef;
    static kCGWindowLayer: CFTypeRef;
    static kCGWindowOwnerPID: CFTypeRef;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

unsafe fn cfstring_to_rust(s: CFTypeRef) -> Option<String> {
    if s.is_null() {
        return None;
    }
    let ptr = CFStringGetCStringPtr(s, CF_STRING_ENCODING_UTF8);
    if !ptr.is_null() {
        return Some(CStr::from_ptr(ptr).to_string_lossy().into_owned());
    }
    let len = CFStringGetLength(s);
    let buf_size = len * 4 + 1;
    let mut buf = vec![0i8; buf_size as usize];
    if CFStringGetCString(s, buf.as_mut_ptr() as *mut c_char, buf_size, CF_STRING_ENCODING_UTF8) {
        Some(CStr::from_ptr(buf.as_ptr() as *const c_char).to_string_lossy().into_owned())
    } else {
        None
    }
}

unsafe fn dict_get_i32(dict: CFDictRef, key: CFTypeRef) -> Option<i32> {
    let v = CFDictionaryGetValue(dict, key);
    if v.is_null() {
        return None;
    }
    let mut out: i32 = 0;
    if CFNumberGetValue(v, CF_NUMBER_SINT32, &mut out as *mut i32 as *mut c_void) {
        Some(out)
    } else {
        None
    }
}

unsafe fn dict_get_f64(dict: CFDictRef, key: CFTypeRef) -> Option<f64> {
    let v = CFDictionaryGetValue(dict, key);
    if v.is_null() {
        return None;
    }
    let mut out: f64 = 0.0;
    if CFNumberGetValue(v, CF_NUMBER_FLOAT64, &mut out as *mut f64 as *mut c_void) {
        Some(out)
    } else {
        None
    }
}

unsafe fn dict_get_string(dict: CFDictRef, key: CFTypeRef) -> Option<String> {
    let v = CFDictionaryGetValue(dict, key);
    cfstring_to_rust(v)
}

/// Creates a temporary CFString from a Rust string slice.
/// # Panics
/// Panics if `s` contains an interior NUL byte. Only call with known-safe string literals.
unsafe fn make_cfstring(s: &str) -> CFTypeRef {
    let c = CString::new(s).expect("invariant: make_cfstring called with NUL-free string literals only");
    CFStringCreateWithCString(kCFAllocatorDefault, c.as_ptr(), CF_STRING_ENCODING_UTF8)
}

// ── Window list ──────────────────────────────────────────────────────────────

fn collect_windows() -> Vec<WindowInfo> {
    let our_pid = std::process::id() as i32;
    unsafe {
        let arr = CGWindowListCopyWindowInfo(
            WIN_LIST_ON_SCREEN | WIN_LIST_EXCLUDE_DESKTOP,
            CG_NULL_WINDOW,
        );
        if arr.is_null() {
            return vec![];
        }
        let count = CFArrayGetCount(arr);
        let mut windows = Vec::new();

        // Create bounds dict keys once before the loop
        let xk = make_cfstring("X");
        let yk = make_cfstring("Y");
        let wk = make_cfstring("Width");
        let hk = make_cfstring("Height");

        for i in 0..count {
            let dict = CFArrayGetValueAtIndex(arr, i);
            if dict.is_null() {
                continue;
            }

            // Layer 0 = normal application windows; skip menu bar items, etc.
            let layer = dict_get_i32(dict, kCGWindowLayer).unwrap_or(1);
            if layer != 0 {
                continue;
            }

            // Skip our own windows
            let owner_pid = dict_get_i32(dict, kCGWindowOwnerPID).unwrap_or(0);
            if owner_pid == our_pid {
                continue;
            }

            let id = match dict_get_i32(dict, kCGWindowNumber) {
                Some(n) if n > 0 => n as u32,
                _ => continue,
            };

            let app_name = dict_get_string(dict, kCGWindowOwnerName).unwrap_or_default();
            let title = dict_get_string(dict, kCGWindowName).unwrap_or_default();

            // Bounds sub-dict keys: "X", "Y", "Width", "Height"
            let bounds_dict = CFDictionaryGetValue(dict, kCGWindowBounds);
            if bounds_dict.is_null() {
                continue;
            }

            let x = dict_get_f64(bounds_dict, xk);
            let y = dict_get_f64(bounds_dict, yk);
            let width = dict_get_f64(bounds_dict, wk);
            let height = dict_get_f64(bounds_dict, hk);

            let (x, y, width, height) = match (x, y, width, height) {
                (Some(x), Some(y), Some(w), Some(h)) => (x, y, w, h),
                _ => continue,
            };

            // Skip off-screen and zero-size windows
            if width < 1.0 || height < 1.0 {
                continue;
            }
            if x < -10_000.0 || y < -10_000.0 {
                continue;
            }

            windows.push(WindowInfo { id, app_name, title, x, y, width, height });
        }

        // Release the bounds dict keys
        CFRelease(xk);
        CFRelease(yk);
        CFRelease(wk);
        CFRelease(hk);
        CFRelease(arr);
        windows
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_window_list() -> Result<Vec<WindowInfo>, String> {
    Ok(collect_windows())
}

#[tauri::command]
pub fn capture_window(app: AppHandle, window_id: u32) -> Result<(), String> {
    let tmp = std::env::temp_dir().join(format!("wwm_window_{window_id}.png"));

    let status = std::process::Command::new("screencapture")
        .args([
            "-l",
            &window_id.to_string(),
            "-o", // no shadow / framing
            "-x", // no sound
            "-t",
            "png",
            tmp.to_str().ok_or("invalid tmp path")?,
        ])
        .status()
        .map_err(|e| format!("screencapture failed to start: {e}"))?;

    if !status.success() {
        return Err(format!("screencapture exited non-zero: {status}"));
    }

    let bytes = std::fs::read(&tmp).map_err(|e| format!("read tmp: {e}"))?;
    std::fs::remove_file(&tmp).ok();

    let base64_png = base64::engine::general_purpose::STANDARD.encode(&bytes);

    // Look up metadata for this window so we can store it in the library
    let win_info = collect_windows().into_iter().find(|w| w.id == window_id);
    let app_name = win_info.as_ref().map(|w| w.app_name.as_str()).unwrap_or("");
    let window_title = win_info.as_ref().map(|w| w.title.as_str()).unwrap_or("");
    let library_id = crate::library::commands::save_draft_internal(
        &base64_png,
        Some(app_name),
        Some(window_title),
    ).ok();

    capture::open_editor_window(app, base64_png, library_id)
}
