# Window Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hover-and-click window capture to the existing tray screenshot menu, opening the captured window (no shadow) directly in the annotation editor.

**Architecture:** A macOS-only Rust module (`window_capture.rs`) enumerates on-screen windows via raw CoreGraphics FFI and captures the selected window using the `screencapture` CLI. A React overlay (`WindowCaptureOverlay.tsx`) draws a fullscreen dim canvas, highlights the window under the cursor, and invokes the Rust commands on click.

**Tech Stack:** Rust raw C FFI (CoreGraphics/CoreFoundation frameworks), `screencapture` CLI, React + TypeScript canvas, Tauri commands, Vitest.

---

## File Map

| Action | File |
|--------|------|
| Modify | `src-tauri/Cargo.toml` |
| Create | `src-tauri/src/window_capture.rs` |
| Modify | `src-tauri/src/lib.rs` |
| Create | `src/test/WindowCaptureOverlay.test.tsx` |
| Create | `src/WindowCaptureOverlay.tsx` |
| Create | `window-capture.html` |
| Create | `src/window-capture.tsx` |
| Modify | `vite.config.ts` |
| Modify | `src/SettingsPage.tsx` |

---

### Task 1: Add Cargo.toml macOS dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

The `core-graphics` and `core-foundation` crates are already in the lockfile as transitive deps of `screenshots`. Listing them explicitly under the macOS target section makes the dependency explicit and allows `#[cfg(target_os = "macos")]` in `window_capture.rs` to compile cleanly.

- [ ] **Step 1: Add the target section to Cargo.toml**

Add after the `[dev-dependencies]` section (or after the last `[dependencies]` block):

```toml
[target.'cfg(target_os = "macos")'.dependencies]
core-graphics = "0.23"
core-foundation = "0.9"
```

- [ ] **Step 2: Verify the build still compiles**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: no errors (warnings about unused deps are fine).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "chore: add core-graphics and core-foundation as explicit macOS deps"
```

---

### Task 2: Create window_capture.rs — Rust commands

**Files:**
- Create: `src-tauri/src/window_capture.rs`

Two `#[tauri::command]` functions behind `#[cfg(target_os = "macos")]`:
- `get_window_list()` — calls CoreGraphics FFI to enumerate on-screen windows, returns `Vec<WindowInfo>` filtered to layer-0 windows excluding our own process
- `capture_window(app, window_id)` — shells out to `screencapture -l <id> -o -x -t png`, reads the PNG, base64-encodes it, calls `capture::open_editor_window`

- [ ] **Step 1: Create the file**

```rust
// src-tauri/src/window_capture.rs
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
    if CFStringGetCString(s, buf.as_mut_ptr(), buf_size, CF_STRING_ENCODING_UTF8) {
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

unsafe fn make_cfstring(s: &str) -> CFTypeRef {
    let c = CString::new(s).unwrap();
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

            let xk = make_cfstring("X");
            let yk = make_cfstring("Y");
            let wk = make_cfstring("Width");
            let hk = make_cfstring("Height");

            let x = dict_get_f64(bounds_dict, xk);
            let y = dict_get_f64(bounds_dict, yk);
            let width = dict_get_f64(bounds_dict, wk);
            let height = dict_get_f64(bounds_dict, hk);

            CFRelease(xk);
            CFRelease(yk);
            CFRelease(wk);
            CFRelease(hk);

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
    capture::open_editor_window(app, base64_png)
}
```

- [ ] **Step 2: Check it compiles (macOS)**

```bash
cd src-tauri && cargo check 2>&1 | grep -E "^error" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/window_capture.rs
git commit -m "feat: window_capture Rust module with get_window_list and capture_window"
```

---

### Task 3: Wire lib.rs — mod, commands, hotkey, tray item

**Files:**
- Modify: `src-tauri/src/lib.rs`

Four changes: (1) declare the module, (2) register commands in invoke_handler, (3) add `Cmd+Ctrl+5` shortcut handler, (4) add "Capture Window" tray menu item.

- [ ] **Step 1: Add `mod window_capture;` at the top of lib.rs**

After `mod capture;` (line 4), add:

```rust
#[cfg(target_os = "macos")]
mod window_capture;
```

- [ ] **Step 2: Add the Cmd+Ctrl+5 shortcut handler in the shortcut plugin**

In the `.with_handler(move |app, shortcut, event| {` block, after the existing `else if shortcut.matches(Modifiers::SUPER | Modifiers::CONTROL, Code::Digit4)` arm, add:

```rust
                    } else if shortcut.matches(Modifiers::SUPER | Modifiers::CONTROL, Code::Digit5) {
                        if event.state() == ShortcutState::Pressed {
                            #[cfg(target_os = "macos")]
                            if let Err(e) = capture::open_capture_overlay_named(app.clone(), "window-capture") {
                                eprintln!("[window-capture] failed to open overlay: {e}");
                            }
                        }
```

