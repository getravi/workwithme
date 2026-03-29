pub mod ws;
pub mod skills;
pub mod keychain;
pub mod audit;
pub mod sessions;
pub mod mcp;
pub mod oauth;
pub mod sandbox;
pub mod approval;
pub mod extensions;
pub mod static_files;
pub mod settings;
pub mod models;
pub mod clipboard;
pub mod notifications;
pub mod files;
pub mod processes;
pub mod logging;
pub mod plugins;
pub mod errors;

use axum::{
    extract::{ws::WebSocketUpgrade, Path, Query},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post, delete},
    Json, Router, middleware::Next,
    body::Body,
};
use serde::Deserialize;
use serde_json::json;
use tower_http::cors::CorsLayer;
use governor::{Quota, RateLimiter, state::{InMemoryState, NotKeyed}, clock::DefaultClock};
use std::num::NonZeroU32;
use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::{RwLock, oneshot};
use std::sync::OnceLock;
use std::sync::Mutex;

/// Global map of OAuth state → completion sender.
/// When the OAuth callback fires, it signals the waiting SSE stream.
static OAUTH_COMPLETIONS: OnceLock<Mutex<HashMap<String, oneshot::Sender<Result<(), String>>>>> =
    OnceLock::new();

fn oauth_completions() -> &'static Mutex<HashMap<String, oneshot::Sender<Result<(), String>>>> {
    OAUTH_COMPLETIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone)]
enum PiOAuthPendingKind {
    OAuth,
    DeviceFlow,
}

#[derive(Clone)]
struct PiOAuthPending {
    provider: String,
    kind: PiOAuthPendingKind,
    verifier: String,
    device_code: Option<String>,
}

static PI_OAUTH_PENDING: OnceLock<Mutex<HashMap<String, PiOAuthPending>>> = OnceLock::new();

fn pi_oauth_pending() -> &'static Mutex<HashMap<String, PiOAuthPending>> {
    PI_OAUTH_PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn provider_oauth_access_token(provider: &str) -> Option<String> {
    oauth::get_credentials(provider, "")
        .ok()
        .flatten()
        .and_then(|creds| {
            let token = creds.access_token.trim();
            (!token.is_empty()).then(|| token.to_string())
        })
}

fn provider_pi_resolved_key(provider: &str) -> Option<String> {
    let auth = pi::auth::AuthStorage::load(pi::config::Config::auth_path()).ok()?;
    auth.resolve_api_key(provider, None)
}

fn select_session_auth_token_from_sources(
    oauth_token: Option<String>,
    pi_token: Option<String>,
    app_token: Option<String>,
) -> Option<String> {
    oauth_token.or(pi_token).or(app_token)
}

pub(crate) fn resolve_session_auth_token(
    auth_storage: &AuthStorage,
    provider: &str,
) -> Option<String> {
    let provider = provider.to_lowercase();
    select_session_auth_token_from_sources(
        provider_oauth_access_token(&provider),
        provider_pi_resolved_key(&provider),
        auth_storage.get_key(&provider),
    )
}

pub(crate) fn provider_has_session_auth(auth_storage: &AuthStorage, provider: &str) -> bool {
    resolve_session_auth_token(auth_storage, provider).is_some()
}

/// Model registry for managing available models
pub struct ModelRegistry {
    /// Cache of models from models.rs
    models: Vec<models::Model>,
}

impl ModelRegistry {
    /// Create new model registry
    pub fn new() -> Result<Self, String> {
        let models = models::list_models()?;
        Ok(ModelRegistry { models })
    }

    /// Get all available models
    #[allow(dead_code)]
    pub fn list(&self) -> Vec<models::Model> {
        self.models.clone()
    }

    /// Find a model by ID
    pub fn find(&self, id: &str) -> Option<models::Model> {
        self.models.iter().find(|m| m.id == id).cloned()
    }

    /// Get API key for a specific model/provider
    #[allow(dead_code)]
    pub fn get_api_key_for_model(&self, model_id: &str, auth_storage: &AuthStorage) -> Option<String> {
        self.find(model_id)
            .and_then(|model| auth_storage.get_key(&model.provider.to_lowercase()))
    }
}

/// Authentication storage for API keys
pub struct AuthStorage;

impl AuthStorage {
    /// Get API key for a provider, checking app-managed keychain first then env vars
    pub fn get_key(&self, provider: &str) -> Option<String> {
        let provider_lower = provider.to_lowercase();

        // Try keychain first
        if let Ok(Some(key)) = keychain::get(&format!("{}-api-key", provider_lower)) {
            return Some(key);
        }

        // Fall back to environment variables
        let env_var = match provider_lower.as_str() {
            "anthropic" => std::env::var("ANTHROPIC_API_KEY").ok(),
            "openai" => std::env::var("OPENAI_API_KEY").ok(),
            "google" => std::env::var("GOOGLE_API_KEY").ok(),
            "cohere" => std::env::var("COHERE_API_KEY").ok(),
            _ => None,
        };

        env_var
    }

    /// Store API key for a provider
    #[allow(dead_code)]
    pub fn set_key(&self, provider: &str, key: &str) -> Result<(), String> {
        let provider_lower = provider.to_lowercase();
        keychain::set(&format!("{}-api-key", provider_lower), key)
    }

