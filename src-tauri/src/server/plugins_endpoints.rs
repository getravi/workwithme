//! HTTP endpoint handlers for the `plugins` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

#[derive(Deserialize)]
pub struct InstallRequest {
    pub url: String,
    #[serde(default)]
    pub verify_signature: bool,
}

#[derive(Deserialize)]
pub struct CallRequest {
    pub function: String,
    #[serde(default)]
    pub input: serde_json::Value,
}

/// List all plugins
pub async fn list() -> Json<serde_json::Value> {
    let plugin_list = plugins::list_plugins().await;
    Json(json!({
        "success": true,
        "plugins": plugin_list
    }))
}

/// Get a specific plugin
pub async fn get(Path(id): Path<String>) -> Json<serde_json::Value> {
    match plugins::get_plugin(&id).await {
        Some(plugin) => {
            Json(json!({
                "success": true,
                "plugin": plugin
            }))
        }
        None => {
            Json(json!({
                "success": false,
                "error": "Plugin not found"
            }))
        }
    }
}

/// Install a plugin from URL
pub async fn install(Json(req): Json<InstallRequest>) -> (StatusCode, Json<serde_json::Value>) {
    match plugins::install_plugin(&req.url, req.verify_signature).await {
        Ok(plugin) => (
            StatusCode::CREATED,
            Json(json!({
                "success": true,
                "plugin": plugin
            }))
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "error": e
            }))
        )
    }
}

/// Enable a plugin
pub async fn enable(Path(id): Path<String>) -> Json<serde_json::Value> {
    match plugins::enable_plugin(&id).await {
        Ok(_) => {
            Json(json!({
                "success": true,
                "message": format!("Plugin {} enabled", id)
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

/// Disable a plugin
pub async fn disable(Path(id): Path<String>) -> Json<serde_json::Value> {
    match plugins::disable_plugin(&id).await {
        Ok(_) => {
            Json(json!({
                "success": true,
                "message": format!("Plugin {} disabled", id)
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

/// Uninstall a plugin
pub async fn uninstall(Path(id): Path<String>) -> Json<serde_json::Value> {
    match plugins::uninstall_plugin(&id).await {
        Ok(_) => {
            Json(json!({
                "success": true,
                "message": format!("Plugin {} uninstalled", id)
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

/// Call a plugin function
pub async fn call(
    Path(id): Path<String>,
    Json(req): Json<CallRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    match plugins::call_plugin_function(&id, &req.function, req.input).await {
        Ok(result) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "result": result
            }))
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "error": e
            }))
        )
    }
}

/// Get plugin statistics
pub async fn stats() -> Json<serde_json::Value> {
    let stats = plugins::get_plugin_stats().await;
    Json(json!({
        "success": true,
        "stats": stats
    }))
}
