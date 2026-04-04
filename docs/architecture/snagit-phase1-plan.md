# Screen Capture & Annotation — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Snagit-style region capture, annotation editor (6 tools), and clipboard/file export to the workwithme Tauri app.

**Architecture:** A transparent fullscreen Tauri overlay captures the region via the `screenshots` Rust crate and passes a base64 PNG to a floating editor window. The editor uses Konva.js for canvas annotation and calls Rust commands to copy to clipboard (arboard) or save to disk (image crate).

**Tech Stack:** Rust (screenshots, image, arboard, tauri commands), React + TypeScript, Konva.js + react-konva, Tauri v2, vitest + jsdom

**Spec:** `docs/architecture/snagit-phase1-design.md`

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `src-tauri/Cargo.toml` | Modify | Add screenshots, image crates |
| `src-tauri/src/capture.rs` | Create | All capture Tauri commands |
| `src-tauri/src/lib.rs` | Modify | Register capture module, CaptureState, hotkey, tray menu |
| `src-tauri/tauri.conf.json` | Modify | CSP: add blob: to img-src |
| `capture-overlay.html` | Create | Vite entry for overlay window |
| `editor.html` | Create | Vite entry for editor window |
| `src/capture-overlay.tsx` | Create | React mount for overlay window |
| `src/editor.tsx` | Create | React mount for editor window |
| `src/CaptureOverlay.tsx` | Create | Fullscreen region-selection canvas component |
| `src/EditorWindow.tsx` | Create | Konva.js annotation editor component |
| `src/test/CaptureOverlay.test.tsx` | Create | Tests for region selection logic |
| `src/test/EditorWindow.test.tsx` | Create | Tests for tool state + undo + export logic |
| `vite.config.ts` | Modify | Multi-entry build (index, capture-overlay, editor) |
| `package.json` | Modify | Add konva, react-konva |

---

## Task 1: Add Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `package.json`

- [ ] **Step 1: Add Rust crates to Cargo.toml**

Open `src-tauri/Cargo.toml`. After the `arboard = "3"` line, add:

```toml
screenshots = "0.8"
image = "0.25"
```

- [ ] **Step 2: Add npm packages**

```bash
pnpm add konva react-konva
```

Expected: `konva` and `react-konva` appear in `package.json` dependencies.

- [ ] **Step 3: Verify Rust compiles with new crates**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with 0 errors. (First run downloads crates — may take 30–60s.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock package.json pnpm-lock.yaml
git commit -m "feat: add screenshots, image, konva dependencies"
```

---

## Task 2: Vite Multi-Entry + HTML Entry Points

**Files:**
- Create: `capture-overlay.html`
- Create: `editor.html`
- Create: `src/capture-overlay.tsx`
- Create: `src/editor.tsx`
- Modify: `vite.config.ts`

- [ ] **Step 1: Create `capture-overlay.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Capture</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
      #root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/capture-overlay.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `editor.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Screenshot Editor</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; background: #111; }
      #root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/editor.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `src/capture-overlay.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { CaptureOverlay } from "./CaptureOverlay";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CaptureOverlay />
  </React.StrictMode>
);
```

- [ ] **Step 4: Create `src/editor.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { EditorWindow } from "./EditorWindow";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <EditorWindow />
  </React.StrictMode>
);
```

- [ ] **Step 5: Create placeholder `src/CaptureOverlay.tsx`** (will be filled in Task 9)

```tsx
export function CaptureOverlay() {
  return <div style={{ width: "100vw", height: "100vh", background: "transparent" }} />;
}
```

- [ ] **Step 6: Create placeholder `src/EditorWindow.tsx`** (will be filled in Tasks 10–14)

```tsx
export function EditorWindow() {
  return <div style={{ width: "100vw", height: "100vh", background: "#111" }} />;
}
```

- [ ] **Step 7: Update `vite.config.ts` for multi-entry build**

Replace the entire `vite.config.ts` with:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        "capture-overlay": "capture-overlay.html",
        editor: "editor.html",
      },
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-ui": [
            "lucide-react",
            "react-markdown",
            "react-syntax-highlighter",
            "dompurify",
          ],
          "vendor-konva": ["konva", "react-konva"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

- [ ] **Step 8: Verify the frontend builds**

```bash
pnpm run build 2>&1 | tail -10
```

Expected: Three entry points built (`index.html`, `capture-overlay.html`, `editor.html`), no errors.

- [ ] **Step 9: Commit**

```bash
git add capture-overlay.html editor.html src/capture-overlay.tsx src/editor.tsx src/CaptureOverlay.tsx src/EditorWindow.tsx vite.config.ts
git commit -m "feat: add vite multi-entry + window entry points for capture and editor"
```

---

## Task 3: Rust Capture Module Skeleton

**Files:**
- Create: `src-tauri/src/capture.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `src-tauri/src/capture.rs` with all command stubs**

```rust
use tauri::AppHandle;

/// Shared state: holds the base64 PNG captured from the screen
/// until the editor window is ready to request it.
pub struct CaptureState {
    pub pending_image: std::sync::Mutex<Option<String>>,
}

impl CaptureState {
    pub fn new() -> Self {
        Self {
            pending_image: std::sync::Mutex::new(None),
        }
    }
}

/// Capture a rectangular region of the screen.
/// Returns a base64-encoded PNG string.
/// Coordinates are in logical pixels; Rust converts to physical using the scale factor.
#[tauri::command]
pub fn capture_region(
    _app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let _ = (x, y, width, height);
    Err("not implemented".to_string())
}

/// Copy a base64-encoded PNG image to the system clipboard as image data.
#[tauri::command]
pub fn copy_image_to_clipboard(base64_png: String) -> Result<(), String> {
    let _ = base64_png;
    Err("not implemented".to_string())
}

/// Show a save-file dialog and write the image as PNG or JPG.
/// Returns the path the file was saved to.
#[tauri::command]
pub async fn save_image_to_file(
    _app: AppHandle,
    base64_png: String,
) -> Result<String, String> {
    let _ = base64_png;
    Err("not implemented".to_string())
}

/// Create the transparent fullscreen capture overlay window.
#[tauri::command]
pub fn open_capture_overlay(_app: AppHandle) -> Result<(), String> {
    Err("not implemented".to_string())
}

/// Store the captured image and open the annotation editor window.
#[tauri::command]
pub fn open_editor_window(
    _app: AppHandle,
    base64_png: String,
) -> Result<(), String> {
    let _ = base64_png;
    Err("not implemented".to_string())
}

/// Called by the editor frontend on mount to retrieve the pending captured image.
#[tauri::command]
pub fn get_captured_image(
    state: tauri::State<CaptureState>,
) -> Option<String> {
    state.pending_image.lock().unwrap().take()
}
```