Wait — instead of a new `open_capture_overlay_named`, it's simpler to just open the window-capture window directly inline. Replace the arm above with:

```rust
                    } else if shortcut.matches(Modifiers::SUPER | Modifiers::CONTROL, Code::Digit5) {
                        if event.state() == ShortcutState::Pressed {
                            #[cfg(target_os = "macos")]
                            {
                                if let Some(w) = app.get_webview_window("window-capture-overlay") {
                                    let _ = w.close();
                                    std::thread::sleep(std::time::Duration::from_millis(50));
                                }
                                if let Err(e) = tauri::WebviewWindowBuilder::new(
                                    app,
                                    "window-capture-overlay",
                                    tauri::WebviewUrl::App("window-capture.html".into()),
                                )
                                .inner_size(1920.0, 1080.0)
                                .position(0.0, 0.0)
                                .transparent(true)
                                .always_on_top(true)
                                .decorations(false)
                                .skip_taskbar(true)
                                .focused(true)
                                .resizable(false)
                                .build() {
                                    eprintln!("[window-capture] overlay build failed: {e}");
                                }
                            }
                        }
```

Actually, to avoid duplicating the window creation logic, add a helper function `open_window_capture_overlay` at the bottom of `lib.rs` (after `set_tray_recording`). Then call it from both the shortcut handler and the tray handler:

```rust
fn open_window_capture_overlay(app: &tauri::AppHandle) {
    // Close any existing overlay
    if let Some(w) = app.get_webview_window("window-capture-overlay") {
        let _ = w.close();
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    // Compute full monitor bounding box (same logic as open_capture_overlay)
    let screens = screenshots::Screen::all().unwrap_or_default();
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (0i32, 0i32, 1920i32, 1080i32);
    if !screens.is_empty() {
        min_x = screens.iter().map(|s| s.display_info.x).min().unwrap_or(0);
        min_y = screens.iter().map(|s| s.display_info.y).min().unwrap_or(0);
        max_x = screens.iter().map(|s| {
            let lw = (s.display_info.width as f64 / s.display_info.scale_factor as f64) as i32;
            s.display_info.x + lw
        }).max().unwrap_or(1920);
        max_y = screens.iter().map(|s| {
            let lh = (s.display_info.height as f64 / s.display_info.scale_factor as f64) as i32;
            s.display_info.y + lh
        }).max().unwrap_or(1080);
    }
    if let Err(e) = tauri::WebviewWindowBuilder::new(
        app,
        "window-capture-overlay",
        tauri::WebviewUrl::App("window-capture.html".into()),
    )
    .inner_size((max_x - min_x) as f64, (max_y - min_y) as f64)
    .position(min_x as f64, min_y as f64)
    .transparent(true)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .focused(true)
    .resizable(false)
    .build()
    {
        eprintln!("[window-capture] overlay build failed: {e}");
    }
}
```

- [ ] **Step 3: Update the shortcut handler**

In the `with_handler` block, add after the `Digit4` arm:

```rust
                    } else if shortcut.matches(Modifiers::SUPER | Modifiers::CONTROL, Code::Digit5) {
                        if event.state() == ShortcutState::Pressed {
                            open_window_capture_overlay(app);
                        }
                    }
```

- [ ] **Step 4: Add "Capture Window" tray menu item**

In the `setup` closure, after `capture_region_item` and before `capture_fullscreen_item`, add:

```rust
            let capture_window_item = tauri::menu::MenuItem::with_id(
                app,
                "capture-window",
                "Capture Window",
                true,
                Some("Super+Ctrl+5"),
            )?;
```

Add it to the `MenuBuilder`:

```rust
            let tray_menu = tauri::menu::MenuBuilder::new(app)
                .item(&capture_region_item)
                .item(&capture_window_item)
                .item(&capture_fullscreen_item)
                .separator()
                .item(&quit_item)
                .build()?;
```

Add the handler in `on_menu_event`:

```rust
                        "capture-window" => {
                            open_window_capture_overlay(&app_handle_tray);
                        }
```

- [ ] **Step 5: Register the Cmd+Ctrl+5 shortcut**

After `app.global_shortcut().register("Super+Ctrl+4")?;`, add:

```rust
            app.global_shortcut().register("Super+Ctrl+5")?;
```

- [ ] **Step 6: Register the commands in invoke_handler**

In `.invoke_handler(tauri::generate_handler![...])`, add:

```rust
            #[cfg(target_os = "macos")]
            window_capture::get_window_list,
            #[cfg(target_os = "macos")]
            window_capture::capture_window,
```

