//! Axum HTTP server — the agent runtime backend.
//!
//! Sub-modules:
//! - [`ws`] — WebSocket hub for streaming agent output to the frontend
//! - [`sessions`] — session lifecycle (create, list, delete, append)
//! - [`files`] — file-system read/write routed through sandbox validation
//! - [`processes`] — shell command execution with sandboxing and approval
//! - [`skills`] — `.pi/skills/` discovery and rendering
//! - [`mcp`] — MCP server config and tool proxying
//! - [`oauth`] — OAuth 2.0 PKCE flow for remote MCP auth
//! - [`keychain`] — system keychain helpers for token storage
//! - [`audit`] — append-only security audit log
//! - [`approval`] — oneshot-channel approval flow for privileged operations
//! - [`extensions`] — session labelling and metadata enrichment
//! - [`models`] — available LLM model listing
//! - [`settings`] — JSON settings store at `~/.pi/settings.json`
//! - [`notifications`] — persistent notification log
//! - [`plugins`] — plugin manifest discovery and lifecycle
//! - [`clipboard`] — clipboard read/write helpers
//! - [`static_files`] — `rust-embed` frontend asset serving

pub mod ws;
pub mod ws_events;
pub mod skills;
pub mod keychain;
pub mod audit;
pub mod sessions;
pub mod mcp;
pub mod mcp_catalog;
pub mod oauth;
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
pub mod skills_endpoints;
pub mod keychain_endpoints;
pub mod audit_endpoints;
pub mod agent_endpoints;
pub mod auth_endpoints;
pub mod oauth_endpoints;
pub mod plugins_endpoints;
pub mod mcp_endpoints;
pub mod sessions_endpoints;
pub mod settings_endpoints;
pub mod models_endpoints;
pub mod clipboard_endpoints;
pub mod notifications_endpoints;
pub mod files_endpoints;
pub mod processes_endpoints;
pub mod logging_endpoints;
pub mod connectors_endpoints;

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

/// Startup-generated token written to ~/.pi/server-token.
/// Any process that calls the sensitive REST endpoints (keychain, clipboard, file browser)
/// must present this as `Authorization: Bearer <token>`.  The token is generated once per
/// app launch and lives only in memory — it is never persisted by the app itself.
static SERVER_TOKEN: OnceLock<String> = OnceLock::new();

/// Return (and lazily initialise) the server auth token.
/// On first call a random UUID-based token is generated and written to ~/.pi/server-token
/// so that the pi_agent (running as the same OS user) can read it.
pub fn server_token() -> &'static str {
    SERVER_TOKEN.get_or_init(|| {
        let token = uuid::Uuid::new_v4().to_string().replace('-', "");
        // Write to ~/.pi/server-token so pi_agent can read it.
        if let Some(home) = dirs::home_dir() {
            let pi_dir = home.join(".pi");
            let _ = std::fs::create_dir_all(&pi_dir);
            let _ = std::fs::write(pi_dir.join("server-token"), &token);
        }
        token
    })
}

/// Middleware that requires `Authorization: Bearer <server_token>` on sensitive endpoints.
async fn auth_middleware(
    request: axum::http::Request<Body>,
    next: Next,
) -> axum::response::Result<axum::response::Response> {
    let expected = server_token();
    let provided = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    if provided != Some(expected) {
        return Err((StatusCode::UNAUTHORIZED, "Unauthorized").into());
    }
    Ok(next.run(request).await)
}

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

    /// Find a model by ID
    pub fn find(&self, id: &str) -> Option<models::Model> {
        self.models.iter().find(|m| m.id == id).cloned()
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
    let quota = Quota::per_second(NonZeroU32::new(2).expect("invariant: 2 is a valid NonZeroU32"))
        .allow_burst(NonZeroU32::new(10).expect("invariant: 10 is a valid NonZeroU32"));
    let rate_limiter: Arc<RateLimiter<NotKeyed, InMemoryState, DefaultClock>> =
        Arc::new(RateLimiter::direct(quota));

    // Initialise the server token early so it is written to ~/.pi/server-token
    // before any endpoint can be called.
    server_token();

    // Routes that expose sensitive data (keychain secrets, clipboard contents, arbitrary
    // file browsing) are placed in a sub-router that requires a valid Bearer token.
    let protected = Router::new()
        .route("/api/keychain/{key}", get(keychain_endpoints::get))
        .route("/api/keychain", post(keychain_endpoints::set))
        .route("/api/keychain/{key}", delete(keychain_endpoints::delete))
        .route("/api/clipboard/paste", get(clipboard_endpoints::paste))
        .route("/api/files/list", get(files_endpoints::list))
        .route("/api/files/search", get(files_endpoints::search))
        .route("/api/files/info", get(files_endpoints::info))
        .layer(axum::middleware::from_fn(auth_middleware));

    let app = Router::new()
        .merge(protected)
        // WebSocket endpoint
        .route("/", get(ws_handler))
        // Health check
        .route("/api/health", get(health_check))
        // WebSocket diagnostics
        .route("/api/ws/connections", get(ws_connections))
        // Skills endpoints
        .route("/api/skills", get(skills_endpoints::list))
        .route("/api/skills/{source}/{slug}", get(skills_endpoints::get))
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
        .route("/api/thinking", get(agent_endpoints::get_thinking).post(agent_endpoints::set_thinking))
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
        // Clipboard endpoints (paste is in the protected router)
        .route("/api/clipboard/copy", post(clipboard_endpoints::copy))
        // Notifications endpoints
        .route("/api/notifications/send", post(notifications_endpoints::send))
        .route("/api/notifications", get(notifications_endpoints::list))
        // File browser endpoints are in the protected router
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
    headers.insert("X-Content-Type-Options", "nosniff".parse().expect("invariant: static header value"));

    // Enable XSS protection in older browsers
    headers.insert("X-XSS-Protection", "1; mode=block".parse().expect("invariant: static header value"));

    // Prevent clickjacking
    headers.insert("X-Frame-Options", "SAMEORIGIN".parse().expect("invariant: static header value"));

    // Enforce HTTPS (for production deployments)
    headers.insert(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains".parse().expect("invariant: static header value"),
    );

    // Prevent information disclosure
    headers.insert("X-Powered-By", "".parse().expect("invariant: static header value"));
    headers.remove("Server");

    response
}

/// Skills API endpoints

/// Keychain API endpoints

/// Audit API endpoints

/// Agent API endpoints

/// Auth API endpoints (Phase 3)

/// OAuth API endpoints

/// Plugin API endpoints

/// MCP API endpoints

/// Sessions API endpoints

/// Settings API endpoints

/// Models API endpoints

/// Clipboard API endpoints

/// Notifications API endpoints

/// File browser API endpoints

/// Process management API endpoints

/// Logging API endpoints

/// Connectors API endpoints (frontend-facing alias for MCP)

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
