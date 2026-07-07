//! HTTP endpoint handlers for the `settings` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

/// Get all settings
pub async fn get_all() -> Json<serde_json::Value> {
    match settings::load_settings() {
        Ok(settings) => {
            Json(json!({
                "success": true,
                "settings": settings
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

/// Save all settings
pub async fn save_all(Json(settings): Json<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
    match settings::save_settings(&settings) {
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

/// Get a single setting
pub async fn get(Path(key): Path<String>) -> Json<serde_json::Value> {
    match settings::get_setting(&key) {
        Ok(Some(value)) => {
            Json(json!({
                "success": true,
                "value": value
            }))
        }
        Ok(None) => {
            Json(json!({
                "success": false,
                "error": "Setting not found"
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

/// Set a single setting
pub async fn set(Path(key): Path<String>, Json(value): Json<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
    match settings::set_setting(&key, value) {
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

/// Delete a setting
pub async fn delete(Path(key): Path<String>) -> Json<serde_json::Value> {
    match settings::delete_setting(&key) {
        Ok(existed) => {
            Json(json!({
                "success": true,
                "deleted": existed
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
