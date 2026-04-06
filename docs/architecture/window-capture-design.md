# Window Capture — Design Spec

## Goal

Add window capture to the existing screen capture feature. The user selects a window by hovering over it and clicking — a macOS-native interaction pattern. The captured window (bare frame, no shadow) opens directly in the annotation editor.

## Interaction Flow

1. User triggers window capture via tray menu ("Capture Window") or hotkey `Cmd+Ctrl+5`
2. A transparent fullscreen overlay opens, dimming the screen
3. As the user moves the mouse, the window under the cursor is highlighted (the dim is cut away to reveal it with a blue border)
4. Click → capture that window → overlay closes → editor opens with the result
5. Escape → cancel, overlay closes

## Architecture

### Rust — `src-tauri/src/window_capture.rs`

Two Tauri commands:

**`get_window_list() -> Result<Vec<WindowInfo>, String>`**
- Calls macOS `CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID)`
- Filters out: zero-size windows, off-screen windows, windows owned by `workwithme` (our own app)
- Returns window bounds in logical coordinates (CGWindowList already uses points — no HiDPI scaling needed)
- Result type (serialized to JSON for the frontend):
  ```rust
  pub struct WindowInfo {
      pub id: u32,
      pub app_name: String,
      pub title: String,
      pub x: f64,
      pub y: f64,
      pub width: f64,
      pub height: f64,
  }
  ```

**`capture_window(app: AppHandle, window_id: u32) -> Result<(), String>`**
- Calls `CGWindowListCreateImage(CGRectNull, kCGWindowListOptionIncludingWindow, window_id, kCGWindowImageBoundsIgnoreFraming)` — bare frame, no shadow
- Converts CGImage → raw RGBA bytes → `image::RgbaImage` → encodes as PNG
- Calls `open_editor_window(app, base64_png)` to store the image and open the editor

Both commands are `#[cfg(target_os = "macos")]` only.

### Dependency

Add to `src-tauri/Cargo.toml` (macOS target only):
```toml
[target.'cfg(target_os = "macos")'.dependencies]
core-graphics = "0.23"
```

### Frontend — `src/WindowCaptureOverlay.tsx`

**`findWindowAtPoint(windows: WindowInfo[], x: number, y: number): WindowInfo | null`**
- Pure utility, exported for testing
- Returns the first window in the list (topmost z-order, as CGWindowList returns them front-to-back) whose rect contains the point
- Point on border counts as inside

**`WindowCaptureOverlay` component**
- On mount: calls `get_window_list()`, stores result in state; draws initial dim on canvas
- Mouse move: calls `findWindowAtPoint`, redraws canvas — full dim + cut-out rect for hovered window + blue border (`rgba(100, 180, 255, 0.9)`)
- Click: calls `capture_window(hovered.id)`, then `getCurrentWindow().close()`
- If window list is empty on mount: show "No windows found" label and close on any click
- Escape: `getCurrentWindow().close()`

### New files

| File | Purpose |
|------|---------|
| `src-tauri/src/window_capture.rs` | Rust commands |
| `window-capture.html` | Vite HTML entry |
| `src/window-capture.tsx` | React mount (`<WindowCaptureOverlay />`) |
| `src/WindowCaptureOverlay.tsx` | Component + `findWindowAtPoint` |
| `src/test/WindowCaptureOverlay.test.tsx` | Unit tests |

### Modified files

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `core-graphics = "0.23"` under macOS target |
| `src-tauri/src/lib.rs` | `mod window_capture`, register 2 commands, add tray item, register `Cmd+Ctrl+5` hotkey |
| `vite.config.ts` | Add `window-capture` entry |
| `src/SettingsPage.tsx` | Add `⌘ ⌃ 5` shortcut to Shortcuts tab |

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| `get_window_list` returns empty | Overlay shows "No capturable windows found." Closes on any click |
| `capture_window` fails (window closed between list and click) | Log error to stderr, close overlay silently — do not open editor |
| Overlay opened while another capture overlay is open | Close the existing overlay first (same pattern as region capture) |

## Testing

`src/test/WindowCaptureOverlay.test.tsx` — unit tests for `findWindowAtPoint`:

1. Returns topmost window when point is inside multiple overlapping windows (first in list wins)
2. Returns the single window when point is inside it
3. Returns `null` when point is outside all windows
4. Returns `null` when window list is empty
5. Point exactly on the border of a window counts as inside

No Konva mocking needed — this component uses a plain `<canvas>`, same as `CaptureOverlay`.

## Tray Menu (after change)

```
Capture Region          ⌘⌃4
Capture Window          ⌘⌃5
Capture Full Screen
─────────────────
Quit
```
