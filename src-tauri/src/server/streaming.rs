use serde_json::json;

/// Stream Claude API response tokens via WebSocket
/// This function prepares the request body for streaming from Claude API
/// The actual streaming is handled by WebSocket messages
pub fn prepare_streaming_request(
    system_prompt: &str,
    messages: Vec<(String, String)>, // (role, content) tuples
    model: &str,
    max_tokens: u32,
) -> serde_json::Value {
    let mut msg_array = vec![];
    for (role, content) in messages {
        msg_array.push(json!({
            "role": role,
            "content": content
        }));
    }

    json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": msg_array,
        "stream": true
    })
}

/// Parse streaming response chunks from Claude API
/// Each chunk is a Server-Sent Events format line
pub fn parse_stream_chunk(line: &str) -> Option<String> {
    if let Some(data) = line.strip_prefix("data: ") {
        // Parse JSON event
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
            // Extract token from delta
            if let Some(token) = json
                .get("delta")
                .and_then(|d| d.get("text"))
                .and_then(|t| t.as_str())
            {
                return Some(token.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prepare_streaming_request() {
        let request = prepare_streaming_request(
            "You are helpful",
            vec![("user".to_string(), "Hello".to_string())],
            "claude-opus-4-6",
            1000,
        );

        assert_eq!(request.get("model").and_then(|v| v.as_str()), Some("claude-opus-4-6"));
        assert!(request.get("stream").and_then(|v| v.as_bool()) == Some(true));
    }

    #[test]
    fn test_parse_stream_chunk() {
        let line = r#"data: {"delta":{"text":"hello"}}"#;
        assert_eq!(parse_stream_chunk(line), Some("hello".to_string()));
    }
}
