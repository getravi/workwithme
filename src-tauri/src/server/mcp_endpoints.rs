//! HTTP endpoint handlers for the `mcp` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

/// Get current MCP configuration
pub async fn get_config() -> Json<serde_json::Value> {
    match mcp::load_mcp_config() {
        Ok(config) => {
            Json(json!({
                "success": true,
                "config": config
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

/// Update MCP configuration
pub async fn update_config(Json(config): Json<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
    match mcp::save_mcp_config(config) {
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
        )
    }
}

/// Get MCP service catalog
pub async fn get_catalog() -> Json<serde_json::Value> {
    let catalog = mcp::get_catalog();
    Json(json!({
        "success": true,
        "catalog": catalog
    }))
}
