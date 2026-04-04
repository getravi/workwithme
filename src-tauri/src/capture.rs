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
