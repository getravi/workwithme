use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

/// Agent session state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub messages: Vec<Message>,
    #[serde(default)]
    pub metadata: Value,
}

/// Content block in message (multi-part)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MessageContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse { id: String, name: String, input: Value },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
        is_error: bool,
    },
}

/// Message in conversation history
/// Supports both legacy string format and new multi-part content blocks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String, // "user" or "assistant"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_blocks: Option<Vec<MessageContentBlock>>,
}

impl Message {
    /// Create message from text (legacy format)
    pub fn text(role: &str, text: &str) -> Self {
        Message {
            role: role.to_string(),
            content: Some(text.to_string()),
            content_blocks: None,
        }
    }

    /// Create message with content blocks
    pub fn with_blocks(role: &str, blocks: Vec<MessageContentBlock>) -> Self {
        Message {
            role: role.to_string(),
            content: None,
            content_blocks: Some(blocks),
        }
    }

    /// Get text representation of message
    pub fn as_text(&self) -> String {
        if let Some(ref text) = self.content {
            return text.clone();
        }

        if let Some(ref blocks) = self.content_blocks {
            return blocks
                .iter()
                .filter_map(|block| match block {
                    MessageContentBlock::Text { text } => Some(text.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n");
        }

        String::new()
    }
}

/// Create a new agent session
pub fn create_session() -> AgentSession {
    let now = chrono::Local::now().to_rfc3339();
    AgentSession {
        id: Uuid::new_v4().to_string(),
        created_at: now.clone(),
        updated_at: now,
        messages: Vec::new(),
        metadata: json!({}),
    }
}

/// Claude API request
#[derive(Debug, Serialize)]
pub struct ClaudeRequest {
    pub model: String,
    pub max_tokens: u32,
    pub system: String,
    pub messages: Vec<ClaudeMessage>,
}

/// Message for Claude API
#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudeMessage {
    pub role: String,
    pub content: String,
}

/// Claude API response
#[derive(Debug, Deserialize)]
pub struct ClaudeResponse {
    pub id: String,
    pub content: Vec<ContentBlock>,
    pub stop_reason: String,
}

/// Content block in Claude response
#[derive(Debug, Deserialize, Clone)]
pub struct ContentBlock {
    pub r#type: String,
    #[serde(default)]
    pub text: Option<String>,
}

/// Default Claude model to use
pub const DEFAULT_MODEL: &str = "claude-opus-4-6";
pub const DEFAULT_MAX_TOKENS: u32 = 4096;

/// System prompt for agent
pub fn get_system_prompt() -> String {
    "You are Claude, an AI assistant created by Anthropic. You are helpful, harmless, and honest. \
     You have access to various tools and can execute tasks on behalf of the user. \
     When the user asks you to do something, you should use the available tools to help them."
        .to_string()
}

/// Call Claude API and get response
pub async fn call_claude_api(
    api_key: &str,
    session: &AgentSession,
    user_message: &str,
) -> Result<String, String> {
    let mut messages = session
        .messages
        .iter()
        .map(|m| ClaudeMessage {
            role: m.role.clone(),
            content: m.as_text(),
        })
        .collect::<Vec<_>>();

    // Add the new user message
    messages.push(ClaudeMessage {
        role: "user".to_string(),
        content: user_message.to_string(),
    });

    let request = ClaudeRequest {
        model: DEFAULT_MODEL.to_string(),
        max_tokens: DEFAULT_MAX_TOKENS,
        system: get_system_prompt(),
        messages,
    };

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to call Claude API: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Claude API returned {}: {}", status, error_text));
    }

    let claude_response = response
        .json::<ClaudeResponse>()
        .await
        .map_err(|e| format!("Failed to parse Claude response: {}", e))?;

    // Extract text from response
    let text = claude_response
        .content
        .iter()
        .filter_map(|block| {
            if block.r#type == "text" {
                block.text.clone()
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    if text.is_empty() {
        return Err("No text response from Claude API".to_string());
    }

    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_session() {
        let session = create_session();
        assert!(!session.id.is_empty());
        assert_eq!(session.messages.len(), 0);
    }

    #[test]
    fn test_session_has_uuid_format() {
        let session = create_session();
        assert_eq!(session.id.len(), 36);
        assert!(session.id.contains('-'));
    }

    #[test]
    fn test_sessions_have_unique_ids() {
        let session1 = create_session();
        let session2 = create_session();
        assert_ne!(session1.id, session2.id);
    }

    #[test]
    fn test_session_timestamps() {
        let session = create_session();
        assert_eq!(session.created_at, session.updated_at);
        // Should be valid RFC3339 format with ISO 8601 datetime
        assert!(session.created_at.contains('T'));
        // Should have some sort of timezone info (Z or offset like +XX:XX or -XX:XX)
        assert!(session.created_at.len() > 10); // Minimum valid RFC3339 format
    }

    #[test]
    fn test_message_text_helper() {
        let msg = Message::text("user", "Hello");
        assert_eq!(msg.role, "user");
        assert_eq!(msg.content, Some("Hello".to_string()));
        assert!(msg.content_blocks.is_none());
    }

    #[test]
    fn test_message_with_blocks() {
        let blocks = vec![MessageContentBlock::Text {
            text: "Hello".to_string(),
        }];
        let msg = Message::with_blocks("assistant", blocks);
        assert_eq!(msg.role, "assistant");
        assert!(msg.content.is_none());
        assert!(msg.content_blocks.is_some());
    }

    #[test]
    fn test_message_as_text_from_string() {
        let msg = Message::text("user", "Hello, world!");
        assert_eq!(msg.as_text(), "Hello, world!");
    }

    #[test]
    fn test_message_as_text_from_blocks() {
        let blocks = vec![
            MessageContentBlock::Text {
                text: "Part 1".to_string(),
            },
            MessageContentBlock::Text {
                text: "Part 2".to_string(),
            },
        ];
        let msg = Message::with_blocks("assistant", blocks);
        assert_eq!(msg.as_text(), "Part 1\nPart 2");
    }

    #[test]
    fn test_message_as_text_mixed_blocks() {
        let blocks = vec![
            MessageContentBlock::Text {
                text: "Text content".to_string(),
            },
            MessageContentBlock::ToolUse {
                id: "tool_1".to_string(),
                name: "bash".to_string(),
                input: serde_json::json!({}),
            },
        ];
        let msg = Message::with_blocks("assistant", blocks);
        // Should only extract text content
        assert_eq!(msg.as_text(), "Text content");
    }

    #[test]
    fn test_default_model_is_claude() {
        assert!(DEFAULT_MODEL.contains("claude"));
    }

    #[test]
    fn test_default_max_tokens() {
        assert!(DEFAULT_MAX_TOKENS > 0);
        assert!(DEFAULT_MAX_TOKENS <= 8192);
    }

    #[test]
    fn test_system_prompt() {
        let prompt = get_system_prompt();
        assert!(!prompt.is_empty());
        assert!(prompt.contains("Claude"));
        assert!(prompt.contains("Anthropic"));
    }

    #[test]
    fn test_agent_session_serialization() {
        let session = create_session();
        let json = serde_json::to_string(&session).unwrap();
        let parsed: AgentSession = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, session.id);
        assert_eq!(parsed.created_at, session.created_at);
        assert_eq!(parsed.messages.len(), session.messages.len());
    }

    #[test]
    fn test_claude_message_structure() {
        let msg = ClaudeMessage {
            role: "assistant".to_string(),
            content: "Response text".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("assistant"));
        assert!(json.contains("Response text"));
    }

    #[test]
    fn test_content_block_with_text() {
        let block = ContentBlock {
            r#type: "text".to_string(),
            text: Some("Some text".to_string()),
        };

        assert_eq!(block.r#type, "text");
        assert_eq!(block.text, Some("Some text".to_string()));
    }

    #[test]
    fn test_content_block_without_text() {
        let block = ContentBlock {
            r#type: "tool_use".to_string(),
            text: None,
        };

        assert_eq!(block.r#type, "tool_use");
        assert!(block.text.is_none());
    }
}

