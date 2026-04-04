use tauri::{AppHandle, Manager};

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
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    use base64::Engine;

    // Get scale factor from the overlay window (or default to 1.0)
    let scale = app
        .get_webview_window("capture-overlay")
        .and_then(|w: tauri::WebviewWindow| w.scale_factor().ok())
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

    // screenshots 0.8 uses image 0.24; re-wrap the raw bytes into image 0.25's RgbaImage
    let (w, h) = (capture.width(), capture.height());
    let raw_bytes = capture.into_raw();
    let rgba_img = image::RgbaImage::from_raw(w, h, raw_bytes)
        .ok_or_else(|| "failed to wrap capture buffer".to_string())?;

    // Encode to PNG → base64
    let dyn_img = image::DynamicImage::ImageRgba8(rgba_img);
    let mut cursor = std::io::Cursor::new(Vec::new());
    dyn_img
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("encode failed: {e}"))?;
    let png_bytes = cursor.into_inner();

    Ok(base64::engine::general_purpose::STANDARD.encode(&png_bytes))
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
