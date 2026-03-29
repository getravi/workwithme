//! WebSocket protocol for streaming agent responses.
//!
//! # Client → Server messages
//!
//! | type | required fields | description |
//! |------|-----------------|-------------|
//! | `join` | `session_id` | Subscribe to an existing session's event stream |
//! | `prompt` | `session_id`, `text` | Run one agent turn |
//! | `steer` | `session_id`, `text` | Inject a steering message mid-turn |
//! | `new_chat` | `cwd` (optional) | Create a new session at a working directory |
//! | `sandbox_approval_response` | `data` | Approve or deny a pending sandbox request |
//!
//! # Server → Client messages
//!
//! | type | description |
//! |------|-------------|
//! | `join:ack` | Subscription confirmed |
//! | `chat_cleared` | New session created |
//! | `message_start` | Agent started generating |
//! | `message_update` | Streaming text or thinking chunk |
//! | `message_end` | Agent finished one response |
//! | `tool_execution_start` | Tool call initiated |
//! | `tool_execution_update` | Partial tool output |
//! | `tool_execution_end` | Tool call complete |
//! | `agent_end` | Full agent loop finished |
//! | `prompt_complete` | Server-side prompt handling done |
//! | `error` | Error occurred |
//! | `approval:ack` | Sandbox approval response acknowledged |

use axum::extract::ws::{Message, WebSocket};
use futures::stream::StreamExt;
use pi::sdk::{AgentEvent, SessionOptions};
use pi::model::{AssistantMessageEvent, ContentBlock};
use pi::tools::ToolOutput;
use serde_json::{json, Value};
use std::sync::Arc;
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::mpsc;
use chrono::{Utc, DateTime};
use tokio::sync::RwLock;

use crate::server::AppState;
use crate::server::approval::{ApprovalResponse, APPROVAL_MANAGER};

// ─── Connection Registry ─────────────────────────────────────────────────────

/// Metadata tracked per active WebSocket connection.
#[derive(Debug, Clone)]
struct WsConnectionMetadata {
    id: String,
    connected_at: DateTime<Utc>,
    session_id: Option<String>,
}

lazy_static::lazy_static! {
    /// Global map of active WebSocket connections, keyed by connection ID.
    /// Cleaned up on disconnect to prevent memory leaks.
    static ref WS_CONNECTIONS: Arc<RwLock<HashMap<String, WsConnectionMetadata>>> =
        Arc::new(RwLock::new(HashMap::new()));
}

// ─── Wire Types ──────────────────────────────────────────────────────────────

/// Incoming WebSocket message envelope.
///
/// All fields except `type` use `#[serde(default)]` so partial messages parse
/// without error — handlers check required fields themselves.
/// Field aliases accept both snake_case and camelCase from the frontend.
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct WsMessage {
    pub r#type: String,
    /// Accepts `sessionId` (frontend camelCase) or `session_id` (tests/internal).
    /// JSON `null` is treated as absent and falls back to empty string.
    #[serde(default, alias = "sessionId", deserialize_with = "null_to_empty_string")]
    pub session_id: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    pub content: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    pub text: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    pub cwd: String,
    #[serde(default)]
    pub data: Value,
}

/// Deserialize a JSON string or null into a Rust String (null → "").
fn null_to_empty_string<'de, D>(d: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    let opt = Option::<String>::deserialize(d)?;
    Ok(opt.unwrap_or_default())
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

