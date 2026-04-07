use super::db::{self, CaptureEntry};
use base64::Engine;

/// Non-tauri helper callable from capture.rs before opening the editor.
pub fn save_draft_internal(image_b64: &str, app_name: Option<&str>, window_title: Option<&str>) -> Result<String, String> {
    let (file_path, width, height) = write_png(image_b64)?;
    let id = db::save_draft(&file_path, app_name, window_title, width, height)?;
    super::ocr::spawn_ocr(id.clone(), file_path);
    Ok(id)
}

#[tauri::command]
pub fn library_save_draft(
    image_b64: String,
    app_name: Option<String>,
    window_title: Option<String>,
) -> Result<String, String> {
    save_draft_internal(&image_b64, app_name.as_deref(), window_title.as_deref())
}

#[tauri::command]
pub fn library_finalize(id: String, image_b64: String) -> Result<(), String> {
    // Look up the file path from the DB
    let file_path = {
        let db_conn = db::DB.get().ok_or("DB not ready")?;
        let conn = db_conn.lock().unwrap();
        conn.query_row(
            "SELECT file_path FROM captures WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get::<_, String>(0),
        ).map_err(|e| format!("lookup: {e}"))?
    };
    write_png_to(&image_b64, &file_path)?;
    db::finalize(&id)?;
    super::ocr::spawn_ocr(id, file_path);
    Ok(())
}

#[tauri::command]
pub fn library_list(before_ts: Option<i64>) -> Result<Vec<CaptureEntry>, String> {
    db::list(before_ts)
}

#[tauri::command]
pub fn library_search(query: String) -> Result<Vec<CaptureEntry>, String> {
    db::search(&query)
}

#[tauri::command]
pub fn library_delete(id: String) -> Result<(), String> {
    if let Some(path) = db::delete(&id)? {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

#[tauri::command]
pub fn library_save_video(
    app: tauri::AppHandle,
    exported_path: String,
) -> Result<String, String> {
    // Extract first frame as base64 PNG thumbnail
    let thumb_b64 = crate::recorder::recording_extract_thumbnail(app, exported_path.clone())?;

    // Write thumbnail PNG to captures dir
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("workwithme")
        .join("captures");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    let thumb_id = uuid::Uuid::new_v4().to_string();
    let thumb_path = dir.join(format!("{thumb_id}-thumb.png"));
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&thumb_b64)
        .map_err(|e| format!("base64: {e}"))?;
    std::fs::write(&thumb_path, &bytes).map_err(|e| format!("write thumb: {e}"))?;

    // Insert DB row
    let id = db::save_video(&exported_path, &thumb_path.to_string_lossy())?;

    // Spawn OCR on thumbnail for searchability
    super::ocr::spawn_ocr(id.clone(), thumb_path.to_string_lossy().to_string());

    Ok(id)
}

/// Decode base64 PNG, write to captures dir, return (file_path, width, height).
fn write_png(image_b64: &str) -> Result<(String, i32, i32), String> {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("workwithme")
        .join("captures");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    let file_id = uuid::Uuid::new_v4().to_string();
    let path = dir.join(format!("{file_id}.png"));
    write_png_to(image_b64, path.to_str().unwrap())?;
    let bytes = std::fs::read(&path).map_err(|e| format!("read: {e}"))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("decode: {e}"))?;
    Ok((path.to_string_lossy().to_string(), img.width() as i32, img.height() as i32))
}

fn write_png_to(image_b64: &str, file_path: &str) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(image_b64)
        .map_err(|e| format!("base64 decode: {e}"))?;
    std::fs::write(file_path, &bytes).map_err(|e| format!("write png: {e}"))?;
    Ok(())
}
