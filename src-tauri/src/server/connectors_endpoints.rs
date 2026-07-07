//! HTTP endpoint handlers for the `connectors` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

/// List all connectors (catalog + configured MCPs)
pub async fn list() -> Json<serde_json::Value> {
    let catalog = mcp::get_catalog();

    // Convert catalog entries to connector objects
    let connectors: Vec<serde_json::Value> = catalog
        .iter()
        .map(|entry| {
            json!({
                "id": format!("remote-mcp/{}", entry.slug),
                "type": "remote-mcp",
                "slug": entry.slug,
                "name": entry.name,
                "description": entry.description,
                "category": entry.category,
                "status": "available",
                "requires_token": entry.requires_token,
                "url": entry.url,
                "docs_url": entry.docs_url,
            })
        })
        .collect();

    Json(json!({
        "success": true,
        "connectors": connectors
    }))
}

/// Get a specific connector by slug
pub async fn get(Path(slug): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
    match mcp::get_mcp_server(&slug) {
        Ok(Some(config)) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "connector": config
            }))
        ),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "success": false,
                "error": "Connector not found"
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

/// Add a new connector (configure MCP server)
pub async fn add(Json(payload): Json<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
    let slug = payload
        .get("slug")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default();

    if slug.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "error": "slug is required"
            }))
        );
    }

    match mcp::set_mcp_server(&slug, payload) {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "connector_id": format!("remote-mcp/{}", slug)
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

/// Update a connector configuration
pub async fn update(
    Path(slug): Path<String>,
    Json(config): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    match mcp::set_mcp_server(&slug, config) {
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

/// Remove a connector (delete MCP server configuration)
pub async fn remove(Path(slug): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
    match mcp::remove_mcp_server(&slug) {
        Ok(true) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "deleted": true
            }))
        ),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "success": false,
                "error": "Connector not found"
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