- [ ] **Step 2: Register the capture module and all commands in `src-tauri/src/lib.rs`**

At the top of `lib.rs`, add after `mod transcription;`:

```rust
mod capture;
```

In the `tauri::Builder::default()` chain, find `.manage(InAppDictationState {...})` and add after it:

```rust
.manage(capture::CaptureState::new())
```

In the `.invoke_handler(tauri::generate_handler![toggle_in_app_dictation])` line, expand it to:

```rust
.invoke_handler(tauri::generate_handler![
    toggle_in_app_dictation,
    capture::capture_region,
    capture::copy_image_to_clipboard,
    capture::save_image_to_file,
    capture::open_capture_overlay,
    capture::open_editor_window,
    capture::get_captured_image,
])
```

- [ ] **Step 3: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/capture.rs src-tauri/src/lib.rs
git commit -m "feat: add capture module skeleton with all command stubs"
```

---

## Task 4: Implement `capture_region`

**Files:**
- Modify: `src-tauri/src/capture.rs`

- [ ] **Step 1: Write the failing test for base64 round-trip in `capture.rs`**

Add to the bottom of `src-tauri/src/capture.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    /// Verify that a known RGBA image encodes to valid base64 PNG
    /// and can be decoded back to the same pixel dimensions.
    #[test]
    fn test_rgba_to_base64_png_round_trip() {
        // 2×2 red image
        let rgba: Vec<u8> = vec![
            255, 0, 0, 255,  // pixel (0,0) red
            255, 0, 0, 255,  // pixel (1,0) red
            255, 0, 0, 255,  // pixel (0,1) red
            255, 0, 0, 255,  // pixel (1,1) red
        ];
        let img = image::RgbaImage::from_raw(2, 2, rgba).unwrap();
        let dyn_img = image::DynamicImage::ImageRgba8(img);

        let mut cursor = std::io::Cursor::new(Vec::new());
        dyn_img
            .write_to(&mut cursor, image::ImageFormat::Png)
            .unwrap();
        let png_bytes = cursor.into_inner();
        let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);

        // Decode back
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&b64)
            .unwrap();
        let decoded_img = image::load_from_memory(&decoded).unwrap();
        assert_eq!(decoded_img.width(), 2);
        assert_eq!(decoded_img.height(), 2);
    }
}
```

- [ ] **Step 2: Run the test — it should pass (tests logic we already know works)**

```bash
cd src-tauri && cargo test test_rgba_to_base64_png_round_trip -- --nocapture 2>&1
```

Expected: `test tests::test_rgba_to_base64_png_round_trip ... ok`

- [ ] **Step 3: Implement `capture_region`**

Replace the `capture_region` stub in `capture.rs` with:

```rust
#[tauri::command]
pub fn capture_region(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    use base64::Engine;

    // Get scale factor from the main window (or default to 1.0)
    let scale = app
        .get_webview_window("capture-overlay")
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(1.0);

    let px = (x as f64 * scale) as i32;
    let py = (y as f64 * scale) as i32;
    let pw = (width as f64 * scale) as u32;
    let ph = (height as f64 * scale) as u32;

    // Find the screen containing the selection origin
    let screen = screenshots::Screen::from_point(px, py)
        .map_err(|e| format!("screen lookup failed: {e}"))?;

    let capture = screen
        .capture_area(px, py, pw, ph)
        .map_err(|e| format!("capture failed: {e}"))?;

    // Encode to PNG → base64
    let dyn_img = image::DynamicImage::ImageRgba8(capture);
    let mut cursor = std::io::Cursor::new(Vec::new());
    dyn_img
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("encode failed: {e}"))?;
    let png_bytes = cursor.into_inner();

    Ok(base64::engine::general_purpose::STANDARD.encode(&png_bytes))
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/capture.rs
git commit -m "feat: implement capture_region with HiDPI scale factor"
```

---

## Task 5: Implement Clipboard + File Export Commands

**Files:**
- Modify: `src-tauri/src/capture.rs`

- [ ] **Step 1: Write tests for image decode and file write**

Add to the `#[cfg(test)]` block at the bottom of `capture.rs`:

```rust
    #[test]
    fn test_decode_base64_png_to_rgba() {
        // Encode a known image then decode via our logic
        let rgba: Vec<u8> = vec![0, 128, 255, 255, 0, 128, 255, 255,
                                  0, 128, 255, 255, 0, 128, 255, 255];
        let img = image::RgbaImage::from_raw(2, 2, rgba.clone()).unwrap();
        let dyn_img = image::DynamicImage::ImageRgba8(img);
        let mut cursor = std::io::Cursor::new(Vec::new());
        dyn_img.write_to(&mut cursor, image::ImageFormat::Png).unwrap();
        let b64 = base64::engine::general_purpose::STANDARD.encode(cursor.into_inner());

        // Now decode as our clipboard function would
        let decoded_bytes = base64::engine::general_purpose::STANDARD.decode(&b64).unwrap();
        let decoded = image::load_from_memory(&decoded_bytes).unwrap().to_rgba8();
        assert_eq!(decoded.width(), 2);
        assert_eq!(decoded.height(), 2);
        assert_eq!(decoded.get_pixel(0, 0).0, [0, 128, 255, 255]);
    }

    #[test]
    fn test_save_image_to_temp_file() {
        use std::io::Write;

        // Build a minimal PNG in memory
        let img = image::RgbaImage::from_raw(4, 4, vec![255u8; 64]).unwrap();
        let dyn_img = image::DynamicImage::ImageRgba8(img);
        let mut cursor = std::io::Cursor::new(Vec::new());
        dyn_img.write_to(&mut cursor, image::ImageFormat::Png).unwrap();
        let b64 = base64::engine::general_purpose::STANDARD.encode(cursor.into_inner());

        // Write to a temp file the same way save_image_to_file would
        let tmp = std::env::temp_dir().join("capture_test_output.png");
        let raw = base64::engine::general_purpose::STANDARD.decode(&b64).unwrap();
        let decoded_img = image::load_from_memory(&raw).unwrap();
        decoded_img.save(&tmp).unwrap();

        assert!(tmp.exists());
        let reloaded = image::open(&tmp).unwrap();
        assert_eq!(reloaded.width(), 4);
        assert_eq!(reloaded.height(), 4);
        std::fs::remove_file(tmp).ok();
    }
```