/// Main WebSocket connection handler.
///
/// Registers the connection, dispatches incoming messages to typed handlers,
/// and removes the connection from the registry on disconnect.
pub async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    let conn_id = uuid::Uuid::new_v4().to_string();
    println!("[ws] new connection: {}", conn_id);

    {
        let mut conns = WS_CONNECTIONS.write().await;
        conns.insert(conn_id.clone(), WsConnectionMetadata {
            id: conn_id.clone(),
            connected_at: Utc::now(),
            session_id: None,
        });
    }

    const MAX_MESSAGE_SIZE: usize = 1024 * 1024; // 1 MB per message
    let mut active_session_id: Option<String> = None;

    while let Some(msg) = socket.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if text.len() > MAX_MESSAGE_SIZE {
                    eprintln!("[ws] [{}] message too large: {} bytes", conn_id, text.len());
                    let _ = socket.send(ws_error("Message exceeds 1 MB limit")).await;
                    break;
                }

                match serde_json::from_str::<WsMessage>(&text) {
                    Ok(ws_msg) => {
                        if !ws_msg.session_id.is_empty() {
                            active_session_id = Some(ws_msg.session_id.clone());
                        }

                        if let Err(e) = validate_ws_message(&ws_msg) {
                            let _ = socket.send(ws_error(&e)).await;
                            continue;
                        }

                        dispatch_message(&ws_msg, &mut socket, Arc::clone(&state), &conn_id).await;
                    }
                    Err(e) => {
                        eprintln!("[ws] [{}] parse error: {}", conn_id, e);
                        let _ = socket.send(ws_error("Invalid JSON message format")).await;
                    }
                }
            }
            Ok(Message::Binary(_)) => {
                let _ = socket.send(ws_error("Binary messages not supported")).await;
            }
            Ok(Message::Close(_)) => break,
            Ok(Message::Ping(p)) => {
                let _ = socket.send(Message::Pong(p)).await;
            }
            Ok(Message::Pong(_)) => {}
            Err(e) => {
                eprintln!("[ws] [{}] error: {}", conn_id, e);
                break;
            }
        }
    }

    // Clean up connection registry
    {
        let mut conns = WS_CONNECTIONS.write().await;
        conns.remove(&conn_id);
    }
    println!(
        "[ws] [{}] disconnected (session: {})",
        conn_id,
        active_session_id.as_deref().unwrap_or("none")
    );
}

/// Return the number of active WebSocket connections.
pub async fn get_active_connections() -> usize {
    WS_CONNECTIONS.read().await.len()
}

/// Return a snapshot of active connections for diagnostics.
///
/// Each entry contains the connection ID, ISO-8601 connect time, and
/// the session ID the connection is subscribed to (if any).
pub async fn active_connection_info() -> Vec<serde_json::Value> {
    let conns = WS_CONNECTIONS.read().await;
    conns
        .values()
        .map(|m| {
            serde_json::json!({
                "id": m.id,
                "connected_at": m.connected_at.to_rfc3339(),
                "session_id": m.session_id
            })
        })
        .collect()
}

// ─── Validation ───────────────────────────────────────────────────────────────

/// Validate an incoming WebSocket message for well-formed fields.
fn validate_ws_message(msg: &WsMessage) -> Result<(), String> {
    if msg.r#type.is_empty() {
        return Err("Message type cannot be empty".to_string());
    }
    if !msg.r#type.chars().all(|c| c.is_alphanumeric() || c == ':' || c == '-' || c == '_') {
        return Err("Invalid message type format".to_string());
    }
    if msg.session_id.len() > 64 {
        return Err("Session ID too long".to_string());
    }
    if msg.content.len() > 1024 * 1024 {
        return Err("Message content too large".to_string());
    }
    Ok(())
}

// ─── Message Router ───────────────────────────────────────────────────────────

