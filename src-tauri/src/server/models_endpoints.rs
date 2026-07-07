//! HTTP endpoint handlers for the `models` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

/// List models available for agent use.
///
/// Only models whose provider has a configured API key or OAuth token are
/// returned — avoids showing models the user cannot actually call.
/// Custom models are always included regardless of provider.
pub async fn list(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    match models::list_models() {
        Ok(all_models) => {
            // Determine which providers have credentials
            let configured_providers: std::collections::HashSet<String> = {
                let all = ["anthropic", "openai", "google", "cohere"];
                all.iter()
                    .filter(|p| provider_has_session_auth(&state.auth_storage, p))
                    .map(|p| p.to_string())
                    .collect()
            };

            // When no providers are configured yet (fresh install / no keys),
            // show all models so the selector is never mysteriously empty.
            let show_all = configured_providers.is_empty();

            let filtered: Vec<_> = all_models
                .into_iter()
                .filter(|m| m.custom || show_all || configured_providers.contains(&m.provider))
                .collect();

            let current = models::get_selected_model().ok();

            Json(json!({
                "success": true,
                "models": filtered,
                "currentModel": current
            }))
        }
        Err(e) => Json(json!({ "success": false, "error": e })),
    }
}

/// Get currently selected model
pub async fn get_selected() -> Json<serde_json::Value> {
    match models::get_selected_model() {
        Ok(model) => {
            Json(json!({
                "success": true,
                "model": model
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

/// Select a model
pub async fn select(Path(id): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
    match models::select_model(&id) {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "selected": id
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

/// Add a custom model
pub async fn add(Json(model): Json<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
    match serde_json::from_value::<models::Model>(model) {
        Ok(model) => {
            match models::add_custom_model(model) {
                Ok(_) => (
                    StatusCode::CREATED,
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
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "error": format!("Invalid model format: {}", e)
            }))
        ),
    }
}

/// Remove a custom model
pub async fn remove(Path(id): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
    match models::remove_custom_model(&id) {
        Ok(true) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "removed": true
            }))
        ),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "success": false,
                "error": "Model not found or is builtin"
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