- [ ] **Step 2: Run the new tests**

```bash
cd src-tauri && cargo test test_decode_base64_png_to_rgba test_save_image_to_temp_file -- --nocapture 2>&1
```

Expected: both tests pass.

- [ ] **Step 3: Implement `copy_image_to_clipboard`**

Replace the stub with:

```rust
#[tauri::command]
pub fn copy_image_to_clipboard(base64_png: String) -> Result<(), String> {
    use base64::Engine;
    use std::borrow::Cow;

    let raw = base64::engine::general_purpose::STANDARD
        .decode(&base64_png)
        .map_err(|e| format!("base64 decode: {e}"))?;
    let img = image::load_from_memory(&raw)
        .map_err(|e| format!("image decode: {e}"))?
        .to_rgba8();

    let (width, height) = (img.width() as usize, img.height() as usize);
    let bytes = img.into_raw();

    let mut clipboard = arboard::Clipboard::new()
        .map_err(|e| format!("clipboard: {e}"))?;
    clipboard
        .set_image(arboard::ImageData {
            width,
            height,
            bytes: Cow::Owned(bytes),
        })
        .map_err(|e| format!("set_image: {e}"))?;

    Ok(())
}
```

- [ ] **Step 4: Implement `save_image_to_file`**

Replace the stub with:

```rust
#[tauri::command]
pub async fn save_image_to_file(
    app: AppHandle,
    base64_png: String,
) -> Result<String, String> {
    use base64::Engine;
    use tauri_plugin_dialog::DialogExt;

    let raw = base64::engine::general_purpose::STANDARD
        .decode(&base64_png)
        .map_err(|e| format!("base64 decode: {e}"))?;
    let img = image::load_from_memory(&raw)
        .map_err(|e| format!("image decode: {e}"))?;

    let path = app
        .dialog()
        .file()
        .add_filter("PNG Image", &["png"])
        .add_filter("JPEG Image", &["jpg", "jpeg"])
        .blocking_save_file()
        .ok_or("Save cancelled")?;

    let path_str = path.to_string();
    img.save(&path_str)
        .map_err(|e| format!("save failed: {e}"))?;

    Ok(path_str)
}
```

- [ ] **Step 5: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/capture.rs
git commit -m "feat: implement copy_image_to_clipboard and save_image_to_file"
```

---

## Task 6: Implement Window Management Commands

**Files:**
- Modify: `src-tauri/src/capture.rs`

- [ ] **Step 1: Implement `open_capture_overlay`**

Replace the stub with:

```rust
#[tauri::command]
pub fn open_capture_overlay(app: AppHandle) -> Result<(), String> {
    // Close any stale overlay from a previous capture
    if let Some(w) = app.get_webview_window("capture-overlay") {
        let _ = w.close();
        // Give the window a moment to close before re-creating it
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "capture-overlay",
        tauri::WebviewUrl::App("capture-overlay.html".into()),
    )
    .fullscreen(true)
    .transparent(true)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .focused(true)
    .build()
    .map_err(|e| format!("failed to create overlay: {e}"))?;

    Ok(())
}
```

- [ ] **Step 2: Implement `open_editor_window`**

Replace the stub with:

```rust
#[tauri::command]
pub fn open_editor_window(
    app: AppHandle,
    base64_png: String,
) -> Result<(), String> {
    // Store image so the editor can retrieve it via get_captured_image
    let state = app.state::<CaptureState>();
    *state.pending_image.lock().unwrap() = Some(base64_png);

    // Close any existing editor
    if let Some(w) = app.get_webview_window("capture-editor") {
        let _ = w.close();
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "capture-editor",
        tauri::WebviewUrl::App("editor.html".into()),
    )
    .inner_size(1000.0, 700.0)
    .min_inner_size(600.0, 400.0)
    .always_on_top(true)
    .decorations(true)
    .resizable(true)
    .title("Screenshot Editor")
    .build()
    .map_err(|e| format!("failed to create editor: {e}"))?;

    Ok(())
}
```

- [ ] **Step 3: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/capture.rs
git commit -m "feat: implement open_capture_overlay and open_editor_window"
```

---

## Task 7: Hotkey (Cmd+Shift+4) + Tray Menu

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add Cmd+Shift+4 to the global shortcut handler**

In `lib.rs`, find the `with_handler` closure for global shortcuts. It currently has:

```rust
if !shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::Space) {
    return;
}
```

Replace with:

```rust
if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::Space) {
    // existing dictation logic — unchanged
    match event.state() {
        ShortcutState::Pressed => { /* ... existing code ... */ }
        ShortcutState::Released => {}
    }
} else if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::Digit4) {
    if event.state() == ShortcutState::Pressed {
        if let Err(e) = capture::open_capture_overlay(app.clone()) {
            eprintln!("[capture] failed to open overlay: {e}");
        }
    }
}
```

Then register the new shortcut in the `.setup` closure, after the existing line `app.global_shortcut().register("Super+Shift+Space")?;`:

```rust
app.global_shortcut().register("Super+Shift+4")?;
```

- [ ] **Step 2: Add tray menu with "Capture Screenshot" item**

In `lib.rs`, find the tray builder section inside `.setup`. Replace:

```rust
let mut tray_builder = tauri::tray::TrayIconBuilder::with_id("dictation")
    .tooltip("Work With Me — press Cmd+Shift+Space to start/stop dictation");
```

with:

