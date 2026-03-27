use axum::extract::ws::{WebSocket, Message};
use futures::stream::StreamExt;

/// Handle a WebSocket connection.
pub async fn handle_socket(mut socket: WebSocket) {
    println!("[ws] new connection");

    while let Some(msg) = socket.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                println!("[ws] received text: {}", text);
                // Echo the message back
                if let Err(e) = socket.send(Message::Text(text)).await {
                    eprintln!("[ws] error sending message: {e}");
                    break;
                }
            }
            Ok(Message::Binary(bin)) => {
                println!("[ws] received binary data ({} bytes)", bin.len());
                // Echo the binary data back
                if let Err(e) = socket.send(Message::Binary(bin)).await {
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
