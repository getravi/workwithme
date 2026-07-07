//! HTTP endpoint handlers for the `clipboard` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

#[derive(Deserialize)]
pub struct CopyRequest {
    pub text: String,
}

/// Copy text to clipboard
pub async fn copy(Json(req): Json<CopyRequest>) -> (StatusCode, Json<serde_json::Value>) {
    match clipboard::copy_to_clipboard(&req.text) {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "success": true
            }))
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "error": e
            }))
        ),
    }
}

/// Paste text from clipboard
pub async fn paste() -> Json<serde_json::Value> {
    match clipboard::paste_from_clipboard() {
        Ok(text) => {
            Json(json!({
                "success": true,
                "text": text
            }))
        }
        Err(e) => {
            Json(json!({
                "success": false,
                "error": e
            }))
        }
    }
}