```rust
let capture_item = tauri::menu::MenuItem::with_id(
    app,
    "capture-screenshot",
    "Capture Screenshot",
    true,
    Some("Super+Shift+4"),
)?;
let quit_item = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
let tray_menu = tauri::menu::MenuBuilder::new(app)
    .item(&capture_item)
    .separator()
    .item(&quit_item)
    .build()?;

let app_handle_tray = app.handle().clone();
let mut tray_builder = tauri::tray::TrayIconBuilder::with_id("dictation")
    .tooltip("Work With Me — Cmd+Shift+Space: dictate | Cmd+Shift+4: capture")
    .menu(&tray_menu)
    .on_menu_event(move |_tray, event| {
        match event.id().as_ref() {
            "capture-screenshot" => {
                if let Err(e) = capture::open_capture_overlay(app_handle_tray.clone()) {
                    eprintln!("[capture] tray trigger failed: {e}");
                }
            }
            "quit" => {
                app_handle_tray.exit(0);
            }
            _ => {}
        }
    });
```

- [ ] **Step 3: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: register Cmd+Shift+4 hotkey and tray menu for screen capture"
```

---

## Task 8: Update CSP for Konva Canvas Export

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add `blob:` to `img-src` in the CSP**

In `src-tauri/tauri.conf.json`, find:

```json
"csp": "default-src 'self'; connect-src 'self' ws://localhost:4242 http://localhost:4242; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:"
```

Replace with:

```json
"csp": "default-src 'self'; connect-src 'self' ws://localhost:4242 http://localhost:4242; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:"
```

(Only change: `data: https:` → `data: blob: https:` in `img-src`)

- [ ] **Step 2: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "fix: allow blob: in CSP for Konva canvas export"
```

---

## Task 9: CaptureOverlay Component

**Files:**
- Modify: `src/CaptureOverlay.tsx`
- Create: `src/test/CaptureOverlay.test.tsx`

- [ ] **Step 1: Write failing tests for region selection logic**

Create `src/test/CaptureOverlay.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { computeSelectionRect } from "../CaptureOverlay";

describe("computeSelectionRect", () => {
  it("returns positive rect when dragging right-down", () => {
    const rect = computeSelectionRect({ x: 10, y: 20 }, { x: 110, y: 120 });
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 100 });
  });

  it("returns positive rect when dragging left-up", () => {
    const rect = computeSelectionRect({ x: 110, y: 120 }, { x: 10, y: 20 });
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 100 });
  });

  it("returns positive rect when dragging right-up", () => {
    const rect = computeSelectionRect({ x: 10, y: 120 }, { x: 110, y: 20 });
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 100 });
  });

  it("handles zero-size drag", () => {
    const rect = computeSelectionRect({ x: 50, y: 50 }, { x: 50, y: 50 });
    expect(rect).toEqual({ x: 50, y: 50, width: 0, height: 0 });
  });
});
```

- [ ] **Step 2: Run the tests — they should fail (computeSelectionRect not exported yet)**

```bash
pnpm test -- --reporter=verbose 2>&1 | grep -A 5 "CaptureOverlay"
```

Expected: test file fails to compile / `computeSelectionRect` not found.

- [ ] **Step 3: Implement `CaptureOverlay.tsx`**

Replace `src/CaptureOverlay.tsx` with:

```tsx
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Point { x: number; y: number; }
interface Rect { x: number; y: number; width: number; height: number; }

/** Pure utility — exported for testing. */
export function computeSelectionRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function CaptureOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<Point>({ x: 0, y: 0 });
  const currentRef = useRef<Point>({ x: 0, y: 0 });

  // Draw dimmed overlay + selection rect
  function draw(canvas: HTMLCanvasElement, start: Point, current: Point) {
    const ctx = canvas.getContext("2d")!;
    const rect = computeSelectionRect(start, current);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Dim entire screen
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Cut out selected region (shows screen behind it)
    ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
    // Border around selection
    ctx.strokeStyle = "rgba(100, 180, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    // Size label
    if (rect.width > 40 && rect.height > 20) {
      ctx.fillStyle = "rgba(100, 180, 255, 0.9)";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.fillText(`${Math.round(rect.width)} × ${Math.round(rect.height)}`, rect.x + 4, rect.y - 6);
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // Initial dim
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await getCurrentWindow().close();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    startRef.current = { x: e.clientX, y: e.clientY };
    currentRef.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    currentRef.current = { x: e.clientX, y: e.clientY };
    const canvas = canvasRef.current;
    if (canvas) draw(canvas, startRef.current, currentRef.current);
  };

  const handleMouseUp = async (e: React.MouseEvent) => {
    if (!dragging) return;
    setDragging(false);
    const rect = computeSelectionRect(startRef.current, { x: e.clientX, y: e.clientY });
    if (rect.width < 5 || rect.height < 5) {
      // Too small — ignore and close
      await getCurrentWindow().close();
      return;
    }
    try {
      const base64Png: string = await invoke("capture_region", {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      await invoke("open_editor_window", { base64Png });
    } catch (err) {
      console.error("[capture] failed:", err);
    }
    await getCurrentWindow().close();
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        cursor: "crosshair",
        display: "block",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    />
  );
}
```

- [ ] **Step 4: Run the tests — they should pass**

```bash
pnpm test -- --reporter=verbose 2>&1 | grep -A 10 "CaptureOverlay"
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/CaptureOverlay.tsx src/test/CaptureOverlay.test.tsx
git commit -m "feat: implement CaptureOverlay region selection component"
```

---

## Task 10: EditorWindow — Base Structure + Image Loading

**Files:**
- Modify: `src/EditorWindow.tsx`
- Create: `src/test/EditorWindow.test.tsx`

- [ ] **Step 1: Write failing test for initial state**

