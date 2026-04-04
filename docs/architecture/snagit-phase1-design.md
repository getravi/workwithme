# Screen Capture & Annotation — Phase 1 Design

**Date:** 2026-04-04
**Scope:** Region capture + annotation editor + clipboard/file export
**Stack:** Tauri v2 + Rust backend + React/TypeScript frontend + Konva.js

---

## 1. Overview

Add Snagit-style screen capture to the existing workwithme Tauri app. Phase 1 delivers: trigger capture via hotkey or tray → drag to select region → annotate in a floating editor window → copy to clipboard or save as PNG/JPG.

---

## 2. Architecture

### 2.1 Window Model

Three Tauri windows participate in the capture flow:

| Window | Label | Type | Description |
|--------|-------|------|-------------|
| Capture Overlay | `capture-overlay` | Transparent fullscreen | Region drag-select UI |
| Annotation Editor | `capture-editor` | Floating, always-on-top | Konva.js canvas for annotation |
| Main App | `main` | Existing | No changes needed |

### 2.2 Data Flow

```
Trigger (hotkey/tray)
  → open_capture_overlay()             [Rust command]
  → user drags region in overlay       [Frontend: CaptureOverlay.tsx]
  → capture_region(x, y, w, h)        [Rust command → screenshots crate]
  → returns base64 PNG to frontend
  → open_editor_window(base64_png)     [Rust command]
  → user annotates in Konva.js         [Frontend: EditorWindow.tsx]
  → export: copy_image_to_clipboard()  [Rust command → arboard]
           or save_image_to_file()     [Rust command → image crate]
```

### 2.3 New Files

**Rust:**
- `src-tauri/src/capture.rs` — screen capture logic (screenshots crate), image export (image crate), clipboard image (arboard)
- Register capture commands in `src-tauri/src/lib.rs`

**Frontend:**
- `src/CaptureOverlay.tsx` — fullscreen region selection UI (rendered in `capture-overlay` window)
- `src/EditorWindow.tsx` — annotation editor with Konva.js (rendered in `capture-editor` window)
- `capture-overlay.html` — Tauri entry point for overlay window
- `editor.html` — Tauri entry point for editor window

---

## 3. Trigger

### 3.1 Global Hotkey
- **Shortcut:** `Cmd+Shift+4` (mirrors macOS screenshot muscle memory)
- Registered alongside the existing `Cmd+Shift+Space` dictation shortcut in `lib.rs`
- Handler calls `open_capture_overlay()`

### 3.2 Tray Menu
- Adds a "Capture Screenshot" item to the existing tray icon menu
- Clicking it calls the same `open_capture_overlay()` path

---

## 4. Capture Overlay (`capture-overlay` window)

### 4.1 Tauri Window Config
- Fullscreen, transparent, always-on-top, no decorations, no taskbar entry
- `focused: true` so it receives keyboard/mouse immediately
- **Lifecycle:** created fresh on each capture trigger (not pre-created at startup); destroyed (not hidden) after the region is selected or ESC is pressed. This avoids stale window state between captures.

### 4.2 Frontend Behaviour (`CaptureOverlay.tsx`)
- Full-viewport `<canvas>` covering the screen
- On mount: dim the entire screen with a semi-transparent dark overlay (opacity ~0.4)
- Cursor: crosshair
- **Mouse down:** record start point, clear dimming from drag rect (so selected region appears bright)
- **Mouse move:** draw rubber-band selection rect with a white/blue 1px border
- **Mouse up:** invoke `capture_region(x, y, w, h)` → receive base64 PNG → invoke `open_editor_window(base64_png)` → close overlay window
- **ESC:** close overlay window without capturing

### 4.3 DPI Handling
- The overlay runs at logical pixel coordinates; Rust must apply `window.scale_factor()` before passing to the `screenshots` crate to get physical pixel coordinates

---

## 5. Rust Capture Module (`capture.rs`)

### 5.1 Dependencies to Add (Cargo.toml)
```toml
screenshots = "0.8"
image = "0.25"
```

(`arboard` is already present)

### 5.2 Tauri Commands

```rust
// Capture a screen region; returns base64-encoded PNG
#[tauri::command]
fn capture_region(app: AppHandle, x: i32, y: i32, width: u32, height: u32) -> Result<String, String>

// Copy a base64 PNG to the system clipboard as an image
#[tauri::command]
fn copy_image_to_clipboard(base64_png: String) -> Result<(), String>

// Show a save dialog and write PNG or JPG to the chosen path
#[tauri::command]
async fn save_image_to_file(app: AppHandle, base64_png: String) -> Result<String, String>

// Open or show the capture overlay window
#[tauri::command]
fn open_capture_overlay(app: AppHandle) -> Result<(), String>

// Open the editor window with the captured image
#[tauri::command]
fn open_editor_window(app: AppHandle, base64_png: String) -> Result<(), String>
```

### 5.3 `capture_region` Implementation
1. Apply scale factor: `physical_x = (x as f64 * scale) as i32`, same for y/w/h
2. Call `screenshots::Screen::all()`, pick the screen whose bounds contain the top-left point `(x, y)` (fallback to primary screen for simplicity in Phase 1)
3. Call `screen.capture_area(physical_x, physical_y, physical_w, physical_h)` → `RgbaImage`
4. Encode to PNG bytes via `image` crate → base64 encode → return string to caller