/// Route an incoming message to its handler.
async fn dispatch_message(msg: &WsMessage, socket: &mut WebSocket, state: Arc<AppState>, conn_id: &str) {
    match msg.r#type.as_str() {
        "join" => handle_join(msg, socket, conn_id).await,
        "new_chat" => handle_new_chat(msg, socket, state).await,
        "prompt" | "agent:message" => handle_prompt(msg, socket, state).await,
        "steer" => {
            let _ = socket.send(Message::Text(
                json!({"type": "steer:ack", "session_id": msg.session_id, "success": true})
                    .to_string()
                    .into(),
            ))
            .await;
        }
        "sandbox_approval_response" | "approval:response" => {
            handle_approval_response(msg, socket).await;
        }
        _ => {
            eprintln!("[ws] unknown message type: {}", msg.r#type);
            let _ = socket
                .send(ws_error(&format!("Unknown message type: {}", msg.r#type)))
                .await;
        }
    }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/// Handle `join` — acknowledge subscription to a session's event stream.
///
/// Updates the connection registry so `active_connection_info` can report
/// which session each WS connection is watching.
async fn handle_join(msg: &WsMessage, socket: &mut WebSocket, conn_id: &str) {
    // Record the subscribed session in the connection registry
    {
        let mut conns = WS_CONNECTIONS.write().await;
        if let Some(meta) = conns.get_mut(conn_id) {
            meta.session_id = Some(msg.session_id.clone());
        }
    }
    let _ = socket.send(Message::Text(
        json!({"type": "join:ack", "session_id": msg.session_id, "subscribed": true})
            .to_string()
            .into(),
    ))
    .await;
}

/// Handle `new_chat` — create a pi agent session at the specified working directory.
///
/// The session handle is stored in `AppState::session_handles` so subsequent
/// `prompt` messages can reuse it.  The CWD is stored in `AppState::session_cwd`.
async fn handle_new_chat(msg: &WsMessage, socket: &mut WebSocket, state: Arc<AppState>) {
    let cwd = msg.cwd.clone(); // empty string means "no project selected" — do not default to process cwd

    let session_id = uuid::Uuid::new_v4().to_string();

    // Persist CWD for future prompt calls
    {
        let mut cwds = state.session_cwd.write().await;
        cwds.insert(session_id.clone(), cwd.clone());
    }

    match create_pi_session(&session_id, &cwd, &state).await {
        Ok(_) => {
            let _ = socket.send(Message::Text(
                json!({
                    "type": "chat_cleared",
                    "sessionId": session_id,
                    "cwd": cwd
                })
                .to_string()
                .into(),
            ))
            .await;

        }
        Err(e) => {
            eprintln!("[ws] failed to create pi session: {}", e);
            let _ = socket
                .send(ws_error(&format!("Failed to create session: {}", e)))
                .await;
        }
    }
}

/// Handle `prompt` — run one agent turn using pi_agent_rust and stream events to the client.
///
/// Creates the session on-demand if it doesn't exist yet (e.g. when the client
/// sends a prompt without a preceding `new_chat`).  Uses an abort handle that
/// is stored in `AppState::abort_handles` and removed after the prompt finishes,
/// so POST /api/stop can cancel it mid-run.
async fn handle_prompt(msg: &WsMessage, socket: &mut WebSocket, state: Arc<AppState>) {
    let session_id = msg.session_id.clone();
    let user_text = if !msg.text.is_empty() {
        msg.text.clone()
    } else {
        msg.content.clone()
    };

    if user_text.is_empty() {
        let _ = socket
            .send(ws_error("prompt requires non-empty text"))
            .await;
        return;
    }

    // Auto-generate a session if the client didn't send one
    let session_id = if session_id.is_empty() {
        let new_id = uuid::Uuid::new_v4().to_string();
        let cwd = String::new(); // no project selected — agent runs without a locked-down cwd
        // Notify the client so it can track the session going forward
        let _ = socket.send(Message::Text(
            json!({"type": "chat_cleared", "sessionId": new_id, "cwd": cwd})
                .to_string()
                .into(),
        )).await;
        new_id
    } else {
        session_id
    };

    // Get or auto-create the session handle
    let handle = {
        let handles = state.session_handles.read().await;
        handles.get(&session_id).cloned()
    };

    let handle = match handle {
        Some(h) => h,
        None => {
            let cwd = {
                let cwds = state.session_cwd.read().await;
                cwds.get(&session_id).cloned().unwrap_or_default()
            };
            match create_pi_session(&session_id, &cwd, &state).await {
                Ok(h) => h,
                Err(e) => {
                    let _ = socket
                        .send(ws_error(&format!("Could not create session: {}", e)))
                        .await;
                    return;
                }
            }
        }
    };

    // Create abort handle — stored so POST /api/stop can cancel the run
    let (abort_handle, abort_signal) = pi::sdk::AbortHandle::new();
    {
        let mut abort_handles = state.abort_handles.write().await;
        abort_handles.insert(session_id.clone(), abort_handle);
    }

    // Channel: agent task → WS sender
    let (tx, mut rx) = mpsc::unbounded_channel::<AgentEvent>();
    // Error channel: captures agent failure so we can forward it after the event loop
    let (err_tx, mut err_rx) = tokio::sync::oneshot::channel::<String>();

    // Spawn agent execution on a separate task so it doesn't block the WS loop
    let handle_clone = Arc::clone(&handle);
    let user_text_clone = user_text.clone();
    tokio::spawn(async move {
        let mut h = handle_clone.lock().await;
        if let Err(e) = h
            .prompt_with_abort(user_text_clone, abort_signal, move |event| {
                // Callback is Fn, not async — use try_send (unbounded, never blocks)
                let _ = tx.send(event);
            })
            .await
        {
            let _ = err_tx.send(format!("{}", e));
        }
        // tx drops here, closing the channel and ending the rx loop below
    });

    // Forward pi AgentEvents as WebSocket messages
    while let Some(event) = rx.recv().await {
        if let Some(ws_msg) = pi_event_to_ws_json(&event, &session_id) {
            if socket.send(Message::Text(ws_msg.into())).await.is_err() {
                break; // Client disconnected
            }
        }
    }

    // Surface any agent error to the frontend
    if let Ok(err_msg) = err_rx.try_recv() {
        eprintln!("[ws] agent error for session {}: {}", session_id, err_msg);
        let _ = socket.send(ws_error(&format!("Agent error: {}", err_msg))).await;
    }

    // Generate session label from first user message (best-effort, non-blocking to client)
    {
        let api_key = state.auth_storage.get_key("anthropic");
        if let Some(key) = api_key {
            let sid = session_id.clone();
            let msg = user_text.clone();
            let label_result = crate::server::extensions::generate_session_label_with_fallback(&key, &msg).await;
            // Save label into session metadata
            if let Ok(Some(mut session)) = crate::server::sessions::load_session(&sid) {
                // Only set label if not already set
                let already_labelled = session.get("metadata")
                    .and_then(|m| m.get("label"))
                    .and_then(|l| l.as_str())
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);
                if !already_labelled {
                    if let Some(meta) = session.get_mut("metadata") {
                        if let Some(obj) = meta.as_object_mut() {
                            obj.insert("label".to_string(), serde_json::json!(label_result));
                        }
                    }
                    let _ = crate::server::sessions::update_session(&sid, session);
                    // Broadcast so frontend knows to refresh the session list
                    let _ = socket.send(Message::Text(
                        serde_json::json!({
                            "type": "session_label_updated",
                            "sessionId": sid,
                            "label": label_result
                        }).to_string().into()
                    )).await;
                }
            }
        }
    }

    // Notify client that the server-side prompt handling is complete
    let _ = socket.send(Message::Text(
        json!({"type": "prompt_complete", "session_id": session_id})
            .to_string()
            .into(),
    ))
    .await;

    // Clean up abort handle
    {
        let mut abort_handles = state.abort_handles.write().await;
        abort_handles.remove(&session_id);
    }
}

/// Handle sandbox approval responses from the frontend.
async fn handle_approval_response(msg: &WsMessage, socket: &mut WebSocket) {
    if let Ok(response) = serde_json::from_value::<ApprovalResponse>(msg.data.clone()) {
        if let Some(manager) = APPROVAL_MANAGER.get() {
            let success = manager.respond(response);
            let _ = socket.send(Message::Text(
                json!({"type": "approval:ack", "success": success})
                    .to_string()
                    .into(),
            ))
            .await;
        } else {
            eprintln!("[ws] approval manager not initialized");
        }
    }
}

// ─── Session Factory ──────────────────────────────────────────────────────────

/// Create a pi agent session, store it in AppState, and return the handle.
///
/// Reads the Anthropic API key from `AuthStorage` (keychain → env var) and
/// passes it to `SessionOptions`.  Checks `AppState::session_model` for a
/// per-session or global model override before falling back to pi's default.
async fn create_pi_session(
    session_id: &str,
    cwd: &str,
    state: &AppState,
) -> Result<crate::server::PiSessionHandle, String> {
    // Resolve per-session model override (falls back to global, then pi default)
    let (provider_override, model_override) = {
        let models = state.session_model.read().await;
        models.get(session_id)
            .or_else(|| models.get("__global__"))
            .cloned()
            .map(|(p, m)| (Some(p), Some(m)))
            .unwrap_or((None, None))
    };

    // Pick up API key for the resolved provider (or "anthropic" by default)
    let provider_name = provider_override.as_deref().unwrap_or("anthropic");
    let api_key = crate::server::resolve_session_auth_token(&state.auth_storage, provider_name);

    let working_directory = if cwd.is_empty() {
        None
    } else {
        Some(PathBuf::from(cwd))
    };

    let options = SessionOptions {
        api_key,
        provider: provider_override,
        model: model_override,
        working_directory,
        no_session: false, // persist session to ~/.pi/sessions/
        ..SessionOptions::default()
    };

    let session_handle = pi::sdk::create_agent_session(options)
        .await
        .map_err(|e| format!("pi session init: {}", e))?;

    let handle = Arc::new(tokio::sync::Mutex::new(session_handle));

    {
        let mut handles = state.session_handles.write().await;
        handles.insert(session_id.to_string(), Arc::clone(&handle));
    }

    Ok(handle)
}

// ─── Event Mapping ────────────────────────────────────────────────────────────

/// Extract plain text from a pi `ToolOutput` (concatenates all `Text` blocks).
fn tool_output_text(output: &ToolOutput) -> String {
    output
        .content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text(t) => Some(t.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

/// Map a pi [`AgentEvent`] to the frontend WebSocket JSON protocol.
///
/// All outgoing field names use camelCase to match the frontend's expectations.
/// Returns `None` for events the frontend doesn't consume.
///
/// # Protocol mapping
///
/// | pi AgentEvent | WS type | Key fields |
/// |---|---|---|
/// | `MessageStart` | `message_start` | `message.role` |
/// | `MessageUpdate { TextDelta }` | `message_update` | `assistantMessageEvent.type`, `message.content` |
/// | `MessageUpdate { ThinkingDelta }` | `message_update` | `assistantMessageEvent.type`, `message.content` |
/// | `MessageEnd` | `message_end` | — |
/// | `ToolExecutionStart` | `tool_execution_start` | `toolCallId`, `toolName`, `args` |
/// | `ToolExecutionUpdate` | `tool_execution_update` | `toolCallId`, `partialResult` |
/// | `ToolExecutionEnd` | `tool_execution_end` | `toolCallId`, `result`, `isError` |
/// | `AgentEnd` | `agent_end` | — |
pub fn pi_event_to_ws_json(event: &AgentEvent, session_id: &str) -> Option<String> {
    let msg = match event {
        AgentEvent::MessageStart { .. } => json!({
            "type": "message_start",
            "sessionId": session_id,
            "message": { "role": "assistant" }
        }),

        AgentEvent::MessageUpdate { message, assistant_message_event, .. } => {
            // Build a content array from the accumulated assistant message so the
            // frontend can replace the full bubble text on every delta.
            let content = match message {
                pi::sdk::Message::Assistant(am) => {
                    am.content.iter().filter_map(|block| {
                        match block {
                            ContentBlock::Text(t) => Some(json!({
                                "type": "text",
                                "text": t.text
                            })),
                            ContentBlock::Thinking(th) => Some(json!({
                                "type": "thinking",
                                "thinking": th.thinking
                            })),
                            _ => None,
                        }
                    }).collect::<Vec<_>>()
                }
                _ => return None,
            };

            let event_type = match assistant_message_event {
                AssistantMessageEvent::TextDelta { .. }    => "text_delta",
                AssistantMessageEvent::ThinkingDelta { .. } => "thinking_delta",
                _ => return None,
            };

            json!({
                "type": "message_update",
                "sessionId": session_id,
                "assistantMessageEvent": { "type": event_type },
                "message": { "content": content }
            })
        }

        AgentEvent::MessageEnd { .. } => json!({
            "type": "message_end",
            "sessionId": session_id,
            "message": {}
        }),

        AgentEvent::ToolExecutionStart { tool_name, tool_call_id, args, .. } => json!({
            "type": "tool_execution_start",
            "sessionId": session_id,
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "args": args
        }),

        AgentEvent::ToolExecutionUpdate { tool_name, tool_call_id, partial_result, .. } => json!({
            "type": "tool_execution_update",
            "sessionId": session_id,
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "partialResult": tool_output_text(partial_result)
        }),

        AgentEvent::ToolExecutionEnd { tool_name, tool_call_id, result, is_error, .. } => json!({
            "type": "tool_execution_end",
            "sessionId": session_id,
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "result": tool_output_text(result),
            "isError": is_error
        }),

        AgentEvent::AgentEnd { .. } => json!({
            "type": "agent_end",
            "sessionId": session_id
        }),

        // Skip lifecycle events the frontend doesn't need
        _ => return None,
    };

    Some(msg.to_string())
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Build a `{"type":"error","message":"..."}` WebSocket text frame.
/// The frontend checks `data.message` (not `data.error`).
fn ws_error(message: &str) -> Message {
    Message::Text(json!({"type": "error", "message": message}).to_string().into())
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── WsMessage parsing ──────────────────────────────────────────────────

    #[test]
    fn test_ws_message_minimal_fields() {
        let msg: WsMessage = serde_json::from_str(r#"{"type":"test"}"#).unwrap();
        assert_eq!(msg.r#type, "test");
        assert!(msg.session_id.is_empty());
        assert!(msg.content.is_empty());
        assert!(msg.text.is_empty());
        assert!(msg.cwd.is_empty());
    }

    #[test]
    fn test_ws_message_full_fields() {
        let msg: WsMessage = serde_json::from_str(r#"{
            "type": "prompt",
            "session_id": "sess-123",
            "text": "hello",
            "cwd": "/tmp",
            "data": {"key": "value"}
        }"#).unwrap();
        assert_eq!(msg.r#type, "prompt");
        assert_eq!(msg.session_id, "sess-123");
        assert_eq!(msg.text, "hello");
    }

    #[test]
    fn test_ws_message_approval_response() {
        let msg: WsMessage = serde_json::from_str(r#"{
            "type": "approval:response",
            "session_id": "sess-456",
            "data": {"approved": true}
        }"#).unwrap();
        assert_eq!(msg.r#type, "approval:response");
        assert_eq!(msg.data["approved"], true);
    }

    // ── Validation ─────────────────────────────────────────────────────────

    #[test]
    fn test_validate_empty_type_fails() {
        let msg = WsMessage {
            r#type: String::new(),
            session_id: String::new(),
            content: String::new(),
            text: String::new(),
            cwd: String::new(),
            data: json!({}),
        };
        assert!(validate_ws_message(&msg).is_err());
    }

    #[test]
    fn test_validate_invalid_type_chars_fails() {
        let msg = WsMessage {
            r#type: "bad type!".to_string(),
            ..default_msg()
        };
        assert!(validate_ws_message(&msg).is_err());
    }

    #[test]
    fn test_validate_session_id_too_long_fails() {
        let msg = WsMessage {
            r#type: "ping".to_string(),
            session_id: "x".repeat(65),
            ..default_msg()
        };
        assert!(validate_ws_message(&msg).is_err());
    }

    #[test]
    fn test_validate_valid_message_passes() {
        let msg = WsMessage {
            r#type: "prompt".to_string(),
            session_id: "abc-123".to_string(),
            text: "hello".to_string(),
            ..default_msg()
        };
        assert!(validate_ws_message(&msg).is_ok());
    }

    // ── pi_event_to_ws_json mapping ────────────────────────────────────────

    #[test]
    fn test_message_start_event() {
        use pi::model::{AssistantMessage, Message};
        let event = AgentEvent::MessageStart {
            message: Message::Assistant(std::sync::Arc::new(AssistantMessage::default())),
        };
        let json = pi_event_to_ws_json(&event, "sid").unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "message_start");
        assert_eq!(v["sessionId"], "sid");
        assert_eq!(v["message"]["role"], "assistant");
    }

    #[test]
    fn test_message_update_text_delta() {
        use pi::model::{AssistantMessage, ContentBlock, TextContent};

        let partial = std::sync::Arc::new(AssistantMessage {
            content: vec![ContentBlock::Text(TextContent::new("Hello"))],
            ..AssistantMessage::default()
        });

        let event = AgentEvent::MessageUpdate {
            message: pi::sdk::Message::Assistant(partial.clone()),
            assistant_message_event: AssistantMessageEvent::TextDelta {
                content_index: 0,
                delta: "world".to_string(),
                partial,
            },
        };

        let json = pi_event_to_ws_json(&event, "sid").unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "message_update");
        assert_eq!(v["assistantMessageEvent"]["type"], "text_delta");
        // message.content[0] should be { type: "text", text: "Hello" }
        assert_eq!(v["message"]["content"][0]["type"], "text");
        assert_eq!(v["message"]["content"][0]["text"], "Hello");
    }

    #[test]
    fn test_message_end_event() {
        use pi::model::AssistantMessage;

        let event = AgentEvent::MessageEnd {
            message: pi::sdk::Message::Assistant(std::sync::Arc::new(
                AssistantMessage::default(),
            )),
        };
        let json = pi_event_to_ws_json(&event, "sid").unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "message_end");
    }

    #[test]
    fn test_tool_execution_start_event() {
        let event = AgentEvent::ToolExecutionStart {
            tool_call_id: "tc-1".to_string(),
            tool_name: "bash".to_string(),
            args: json!({"command": "ls"}),
        };
        let json = pi_event_to_ws_json(&event, "sid").unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "tool_execution_start");
        assert_eq!(v["toolName"], "bash");
        assert_eq!(v["toolCallId"], "tc-1");
    }

    #[test]
    fn test_tool_execution_end_event() {
        use pi::model::ContentBlock;
        use pi::model::TextContent;
        use pi::tools::ToolOutput;

        let result = ToolOutput {
            content: vec![ContentBlock::Text(TextContent::new("file.txt"))],
            details: None,
            is_error: false,
        };
        let event = AgentEvent::ToolExecutionEnd {
            tool_call_id: "tc-1".to_string(),
            tool_name: "ls".to_string(),
            result,
            is_error: false,
        };
        let json = pi_event_to_ws_json(&event, "sid").unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "tool_execution_end");
        assert_eq!(v["result"], "file.txt");
        assert_eq!(v["isError"], false);
    }

    #[test]
    fn test_agent_end_extracts_final_response() {
        use pi::model::{AssistantMessage, ContentBlock, TextContent};
        use pi::sdk::Message;

        let am = AssistantMessage {
            content: vec![ContentBlock::Text(TextContent::new("done"))],
            ..AssistantMessage::default()
        };
        let event = AgentEvent::AgentEnd {
            session_id: "sid".into(),
            messages: vec![Message::Assistant(std::sync::Arc::new(am))],
            error: None,
        };
        let json = pi_event_to_ws_json(&event, "sid").unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "agent_end");
        assert_eq!(v["sessionId"], "sid");
        // final_response and error fields are not emitted in simplified agent_end
    }

    #[test]
    fn test_turn_start_is_filtered() {
        // TurnStart should return None — frontend doesn't need it
        let event = AgentEvent::TurnStart {
            session_id: "sid".into(),
            turn_index: 0,
            timestamp: 0,
        };
        assert!(pi_event_to_ws_json(&event, "sid").is_none());
    }

    #[test]
    fn test_tool_output_text_extraction() {
        use pi::model::{ContentBlock, TextContent};
        use pi::tools::ToolOutput;

        let output = ToolOutput {
            content: vec![
                ContentBlock::Text(TextContent::new("line1\n")),
                ContentBlock::Text(TextContent::new("line2")),
            ],
            details: None,
            is_error: false,
        };
        assert_eq!(tool_output_text(&output), "line1\nline2");
    }

    #[test]
    fn test_ws_error_format() {
        let frame = ws_error("something bad");
        if let Message::Text(t) = frame {
            let v: Value = serde_json::from_str(&t).unwrap();
            assert_eq!(v["type"], "error");
            assert_eq!(v["message"], "something bad");
        } else {
            panic!("expected Text frame");
        }
    }

    // ─── helpers ───────────────────────────────────────────────────────────

    fn default_msg() -> WsMessage {
        WsMessage {
            r#type: "ping".to_string(),
            session_id: String::new(),
            content: String::new(),
            text: String::new(),
            cwd: String::new(),
            data: json!({}),
        }
    }
}
