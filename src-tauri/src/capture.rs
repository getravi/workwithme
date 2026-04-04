use base64::Engine;
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
/// Coordinates are in logical pixels (points); the screenshots crate / CoreGraphics
/// handles HiDPI internally — no manual scaling is needed from the caller.
#[tauri::command]
pub fn capture_region(
    _app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    if width == 0 || height == 0 {
        return Err("selection too small to capture".to_string());
    }

    // The screenshots crate operates in logical coordinates (CoreGraphics points on macOS).
    // No manual HiDPI scaling is needed — the OS handles pixel density internally.
    let screen = screenshots::Screen::from_point(x, y)
        .map_err(|e| format!("screen lookup failed: {e}"))?;

    let capture = screen
        .capture_area(x, y, width, height)
        .map_err(|e| format!("capture failed: {e}"))?;

    // Work around screenshots 0.8 bundling image 0.24 while project uses image 0.25:
    // extract raw RGBA bytes and re-wrap into the project's image::RgbaImage.
    let (w, h) = (capture.width(), capture.height());
    let raw_bytes = capture.into_raw();
    let rgba_img = image::RgbaImage::from_raw(w, h, raw_bytes)
        .ok_or("failed to wrap capture buffer")?;

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

/// Show a save-file dialog and write the image as PNG or JPG.
/// Returns the path the file was saved to.
#[tauri::command]
pub async fn save_image_to_file(
    app: AppHandle,
    base64_png: String,
) -> Result<String, String> {
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
}