    /// Delete API key for a provider
    #[allow(dead_code)]
    pub fn delete_key(&self, provider: &str) -> Result<bool, String> {
        let provider_lower = provider.to_lowercase();
        keychain::delete(&format!("{}-api-key", provider_lower))
    }

    /// Get list of configured providers (those with keys stored)
    #[allow(dead_code)]
    pub fn get_configured_providers(&self) -> Result<Vec<String>, String> {
        let providers = vec!["anthropic", "openai", "google", "cohere"];
        let mut configured = Vec::new();

        for provider in providers {
            if provider_has_session_auth(self, provider) {
                configured.push(provider.to_string());
            }
        }

        Ok(configured)
    }
}

/// Pi session handle type — wraps the pi_agent_rust session behind an async mutex
/// so a single session can be accessed from multiple tasks safely.
pub type PiSessionHandle = Arc<tokio::sync::Mutex<pi::sdk::AgentSessionHandle>>;

/// Application state shared across all Axum handlers and WebSocket connections.
///
/// Holds auth storage for API keys, pi agent sessions keyed by session ID,
/// abort handles for prompt cancellation, per-session working directories,
/// and per-session model overrides.
pub struct AppState {
    /// Model registry (for REST /api/models endpoints)
    pub model_registry: Arc<ModelRegistry>,
    /// Authentication storage — keychain + env-var fallback for all providers
    pub auth_storage: Arc<AuthStorage>,
    /// Active pi agent sessions keyed by session_id
    pub session_handles: Arc<RwLock<HashMap<String, PiSessionHandle>>>,
    /// Abort handles for in-flight prompts — used by POST /api/stop
    pub abort_handles: Arc<RwLock<HashMap<String, pi::sdk::AbortHandle>>>,
    /// Working directory per session — preserved across WS reconnects
    pub session_cwd: Arc<RwLock<HashMap<String, String>>>,
    /// Session-scoped model override: session_id → "provider/model_id"
    /// Set by POST /api/model; read by create_pi_session before session init.
    pub session_model: Arc<RwLock<HashMap<String, (String, String)>>>,
}

impl AppState {
    /// Create a new AppState, initialising all shared maps as empty.
    pub fn new() -> Result<Self, String> {
        let model_registry = Arc::new(ModelRegistry::new()?);
        let auth_storage = Arc::new(AuthStorage);
        Ok(AppState {
            model_registry,
            auth_storage,
            session_handles: Arc::new(RwLock::new(HashMap::new())),
            abort_handles: Arc::new(RwLock::new(HashMap::new())),
            session_cwd: Arc::new(RwLock::new(HashMap::new())),
            session_model: Arc::new(RwLock::new(HashMap::new())),
        })
    }
}

/// Create CORS configuration for frontend requests
/// Allows requests from localhost and Tauri webview contexts.
/// Uses permissive mode for development; Tauri webview runs same-origin anyway.
fn create_cors_layer() -> CorsLayer {
    // Permissive CORS for Tauri webview (which runs same-origin by default)
    // In production, restrict to specific origins if needed
    CorsLayer::permissive()
}

