pub mod ws;
pub mod skills;
pub mod keychain;
pub mod audit;
pub mod sessions;
pub mod mcp;
pub mod oauth;
pub mod agent;
pub mod tools;
pub mod agent_executor;
pub mod sandbox;
pub mod approval;
pub mod extensions;
pub mod static_files;
pub mod settings;
pub mod models;
pub mod clipboard;
pub mod notifications;
pub mod streaming;
pub mod files;
pub mod processes;
pub mod logging;
pub mod db;
pub mod queries;
pub mod plugins;

use axum::{
    extract::{ws::WebSocketUpgrade, Path},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post, delete},
    Json, Router, middleware::Next,
};
use serde::Deserialize;
use serde_json::json;
use tower_http::cors::CorsLayer;
use governor::{Quota, RateLimiter, state::{InMemoryState, NotKeyed}, clock::DefaultClock};
use std::num::NonZeroU32;
use std::sync::Arc;

/// Create the main Axum router with all endpoints and middleware.
pub async fn create_app() -> Result<Router, String> {
    // Configure rate limiter: 2 requests per second with burst of 10
    // This prevents DoS attacks while allowing normal usage
    let quota = Quota::per_second(NonZeroU32::new(2).unwrap())
        .allow_burst(NonZeroU32::new(10).unwrap());
    let rate_limiter: Arc<RateLimiter<NotKeyed, InMemoryState, DefaultClock>> =
        Arc::new(RateLimiter::direct(quota));

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
        // MCP endpoints
        .route("/api/mcp", get(mcp_endpoints::get_config))
        .route("/api/mcp", post(mcp_endpoints::update_config))
        .route("/api/mcp/catalog", get(mcp_endpoints::get_catalog))
        // OAuth endpoints
        .route("/api/auth/oauth-providers", get(oauth_endpoints::list_providers))
        .route("/api/auth/login", post(oauth_endpoints::login))
        .route("/api/auth/callback", get(oauth_endpoints::callback))
        .route("/api/auth/status", get(oauth_endpoints::status))
        .route("/api/auth/logout", post(oauth_endpoints::logout))
        // Agent endpoints
        .route("/api/agent/session", post(agent_endpoints::create_session))
        // Settings endpoints
        .route("/api/settings", get(settings_endpoints::get_all))
        .route("/api/settings", post(settings_endpoints::save_all))
        .route("/api/settings/:key", get(settings_endpoints::get))
        .route("/api/settings/:key", post(settings_endpoints::set))
        .route("/api/settings/:key", delete(settings_endpoints::delete))
        // Models endpoints
        .route("/api/models", get(models_endpoints::list))
        .route("/api/models/selected", get(models_endpoints::get_selected))
        .route("/api/models/select/:id", post(models_endpoints::select))
        .route("/api/models/add", post(models_endpoints::add))
        .route("/api/models/:id", delete(models_endpoints::remove))
        // Clipboard endpoints
        .route("/api/clipboard/copy", post(clipboard_endpoints::copy))
        .route("/api/clipboard/paste", get(clipboard_endpoints::paste))
        // Notifications endpoints
        .route("/api/notifications/send", post(notifications_endpoints::send))
        .route("/api/notifications", get(notifications_endpoints::list))
        // File browser endpoints
        .route("/api/files/list", get(files_endpoints::list))
        .route("/api/files/search", get(files_endpoints::search))
        .route("/api/files/info", get(files_endpoints::info))
        // Process management endpoints
        .route("/api/processes", get(processes_endpoints::list))
        .route("/api/processes/:id/kill", post(processes_endpoints::kill))
        // Logging endpoints
        .route("/api/logs", get(logging_endpoints::get_logs))
        .route("/api/logs/level", get(logging_endpoints::get_level))
        .route("/api/logs/level", post(logging_endpoints::set_level))
        .route("/api/logs/clear", post(logging_endpoints::clear))
        // Database/Query endpoints
        .route("/api/sessions/search", get(queries_endpoints::search_sessions))
        .route("/api/sessions/paginated", get(queries_endpoints::list_paginated))
        .route("/api/audit/date-range", get(queries_endpoints::audit_by_date))
        .route("/api/analytics/tools", get(queries_endpoints::tool_analytics))
        .route("/api/analytics/sessions", get(queries_endpoints::session_stats))
        .route("/api/sessions/:id/pause", post(queries_endpoints::pause_session))
        .route("/api/sessions/:id/resume", post(queries_endpoints::resume_session))
        .route("/api/sessions/:id/delete", delete(queries_endpoints::delete_session))
        // Plugin endpoints
        .route("/api/plugins", get(plugins_endpoints::list))
        .route("/api/plugins/install", post(plugins_endpoints::install))
        .route("/api/plugins/stats", get(plugins_endpoints::stats))
        .route("/api/plugins/:id", get(plugins_endpoints::get))
        .route("/api/plugins/:id/enable", post(plugins_endpoints::enable))
        .route("/api/plugins/:id/disable", post(plugins_endpoints::disable))
        .route("/api/plugins/:id", delete(plugins_endpoints::uninstall))
        .route("/api/plugins/:id/call", post(plugins_endpoints::call))
        // Static files (SPA fallback) - catch-all at the end
        .fallback(static_files_handler)
        // Rate limiting middleware to prevent DoS attacks
        .layer(axum::middleware::from_fn_with_state(
            rate_limiter,
            rate_limit_middleware,
        ))
        // CORS middleware to allow frontend requests
        .layer(CorsLayer::permissive());

    Ok(app)
}

