use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::mpsc;

/// Generic completion request for any LLM provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub model: String,
    pub system: String,
    pub messages: Vec<AgentMessage>,
    pub tools: Vec<ToolDefinition>,
    pub max_tokens: u32,
}

/// Agent message with content blocks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub role: String, // "user" | "assistant"
    #[serde(flatten)]
    pub content: Vec<ContentBlock>,
}

/// Multi-part content block
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
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

/// Tool definition with JSON schema
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value, // JSON Schema
}

/// Generic completion response from any LLM provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub id: String,
    pub content: Vec<ResponseContentBlock>,
    pub stop_reason: String,
}

/// Response content block from API
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ResponseContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
}

/// Stream event from LLM provider
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    MessageStart { message: CompletionResponse },
    ContentBlockStart { index: usize, content_block: ResponseContentBlock },
    ContentBlockDelta { index: usize, delta: Value },
    ContentBlockStop { index: usize },
    MessageDelta { delta: Value },
    MessageStop,
}

/// Trait for LLM providers
#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Provider ID (e.g., "anthropic", "openai")
    fn provider_id(&self) -> &str;

    /// Available model IDs for this provider
    fn model_ids(&self) -> Vec<&str>;

    /// Complete a request (non-streaming)
    async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse, String>;

    /// Stream a completion response
    async fn stream(
        &self,
        req: CompletionRequest,
        tx: mpsc::Sender<StreamEvent>,
    ) -> Result<(), String>;
}