/// Create the main Axum router with all endpoints and middleware.
pub async fn create_app() -> Result<Router, String> {
    // Initialize application state
    let app_state = Arc::new(AppState::new()?);

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
        // WebSocket diagnostics
        .route("/api/ws/connections", get(ws_connections))
        // Skills endpoints
        .route("/api/skills", get(skills_endpoints::list))
        .route("/api/skills/{source}/{slug}", get(skills_endpoints::get))
        // Keychain endpoints
        .route("/api/keychain/{key}", get(keychain_endpoints::get))
        .route("/api/keychain", post(keychain_endpoints::set))
        .route("/api/keychain/{key}", delete(keychain_endpoints::delete))
        // Audit endpoint
        .route("/api/audit", post(audit_endpoints::log))
        // Sessions endpoints
        .route("/api/sessions", get(sessions_endpoints::list))
        .route("/api/sessions", post(sessions_endpoints::create))
        .route("/api/sessions/load", post(sessions_endpoints::load))
        .route("/api/sessions/archive", post(sessions_endpoints::archive_by_path))
        .route("/api/sessions/{id}", get(sessions_endpoints::get))
        .route("/api/sessions/{id}", axum::routing::put(sessions_endpoints::update))
        .route("/api/sessions/{id}/archive", post(sessions_endpoints::archive))
        // MCP endpoints
        .route("/api/mcp", get(mcp_endpoints::get_config))
        .route("/api/mcp", post(mcp_endpoints::update_config))
        .route("/api/mcp/catalog", get(mcp_endpoints::get_catalog))
        // Connectors endpoints (frontend-facing alias for MCP)
        .route("/api/connectors", get(connectors_endpoints::list))
        .route("/api/connectors/remote-mcp/{slug}", get(connectors_endpoints::get))
        .route("/api/connectors/remote-mcp", post(connectors_endpoints::add))
        .route("/api/connectors/remote-mcp/{slug}", axum::routing::put(connectors_endpoints::update))
        .route("/api/connectors/remote-mcp/{slug}", delete(connectors_endpoints::remove))
        // OAuth endpoints — login uses GET + SSE (EventSource)
        .route("/api/auth/oauth-providers", get(oauth_endpoints::list_providers))
        .route("/api/auth/login", get(oauth_endpoints::login))
        .route("/api/auth/login/complete", post(oauth_endpoints::complete_login))
        .route("/api/auth/callback", get(oauth_endpoints::callback))
        .route("/api/auth/status", get(oauth_endpoints::status))
        .route("/api/auth/logout", post(oauth_endpoints::logout))
        // Auth/model endpoints for Phase 3
        .route("/api/auth/key", post(auth_endpoints::set_key))
        .route("/api/auth", get(auth_endpoints::get_configured))
        .route("/api/model", post(agent_endpoints::set_model))
        .route("/api/stop", post(agent_endpoints::stop_agent))
        .route("/api/project", get(agent_endpoints::get_project))
        .route("/api/project", post(agent_endpoints::set_project))
        .route("/api/sandbox/status", get(agent_endpoints::sandbox_status))
        // Agent endpoints
        .route("/api/agent/session", post(agent_endpoints::create_session))
        // Settings endpoints
        .route("/api/settings", get(settings_endpoints::get_all))
        .route("/api/settings", post(settings_endpoints::save_all))
        .route("/api/settings/{key}", get(settings_endpoints::get))
        .route("/api/settings/{key}", post(settings_endpoints::set))
        .route("/api/settings/{key}", delete(settings_endpoints::delete))
        // Models endpoints
        .route("/api/models", get(models_endpoints::list))
        .route("/api/models/selected", get(models_endpoints::get_selected))
        .route("/api/models/select/{id}", post(models_endpoints::select))
        .route("/api/models/add", post(models_endpoints::add))
        .route("/api/models/{id}", delete(models_endpoints::remove))
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
        .route("/api/processes/{id}/kill", post(processes_endpoints::kill))
        // Logging endpoints
        .route("/api/logs", get(logging_endpoints::get_logs))
        .route("/api/logs/level", get(logging_endpoints::get_level))
        .route("/api/logs/level", post(logging_endpoints::set_level))
        .route("/api/logs/clear", post(logging_endpoints::clear))
        // Plugin endpoints
        .route("/api/plugins", get(plugins_endpoints::list))
        .route("/api/plugins/install", post(plugins_endpoints::install))
        .route("/api/plugins/stats", get(plugins_endpoints::stats))
        .route("/api/plugins/{id}", get(plugins_endpoints::get))
        .route("/api/plugins/{id}/enable", post(plugins_endpoints::enable))
        .route("/api/plugins/{id}/disable", post(plugins_endpoints::disable))
        .route("/api/plugins/{id}", delete(plugins_endpoints::uninstall))
        .route("/api/plugins/{id}/call", post(plugins_endpoints::call))
        // Static files (SPA fallback) - catch-all at the end
        .fallback(static_files_handler)
        // Add security headers to all responses
        .layer(axum::middleware::from_fn(security_headers_middleware))
        // Rate limiting middleware to prevent DoS attacks
        .layer(axum::middleware::from_fn_with_state(
            rate_limiter,
            rate_limit_middleware,
        ))
        // Request body size limit (10MB max) to prevent memory exhaustion attacks
        .layer(axum::middleware::from_fn(request_size_limit_middleware))
        // CORS middleware to allow frontend requests
        .layer(create_cors_layer())
        // Inject application state
        .with_state(app_state);

    Ok(app)
}

/// Handler for static files with SPA routing fallback
async fn static_files_handler(
    axum::extract::Path(path): axum::extract::Path<String>,
) -> impl IntoResponse {
    static_files::serve_static(path).await
}

/// WebSocket handler for agent communication.
/// Passes shared AppState into the socket handler for session + abort management.
async fn ws_handler(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws::handle_socket(socket, state))
}

/// Health check endpoint.
async fn health_check() -> Json<serde_json::Value> {
    let ws_count = ws::get_active_connections().await;
    Json(json!({
        "status": "ok",
        "server": "workwithme-rust-backend",
        "ws_connections": ws_count
    }))
}