**Note:** `capture_region` only returns the base64 PNG. The overlay frontend is responsible for calling `open_editor_window` next and closing the overlay window itself. This keeps the sequencing (close overlay → open editor) in the frontend where it's easier to reason about.

### 5.4 `copy_image_to_clipboard` Implementation
1. Decode base64 → PNG bytes → `image::load_from_memory` → `RgbaImage`
2. Construct `arboard::ImageData { width, height, bytes: Cow::Owned(rgba_bytes) }`
3. `clipboard.set_image(image_data)`

### 5.5 `save_image_to_file` Implementation
1. Decode base64 → `DynamicImage`
2. Show `tauri_plugin_dialog` save dialog with filters PNG/JPG
3. Detect extension from chosen path → encode accordingly via `image` crate
4. Write to disk, return the saved path (shown briefly in a toast)

---

## 6. Annotation Editor (`capture-editor` window)

### 6.1 Tauri Window Config
- Size: `1000 × 700` initial, resizable
- Always-on-top, decorated (has title bar for move/resize)
- Transparent: false
- Label: `capture-editor`
- The captured image is passed via a Tauri event `capture-image` emitted after the window opens

### 6.2 Layout: Top Bar

```
[→] [T] [□] [〰] [▓] [①]  |  [tool options…]  |  [↩]  |  [📋] [Save ▾]
──────────────────────────────────────────────────────────────────────────
                        Konva.js Canvas
```

- Left group: tool buttons (Arrow, Text, Rectangle, Highlight, Blur, Numbered Step)
- Middle: contextual options for selected tool (color swatches, stroke weight, etc.)
- Right: Undo, Copy to Clipboard, Save dropdown (PNG / JPG)
- Active tool is highlighted in purple (`#6c63ff`)

### 6.3 Tool Specifications

| Tool | Konva Shape | Options |
|------|-------------|---------|
| Arrow | `Konva.Arrow` | Color (5 swatches), stroke weight (thin/medium/thick) |
| Text | `Konva.Text` | Color (5 swatches), font size (S/M/L = 14/18/24px) |
| Rectangle | `Konva.Rect` | Stroke color, fill (none / 25% opacity) |
| Highlight | `Konva.Rect` | Color (yellow/green/blue/red at 40% opacity), no stroke |
| Blur/Redact | `Konva.Rect` + filter | Intensity: light blur / strong blur / solid black fill |
| Numbered Step | `Konva.Circle` + `Konva.Text` | Color, auto-incrementing counter (①②③…) |

### 6.4 Annotation Interaction
- Click tool → switch active tool
- Click+drag on canvas → create shape (except Text: single click places text input)
- Shapes are selectable/moveable after placement (Konva transformer)
- Undo stack: maintain array of Konva layer snapshots, ↩ pops last
- Delete key removes selected shape

### 6.5 Export
- **Copy:** `stage.toDataURL({ pixelRatio: 2 })` → base64 PNG → `invoke('copy_image_to_clipboard', ...)`
- **Save:** same `toDataURL` → `invoke('save_image_to_file', ...)` → Rust handles dialog + write
- After copy: brief "Copied!" toast in the toolbar
- Save dropdown: PNG (default) / JPG options

---

## 7. New npm Dependencies

```
konva
react-konva
```

---

## 8. Hotkey Registration

In `lib.rs`, alongside the existing `Super+Shift+Space` dictation shortcut:

```rust
app.global_shortcut().register("Super+Shift+4")?;
```

Handler matches `Modifiers::SUPER | Modifiers::SHIFT` + `Code::Digit4` and calls `open_capture_overlay`.

---

## 9. Tray Menu

Extend the existing tray builder in `lib.rs` to add a menu:

```rust
let menu = tauri::menu::MenuBuilder::new(app)
    .item(&MenuItem::new(app, "Capture Screenshot", true, None::<&str>)?)
    .separator()
    .item(&MenuItem::new(app, "Quit", true, None::<&str>)?)
    .build()?;
tray_builder = tray_builder.menu(&menu).on_menu_event(|app, event| {
    if event.id() == "capture-screenshot" {
        let _ = open_capture_overlay(app.clone());
    }
});
```

---

## 10. Out of Scope (Phase 1)

- Library / history of captures
- Fullscreen or window-specific capture modes
- Screen recording / video
- OCR
- Cloud sharing

---

## 11. MVP Acceptance Criteria

- [ ] `Cmd+Shift+4` and tray menu both open the capture overlay
- [ ] Drag-to-select on overlay captures the correct region at native resolution (HiDPI correct)
- [ ] Overlay dismisses cleanly on ESC or after region selected
- [ ] Editor window opens with the screenshot loaded in Konva canvas
- [ ] All 6 annotation tools work: create, select, move, delete
- [ ] Undo works for at least 10 steps
- [ ] "Copy" puts a pixel-accurate image on the system clipboard (paste into Slack/Finder works)
- [ ] "Save" shows OS file dialog, saves PNG or JPG to chosen path
- [ ] No regressions to dictation feature or HTTP server
