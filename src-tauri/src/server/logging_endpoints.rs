//! HTTP endpoint handlers for the `logging` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

/// Get recent logs
pub async fn get_logs(axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>) -> Json<serde_json::Value> {
    let limit = params
        .get("limit")
        .and_then(|l| l.parse::<usize>().ok())
        .unwrap_or(100);

    match logging::get_recent_logs(limit) {
        Ok(logs) => {
            Json(json!({
                "success": true,
                "logs": logs
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

/// Get current log level
pub async fn get_level() -> Json<serde_json::Value> {
    let level = logging::get_log_level();
    Json(json!({
        "success": true,
        "level": level.as_str()
    }))
}

/// Set log level
pub async fn set_level(Json(body): Json<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
    let level_str = body
        .get("level")
        .and_then(|l| l.as_str())
        .unwrap_or("info");

    match logging::LogLevel::from_str(level_str) {
        Some(level) => {
            match logging::set_log_level(level) {
                Ok(_) => (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "level": level.as_str()
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
        None => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "error": format!("Invalid log level: {}", level_str)
            }))
        ),
    }
}

/// Clear logs
pub async fn clear() -> (StatusCode, Json<serde_json::Value>) {
    match logging::clear_logs() {
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
