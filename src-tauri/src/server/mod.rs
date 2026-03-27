pub mod ws;
pub mod skills;
pub mod keychain;
pub mod audit;
pub mod sessions;

use axum::{
    extract::{ws::WebSocketUpgrade, Path},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post, delete},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use tower_http::cors::CorsLayer;

/// Create the main Axum router with all endpoints and middleware.
pub async fn create_app() -> Result<Router, String> {
    let app = Router::new()
        // WebSocket endpoint
        .route("/", get(ws_handler))
        // Health check
        .route("/api/health", get(health_check))
        // Skills endpoints
        .route("/api/skills", get(skills_endpoints::list))
        .route("/api/skills/:source/:slug", get(skills_endpoints::get))
        // Keychain endpoints
        .route("/api/keychain/:key", get(keychain_endpoints::get))
        .route("/api/keychain", post(keychain_endpoints::set))
        .route("/api/keychain/:key", delete(keychain_endpoints::delete))
        // Audit endpoint
        .route("/api/audit", post(audit_endpoints::log))
        // Sessions endpoints
        .route("/api/sessions", get(sessions_endpoints::list))
        .route("/api/sessions", post(sessions_endpoints::create))
        .route("/api/sessions/:id", get(sessions_endpoints::get))
        .route("/api/sessions/:id", axum::routing::put(sessions_endpoints::update))
        .route("/api/sessions/:id/archive", post(sessions_endpoints::archive))
        // CORS middleware to allow frontend requests
        .layer(CorsLayer::permissive());

    Ok(app)
}

/// WebSocket handler for agent communication.
async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(ws::handle_socket)
}

/// Health check endpoint.
async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "server": "workwithme-rust-backend"
    }))
}

/// Skills API endpoints
mod skills_endpoints {
    use super::*;

    /// List all skills
    pub async fn list() -> Json<serde_json::Value> {
        let skills = skills::list_skills();
        Json(json!({
            "skills": skills
        }))
    }

    /// Get skill details
    pub async fn get(Path((source, slug)): Path<(String, String)>) -> Json<serde_json::Value> {
        match skills::get_skill_content(&source, &slug) {
            Some(content) => {
                Json(json!({
                    "success": true,
                    "content": content
                }))
            }
            None => {
                Json(json!({
                    "success": false,
                    "error": "Skill not found"
                }))
            }
        }
    }
}

/// Keychain API endpoints
mod keychain_endpoints {
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
}

/// Audit API endpoints
mod audit_endpoints {
    use super::*;

    #[derive(Deserialize)]
    pub struct AuditLogRequest {
        #[serde(rename = "type")]
        pub event_type: String,
        #[serde(default)]
        pub details: Option<serde_json::Value>,
    }

    /// Log an audit event
    pub async fn log(Json(req): Json<AuditLogRequest>) -> (StatusCode, Json<serde_json::Value>) {
        match audit::log_event(&req.event_type, req.details) {
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
}

/// Sessions API endpoints
mod sessions_endpoints {
    use super::*;

    /// List all sessions
    pub async fn list() -> Json<serde_json::Value> {
        match sessions::list_sessions() {
            Ok(session_list) => {
                Json(json!({
                    "success": true,
                    "sessions": session_list
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

    /// Load a session by ID
    pub async fn get(Path(id): Path<String>) -> Json<serde_json::Value> {
        match sessions::load_session(&id) {
            Ok(Some(session)) => {
                Json(json!({
                    "success": true,
                    "session": session
                }))
            }
            Ok(None) => {
                Json(json!({
                    "success": false,
                    "error": "Session not found"
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

    /// Create a new session
    pub async fn create(Json(data): Json<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
        match sessions::create_session(data) {
            Ok(id) => (
                StatusCode::CREATED,
                Json(json!({
                    "success": true,
                    "id": id
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

    /// Update a session
    pub async fn update(Path(id): Path<String>, Json(data): Json<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
        match sessions::update_session(&id, data) {
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

    /// Archive a session
    pub async fn archive(Path(id): Path<String>) -> Json<serde_json::Value> {
        match sessions::archive_session(&id) {
            Ok(true) => {
                Json(json!({
                    "success": true,
                    "archived": true
                }))
            }
            Ok(false) => {
                Json(json!({
                    "success": false,
                    "error": "Session not found"
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
}
