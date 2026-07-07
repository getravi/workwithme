//! HTTP endpoint handlers for the `keychain` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

#[derive(Deserialize)]
pub struct SetRequest {
    pub key: String,
    pub token: String,
}

/// Get a stored token from keychain
pub async fn get(Path(key): Path<String>) -> Json<serde_json::Value> {
    match keychain::get(&key) {
        Ok(Some(token)) => {
            Json(json!({
                "success": true,
                "token": token
            }))
        }
        Ok(None) => {
            Json(json!({
                "success": false,
                "error": "Token not found"
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

/// Store a token in keychain
pub async fn set(Json(req): Json<SetRequest>) -> (StatusCode, Json<serde_json::Value>) {
    match keychain::set(&req.key, &req.token) {
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

/// Delete a token from keychain
pub async fn delete(Path(key): Path<String>) -> Json<serde_json::Value> {
    match keychain::delete(&key) {
        Ok(found) => {
            Json(json!({
                "success": true,
                "deleted": found
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