Create `src/test/EditorWindow.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Mock Konva — canvas is not available in jsdom
vi.mock("react-konva", () => ({
  Stage: ({ children }: { children: React.ReactNode }) => <div data-testid="konva-stage">{children}</div>,
  Layer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Image: () => <div data-testid="konva-image" />,
  Arrow: () => <div data-testid="konva-arrow" />,
  Rect: () => <div data-testid="konva-rect" />,
  Text: () => <div data-testid="konva-text" />,
  Circle: () => <div data-testid="konva-circle" />,
  Transformer: () => <div data-testid="konva-transformer" />,
}));
vi.mock("konva", () => ({ default: {} }));

import { EditorWindow } from "../EditorWindow";
import { useEditorStore } from "../EditorWindow";

describe("EditorWindow store", () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeTool: "arrow",
      annotations: [],
      undoStack: [],
      stepCounter: 1,
      color: "#ff4444",
      strokeWeight: "medium",
      fontSize: "M",
      blurIntensity: "strong",
    });
  });

  it("starts with arrow tool active", () => {
    expect(useEditorStore.getState().activeTool).toBe("arrow");
  });

  it("setActiveTool changes the active tool", () => {
    useEditorStore.getState().setActiveTool("text");
    expect(useEditorStore.getState().activeTool).toBe("text");
  });

  it("stepCounter increments when a step annotation is added", () => {
    useEditorStore.getState().incrementStepCounter();
    expect(useEditorStore.getState().stepCounter).toBe(2);
  });

  it("undo removes last annotation and restores previous", () => {
    const store = useEditorStore.getState();
    store.pushAnnotation({ id: "a1", type: "arrow" as const, props: {} });
    store.pushAnnotation({ id: "a2", type: "arrow" as const, props: {} });
    expect(useEditorStore.getState().annotations).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations).toHaveLength(1);
    expect(useEditorStore.getState().annotations[0].id).toBe("a1");
  });

  it("undo does nothing when annotations is empty", () => {
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations).toHaveLength(0);
  });

  it("deleteAnnotation removes by id", () => {
    const store = useEditorStore.getState();
    store.pushAnnotation({ id: "x1", type: "rect" as const, props: {} });
    store.pushAnnotation({ id: "x2", type: "rect" as const, props: {} });
    useEditorStore.getState().deleteAnnotation("x1");
    const ids = useEditorStore.getState().annotations.map(a => a.id);
    expect(ids).toEqual(["x2"]);
  });
});
```

