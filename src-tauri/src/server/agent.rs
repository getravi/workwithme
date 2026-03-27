use serde::{Deserialize, Serialize};
use serde_json::json;
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
    pub metadata: serde_json::Value,
}

/// Message in conversation history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String, // "user" or "assistant"
    pub content: String,
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
            content: m.content.clone(),
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