/// Handler for static files with SPA routing fallback
async fn static_files_handler(
    axum::extract::Path(path): axum::extract::Path<String>,
) -> impl IntoResponse {
    static_files::serve_static(path).await
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

/// Rate limiting middleware to prevent DoS attacks.
/// Each request consumes one token from the rate limiter.
/// If the rate limit is exceeded, returns a 429 Too Many Requests error.
async fn rate_limit_middleware(
    axum::extract::State(limiter): axum::extract::State<Arc<RateLimiter<NotKeyed, InMemoryState, DefaultClock>>>,
    request: axum::http::Request<axum::body::Body>,
    next: Next,
) -> axum::response::Result<axum::response::Response> {
    if limiter.check().is_err() {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "Rate limit exceeded. Maximum 2 requests per second allowed.",
        ).into());
    }

    Ok(next.run(request).await)
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

/// Agent API endpoints
mod agent_endpoints {
    use super::*;

    #[derive(Deserialize)]
    pub struct CreateSessionRequest {
        #[serde(default)]
        pub metadata: Option<serde_json::Value>,
    }

    /// Create a new agent session
    pub async fn create_session(Json(req): Json<CreateSessionRequest>) -> (StatusCode, Json<serde_json::Value>) {
        let mut session = agent::create_session();

        if let Some(metadata) = req.metadata {
            session.metadata = metadata;
        }

        // Try to generate a session label using Claude Haiku
        // Look for API key in environment or keychain
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .ok()
            .or_else(|| keychain::get("anthropic-api-key").ok().flatten());

        if let Some(key) = api_key {
            let label = extensions::generate_session_label_with_fallback(&key).await;
            if let Some(ref mut metadata_obj) = session.metadata.as_object_mut() {
                metadata_obj.insert("label".to_string(), json!(label));
            }
        } else {
            // Fallback: use session ID as label if no API key available
            if let Some(ref mut metadata_obj) = session.metadata.as_object_mut() {
                metadata_obj.insert(
                    "label".to_string(),
                    json!(format!("session-{}", &session.id[..8])),
                );
            }
        }

        // Persist session to disk
        match sessions::create_session(serde_json::to_value(&session).unwrap()) {
            Ok(_) => {
                (
                    StatusCode::CREATED,
                    Json(json!({
                        "success": true,
                        "session": session
                    }))
                )
            }
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

/// OAuth API endpoints
mod oauth_endpoints {
    use super::*;
    use axum::extract::Query;
    use serde::Deserialize;

    #[derive(Deserialize)]
    pub struct LoginRequest {
        pub provider: String,
    }

    #[derive(Deserialize)]
    pub struct CallbackQuery {
        pub code: Option<String>,
        pub state: Option<String>,
        pub error: Option<String>,
    }

    #[derive(Deserialize)]
    pub struct LogoutRequest {
        pub provider: String,
        pub user_id: String,
    }

    /// List available OAuth providers
    pub async fn list_providers() -> Json<serde_json::Value> {
        let providers = oauth::get_oauth_providers();
        Json(json!({
            "providers": providers
        }))
    }

    /// Initiate OAuth login flow
    pub async fn login(Json(req): Json<LoginRequest>) -> (StatusCode, Json<serde_json::Value>) {
        match oauth::generate_authorization_url(&req.provider) {
            Ok((auth_url, state)) => {
                // Store state with expiration for CSRF protection
                if let Err(e) = oauth::store_auth_state(&req.provider, &state) {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({
                            "success": false,
                            "error": format!("Failed to store auth state: {}", e)
                        }))
                    );
                }

                (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "url": auth_url,
                        "state": state
                    }))
                )
            }
            Err(e) => (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "error": e
                }))
            )
        }
    }

    /// Handle OAuth callback
    pub async fn callback(Query(query): Query<CallbackQuery>) -> (StatusCode, Json<serde_json::Value>) {
        if let Some(error) = query.error {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "error": format!("OAuth error: {}", error)
                }))
            );
        }

        let code = match query.code {
            Some(c) => c,
            None => return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "error": "Missing authorization code"
                }))
            ),
        };

        let state = match query.state {
            Some(s) => s,
            None => return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "error": "Missing state parameter"
                }))
            ),
        };

        // Validate and retrieve provider from state, removes state after validation
        let provider = match oauth::validate_and_remove_auth_state(&state) {
            Ok(p) => p,
            Err(e) => return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "error": format!("State validation failed: {}", e)
                }))
            ),
        };

        match oauth::exchange_code_for_token(&provider, &code, &state).await {
            Ok(creds) => {

                (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "credentials": {
                            "provider": creds.provider,
                            "access_token": creds.access_token,
                            "refresh_token": creds.refresh_token,
                            "expires_at": creds.expires_at
                        }
                    }))
                )
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "error": format!("Token exchange failed: {}", e)
                }))
            )
        }
    }

    /// Get authentication status
    pub async fn status() -> Json<serde_json::Value> {
        let mut authenticated = vec![];

        for provider in &["google", "github", "openai"] {
            // Try to retrieve credentials (will be empty if not authenticated)
            if let Ok(Some(_)) = oauth::get_credentials(provider, "") {
                authenticated.push(provider.to_string());
            }
        }

        Json(json!({
            "authenticated_providers": authenticated,
            "has_credentials": !authenticated.is_empty()
        }))
    }

    /// Logout from OAuth provider
    pub async fn logout(Json(req): Json<LogoutRequest>) -> Json<serde_json::Value> {
        match oauth::delete_credentials(&req.provider, &req.user_id) {
            Ok(_) => {
                Json(json!({
                    "success": true,
                    "message": format!("Logged out from {}", req.provider)
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

/// Plugin API endpoints
mod plugins_endpoints {
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
}

/// MCP API endpoints
mod mcp_endpoints {
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

/// Settings API endpoints
mod settings_endpoints {
    use super::*;

    /// Get all settings
    pub async fn get_all() -> Json<serde_json::Value> {
        match settings::load_settings() {
            Ok(settings) => {
                Json(json!({
                    "success": true,
                    "settings": settings
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

    /// Save all settings
    pub async fn save_all(Json(settings): Json<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
        match settings::save_settings(&settings) {
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

    /// Get a single setting
    pub async fn get(Path(key): Path<String>) -> Json<serde_json::Value> {
        match settings::get_setting(&key) {
            Ok(Some(value)) => {
                Json(json!({
                    "success": true,
                    "value": value
                }))
            }
            Ok(None) => {
                Json(json!({
                    "success": false,
                    "error": "Setting not found"
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

    /// Set a single setting
    pub async fn set(Path(key): Path<String>, Json(value): Json<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
        match settings::set_setting(&key, value) {
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

    /// Delete a setting
    pub async fn delete(Path(key): Path<String>) -> Json<serde_json::Value> {
        match settings::delete_setting(&key) {
            Ok(existed) => {
                Json(json!({
                    "success": true,
                    "deleted": existed
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

/// Models API endpoints
mod models_endpoints {
    use super::*;

    /// List all available models
    pub async fn list() -> Json<serde_json::Value> {
        match models::list_models() {
            Ok(models) => {
                Json(json!({
                    "success": true,
                    "models": models
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
}

/// Clipboard API endpoints
mod clipboard_endpoints {
    use super::*;

    #[derive(Deserialize)]
    pub struct CopyRequest {
        pub text: String,
    }

    /// Copy text to clipboard
    pub async fn copy(Json(req): Json<CopyRequest>) -> (StatusCode, Json<serde_json::Value>) {
        match clipboard::copy_to_clipboard(&req.text) {
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

    /// Paste text from clipboard
    pub async fn paste() -> Json<serde_json::Value> {
        match clipboard::paste_from_clipboard() {
            Ok(text) => {
                Json(json!({
                    "success": true,
                    "text": text
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

/// Notifications API endpoints
mod notifications_endpoints {
    use super::*;

    #[derive(Deserialize)]
    pub struct NotificationRequest {
        pub title: String,
        pub body: String,
        #[serde(default)]
        pub level: String,
    }

    /// Send a notification
    pub async fn send(Json(req): Json<NotificationRequest>) -> (StatusCode, Json<serde_json::Value>) {
        let level = if req.level.is_empty() {
            "info"
        } else {
            &req.level
        };

        match notifications::send_notification(&req.title, &req.body, level) {
            Ok(id) => (
                StatusCode::OK,
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
            ),
        }
    }

    /// Get recent notifications
    pub async fn list() -> Json<serde_json::Value> {
        match notifications::get_recent_notifications(50) {
            Ok(notifs) => {
                Json(json!({
                    "success": true,
                    "notifications": notifs
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

/// File browser API endpoints
mod files_endpoints {
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
}

/// Process management API endpoints
mod processes_endpoints {
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
}

/// Logging API endpoints
mod logging_endpoints {
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
}

/// Advanced database query endpoints
mod queries_endpoints {
    use super::*;

    /// Search sessions by label
    pub async fn search_sessions(axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>) -> Json<serde_json::Value> {
        let query = params.get("q").cloned().unwrap_or_default();

        if query.is_empty() {
            return Json(json!({
                "success": false,
                "error": "q parameter required"
            }));
        }

        match queries::search_sessions(&query).await {
            Ok(results) => {
                Json(json!({
                    "success": true,
                    "results": results,
                    "count": results.len()
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

    /// Get paginated sessions list
    pub async fn list_paginated(axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>) -> Json<serde_json::Value> {
        let limit = params.get("limit").and_then(|l| l.parse::<i64>().ok()).unwrap_or(20);
        let offset = params.get("offset").and_then(|o| o.parse::<i64>().ok()).unwrap_or(0);
        let archived = params.get("archived").and_then(|a| a.parse::<bool>().ok()).unwrap_or(false);

        match queries::list_sessions_paginated(limit, offset, archived).await {
            Ok((sessions, total)) => {
                Json(json!({
                    "success": true,
                    "sessions": sessions,
                    "total": total,
                    "limit": limit,
                    "offset": offset
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

    /// Get audit events by date range
    pub async fn audit_by_date(axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>) -> Json<serde_json::Value> {
        let start_date = params.get("start").cloned().unwrap_or_default();
        let end_date = params.get("end").cloned().unwrap_or_default();
        let limit = params.get("limit").and_then(|l| l.parse::<i64>().ok()).unwrap_or(100);

        if start_date.is_empty() || end_date.is_empty() {
            return Json(json!({
                "success": false,
                "error": "start and end date parameters required"
            }));
        }

        match queries::get_audit_events_by_date(&start_date, &end_date, limit).await {
            Ok(events) => {
                Json(json!({
                    "success": true,
                    "events": events,
                    "count": events.len()
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

    /// Get tool usage analytics
    pub async fn tool_analytics() -> Json<serde_json::Value> {
        match queries::get_tool_analytics().await {
            Ok(analytics) => {
                Json(json!({
                    "success": true,
                    "analytics": analytics
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

    /// Get session statistics
    pub async fn session_stats() -> Json<serde_json::Value> {
        match queries::get_session_stats().await {
            Ok(stats) => {
                Json(json!({
                    "success": true,
                    "stats": stats
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

    /// Pause a session
    pub async fn pause_session(Path(id): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
        match queries::pause_session(&id).await {
            Ok(_) => (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "status": "paused"
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

    /// Resume a session
    pub async fn resume_session(Path(id): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
        match queries::resume_session(&id).await {
            Ok(_) => (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "status": "active"
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

    /// Delete a session
    pub async fn delete_session(Path(id): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
        match queries::delete_session(&id).await {
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
                    "error": "Session not found"
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
}
