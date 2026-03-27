use axum::extract::ws::{WebSocket, Message};
use futures::stream::StreamExt;
use serde_json::json;
use crate::server::approval::{ApprovalResponse, APPROVAL_MANAGER};
use std::sync::Arc;
use std::collections::HashMap;
use chrono::{Utc, DateTime};

/// WebSocket connection metadata
#[derive(Debug, Clone)]
struct WsConnectionMetadata {
    id: String,
    connected_at: DateTime<Utc>,
    last_activity: DateTime<Utc>,
    session_id: Option<String>,
}

#[allow(rustdoc::unused_doc_comments)]
/// This tracks active WebSocket connections by connection ID
/// Cleaned up on disconnect to prevent memory leaks
lazy_static::lazy_static! {
    static ref WS_CONNECTIONS: Arc<tokio::sync::RwLock<HashMap<String, WsConnectionMetadata>>> =
        Arc::new(tokio::sync::RwLock::new(HashMap::new()));
}

/// WebSocket message types
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct WsMessage {
    pub r#type: String,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Handle a WebSocket connection with cleanup on disconnect.
pub async fn handle_socket(mut socket: WebSocket) {
    let conn_id = uuid::Uuid::new_v4().to_string();
    println!("[ws] new connection: {}", conn_id);

    // Register connection
    let metadata = WsConnectionMetadata {
        id: conn_id.clone(),
        connected_at: Utc::now(),
        last_activity: Utc::now(),
        session_id: None,
    };
    {
        let mut conns = WS_CONNECTIONS.write().await;
        conns.insert(conn_id.clone(), metadata);
    }

    const MAX_MESSAGE_SIZE: usize = 1024 * 1024; // 1MB limit
    let mut session_id: Option<String> = None;

    while let Some(msg) = socket.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                // Validate message size
                if text.len() > MAX_MESSAGE_SIZE {
                    eprintln!("[ws] message too large: {} bytes", text.len());
                    let error_response = json!({
                        "type": "error",
                        "error": "Message exceeds maximum size (1MB)"
                    }).to_string();
                    let _ = socket.send(Message::Text(error_response.into())).await;
                    break;
                }

                println!("[ws] [{}] received: {}", conn_id, text);

                // Try to parse as JSON message
                match serde_json::from_str::<WsMessage>(&text) {
                    Ok(ws_msg) => {
                        // Track session ID
                        if !ws_msg.session_id.is_empty() {
                            session_id = Some(ws_msg.session_id.clone());
                        }

                        // Validate message structure
                        if let Err(e) = validate_ws_message(&ws_msg) {
                            let error_response = json!({
                                "type": "error",
                                "error": e
                            }).to_string();
                            let _ = socket.send(Message::Text(error_response.into())).await;
                            continue;
                        }

                        // Route message based on type
                        handle_ws_message(&ws_msg, &mut socket).await;
                    }
                    Err(e) => {
                        eprintln!("[ws] [{}] failed to parse message: {}", conn_id, e);
                        let error_response = json!({
                            "type": "error",
                            "error": "Invalid JSON message format"
                        }).to_string();
                        let _ = socket.send(Message::Text(error_response.into())).await;
                    }
                }
            }
            Ok(Message::Binary(bin)) => {
                println!("[ws] [{}] received binary data ({} bytes)", conn_id, bin.len());
                let error_response = json!({
                    "type": "error",
                    "error": "Binary messages not supported"
                }).to_string();
                if let Err(e) = socket.send(Message::Text(error_response.into())).await {
                    eprintln!("[ws] [{}] error sending message: {e}", conn_id);
                    break;
                }
            }
            Ok(Message::Close(_)) => {
                println!("[ws] [{}] connection closed", conn_id);
                break;
            }
            Ok(Message::Ping(p)) => {
                println!("[ws] [{}] received ping", conn_id);
                if let Err(e) = socket.send(Message::Pong(p)).await {
                    eprintln!("[ws] [{}] error sending pong: {e}", conn_id);
                    break;
                }
            }
            Ok(Message::Pong(_)) => {
                println!("[ws] [{}] received pong", conn_id);
            }
            Err(e) => {
                eprintln!("[ws] [{}] error: {e}", conn_id);
                break;
            }
        }
    }

    // Cleanup: remove connection from registry
    {
        let mut conns = WS_CONNECTIONS.write().await;
        conns.remove(&conn_id);
    }

    if let Some(sid) = session_id {
        println!("[ws] [{}] connection finished (session: {})", conn_id, sid);
    } else {
        println!("[ws] [{}] connection finished", conn_id);
    }
}

/// Get active WebSocket connections count
pub async fn get_active_connections() -> usize {
    WS_CONNECTIONS.read().await.len()
}

/// Validate WebSocket message structure and required fields
fn validate_ws_message(msg: &WsMessage) -> Result<(), String> {
    // Check that message type is not empty
    if msg.r#type.is_empty() {
        return Err("Message type cannot be empty".to_string());
    }

    // Validate message type format (alphanumeric, dash, colon)
    if !msg.r#type.chars().all(|c| c.is_alphanumeric() || c == ':' || c == '-' || c == '_') {
        return Err("Invalid message type format".to_string());
    }

    // Validate session_id format if present
    if !msg.session_id.is_empty() && msg.session_id.len() > 36 {
        return Err("Session ID too long".to_string());
    }

    // Validate content size
    if msg.content.len() > 1024 * 1024 {
        return Err("Message content too large".to_string());
    }

    // Validate based on message type
    match msg.r#type.as_str() {
        "approval:response" => {
            if msg.data.is_null() {
                return Err("approval:response requires data field".to_string());
            }
        }
        _ => {}
    }

    Ok(())
}

