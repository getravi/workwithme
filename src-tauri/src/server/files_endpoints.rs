//! HTTP endpoint handlers for the `files` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

/// List directory contents
pub async fn list(axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>) -> Json<serde_json::Value> {
    let path = params.get("path").cloned().unwrap_or_else(|| "~".to_string());

    match files::list_directory(&path) {
        Ok(entries) => {
            Json(json!({
                "success": true,
                "entries": entries,
                "path": path
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

/// Search for files
pub async fn search(axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>) -> Json<serde_json::Value> {
    let path = params.get("path").cloned().unwrap_or_else(|| "~".to_string());
    let pattern = params.get("query").cloned().unwrap_or_default();

    match files::search_files(&path, &pattern) {
        Ok(entries) => {
            Json(json!({
                "success": true,
                "entries": entries,
                "query": pattern
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

/// Get file info
pub async fn info(axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>) -> Json<serde_json::Value> {
    let path = params.get("path").cloned().unwrap_or_default();

    if path.is_empty() {
        return Json(json!({
            "success": false,
            "error": "path parameter required"
        }));
    }

    match files::get_file_info(&path) {
        Ok(entry) => {
            Json(json!({
                "success": true,
                "entry": entry
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
