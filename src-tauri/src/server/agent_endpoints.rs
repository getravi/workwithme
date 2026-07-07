//! HTTP endpoint handlers for the `agent` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

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

/// GET /api/thinking?sessionId=... — return the current thinking level for a session.
pub async fn get_thinking(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> (StatusCode, Json<serde_json::Value>) {
    let session_id = params.get("sessionId").cloned().unwrap_or_else(|| "__global__".to_string());
    let level = {
        let handles = state.session_handles.read().await;
        if let Some(handle) = handles.get(&session_id) {
            let h = handle.lock().await;
            h.thinking_level().map(|l| l.to_string()).unwrap_or_else(|| "off".to_string())
        } else {
            "off".to_string()
        }
    };
    (StatusCode::OK, Json(json!({ "level": level })))
}

/// POST /api/thinking — set the thinking level for an active session.
/// Body: { "sessionId": "...", "level": "off" | "low" | "medium" | "high" }
pub async fn set_thinking(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    let session_id = req.get("sessionId").and_then(|v| v.as_str()).unwrap_or("__global__");
    let level_str = req.get("level").and_then(|v| v.as_str()).unwrap_or("off");
    let level: pi::model::ThinkingLevel = level_str.parse().unwrap_or_default();
    let handles = state.session_handles.read().await;
    if let Some(handle) = handles.get(session_id) {
        let mut h = handle.lock().await;
        if let Err(e) = h.set_thinking_level(level).await {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "error": e.to_string() })));
        }
    }
    (StatusCode::OK, Json(json!({ "success": true, "level": level_str })))
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

/// Get sandbox support status.
/// Checks whether the platform sandbox tool (sandbox-exec on macOS, bwrap on Linux)
/// is actually available so the frontend warning banner reflects reality.
pub async fn sandbox_status() -> Json<serde_json::Value> {
    let (active, warning) = detect_sandbox_availability();
    Json(json!({
        "supported": true,
        "active": active,
        "srtAvailable": false,
        "platform": std::env::consts::OS,
        "warning": warning,
        "features": ["tool_execution", "approval_flow", "tool_schemas"]
    }))
}

/// Returns (active, warning_message) by probing for the platform sandbox binary.
fn detect_sandbox_availability() -> (bool, Option<String>) {
    #[cfg(target_os = "macos")]
    {
        let available = std::path::Path::new("/usr/bin/sandbox-exec").exists();
        if available {
            (true, None)
        } else {
            (false, Some("sandbox-exec not found — tool execution runs unsandboxed.".to_string()))
        }
    }
    #[cfg(target_os = "linux")]
    {
        let available = std::process::Command::new("which")
            .arg("bwrap")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if available {
            (true, None)
        } else {
            (false, Some("bwrap (bubblewrap) not found — tool execution runs unsandboxed.".to_string()))
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        (false, Some("Sandboxing is not supported on this platform.".to_string()))
    }
}