- [ ] **Step 2: Run the tests — they should fail (EditorWindow.tsx doesn't export useEditorStore yet)**

```bash
pnpm test -- --reporter=verbose 2>&1 | grep -A 15 "EditorWindow"
```

Expected: Compile errors or test failures about missing exports.

- [ ] **Step 3: Install zustand (state management already used in the app)**

Check if zustand is already installed:

```bash
grep zustand package.json
```

If not listed, add it:

```bash
pnpm add zustand
```

- [ ] **Step 4: Implement `EditorWindow.tsx` base structure**

Replace `src/EditorWindow.tsx` with:

```tsx
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Transformer } from "react-konva";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import Konva from "konva";

// ── Types ──────────────────────────────────────────────────────────────────

export type ToolType = "arrow" | "text" | "rect" | "highlight" | "blur" | "step";
export type StrokeWeight = "thin" | "medium" | "thick";
export type FontSize = "S" | "M" | "L";
export type BlurIntensity = "light" | "strong" | "solid";

export interface Annotation {
  id: string;
  type: ToolType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: Record<string, any>;
}

// ── Store ──────────────────────────────────────────────────────────────────

interface EditorState {
  activeTool: ToolType;
  annotations: Annotation[];
  undoStack: Annotation[][];   // each entry = full annotations snapshot before the change
  stepCounter: number;
  color: string;
  strokeWeight: StrokeWeight;
  fontSize: FontSize;
  blurIntensity: BlurIntensity;
  setActiveTool: (t: ToolType) => void;
  setColor: (c: string) => void;
  setStrokeWeight: (w: StrokeWeight) => void;
  setFontSize: (s: FontSize) => void;
  setBlurIntensity: (i: BlurIntensity) => void;
  pushAnnotation: (a: Annotation) => void;
  deleteAnnotation: (id: string) => void;
  undo: () => void;
  incrementStepCounter: () => void;
  resetStepCounter: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeTool: "arrow",
  annotations: [],
  undoStack: [],
  stepCounter: 1,
  color: "#ff4444",
  strokeWeight: "medium",
  fontSize: "M",
  blurIntensity: "strong",
  setActiveTool: (t) => set({ activeTool: t }),
  setColor: (c) => set({ color: c }),
  setStrokeWeight: (w) => set({ strokeWeight: w }),
  setFontSize: (s) => set({ fontSize: s }),
  setBlurIntensity: (i) => set({ blurIntensity: i }),
  pushAnnotation: (a) =>
    set((s) => ({
      undoStack: [...s.undoStack.slice(-19), s.annotations],
      annotations: [...s.annotations, a],
    })),
  deleteAnnotation: (id) =>
    set((s) => ({
      undoStack: [...s.undoStack.slice(-19), s.annotations],
      annotations: s.annotations.filter((a) => a.id !== id),
    })),
  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    set({ annotations: prev, undoStack: undoStack.slice(0, -1) });
  },
  incrementStepCounter: () => set((s) => ({ stepCounter: s.stepCounter + 1 })),
  resetStepCounter: () => set({ stepCounter: 1 }),
}));

// ── Toolbar ────────────────────────────────────────────────────────────────

const TOOL_COLORS = ["#ff4444", "#44aaff", "#44dd44", "#ffdd44", "#ffffff"];
const HIGHLIGHT_COLORS = ["rgba(255,221,0,0.4)", "rgba(0,255,128,0.4)", "rgba(0,170,255,0.4)", "rgba(255,80,80,0.4)"];

function ToolOptions() {
  const { activeTool, color, strokeWeight, fontSize, blurIntensity,
          setColor, setStrokeWeight, setFontSize, setBlurIntensity } = useEditorStore();

  const swatch = (c: string, key: string) => (
    <button
      key={key}
      onClick={() => setColor(c)}
      style={{
        width: 20, height: 20, borderRadius: "50%", background: c,
        border: color === c ? "2px solid #fff" : "2px solid transparent",
        cursor: "pointer", padding: 0,
      }}
    />
  );

  if (activeTool === "arrow" || activeTool === "rect") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={labelStyle}>Color</span>
      <div style={{ display: "flex", gap: 4 }}>{TOOL_COLORS.map((c) => swatch(c, c))}</div>
      <span style={{ ...labelStyle, marginLeft: 8 }}>Weight</span>
      {(["thin", "medium", "thick"] as StrokeWeight[]).map((w) => (
        <button key={w} onClick={() => setStrokeWeight(w)}
          style={{ ...optBtnStyle, border: strokeWeight === w ? "1px solid #6c63ff" : "1px solid transparent" }}>
          <div style={{ height: w === "thin" ? 1.5 : w === "medium" ? 3 : 5, width: 14, background: "#aaa", borderRadius: 2 }} />
        </button>
      ))}
    </div>
  );

  if (activeTool === "text") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={labelStyle}>Color</span>
      <div style={{ display: "flex", gap: 4 }}>{TOOL_COLORS.map((c) => swatch(c, c))}</div>
      <span style={{ ...labelStyle, marginLeft: 8 }}>Size</span>
      {(["S", "M", "L"] as FontSize[]).map((s) => (
        <button key={s} onClick={() => setFontSize(s)}
          style={{ ...optBtnStyle, border: fontSize === s ? "1px solid #6c63ff" : "1px solid transparent", fontSize: 11, color: "#aaa" }}>
          {s}
        </button>
      ))}
    </div>
  );

  if (activeTool === "highlight") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={labelStyle}>Color</span>
      <div style={{ display: "flex", gap: 4 }}>{HIGHLIGHT_COLORS.map((c) => swatch(c, c))}</div>
    </div>
  );

  if (activeTool === "blur") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={labelStyle}>Intensity</span>
      {(["light", "strong", "solid"] as BlurIntensity[]).map((i) => (
        <button key={i} onClick={() => setBlurIntensity(i)}
          style={{ ...optBtnStyle, border: blurIntensity === i ? "1px solid #6c63ff" : "1px solid transparent", fontSize: 11, color: "#aaa", padding: "0 8px" }}>
          {i === "solid" ? "Solid ■" : i.charAt(0).toUpperCase() + i.slice(1)}
        </button>
      ))}
    </div>
  );

  if (activeTool === "step") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={labelStyle}>Color</span>
      <div style={{ display: "flex", gap: 4 }}>{TOOL_COLORS.slice(0, 3).map((c) => swatch(c, c))}</div>
      <span style={{ ...labelStyle, marginLeft: 8, color: "#555" }}>Auto-increments ①②③…</span>
    </div>
  );

  return null;
}

const labelStyle: React.CSSProperties = { fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1 };
const optBtnStyle: React.CSSProperties = { width: 30, height: 26, background: "#2a2a3e", border: "none", borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
const TOOLS: { id: ToolType; label: string }[] = [
  { id: "arrow", label: "→" },
  { id: "text", label: "T" },
  { id: "rect", label: "□" },
  { id: "highlight", label: "〰" },
  { id: "blur", label: "▓" },
  { id: "step", label: "①" },
];

// ── Main component ─────────────────────────────────────────────────────────

export function EditorWindow() {
  const { activeTool, setActiveTool, undo } = useEditorStore();
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [copyToast, setCopyToast] = useState(false);
  const stageRef = useRef<Konva.Stage>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load captured image from Rust state
  useEffect(() => {
    invoke<string | null>("get_captured_image").then((b64) => {
      if (!b64) return;
      const img = new window.Image();
      img.src = `data:image/png;base64,${b64}`;
      img.onload = () => {
        setImageEl(img);
        setStageSize({ width: img.naturalWidth, height: img.naturalHeight });
      };
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        useEditorStore.getState().deleteAnnotation(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, selectedId]);

  async function handleCopy() {
    if (!stageRef.current) return;
    const dataUrl = stageRef.current.toDataURL({ pixelRatio: 2 });
    const base64Png = dataUrl.replace(/^data:image\/png;base64,/, "");
    try {
      await invoke("copy_image_to_clipboard", { base64Png });
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 2000);
    } catch (err) {
      console.error("[editor] copy failed:", err);
    }
  }

  async function handleSave(format: "png" | "jpg") {
    if (!stageRef.current) return;
    const dataUrl = stageRef.current.toDataURL({ pixelRatio: 2, mimeType: format === "jpg" ? "image/jpeg" : "image/png" });
    const base64Png = dataUrl.replace(/^data:image\/(png|jpeg);base64,/, "");
    try {
      await invoke("save_image_to_file", { base64Png });
    } catch (err) {
      console.error("[editor] save failed:", err);
    }
  }

  const [saveOpen, setSaveOpen] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100vw", height: "100vh", background: "#111" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "6px 10px", background: "#1a1a2e",
        borderBottom: "1px solid #333", flexShrink: 0,
      }}>
        {/* Tool buttons */}
        <div style={{ display: "flex", gap: 3 }}>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTool(t.id)}
              style={{
                width: 32, height: 32, background: activeTool === t.id ? "#6c63ff" : "#2a2a3e",
                border: "none", borderRadius: 6, cursor: "pointer",
                color: activeTool === t.id ? "#fff" : "#aaa", fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              title={t.id}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 24, background: "#333", margin: "0 4px" }} />
        {/* Tool options */}
        <div style={{ flex: 1 }}><ToolOptions /></div>
        <div style={{ width: 1, height: 24, background: "#333", margin: "0 4px" }} />
        {/* Undo */}
        <button onClick={undo} style={{ width: 32, height: 32, background: "#2a2a3e", border: "none", borderRadius: 6, cursor: "pointer", color: "#aaa", fontSize: 16 }} title="Undo (⌘Z)">↩</button>
        <div style={{ width: 1, height: 24, background: "#333", margin: "0 4px" }} />
        {/* Copy */}
        <button onClick={handleCopy} style={{ width: 32, height: 32, background: "#2a2a3e", border: "none", borderRadius: 6, cursor: "pointer", color: "#aaa", fontSize: 14 }} title="Copy to clipboard">
          {copyToast ? "✓" : "📋"}
        </button>
        {/* Save */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setSaveOpen((o) => !o)}
            style={{ height: 32, padding: "0 12px", background: "#2a3e2a", border: "none", borderRadius: 6, cursor: "pointer", color: "#5fb85f", fontSize: 12, fontWeight: 600 }}>
            Save ▾
          </button>
          {saveOpen && (
            <div style={{ position: "absolute", top: 36, right: 0, background: "#1a1a2e", border: "1px solid #333", borderRadius: 6, overflow: "hidden", zIndex: 100 }}>
              {["png", "jpg"].map((fmt) => (
                <button key={fmt} onClick={() => { setSaveOpen(false); handleSave(fmt as "png" | "jpg"); }}
                  style={{ display: "block", width: "100%", padding: "8px 16px", background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, textAlign: "left" }}>
                  Save as {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}
          onClick={(e) => {
            if (e.target === e.target.getStage()) setSelectedId(null);
          }}
        >
          <Layer>
            {imageEl && (
              <KonvaImage image={imageEl} x={0} y={0} width={stageSize.width} height={stageSize.height} />
            )}
            {/* Annotations rendered in Task 11–12 */}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests — store tests should pass**

```bash
pnpm test -- --reporter=verbose 2>&1 | grep -A 20 "EditorWindow"
```

Expected: All 6 store tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/EditorWindow.tsx src/test/EditorWindow.test.tsx
git commit -m "feat: EditorWindow base structure with zustand store and image loading"
```

---

## Task 11: Annotation Rendering — Arrow, Text, Rectangle, Highlight

**Files:**
- Modify: `src/EditorWindow.tsx`

The Konva annotations are drawn on `mousedown`/`mousemove`/`mouseup` events on the Stage. We implement a drawing layer that turns interactions into `Annotation` objects persisted in the zustand store.

- [ ] **Step 1: Add annotation rendering helpers at the top of `EditorWindow.tsx`**

After the `useEditorStore` definition, add:

```tsx
import { Arrow, Rect, Text, Circle } from "react-konva";

// Font size map
const FONT_SIZE_MAP: Record<FontSize, number> = { S: 14, M: 18, L: 24 };
// Stroke weight map
const STROKE_WEIGHT_MAP: Record<StrokeWeight, number> = { thin: 2, medium: 4, thick: 7 };

function AnnotationNode({
  ann,
  isSelected,
  onSelect,
}: {
  ann: Annotation;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const p = ann.props;
  const handleClick = () => onSelect(ann.id);

  if (ann.type === "arrow") {
    return (
      <Arrow
        points={p.points}
        stroke={p.color}
        strokeWidth={p.strokeWidth}
        fill={p.color}
        pointerLength={10}
        pointerWidth={8}
        onClick={handleClick}
        opacity={isSelected ? 0.75 : 1}
        draggable
      />
    );
  }
  if (ann.type === "text") {
    return (
      <Text
        x={p.x} y={p.y}
        text={p.text}
        fontSize={p.fontSize}
        fill={p.color}
        onClick={handleClick}
        opacity={isSelected ? 0.75 : 1}
        draggable
      />
    );
  }
  if (ann.type === "rect") {
    return (
      <Rect
        x={p.x} y={p.y} width={p.width} height={p.height}
        stroke={p.color}
        strokeWidth={p.strokeWidth}
        fill={p.fill ?? "transparent"}
        onClick={handleClick}
        opacity={isSelected ? 0.75 : 1}
        draggable
      />
    );
  }
  if (ann.type === "highlight") {
    return (
      <Rect
        x={p.x} y={p.y} width={p.width} height={p.height}
        fill={p.color}
        listening={false}
        opacity={isSelected ? 0.5 : 1}
      />
    );
  }
  if (ann.type === "blur") {
    return (
      <Rect
        x={p.x} y={p.y} width={p.width} height={p.height}
        fill={p.fill}
        onClick={handleClick}
        opacity={isSelected ? 0.75 : 1}
        draggable
      />
    );
  }
  if (ann.type === "step") {
    return (
      <>
        <Circle
          x={p.x} y={p.y} radius={14}
          fill={p.color}
          onClick={handleClick}
          opacity={isSelected ? 0.75 : 1}
          draggable
        />
        <Text
          x={p.x - 14} y={p.y - 14}
          width={28} height={28}
          text={String(p.step)}
          fontSize={13}
          fontStyle="bold"
          fill="#fff"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </>
    );
  }
  return null;
}
```

- [ ] **Step 2: Add drawing state and Stage event handlers inside `EditorWindow`**

Inside the `EditorWindow` function, after the `const [saveOpen, setSaveOpen] = useState(false);` line, add:

```tsx
  // Drawing in progress
  const [drawing, setDrawing] = useState<{ type: ToolType; startX: number; startY: number } | null>(null);
  const [liveRect, setLiveRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [livePoints, setLivePoints] = useState<number[]>([]);

  const { annotations, color, strokeWeight, fontSize, blurIntensity, stepCounter, pushAnnotation, incrementStepCounter } = useEditorStore();

  function getRelativePos(e: Konva.KonvaEventObject<MouseEvent>) {
    const stage = e.target.getStage()!;
    const pos = stage.getPointerPosition()!;
    return pos;
  }

  function handleStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.target !== e.target.getStage() && e.target.getClassName() !== "Image") return;
    setSelectedId(null);
    const pos = getRelativePos(e);
    if (activeTool === "step") {
      // Steps are placed on click, not drag
      pushAnnotation({
        id: crypto.randomUUID(),
        type: "step",
        props: { x: pos.x, y: pos.y, step: stepCounter, color },
      });
      incrementStepCounter();
      return;
    }
    if (activeTool === "text") {
      const text = window.prompt("Enter text:");
      if (text) {
        pushAnnotation({
          id: crypto.randomUUID(),
          type: "text",
          props: { x: pos.x, y: pos.y, text, color, fontSize: FONT_SIZE_MAP[fontSize] },
        });
      }
      return;
    }
    setDrawing({ type: activeTool, startX: pos.x, startY: pos.y });
    setLiveRect(null);
    setLivePoints([pos.x, pos.y, pos.x, pos.y]);
  }

  function handleStageMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!drawing) return;
    const pos = getRelativePos(e);
    if (drawing.type === "arrow") {
      setLivePoints([drawing.startX, drawing.startY, pos.x, pos.y]);
    } else {
      setLiveRect({
        x: Math.min(drawing.startX, pos.x),
        y: Math.min(drawing.startY, pos.y),
        w: Math.abs(pos.x - drawing.startX),
        h: Math.abs(pos.y - drawing.startY),
      });
    }
  }

  function handleStageMouseUp(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!drawing) return;
    const pos = getRelativePos(e);
    const sw = STROKE_WEIGHT_MAP[strokeWeight];

    if (drawing.type === "arrow") {
      const pts = [drawing.startX, drawing.startY, pos.x, pos.y];
      if (Math.abs(pts[2] - pts[0]) > 5 || Math.abs(pts[3] - pts[1]) > 5) {
        pushAnnotation({ id: crypto.randomUUID(), type: "arrow", props: { points: pts, color, strokeWidth: sw } });
      }
    } else if (drawing.type === "rect" && liveRect && liveRect.w > 5 && liveRect.h > 5) {
      pushAnnotation({ id: crypto.randomUUID(), type: "rect", props: { x: liveRect.x, y: liveRect.y, width: liveRect.w, height: liveRect.h, color, strokeWidth: sw, fill: undefined } });
    } else if (drawing.type === "highlight" && liveRect && liveRect.w > 5 && liveRect.h > 5) {
      pushAnnotation({ id: crypto.randomUUID(), type: "highlight", props: { x: liveRect.x, y: liveRect.y, width: liveRect.w, height: liveRect.h, color } });
    } else if (drawing.type === "blur" && liveRect && liveRect.w > 5 && liveRect.h > 5) {
      const fill = blurIntensity === "solid" ? "rgba(0,0,0,0.92)"
        : blurIntensity === "strong" ? "rgba(20,20,20,0.82)"
        : "rgba(80,80,80,0.55)";
      pushAnnotation({ id: crypto.randomUUID(), type: "blur", props: { x: liveRect.x, y: liveRect.y, width: liveRect.w, height: liveRect.h, fill } });
    }
    setDrawing(null);
    setLiveRect(null);
    setLivePoints([]);
  }
```

- [ ] **Step 3: Wire Stage event handlers and live-preview shapes into the JSX**

Find the `<Stage` element in the returned JSX and update it to add the three mouse handlers alongside the existing `onClick` prop. The full `<Stage>` opening tag should now read:

```tsx
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}
          onClick={(e) => {
            if (e.target === e.target.getStage()) setSelectedId(null);
          }}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
        >
```

Then replace the entire `<Layer>` block with:

```tsx
          <Layer>
            {imageEl && (
              <KonvaImage image={imageEl} x={0} y={0} width={stageSize.width} height={stageSize.height} />
            )}
            {/* Committed annotations */}
            {annotations.map((ann) => (
              <AnnotationNode
                key={ann.id}
                ann={ann}
                isSelected={selectedId === ann.id}
                onSelect={setSelectedId}
              />
            ))}
            {/* Live preview while dragging */}
            {drawing && livePoints.length === 4 && drawing.type === "arrow" && (
              <Arrow
                points={livePoints}
                stroke={color}
                strokeWidth={STROKE_WEIGHT_MAP[strokeWeight]}
                fill={color}
                pointerLength={10}
                pointerWidth={8}
                listening={false}
                opacity={0.7}
              />
            )}
            {drawing && liveRect && drawing.type !== "arrow" && (
              <Rect
                x={liveRect.x} y={liveRect.y} width={liveRect.w} height={liveRect.h}
                stroke={drawing.type === "blur" ? "#888" : color}
                strokeWidth={1}
                fill={drawing.type === "highlight" ? color : drawing.type === "blur" ? "rgba(80,80,80,0.4)" : "transparent"}
                dash={[4, 4]}
                listening={false}
                opacity={0.7}
              />
            )}
          </Layer>
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
pnpm run build 2>&1 | grep -E "error|Error|warn" | head -20
```

Expected: No TypeScript errors.

- [ ] **Step 5: Run all tests**

```bash
pnpm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/EditorWindow.tsx
git commit -m "feat: annotation rendering for arrow, text, rect, highlight, blur, step tools"
```

---

## Task 12: Manual Integration Smoke Test

- [ ] **Step 1: Start the app in dev mode**

```bash
pnpm tauri dev
```

- [ ] **Step 2: Test hotkey trigger**

Press `Cmd+Shift+4`. Expected: transparent fullscreen overlay appears with dim + crosshair cursor.

- [ ] **Step 3: Test region selection**

Drag a rectangle over any area. Expected: selected region appears bright, rest stays dimmed, size label updates. Release mouse: overlay closes, editor window opens with the screenshot.

- [ ] **Step 4: Test each annotation tool**

In the editor:
- Select Arrow → drag → arrow appears with selected color
- Select Text → click → prompt appears → text placed
- Select Rectangle → drag → rect border appears
- Select Highlight → drag → semi-transparent color band
- Select Blur → drag → dark redaction box
- Select Step → click 3 times → ① ② ③ circles appear

- [ ] **Step 5: Test undo**

Add 3 arrows, press `Cmd+Z` three times. Expected: annotations remove one-by-one.

- [ ] **Step 6: Test delete**

Add a shape, click to select it (dims), press Delete key. Expected: shape removed.

- [ ] **Step 7: Test copy to clipboard**

Click 📋 toolbar button. Expected: brief ✓ toast. Paste into Preview/Slack: annotated screenshot appears.

- [ ] **Step 8: Test save**

Click Save ▾ → Save as PNG → choose path. Expected: file saved, opens correctly in Preview.

- [ ] **Step 9: Test tray menu**

Click tray icon → "Capture Screenshot". Expected: same overlay appears.

- [ ] **Step 10: Test ESC**

Open overlay, press ESC. Expected: overlay closes cleanly, no editor opens.

- [ ] **Step 11: Verify no regressions**

Press `Cmd+Shift+Space` — dictation still works. HTTP server still accessible at `http://127.0.0.1:4242`.

- [ ] **Step 12: Final commit**

```bash
git add -A
git commit -m "feat: screen capture phase 1 — region capture, 6 annotation tools, clipboard + file export"
```

---

## Summary

| What's built | How it works |
|---|---|
| `Cmd+Shift+4` + tray menu | Global shortcut calls `open_capture_overlay` Rust command |
| Region overlay | Transparent Tauri window, canvas dims screen, user drags to select |
| Screen capture | `screenshots::Screen::from_point` → `capture_area` → base64 PNG |
| Annotation editor | Floating Tauri window, Konva.js canvas with 6 tool types |
| Clipboard export | `arboard::Clipboard::set_image` with decoded RGBA pixels |
| File export | `tauri_plugin_dialog::blocking_save_file` + `image::save` |