/// Route WebSocket messages to appropriate handlers
async fn handle_ws_message(msg: &WsMessage, socket: &mut WebSocket) {
    match msg.r#type.as_str() {
        "approval:response" => {
            // Handle approval response from frontend
            if let Ok(approval_response) = serde_json::from_value::<ApprovalResponse>(msg.data.clone()) {
                if let Some(manager) = APPROVAL_MANAGER.get() {
                    let success = manager.respond(approval_response);
                    let response = json!({
                        "type": "approval:ack",
                        "success": success
                    }).to_string();
                    let _ = socket.send(Message::Text(response.into())).await;
                } else {
                    eprintln!("[ws] approval manager not initialized");
                }
            } else {
                eprintln!("[ws] failed to parse approval response");
            }
        }
        "agent:message" => {
            // Agent message - will be handled by Phase 3a integration
            let response = json!({
                "type": "agent:response",
                "sessionId": msg.session_id,
                "content": "Agent integration coming in Phase 3a"
            }).to_string();
            let _ = socket.send(Message::Text(response.into())).await;
        }
        "session:list" => {
            let response = json!({
                "type": "session:list",
                "sessions": []
            }).to_string();
            let _ = socket.send(Message::Text(response.into())).await;
        }
        "session:load" => {
            let response = json!({
                "type": "session:load",
                "sessionId": msg.session_id,
                "session": serde_json::Value::Null
            }).to_string();
            let _ = socket.send(Message::Text(response.into())).await;
        }
        _ => {
            eprintln!("[ws] unknown message type: {}", msg.r#type);
            let response = json!({
                "type": "error",
                "error": format!("Unknown message type: {}", msg.r#type)
            }).to_string();
            let _ = socket.send(Message::Text(response.into())).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ws_message_structure() {
        let msg = WsMessage {
            r#type: "agent:message".to_string(),
            session_id: "session-123".to_string(),
            content: "Hello".to_string(),
            data: json!({"key": "value"}),
        };

        assert_eq!(msg.r#type, "agent:message");
        assert_eq!(msg.session_id, "session-123");
        assert_eq!(msg.content, "Hello");
    }

    #[test]
    fn test_ws_message_deserialization() {
        let json_str = r#"{
            "type": "approval:response",
            "session_id": "sess-456",
            "content": "response",
            "data": {"approved": true}
        }"#;

        let msg: WsMessage = serde_json::from_str(json_str).unwrap();
        assert_eq!(msg.r#type, "approval:response");
    }

    #[test]
    fn test_ws_message_with_minimal_fields() {
        let json_str = r#"{"type": "test"}"#;

        let msg: WsMessage = serde_json::from_str(json_str).unwrap();
        assert_eq!(msg.r#type, "test");
        assert!(msg.session_id.is_empty());
        assert!(msg.content.is_empty());
    }

    #[test]
    fn test_ws_message_types() {
        let message_types = vec![
            "approval:response",
            "agent:message",
            "session:list",
            "session:load",
            "ping",
        ];

        for msg_type in message_types {
            let msg = WsMessage {
                r#type: msg_type.to_string(),
                session_id: String::new(),
                content: String::new(),
                data: json!({}),
            };

            assert_eq!(msg.r#type, msg_type);
        }
    }

    #[test]
    fn test_ws_message_with_complex_data() {
        let msg = WsMessage {
            r#type: "agent:message".to_string(),
            session_id: "sess-789".to_string(),
            content: "test message".to_string(),
            data: json!({
                "nested": {
                    "level1": {
                        "level2": "value"
                    }
                },
                "array": [1, 2, 3],
                "boolean": true
            }),
        };

        assert!(msg.data.get("nested").is_some());
        assert!(msg.data.get("array").is_some());
    }

    #[test]
    fn test_ws_message_serialization() {
        let msg = WsMessage {
            r#type: "test:message".to_string(),
            session_id: "test-session".to_string(),
            content: "test".to_string(),
            data: json!({"test": true}),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: WsMessage = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.r#type, msg.r#type);
        assert_eq!(parsed.session_id, msg.session_id);
    }

    #[test]
    fn test_ws_error_message_format() {
        let error_response = json!({
            "type": "error",
            "error": "Test error message"
        });

        assert_eq!(error_response["type"], "error");
        assert!(error_response.get("error").is_some());
    }

    #[test]
    fn test_approval_response_message() {
        let msg = WsMessage {
            r#type: "approval:response".to_string(),
            session_id: String::new(),
            content: String::new(),
            data: json!({
                "request_id": "req-123",
                "approved": true,
                "reason": "User approved"
            }),
        };

        assert_eq!(msg.r#type, "approval:response");
        assert!(msg.data.get("request_id").is_some());
        assert!(msg.data.get("approved").is_some());
    }

    #[test]
    fn test_agent_message_with_session() {
        let msg = WsMessage {
            r#type: "agent:message".to_string(),
            session_id: "agent-sess-001".to_string(),
            content: "Process this request".to_string(),
            data: json!({"prompt": "What is 2+2?"}),
        };

        assert_eq!(msg.r#type, "agent:message");
        assert!(!msg.session_id.is_empty());
        assert!(!msg.content.is_empty());
    }
}
