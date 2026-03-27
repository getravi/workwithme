use axum::extract::ws::{WebSocket, Message};
use futures::stream::StreamExt;
use serde_json::json;

/// WebSocket message types
#[derive(Debug, serde::Deserialize)]
pub struct WsMessage {
    pub r#type: String,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Handle a WebSocket connection.
pub async fn handle_socket(mut socket: WebSocket) {
    println!("[ws] new connection");

    while let Some(msg) = socket.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                println!("[ws] received: {}", text);

                // Try to parse as JSON message
                match serde_json::from_str::<WsMessage>(&text) {
                    Ok(ws_msg) => {
                        // Route message based on type
                        handle_ws_message(&ws_msg, &mut socket).await;
                    }
                    Err(e) => {
                        eprintln!("[ws] failed to parse message: {}", e);
                        let error_response = json!({
                            "type": "error",
                            "error": "Invalid message format"
                        }).to_string();
                        let _ = socket.send(Message::Text(error_response.into())).await;
                    }
                }
            }
            Ok(Message::Binary(bin)) => {
                println!("[ws] received binary data ({} bytes)", bin.len());
                let error_response = json!({
                    "type": "error",
                    "error": "Binary messages not supported"
                }).to_string();
                if let Err(e) = socket.send(Message::Text(error_response.into())).await {
                    eprintln!("[ws] error sending message: {e}");
                    break;
                }
            }
            Ok(Message::Close(_)) => {
                println!("[ws] connection closed");
                break;
            }
            Ok(Message::Ping(p)) => {
                println!("[ws] received ping");
                if let Err(e) = socket.send(Message::Pong(p)).await {
                    eprintln!("[ws] error sending pong: {e}");
                    break;
                }
            }
            Ok(Message::Pong(_)) => {
                println!("[ws] received pong");
            }
            Err(e) => {
                eprintln!("[ws] error: {e}");
                break;
            }
        }
    }

    println!("[ws] connection finished");
}

/// Route WebSocket messages to appropriate handlers
async fn handle_ws_message(msg: &WsMessage, socket: &mut WebSocket) {
    match msg.r#type.as_str() {
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