/// Anthropic provider implementation
pub struct AnthropicProvider {
    api_key: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String) -> Self {
        AnthropicProvider { api_key }
    }
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
    fn provider_id(&self) -> &str {
        "anthropic"
    }

    fn model_ids(&self) -> Vec<&str> {
        vec![
            "claude-opus-4-6",
            "claude-sonnet-4-6",
            "claude-3-5-haiku-20241022",
        ]
    }

    async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse, String> {
        // Convert our generic format to Anthropic's format
        let anthropic_messages = req
            .messages
            .iter()
            .map(|msg| {
                let content = msg
                    .content
                    .iter()
                    .map(|block| match block {
                        ContentBlock::Text { text } => json!({
                            "type": "text",
                            "text": text
                        }),
                        ContentBlock::ToolUse { id, name, input } => json!({
                            "type": "tool_use",
                            "id": id,
                            "name": name,
                            "input": input
                        }),
                        ContentBlock::ToolResult {
                            tool_use_id,
                            content,
                            is_error,
                        } => json!({
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": content,
                            "is_error": is_error
                        }),
                    })
                    .collect::<Vec<_>>();

                json!({
                    "role": msg.role,
                    "content": content
                })
            })
            .collect::<Vec<_>>();

        let anthropic_tools = req
            .tools
            .iter()
            .map(|tool| {
                json!({
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema
                })
            })
            .collect::<Vec<_>>();

        let body = json!({
            "model": req.model,
            "max_tokens": req.max_tokens,
            "system": req.system,
            "tools": anthropic_tools,
            "messages": anthropic_messages
        });

        let client = reqwest::Client::new();
        let response = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Failed to call Anthropic API: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic API returned {}: {}", status, error_text));
        }

        let anthropic_response: Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

        // Convert Anthropic response to our format
        let content = anthropic_response["content"]
            .as_array()
            .ok_or("No content in response".to_string())?
            .iter()
            .filter_map(|block| {
                let block_type = block["type"].as_str()?;
                match block_type {
                    "text" => Some(ResponseContentBlock::Text {
                        text: block["text"].as_str()?.to_string(),
                    }),
                    "tool_use" => Some(ResponseContentBlock::ToolUse {
                        id: block["id"].as_str()?.to_string(),
                        name: block["name"].as_str()?.to_string(),
                        input: block["input"].clone(),
                    }),
                    _ => None,
                }
            })
            .collect();

        Ok(CompletionResponse {
            id: anthropic_response["id"]
                .as_str()
                .ok_or("No id in response".to_string())?
                .to_string(),
            content,
            stop_reason: anthropic_response["stop_reason"]
                .as_str()
                .ok_or("No stop_reason in response".to_string())?
                .to_string(),
        })
    }

    async fn stream(
        &self,
        req: CompletionRequest,
        tx: mpsc::Sender<StreamEvent>,
    ) -> Result<(), String> {
        // Convert our generic format to Anthropic's format
        let anthropic_messages = req
            .messages
            .iter()
            .map(|msg| {
                let content = msg
                    .content
                    .iter()
                    .map(|block| match block {
                        ContentBlock::Text { text } => json!({
                            "type": "text",
                            "text": text
                        }),
                        ContentBlock::ToolUse { id, name, input } => json!({
                            "type": "tool_use",
                            "id": id,
                            "name": name,
                            "input": input
                        }),
                        ContentBlock::ToolResult {
                            tool_use_id,
                            content,
                            is_error,
                        } => json!({
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": content,
                            "is_error": is_error
                        }),
                    })
                    .collect::<Vec<_>>();

                json!({
                    "role": msg.role,
                    "content": content
                })
            })
            .collect::<Vec<_>>();

        let anthropic_tools = req
            .tools
            .iter()
            .map(|tool| {
                json!({
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema
                })
            })
            .collect::<Vec<_>>();

        let body = json!({
            "model": req.model,
            "max_tokens": req.max_tokens,
            "system": req.system,
            "tools": anthropic_tools,
            "messages": anthropic_messages,
            "stream": true
        });

        let client = reqwest::Client::new();
        let response = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Failed to call Anthropic API: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic API returned {}: {}", status, error_text));
        }

        let mut stream = response.bytes_stream();
        use futures::stream::StreamExt;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
            let text = String::from_utf8_lossy(&chunk);

            for line in text.lines() {
                if line.starts_with("data: ") {
                    let json_str = &line[6..];
                    if json_str == "[DONE]" {
                        // Send final stop event
                        let _ = tx.send(StreamEvent::MessageStop).await;
                        break;
                    }

                    if let Ok(event) = serde_json::from_str::<Value>(json_str) {
                        // Process stream events and send to channel
                        // This is simplified - a full implementation would handle all event types
                        if let Some(delta) = event.get("delta") {
                            if let Some(text) = delta.get("text") {
                                let _ = tx
                                    .send(StreamEvent::ContentBlockDelta {
                                        index: 0,
                                        delta: text.clone(),
                                    })
                                    .await;
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }
}

/// OpenAI provider stub (placeholder)
pub struct OpenAiProvider {
    api_key: String,
}

impl OpenAiProvider {
    pub fn new(api_key: String) -> Self {
        OpenAiProvider { api_key }
    }
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn provider_id(&self) -> &str {
        "openai"
    }

    fn model_ids(&self) -> Vec<&str> {
        vec!["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"]
    }

    async fn complete(&self, _req: CompletionRequest) -> Result<CompletionResponse, String> {
        Err("OpenAI provider not yet implemented".to_string())
    }

    async fn stream(
        &self,
        _req: CompletionRequest,
        _tx: mpsc::Sender<StreamEvent>,
    ) -> Result<(), String> {
        Err("OpenAI provider streaming not yet implemented".to_string())
    }
}

// Re-export for convenience
pub use serde_json::json;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_anthropic_provider_ids() {
        let provider = AnthropicProvider::new("test-key".to_string());
        assert_eq!(provider.provider_id(), "anthropic");
    }

    #[test]
    fn test_anthropic_model_ids() {
        let provider = AnthropicProvider::new("test-key".to_string());
        let models = provider.model_ids();
        assert!(models.contains(&"claude-opus-4-6"));
        assert!(models.contains(&"claude-sonnet-4-6"));
        assert!(models.contains(&"claude-3-5-haiku-20241022"));
    }

    #[test]
    fn test_openai_provider_ids() {
        let provider = OpenAiProvider::new("test-key".to_string());
        assert_eq!(provider.provider_id(), "openai");
    }

    #[test]
    fn test_openai_model_ids() {
        let provider = OpenAiProvider::new("test-key".to_string());
        let models = provider.model_ids();
        assert!(models.contains(&"gpt-4"));
    }

    #[test]
    fn test_content_block_text_serialization() {
        let block = ContentBlock::Text {
            text: "Hello, world!".to_string(),
        };
        let json = serde_json::to_value(&block).unwrap();
        assert_eq!(json["type"], "text");
        assert_eq!(json["text"], "Hello, world!");
    }

    #[test]
    fn test_content_block_tool_use_serialization() {
        let block = ContentBlock::ToolUse {
            id: "tool_1".to_string(),
            name: "bash".to_string(),
            input: json!({"command": "ls -la"}),
        };
        let json = serde_json::to_value(&block).unwrap();
        assert_eq!(json["type"], "tool_use");
        assert_eq!(json["id"], "tool_1");
        assert_eq!(json["name"], "bash");
    }

    #[test]
    fn test_completion_request_structure() {
        let req = CompletionRequest {
            model: "claude-opus-4-6".to_string(),
            system: "You are helpful".to_string(),
            messages: vec![AgentMessage {
                role: "user".to_string(),
                content: vec![ContentBlock::Text {
                    text: "Hello".to_string(),
                }],
            }],
            tools: vec![],
            max_tokens: 4096,
        };

        assert_eq!(req.model, "claude-opus-4-6");
        assert_eq!(req.messages.len(), 1);
        assert_eq!(req.max_tokens, 4096);
    }

    #[test]
    fn test_agent_message_with_multiple_blocks() {
        let msg = AgentMessage {
            role: "assistant".to_string(),
            content: vec![
                ContentBlock::Text {
                    text: "I'll help you".to_string(),
                },
                ContentBlock::ToolUse {
                    id: "tool_1".to_string(),
                    name: "bash".to_string(),
                    input: json!({"command": "pwd"}),
                },
            ],
        };

        assert_eq!(msg.role, "assistant");
        assert_eq!(msg.content.len(), 2);
    }
}