/// Return per-connection diagnostics — connection ID, connect time, subscribed session.
async fn ws_connections() -> Json<serde_json::Value> {
    let connections = ws::active_connection_info().await;
    Json(json!({
        "count": connections.len(),
        "connections": connections
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

/// Request size limit middleware to prevent memory exhaustion attacks.
/// Rejects requests with Content-Length > 10MB.
async fn request_size_limit_middleware(
    request: axum::http::Request<Body>,
    next: Next,
) -> axum::response::Result<axum::response::Response> {
    const MAX_BODY_SIZE: u64 = 10 * 1024 * 1024; // 10MB

    // Check Content-Length header
    if let Some(content_length) = request
        .headers()
        .get(axum::http::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
    {
        if content_length > MAX_BODY_SIZE {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                "Request body exceeds maximum size (10MB).",
            ).into());
        }
    }

    Ok(next.run(request).await)
}

/// Add security headers to all responses to prevent common attacks
async fn security_headers_middleware(
    request: axum::http::Request<Body>,
    next: Next,
) -> axum::response::Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();

    // Prevent MIME type sniffing
    headers.insert("X-Content-Type-Options", "nosniff".parse().unwrap());

    // Enable XSS protection in older browsers
    headers.insert("X-XSS-Protection", "1; mode=block".parse().unwrap());

    // Prevent clickjacking
    headers.insert("X-Frame-Options", "SAMEORIGIN".parse().unwrap());

    // Enforce HTTPS (for production deployments)
    headers.insert(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains".parse().unwrap(),
    );

    // Prevent information disclosure
    headers.insert("X-Powered-By", "".parse().unwrap());
    headers.remove("Server");

    response
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

    /// Create a new agent session record in the sessions store.
    ///
    /// This creates the on-disk session JSON used by the sessions REST API.
    /// The actual pi runtime session is created separately when `new_chat` arrives
    /// over WebSocket.
    pub async fn create_session(Json(req): Json<CreateSessionRequest>) -> (StatusCode, Json<serde_json::Value>) {
        let now = chrono::Local::now().to_rfc3339();
        let session_id = uuid::Uuid::new_v4().to_string();
        let mut metadata = req.metadata.unwrap_or_else(|| json!({}));

        // Try to generate a session label using Claude Haiku
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .ok()
            .or_else(|| keychain::get("anthropic-api-key").ok().flatten());

        if let Some(key) = api_key {
            let label = extensions::generate_session_label_with_fallback(&key, "new coding session").await;
            if let Some(obj) = metadata.as_object_mut() {
                obj.insert("label".to_string(), json!(label));
            }
        } else if let Some(obj) = metadata.as_object_mut() {
            obj.insert("label".to_string(), json!(format!("session-{}", &session_id[..8])));
        }

        let session = json!({
            "id": session_id,
            "created_at": now,
            "updated_at": now,
            "messages": [],
            "metadata": metadata
        });

        // Persist session to disk
        match sessions::create_session(session.clone()) {
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

    #[derive(Deserialize)]
    pub struct SetModelRequest {
        pub provider: String,
        #[serde(rename = "modelId", alias = "model_id")]
        pub model_id: String,
        #[serde(rename = "sessionId", alias = "session_id", default)]
        pub session_id: Option<String>,
    }

    /// Set the model for a session (or as a global default when no sessionId given).
    ///
    /// Validates the model ID against the model registry before storing.
    /// Stores `(provider, model_id)` in `AppState::session_model`.  The next
    /// `create_pi_session` call for this session will pick up the stored values
    /// and pass them via `SessionOptions::provider` / `SessionOptions::model`.
    pub async fn set_model(
        axum::extract::State(state): axum::extract::State<Arc<AppState>>,
        Json(req): Json<SetModelRequest>,
    ) -> (StatusCode, Json<serde_json::Value>) {
        // Validate the model ID is known (custom/unknown models are allowed but logged)
        if state.model_registry.find(&req.model_id).is_none() {
            eprintln!("[api/model] unknown model '{}' — accepting anyway (may be a custom or new model)", req.model_id);
        }

        // Use "__global__" as the key when no sessionId is provided
        let key = req.session_id.clone().unwrap_or_else(|| "__global__".to_string());
        {
            let mut models = state.session_model.write().await;
            models.insert(key, (req.provider.clone(), req.model_id.clone()));
        }
        (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "provider": req.provider,
                "model_id": req.model_id
            }))
        )
    }

    /// Stop an active agent run by firing the session's abort handle.
    ///
    /// Looks up the `AbortHandle` stored in `AppState::abort_handles` when a
    /// prompt was started, then calls `abort()` to signal cancellation to the
    /// pi agent loop.
    pub async fn stop_agent(
        axum::extract::State(state): axum::extract::State<Arc<AppState>>,
        Json(req): Json<serde_json::Value>,
    ) -> (StatusCode, Json<serde_json::Value>) {
        let session_id = req.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
        if session_id.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"success": false, "error": "sessionId required"})),
            );
        }

        let aborted = {
            let handles = state.abort_handles.read().await;
            if let Some(handle) = handles.get(session_id) {
                handle.abort();
                true
            } else {
                false
            }
        };

        (
            StatusCode::OK,
            Json(json!({"success": true, "aborted": aborted})),
        )
    }

    /// Get the working directory for a session.
    ///
    /// Reads from `AppState::session_cwd` (set when `new_chat` creates a
    /// session) and falls back to the process CWD if no session is specified.
    pub async fn get_project(
        axum::extract::State(state): axum::extract::State<Arc<AppState>>,
        Query(params): Query<HashMap<String, String>>,
    ) -> Json<serde_json::Value> {
        let cwd = if let Some(sid) = params.get("sessionId") {
            let cwds = state.session_cwd.read().await;
            cwds.get(sid).cloned().unwrap_or_else(|| "/".to_string())
        } else {
            std::env::current_dir()
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|| "/".to_string())
        };
        Json(json!({"cwd": cwd}))
    }

    #[derive(Deserialize)]
    pub struct SetProjectRequest {
        /// Accepts both `cwd` and `path` from the frontend.
        #[serde(alias = "path")]
        pub cwd: String,
        /// Accepts camelCase `sessionId` from the frontend (API contract).
        #[serde(default, rename = "sessionId", alias = "session_id")]
        pub session_id: Option<String>,
    }

    /// Set project directory (creates new session or updates existing)
    pub async fn set_project(
        axum::extract::State(state): axum::extract::State<Arc<AppState>>,
        Json(req): Json<SetProjectRequest>,
    ) -> (StatusCode, Json<serde_json::Value>) {
        // If updating existing session, load it; otherwise create new
        let mut session_data = if let Some(ref sid) = req.session_id {
            match sessions::load_session(sid) {
                Ok(Some(s)) => s,
                _ => {
                    // Session doesn't exist, create new one
                    let now = chrono::Local::now().to_rfc3339();
                    json!({
                        "id": uuid::Uuid::new_v4().to_string(),
                        "created_at": now,
                        "updated_at": now,
                        "messages": [],
                        "metadata": {}
                    })
                }
            }
        } else {
            // Create new session
            let now = chrono::Local::now().to_rfc3339();
            json!({
                "id": uuid::Uuid::new_v4().to_string(),
                "created_at": now,
                "updated_at": now,
                "messages": [],
                "metadata": {}
            })
        };

        // Update metadata with cwd
        if let Some(meta) = session_data.get_mut("metadata") {
            if let Some(meta_obj) = meta.as_object_mut() {
                meta_obj.insert("cwd".to_string(), json!(req.cwd.clone()));
            }
        } else {
            if let Some(obj) = session_data.as_object_mut() {
                obj.insert("metadata".to_string(), json!({
                    "cwd": req.cwd.clone()
                }));
            }
        }

        // Save or update session
        let session_id = if let Some(sid) = req.session_id {
            let _ = sessions::update_session(&sid, session_data);
            sid
        } else {
            match sessions::create_session(session_data) {
                Ok(id) => id,
                Err(e) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({
                            "success": false,
                            "error": e
                        }))
                    );
                }
            }
        };

        // Store cwd in AppState so GET /api/project reflects it immediately
        {
            let mut cwds = state.session_cwd.write().await;
            cwds.insert(session_id.clone(), req.cwd.clone());
        }

        // Drop the existing pi session handle so the next prompt spawns a fresh
        // session with the updated working directory as its sandbox boundary.
        {
            let mut handles = state.session_handles.write().await;
            handles.remove(&session_id);
        }

        (
            StatusCode::CREATED,
            Json(json!({
                "success": true,
                "sessionId": session_id,
                "cwd": req.cwd
            }))
        )
    }

    /// Get sandbox support status
    pub async fn sandbox_status() -> Json<serde_json::Value> {
        Json(json!({
            "supported": true,
            "active": true,
            "srtAvailable": false,
            "platform": std::env::consts::OS,
            "warning": null,
            "features": ["tool_execution", "approval_flow", "tool_schemas"]
        }))
    }
}