Note: `generate_handler!` does not support `#[cfg]` attributes directly. Instead, add them unconditionally and gate the entire module with cfg. Since the project is macOS-only right now, just add them without the cfg guard:

```rust
        .invoke_handler(tauri::generate_handler![
            toggle_in_app_dictation,
            capture::capture_region,
            capture::capture_fullscreen,
            capture::copy_image_to_clipboard,
            capture::save_image_to_file,
            capture::open_capture_overlay,
            capture::open_editor_window,
            capture::get_captured_image,
            window_capture::get_window_list,
            window_capture::capture_window,
        ])
```

And at the top of `lib.rs`, the `mod window_capture;` declaration is already `#[cfg(target_os = "macos")]`. On non-macOS targets you would need conditional compilation in the handler too — but since this codebase is macOS-only, just add them unconditionally.

- [ ] **Step 7: Verify it compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: wire window capture commands, Cmd+Ctrl+5 hotkey, and tray menu item"
```

---

### Task 4: Write findWindowAtPoint tests then implement WindowCaptureOverlay.tsx

**Files:**
- Create: `src/test/WindowCaptureOverlay.test.tsx`
- Create: `src/WindowCaptureOverlay.tsx`

`findWindowAtPoint` is the only pure-logic function worth unit-testing. Write the 5 tests first, verify they fail, then implement.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/test/WindowCaptureOverlay.test.tsx
import { describe, it, expect } from "vitest";
import { findWindowAtPoint } from "../WindowCaptureOverlay";
import type { WindowInfo } from "../WindowCaptureOverlay";

const win = (overrides: Partial<WindowInfo> = {}): WindowInfo => ({
  id: 1,
  app_name: "TestApp",
  title: "Test Window",
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  ...overrides,
});

describe("findWindowAtPoint", () => {
  it("returns topmost window when point is inside multiple overlapping windows", () => {
    const front = win({ id: 1, x: 50, y: 50, width: 300, height: 300 });
    const back  = win({ id: 2, x: 0,  y: 0,  width: 500, height: 500 });
    // front is first in list (front-to-back order from CGWindowList)
    const result = findWindowAtPoint([front, back], 100, 100);
    expect(result?.id).toBe(1);
  });

  it("returns the single window when point is inside it", () => {
    const w = win({ x: 100, y: 100, width: 200, height: 150 });
    expect(findWindowAtPoint([w], 150, 150)?.id).toBe(w.id);
  });

  it("returns null when point is outside all windows", () => {
    const w = win({ x: 100, y: 100, width: 200, height: 150 });
    expect(findWindowAtPoint([w], 500, 500)).toBeNull();
  });

  it("returns null when window list is empty", () => {
    expect(findWindowAtPoint([], 100, 100)).toBeNull();
  });

  it("point exactly on the border counts as inside", () => {
    const w = win({ x: 100, y: 100, width: 200, height: 150 });
    // Top-left corner
    expect(findWindowAtPoint([w], 100, 100)?.id).toBe(w.id);
    // Bottom-right corner
    expect(findWindowAtPoint([w], 300, 250)?.id).toBe(w.id);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/test/WindowCaptureOverlay.test.tsx 2>&1 | tail -10
```

Expected: FAIL — `findWindowAtPoint` is not exported (module not found).

- [ ] **Step 3: Create WindowCaptureOverlay.tsx**

