//! HTTP endpoint handlers for the `auth` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

#[derive(Deserialize)]
pub struct SetKeyRequest {
    pub provider: String,
    pub key: String,
}

/// Store API key for a provider
pub async fn set_key(Json(req): Json<SetKeyRequest>) -> (StatusCode, Json<serde_json::Value>) {
    match keychain::set(&format!("{}-api-key", req.provider.to_lowercase()), &req.key) {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "message": format!("API key stored for {}", req.provider)
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

/// Get configured providers (those with keys stored).
/// Returns { availableProviders: [...], configured: [...] } as expected by the frontend.
pub async fn get_configured() -> Json<serde_json::Value> {
    let all_providers = vec!["anthropic", "openai", "google", "cohere"];
    let auth_storage = AuthStorage;
    let mut configured = Vec::new();

    for provider in &all_providers {
        if provider_has_session_auth(&auth_storage, provider) {
            configured.push(provider.to_string());
        }
    }

    Json(json!({
        "availableProviders": all_providers,
        "configured": configured
    }))
}
