use crate::server::agent::{AgentSession, Message, MessageContentBlock};
use crate::server::tools::{execute_tool, ToolUseBlock, tool_definitions};
use crate::server::providers::{
    LlmProvider, AnthropicProvider, CompletionRequest, AgentMessage, ContentBlock,
    ResponseContentBlock,
};
use crate::server::AppState;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::sync::mpsc;
use serde_json::Value;

/// Agent event for streaming responses
#[derive(Debug, Clone)]
pub enum AgentEvent {
    MessageStart,
    MessageDelta { text: String },
    MessageEnd,
    ToolExecutionStart { tool_name: String, tool_id: String },
    ToolExecutionDelta { output: String },
    ToolExecutionEnd { tool_name: String, output: String },
    AgentEnd { final_response: String },
    Error { message: String },
}

/// Execute agent turn: send message, handle tool calls, return response
pub async fn execute_agent_turn(
    state: Arc<AppState>,
    session: Arc<RwLock<AgentSession>>,
    user_message: String,
    event_tx: mpsc::Sender<AgentEvent>,
) -> Result<String, String> {
    // Get session ID for logging
    let session_id = {
        let s = session.read().await;
        s.id.clone()
    };

    // Add user message to session
    {
        let mut s = session.write().await;
        s.messages.push(Message::text("user", &user_message));
    }

    let mut iteration = 0;
    const MAX_ITERATIONS: u32 = 10;
    let final_response;

    loop {
        iteration += 1;
        if iteration > MAX_ITERATIONS {
            return Err(format!("Max iterations ({}) reached", MAX_ITERATIONS));
        }

        // Get current session state for API call
        let (messages, model_id) = {
            let s = session.read().await;
            let msgs = s
                .messages
                .iter()
                .map(|msg| {
                    let content = if let Some(text) = &msg.content {
                        vec![ContentBlock::Text {
                            text: text.clone(),
                        }]
                    } else if let Some(blocks) = &msg.content_blocks {
                        blocks
                            .iter()
                            .map(|b| match b {
                                MessageContentBlock::Text { text } => ContentBlock::Text {
                                    text: text.clone(),
                                },
                                MessageContentBlock::ToolUse { id, name, input } => {
                                    ContentBlock::ToolUse {
                                        id: id.clone(),
                                        name: name.clone(),
                                        input: input.clone(),
                                    }
                                }
                                MessageContentBlock::ToolResult {
                                    tool_use_id,
                                    content,
                                    is_error,
                                } => ContentBlock::ToolResult {
                                    tool_use_id: tool_use_id.clone(),
                                    content: content.clone(),
                                    is_error: *is_error,
                                },
                            })
                            .collect()
                    } else {
                        vec![]
                    };

                    AgentMessage {
                        role: msg.role.clone(),
                        content,
                    }
                })
                .collect();

            // Default to Claude Opus
            let model = "claude-opus-4-6".to_string();
            (msgs, model)
        };

        // Get API key for model
        let provider_name = "anthropic"; // For now, hardcoded - could be per-model in future
        let api_key = state
            .auth_storage
            .get_key(provider_name)
            .ok_or(format!("No API key found for provider: {}", provider_name))?;

        // Create provider instance
        let provider = AnthropicProvider::new(api_key);

        // Build completion request - include built-in tools + MCP tools
        let mut tools: Vec<crate::server::providers::ToolDefinition> = tool_definitions()
            .into_iter()
            .map(|t| {
                crate::server::providers::ToolDefinition {
                    name: t.name,
                    description: t.description,
                    input_schema: t.input_schema,
                }
            })
            .collect();

        // Load and append MCP tools from configuration
        let mcp_tools = crate::server::mcp::load_agent_mcp_tools().await;
        for mcp_tool in mcp_tools {
            tools.push(crate::server::providers::ToolDefinition {
                name: mcp_tool.name,
                description: mcp_tool.description,
                input_schema: mcp_tool.input_schema,
            });
        }

        let completion_req = CompletionRequest {
            model: model_id.clone(),
            system: get_system_prompt(),
            messages,
            tools,
            max_tokens: 4096,
        };

        // Call provider
        let response = match provider.complete(completion_req).await {
            Ok(resp) => resp,
            Err(e) => {
                let _ = event_tx
                    .send(AgentEvent::Error {
                        message: format!("API call failed: {}", e),
                    })
                    .await;
                return Err(e);
            }
        };

        // Process response content blocks
        let mut has_tool_use = false;
        let mut response_text = String::new();

        // First pass: collect text and detect tool use
        for block in &response.content {
            match block {
                ResponseContentBlock::Text { text } => {
                    response_text.push_str(text);
                }
                ResponseContentBlock::ToolUse { .. } => {
                    has_tool_use = true;
                }
            }
        }

        // Send message events
        if !response_text.is_empty() {
            let _ = event_tx.send(AgentEvent::MessageStart).await;
            let _ = event_tx
                .send(AgentEvent::MessageDelta {
                    text: response_text.clone(),
                })
                .await;
            let _ = event_tx.send(AgentEvent::MessageEnd).await;
        }

        // Add assistant response to session
        {
            let mut s = session.write().await;
            if has_tool_use {
                // Store response with tool use blocks
                let mut blocks = Vec::new();
                if !response_text.is_empty() {
                    blocks.push(MessageContentBlock::Text {
                        text: response_text.clone(),
                    });
                }
                for block in &response.content {
                    match block {
                        ResponseContentBlock::ToolUse { id, name, input } => {
                            blocks.push(MessageContentBlock::ToolUse {
                                id: id.clone(),
                                name: name.clone(),
                                input: input.clone(),
                            });
                        }
                        _ => {}
                    }
                }
                s.messages.push(Message::with_blocks("assistant", blocks));
            } else {
                s.messages.push(Message::text("assistant", &response_text));
            }
        }

        if !has_tool_use {
            // No tool use, response is complete
            final_response = response_text;
            break;
        }

        // Execute tools from response
        for block in &response.content {
            if let ResponseContentBlock::ToolUse { id, name, input } = block {
                let _ = event_tx
                    .send(AgentEvent::ToolExecutionStart {
                        tool_name: name.clone(),
                        tool_id: id.clone(),
                    })
                    .await;

                // Convert input to ToolUseBlock format for execution
                let tool_block = ToolUseBlock {
                    id: id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                };

                let result = execute_tool(&tool_block).await;
                let output_text = result.content.clone();

                let _ = event_tx
                    .send(AgentEvent::ToolExecutionDelta {
                        output: output_text.clone(),
                    })
                    .await;

                let _ = event_tx
                    .send(AgentEvent::ToolExecutionEnd {
                        tool_name: name.clone(),
                        output: output_text.clone(),
                    })
                    .await;

                // Add tool result to session
                {
                    let mut s = session.write().await;
                    s.messages.push(Message::with_blocks(
                        "user",
                        vec![MessageContentBlock::ToolResult {
                            tool_use_id: id.clone(),
                            content: output_text,
                            is_error: result.is_error,
                        }],
                    ));
                }
            }
        }
    }

    // Update session timestamp
    {
        let mut s = session.write().await;
        s.updated_at = chrono::Local::now().to_rfc3339();
    }

    let _ = event_tx
        .send(AgentEvent::AgentEnd {
            final_response: final_response.clone(),
        })
        .await;

    Ok(final_response)
}

/// Get system prompt for agent
fn get_system_prompt() -> String {
    "You are Claude, an AI assistant created by Anthropic. You are helpful, harmless, and honest. \
     You have access to various tools and can execute tasks on behalf of the user. \
     When the user asks you to do something, you should use the available tools to help them."
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_system_prompt() {
        let prompt = get_system_prompt();
        assert!(prompt.contains("Claude"));
        assert!(prompt.contains("helpful"));
    }
}
