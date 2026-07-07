//! HTTP endpoint handlers for the `processes` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

/// List running processes
pub async fn list() -> Json<serde_json::Value> {
    match processes::list_processes() {
        Ok(procs) => {
            Json(json!({
                "success": true,
                "processes": procs
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

/// Kill a process
pub async fn kill(Path(id): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
    match processes::kill_process(&id) {
        Ok(true) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "killed": true
            }))
        ),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "success": false,
                "error": "Process not found"
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