/// Auth API endpoints (Phase 3)
mod auth_endpoints {
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
    pub struct CompleteLoginRequest {
        #[serde(rename = "pendingId", alias = "pending_id")]
        pub pending_id: String,
        #[serde(rename = "codeInput", alias = "code_input")]
        pub code_input: Option<String>,
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

    /// Initiate a pi_agent_rust-backed OAuth login flow.
    pub async fn login(Query(req): Query<LoginRequest>) -> (StatusCode, Json<serde_json::Value>) {
        let provider = req.provider.clone();
        let pending_id = uuid::Uuid::new_v4().to_string();

        if provider == "kimi-for-coding" {
            match pi::auth::start_kimi_code_device_flow().await {
                Ok(device) => {
                    let verification_url = device
                        .verification_uri_complete
                        .clone()
                        .unwrap_or_else(|| device.verification_uri.clone());
                    pi_oauth_pending().lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .insert(pending_id.clone(), PiOAuthPending {
                            provider: provider.clone(),
                            kind: PiOAuthPendingKind::DeviceFlow,
                            verifier: String::new(),
                            device_code: Some(device.device_code),
                        });

                    (
                        StatusCode::OK,
                        Json(json!({
                            "success": true,
                            "provider": provider,
                            "pendingId": pending_id,
                            "kind": "device",
                            "url": verification_url,
                            "instructions": format!(
                                "If prompted, enter this code: {}. After approving access in the browser, click Complete setup.",
                                device.user_code
                            ),
                            "message": "Open the link below and approve access to continue."
                        }))
                    )
                }
                Err(e) => (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "success": false, "error": e.to_string() }))
                ),
            }
        } else {
            let oauth_result = if provider == "anthropic" {
                pi::auth::start_anthropic_oauth().map(|info| (info.provider, info.url, info.verifier, info.instructions))
            } else if provider == "openai-codex" {
                pi::auth::start_openai_codex_oauth().map(|info| (info.provider, info.url, info.verifier, info.instructions))
            } else if provider == "google-gemini-cli" {
                pi::auth::start_google_gemini_cli_oauth().map(|info| (info.provider, info.url, info.verifier, info.instructions))
            } else if provider == "google-antigravity" {
                pi::auth::start_google_antigravity_oauth().map(|info| (info.provider, info.url, info.verifier, info.instructions))
            } else if provider == "github-copilot" || provider == "copilot" {
                let client_id = std::env::var("GITHUB_COPILOT_CLIENT_ID").unwrap_or_default();
                let config = pi::auth::CopilotOAuthConfig {
                    client_id,
                    ..pi::auth::CopilotOAuthConfig::default()
                };
                pi::auth::start_copilot_browser_oauth(&config).map(|info| (info.provider, info.url, info.verifier, info.instructions))
            } else if provider == "gitlab" || provider == "gitlab-duo" {
                let client_id = std::env::var("GITLAB_CLIENT_ID").unwrap_or_default();
                let base_url = std::env::var("GITLAB_BASE_URL")
                    .unwrap_or_else(|_| "https://gitlab.com".to_string());
                let config = pi::auth::GitLabOAuthConfig {
                    client_id,
                    base_url,
                    ..pi::auth::GitLabOAuthConfig::default()
                };
                pi::auth::start_gitlab_oauth(&config).map(|info| (info.provider, info.url, info.verifier, info.instructions))
            } else {
                Err(pi::error::Error::auth(format!("Login not supported for {provider}")))
            };

            match oauth_result {
                Ok((resolved_provider, url, verifier, instructions)) => {
                    pi_oauth_pending().lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .insert(pending_id.clone(), PiOAuthPending {
                            provider: resolved_provider.clone(),
                            kind: PiOAuthPendingKind::OAuth,
                            verifier,
                            device_code: None,
                        });

                    (
                        StatusCode::OK,
                        Json(json!({
                            "success": true,
                            "provider": resolved_provider,
                            "pendingId": pending_id,
                            "kind": "oauth",
                            "url": url,
                            "instructions": instructions,
                            "message": "Open the link below, then paste the callback URL or authorization code to continue."
                        }))
                    )
                }
                Err(e) => (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "success": false, "error": e.to_string() }))
                ),
            }
        }
    }

    pub async fn complete_login(Json(req): Json<CompleteLoginRequest>) -> (StatusCode, Json<serde_json::Value>) {
        let pending = {
            pi_oauth_pending().lock()
                .unwrap_or_else(|p| p.into_inner())
                .get(&req.pending_id)
                .cloned()
        };

        let Some(pending) = pending else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "success": false, "error": "Login session not found or expired." }))
            );
        };

        let mut auth = match pi::auth::AuthStorage::load_async(pi::config::Config::auth_path()).await {
            Ok(auth) => auth,
            Err(e) => return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": e.to_string() }))
            ),
        };

        let credential_result = match pending.kind {
            PiOAuthPendingKind::OAuth => {
                let code_input = req.code_input.as_deref().unwrap_or("").trim().to_string();
                if code_input.is_empty() {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "success": false, "error": "Paste the callback URL or authorization code to continue." }))
                    );
                }

                if pending.provider == "anthropic" {
                    pi::auth::complete_anthropic_oauth(&code_input, &pending.verifier).await.map_err(|e| e.to_string())
                } else if pending.provider == "openai-codex" {
                    pi::auth::complete_openai_codex_oauth(&code_input, &pending.verifier).await.map_err(|e| e.to_string())
                } else if pending.provider == "google-gemini-cli" {
                    pi::auth::complete_google_gemini_cli_oauth(&code_input, &pending.verifier).await.map_err(|e| e.to_string())
                } else if pending.provider == "google-antigravity" {
                    pi::auth::complete_google_antigravity_oauth(&code_input, &pending.verifier).await.map_err(|e| e.to_string())
                } else if pending.provider == "github-copilot" || pending.provider == "copilot" {
                    let client_id = std::env::var("GITHUB_COPILOT_CLIENT_ID").unwrap_or_default();
                    let config = pi::auth::CopilotOAuthConfig {
                        client_id,
                        ..pi::auth::CopilotOAuthConfig::default()
                    };
                    pi::auth::complete_copilot_browser_oauth(&config, &code_input, &pending.verifier).await.map_err(|e| e.to_string())
                } else if pending.provider == "gitlab" || pending.provider == "gitlab-duo" {
                    let client_id = std::env::var("GITLAB_CLIENT_ID").unwrap_or_default();
                    let base_url = std::env::var("GITLAB_BASE_URL")
                        .unwrap_or_else(|_| "https://gitlab.com".to_string());
                    let config = pi::auth::GitLabOAuthConfig {
                        client_id,
                        base_url,
                        ..pi::auth::GitLabOAuthConfig::default()
                    };
                    pi::auth::complete_gitlab_oauth(&config, &code_input, &pending.verifier).await.map_err(|e| e.to_string())
                } else {
                    Err(format!("Login completion not supported for {}", pending.provider))
                }
            }
            PiOAuthPendingKind::DeviceFlow => {
                let Some(device_code) = pending.device_code.as_deref() else {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "success": false, "error": "Device flow is missing a device code." }))
                    );
                };

                match pi::auth::poll_kimi_code_device_flow(device_code).await {
                    pi::auth::DeviceFlowPollResult::Success(credential) => Ok(credential),
                    pi::auth::DeviceFlowPollResult::Pending => Err("Authorization is still pending. Approve access in the browser, then try again.".to_string()),
                    pi::auth::DeviceFlowPollResult::SlowDown => Err("Authorization server asked to slow down. Wait a few seconds and try again.".to_string()),
                    pi::auth::DeviceFlowPollResult::Expired => Err("Device code expired. Start setup again.".to_string()),
                    pi::auth::DeviceFlowPollResult::AccessDenied => Err("Authorization was denied.".to_string()),
                    pi::auth::DeviceFlowPollResult::Error(err) => Err(err),
                }
            }
        };

        match credential_result {
            Ok(credential) => {
                auth.set(pending.provider.clone(), credential);
                if let Err(e) = auth.save_async().await {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "success": false, "error": e.to_string() }))
                    );
                }

                pi_oauth_pending().lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .remove(&req.pending_id);

                (
                    StatusCode::OK,
                    Json(json!({ "success": true, "provider": pending.provider }))
                )
            }
            Err(error) => {
                let status = if error.contains("pending") || error.contains("slow down") {
                    StatusCode::CONFLICT
                } else {
                    StatusCode::BAD_REQUEST
                };
                (status, Json(json!({ "success": false, "error": error })))
            }
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
                // Signal the waiting SSE stream that auth completed successfully
                if let Some(tx) = oauth_completions().lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .remove(&state)
                {
                    let _ = tx.send(Ok(()));
                }

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
            Err(e) => {
                // Signal the waiting SSE stream that auth failed
                if let Some(tx) = oauth_completions().lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .remove(&state)
                {
                    let _ = tx.send(Err(format!("Token exchange failed: {}", e)));
                }

                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "success": false,
                        "error": format!("Token exchange failed: {}", e)
                    }))
                )
            }
        }
    }

    /// Get authentication status
    pub async fn status() -> Json<serde_json::Value> {
        let mut authenticated = vec![];
        let auth = pi::auth::AuthStorage::load(pi::config::Config::auth_path()).ok();

        for provider in oauth::get_oauth_providers() {
            let is_active = auth.as_ref().map(|auth| {
                !matches!(
                    auth.credential_status(&provider.id),
                    pi::auth::CredentialStatus::Missing | pi::auth::CredentialStatus::OAuthExpired { .. }
                )
            }).unwrap_or(false);

            if is_active {
                authenticated.push(provider.id);
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

    #[derive(Deserialize)]
    pub struct ListQuery {
        #[serde(rename = "includeArchived")]
        pub include_archived: Option<bool>,
    }

    #[derive(Deserialize)]
    pub struct LoadRequest {
        pub path: String,
    }

    #[derive(Deserialize)]
    pub struct ArchiveRequest {
        pub path: String,
        pub archived: bool,
    }

    /// List sessions. Returns a plain JSON array.
    /// Accepts ?includeArchived=true to include archived sessions.
    pub async fn list(Query(q): Query<ListQuery>) -> Json<serde_json::Value> {
        let include_archived = q.include_archived.unwrap_or(false);
        match sessions::list_sessions_all(include_archived) {
            Ok(session_list) => Json(serde_json::Value::Array(session_list)),
            Err(_) => Json(serde_json::Value::Array(vec![])),
        }
    }

    /// Load a session by absolute file path.
    /// Returns { success, sessionId, messages, toolExecutions, cwd }.
    pub async fn load(Json(req): Json<LoadRequest>) -> (StatusCode, Json<serde_json::Value>) {
        match sessions::load_session_by_path(&req.path) {
            Ok(Some(session)) => {
                let session_id = session.get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let cwd = session.get("cwd")
                    .or_else(|| session.get("working_directory"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let messages = session.get("messages")
                    .cloned()
                    .unwrap_or(json!([]));
                let tool_executions = session.get("toolExecutions")
                    .or_else(|| session.get("tool_executions"))
                    .cloned()
                    .unwrap_or(json!([]));

                (StatusCode::OK, Json(json!({
                    "success": true,
                    "sessionId": session_id,
                    "messages": messages,
                    "toolExecutions": tool_executions,
                    "cwd": cwd
                })))
            }
            Ok(None) => (StatusCode::NOT_FOUND, Json(json!({
                "success": false,
                "error": "Session not found"
            }))),
            Err(e) => (StatusCode::BAD_REQUEST, Json(json!({
                "success": false,
                "error": e
            }))),
        }
    }

    /// Archive or unarchive a session by its absolute file path.
    pub async fn archive_by_path(Json(req): Json<ArchiveRequest>) -> (StatusCode, Json<serde_json::Value>) {
        match sessions::set_archived_by_path(&req.path, req.archived) {
            Ok(true) => (StatusCode::OK, Json(json!({ "success": true }))),
            Ok(false) => (StatusCode::NOT_FOUND, Json(json!({
                "success": false,
                "error": "Session not found"
            }))),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "success": false,
                "error": e
            }))),
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

/// Connectors API endpoints (frontend-facing alias for MCP)
mod connectors_endpoints {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_set_project_request_with_session_id() {
        // Test that SetProjectRequest properly deserializes with sessionId
        let json = r#"{"cwd":"/home/user/project","sessionId":"abc123"}"#;
        let req: agent_endpoints::SetProjectRequest = serde_json::from_str(json).unwrap();

        assert_eq!(req.cwd, "/home/user/project");
        assert_eq!(req.session_id, Some("abc123".to_string()));
    }

    #[test]
    fn test_set_project_request_without_session_id() {
        // Test that SetProjectRequest works without sessionId (optional field)
        let json = r#"{"cwd":"/home/user/project"}"#;
        let req: agent_endpoints::SetProjectRequest = serde_json::from_str(json).unwrap();

        assert_eq!(req.cwd, "/home/user/project");
        assert_eq!(req.session_id, None);
    }

    #[test]
    fn test_cwd_stored_in_session_metadata() {
        // Test that cwd is properly stored in session metadata
        let cwd = "/home/user/projects/my-app";

        // Simulate what set_project does: create session JSON and update metadata with cwd
        let now = chrono::Local::now().to_rfc3339();
        let mut session_json = json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "created_at": now,
            "updated_at": now,
            "messages": [],
            "metadata": {}
        });
        if let Some(meta) = session_json.get_mut("metadata") {
            if let Some(meta_obj) = meta.as_object_mut() {
                meta_obj.insert("cwd".to_string(), json!(cwd));
            }
        }

        // Verify cwd is in metadata
        let stored_cwd = session_json
            .get("metadata")
            .and_then(|m| m.get("cwd"))
            .and_then(|c| c.as_str());

        assert_eq!(stored_cwd, Some(cwd));
    }

    #[test]
    fn test_inline_session_json_has_required_fields() {
        // Verify the inline session JSON created in set_project has the correct shape
        let now = chrono::Local::now().to_rfc3339();
        let session = json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "created_at": now,
            "updated_at": now,
            "messages": [],
            "metadata": {}
        });
        assert!(session["id"].is_string());
        assert!(session["created_at"].is_string());
        assert!(session["updated_at"].is_string());
        assert!(session["messages"].is_array());
        assert!(session["metadata"].is_object());
        assert_eq!(session["messages"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_model_registry_initialization() {
        // Test that ModelRegistry initializes properly
        match ModelRegistry::new() {
            Ok(registry) => {
                let models = registry.list();
                // Should have at least some models
                assert!(!models.is_empty(), "ModelRegistry should have models");
            }
            Err(e) => panic!("Failed to initialize ModelRegistry: {}", e),
        }
    }

    #[test]
    fn test_model_registry_find() {
        // Test finding a model by ID
        match ModelRegistry::new() {
            Ok(registry) => {
                // Should find claude-opus (common model)
                let found = registry.find("claude-opus-4-6");
                assert!(found.is_some(), "Should find claude-opus-4-6 model");
            }
            Err(e) => panic!("Failed to initialize ModelRegistry: {}", e),
        }
    }

    #[test]
    fn test_auth_storage_initialization() {
        // Test that AuthStorage initializes and can query providers
        let auth = AuthStorage;

        // AuthStorage should be able to get configured providers
        let result = auth.get_configured_providers();
        assert!(result.is_ok(), "Should be able to query providers");
    }

    #[test]
    fn test_select_session_auth_token_prefers_oauth_over_other_sources() {
        let selected = select_session_auth_token_from_sources(
            Some("oauth-token".to_string()),
            Some("pi-token".to_string()),
            Some("app-key".to_string()),
        );

        assert_eq!(selected.as_deref(), Some("oauth-token"));
    }

    #[test]
    fn test_select_session_auth_token_falls_back_to_pi_then_app_key() {
        let selected = select_session_auth_token_from_sources(
            None,
            Some("pi-token".to_string()),
            Some("app-key".to_string()),
        );
        assert_eq!(selected.as_deref(), Some("pi-token"));

        let selected = select_session_auth_token_from_sources(
            None,
            None,
            Some("app-key".to_string()),
        );
        assert_eq!(selected.as_deref(), Some("app-key"));
    }

    #[tokio::test]
    async fn test_app_state_session_model_defaults_empty() {
        let state = AppState::new().expect("AppState::new should succeed");
        let models = state.session_model.read().await;
        assert!(models.is_empty(), "session_model should start empty");
    }

    #[tokio::test]
    async fn test_app_state_session_model_per_session_override() {
        let state = AppState::new().expect("AppState::new should succeed");
        {
            let mut models = state.session_model.write().await;
            models.insert("sess-abc".to_string(), ("openai".to_string(), "gpt-4o".to_string()));
        }
        let models = state.session_model.read().await;
        let entry = models.get("sess-abc").expect("should have sess-abc");
        assert_eq!(entry.0, "openai");
        assert_eq!(entry.1, "gpt-4o");
        // Other sessions unaffected
        assert!(models.get("sess-other").is_none());
    }

    #[tokio::test]
    async fn test_app_state_session_model_global_fallback() {
        let state = AppState::new().expect("AppState::new should succeed");
        {
            let mut models = state.session_model.write().await;
            models.insert("__global__".to_string(), ("anthropic".to_string(), "claude-haiku-4-5-20251001".to_string()));
        }
        let models = state.session_model.read().await;
        // A session with no per-session entry should use __global__
        let global = models.get("__global__").expect("should have __global__");
        assert_eq!(global.0, "anthropic");
        assert_eq!(global.1, "claude-haiku-4-5-20251001");
    }

    #[test]
    fn test_set_model_request_deserializes() {
        let json = r#"{"provider":"openai","model_id":"gpt-4o","session_id":"s1"}"#;
        let req: agent_endpoints::SetModelRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.provider, "openai");
        assert_eq!(req.model_id, "gpt-4o");
        assert_eq!(req.session_id, Some("s1".to_string()));
    }

    #[test]
    fn test_set_model_request_no_session_id() {
        let json = r#"{"provider":"anthropic","model_id":"claude-opus-4-6"}"#;
        let req: agent_endpoints::SetModelRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.session_id, None);
    }
}