```typescript
// src/WindowCaptureOverlay.tsx
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface WindowInfo {
  id: number;
  app_name: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pure utility — exported for testing.
 *  Returns the first window in the list (topmost z-order, as CGWindowList
 *  returns them front-to-back) whose rect contains the point.
 *  Point on the border counts as inside. */
export function findWindowAtPoint(
  windows: WindowInfo[],
  x: number,
  y: number
): WindowInfo | null {
  for (const w of windows) {
    if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) {
      return w;
    }
  }
  return null;
}

// Canvas drawing helpers ─────────────────────────────────────────────────────

function drawDim(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, w, h);
}

function drawHighlight(
  ctx: CanvasRenderingContext2D,
  win: WindowInfo,
  canvasW: number,
  canvasH: number
) {
  ctx.clearRect(0, 0, canvasW, canvasH);
  drawDim(ctx, canvasW, canvasH);
  // Cut out the hovered window so the real window shows through
  ctx.clearRect(win.x, win.y, win.width, win.height);
  // Blue border
  ctx.strokeStyle = "rgba(100, 180, 255, 0.9)";
  ctx.lineWidth = 2;
  ctx.strokeRect(win.x, win.y, win.width, win.height);
}

// Component ──────────────────────────────────────────────────────────────────

export function WindowCaptureOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const hoveredRef = useRef<WindowInfo | null>(null);

  // Load window list on mount
  useEffect(() => {
    invoke<WindowInfo[]>("get_window_list")
      .then((wins) => {
        setWindows(wins);
        setLoaded(true);
      })
      .catch((err) => {
        console.error("[window-capture] get_window_list failed:", err);
        setLoaded(true);
      });
  }, []);

  // Draw initial dim once loaded
  useEffect(() => {
    if (!loaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d")!;
    drawDim(ctx, canvas.width, canvas.height);
  }, [loaded]);

  // Escape key closes
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await getCurrentWindow().close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const found = findWindowAtPoint(windows, e.clientX, e.clientY);
    hoveredRef.current = found;
    const ctx = canvas.getContext("2d")!;
    if (found) {
      drawHighlight(ctx, found, canvas.width, canvas.height);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawDim(ctx, canvas.width, canvas.height);
    }
  };

  const handleClick = async () => {
    const hovered = hoveredRef.current;
    if (!hovered) {
      // Clicked on empty area or no windows: close
      await getCurrentWindow().close();
      return;
    }
    try {
      await invoke("capture_window", { windowId: hovered.id });
    } catch (err) {
      console.error("[window-capture] capture_window failed:", err);
    }
    await getCurrentWindow().close();
  };

  // Empty list state
  if (loaded && windows.length === 0) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "default",
        }}
        onClick={handleClick}
      >
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14 }}>
          No capturable windows found.
        </p>
      </div>
    );
  }

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
      onMouseMove={handleMouseMove}
      onClick={handleClick}
    />
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/test/WindowCaptureOverlay.test.tsx 2>&1 | tail -10
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/WindowCaptureOverlay.tsx src/test/WindowCaptureOverlay.test.tsx
git commit -m "feat: WindowCaptureOverlay component and findWindowAtPoint with tests"
```

---

### Task 5: Create HTML entry, React mount, update vite.config.ts

**Files:**
- Create: `window-capture.html`
- Create: `src/window-capture.tsx`
- Modify: `vite.config.ts`

Follows the same pattern as `capture-overlay.html` / `src/capture-overlay.tsx`.

- [ ] **Step 1: Create window-capture.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Window Capture</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
      #root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/window-capture.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create src/window-capture.tsx**

```typescript
// src/window-capture.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { WindowCaptureOverlay } from "./WindowCaptureOverlay";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WindowCaptureOverlay />
  </React.StrictMode>
);
```

- [ ] **Step 3: Add window-capture entry to vite.config.ts**

In the `input` object:

```typescript
      input: {
        main: "index.html",
        "capture-overlay": "capture-overlay.html",
        editor: "editor.html",
        "window-capture": "window-capture.html",
      },
```

- [ ] **Step 4: Verify the dev build picks up the new entry**

```bash
npx vite build 2>&1 | grep -E "(window-capture|error)" | head -10
```

Expected: `window-capture.html` appears in build output, no errors.

- [ ] **Step 5: Commit**

```bash
git add window-capture.html src/window-capture.tsx vite.config.ts
git commit -m "feat: window-capture HTML entry and React mount"
```

---

### Task 6: Update SettingsPage.tsx — add Cmd+Ctrl+5 shortcut

**Files:**
- Modify: `src/SettingsPage.tsx`

The `SHORTCUTS` array already has the region capture entry. Add the window capture shortcut next to it.

- [ ] **Step 1: Open SettingsPage.tsx and find the SHORTCUTS array**

Look for the entry added for region capture:

```typescript
{ category: "Screenshot", keys: ["⌘", "⌃", "4"], description: "Capture screen region" },
```

- [ ] **Step 2: Add the window capture shortcut immediately after it**

```typescript
{ category: "Screenshot", keys: ["⌘", "⌃", "5"], description: "Capture window" },
```

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -15
```

Expected: all tests pass (including the 5 new WindowCaptureOverlay tests).

- [ ] **Step 4: Commit**

```bash
git add src/SettingsPage.tsx
git commit -m "feat: add Cmd+Ctrl+5 window capture shortcut to Settings > Shortcuts"
```

---

## Manual Smoke Test

After all tasks are complete:

1. Build and run: `npm run tauri dev`
2. Open tray menu — confirm order: **Capture Region ⌘⌃4 | Capture Window ⌘⌃5 | Capture Full Screen | — | Quit**
3. Click "Capture Window" — fullscreen dim overlay appears, cursor is crosshair
4. Move mouse over a browser or terminal window — the window lights up with blue border, background dims
5. Click the highlighted window — overlay closes, editor opens with a clean bare-frame capture
6. Escape key during overlay — overlay closes, no editor
7. Press **⌘⌃5** hotkey — same overlay opens
8. Open Settings > Shortcuts — confirm **⌘ ⌃ 5 — Capture window** entry is visible
