//! Mapping from pi `AgentEvent`s to the frontend WebSocket JSON protocol.
//! Extracted from `ws.rs`. Pure transform: pi event in, camelCase JSON string out.

use pi::sdk::AgentEvent;
use pi::model::{AssistantMessageEvent, ContentBlock};
use pi::tools::ToolOutput;
use serde_json::json;

fn derive_status_from_tool(tool_name: &str) -> String {
    let name_lower = tool_name.to_lowercase().replace('_', "-");
    if name_lower.contains("read") || name_lower.contains("file") {
        "Reading files...".to_string()
    } else if name_lower.contains("glob") || name_lower.contains("find") {
        "Finding files...".to_string()
    } else if name_lower.contains("grep") || name_lower.contains("search") {
        "Searching codebase...".to_string()
    } else if name_lower.contains("web-search") || name_lower.contains("web_search") {
        "Searching the web...".to_string()
    } else if name_lower.contains("web-fetch") || name_lower.contains("web_fetch") {
        "Fetching content...".to_string()
    } else if name_lower.contains("bash") || name_lower.contains("shell") || name_lower.contains("exec") {
        "Running commands...".to_string()
    } else if name_lower.contains("write") || name_lower.contains("create") {
        "Writing files...".to_string()
    } else if name_lower.contains("edit") || name_lower.contains("patch") {
        "Editing files...".to_string()
    } else if name_lower.contains("mcp") {
        if name_lower.contains("read") {
            "Reading files...".to_string()
        } else if name_lower.contains("write") {
            "Writing files...".to_string()
        } else if name_lower.contains("list") || name_lower.contains("dir") {
            "Listing directory...".to_string()
        } else if name_lower.contains("search") {
            "Searching...".to_string()
        } else {
            "Working...".to_string()
        }
    } else {
        "Working on your request...".to_string()
    }
}

/// Extract plain text from a pi `ToolOutput` (concatenates all `Text` blocks).
pub fn tool_output_text(output: &ToolOutput) -> String {
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
/// | `MessageUpdate { TextDelta }` | `message_update` | `eventType`, `delta` |
/// | `MessageUpdate { ThinkingDelta }` | `message_update` | `eventType`, `delta` |
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

        AgentEvent::MessageUpdate { assistant_message_event, .. } => {
            let (event_type, delta_payload) = match assistant_message_event {
                AssistantMessageEvent::TextDelta { delta, .. } => (
                    "text_delta",
                    serde_json::json!({"type": "text", "text": delta}),
                ),
                AssistantMessageEvent::ThinkingDelta { delta, .. } => (
                    "thinking_delta",
                    serde_json::json!({"type": "thinking", "thinking": delta}),
                ),
                AssistantMessageEvent::ToolCallDelta { delta, .. } => (
                    "toolcall_delta",
                    serde_json::json!({"type": "tool_call_delta", "delta": delta}),
                ),
                AssistantMessageEvent::ToolCallEnd { tool_call, .. } => (
                    "toolcall_end",
                    serde_json::json!({
                        "type": "tool_call",
                        "toolCallId": tool_call.id,
                        "toolName": tool_call.name,
                        "input": tool_call.arguments
                    }),
                ),
                // Start events carry no payload the frontend needs
                AssistantMessageEvent::TextStart { .. }
                | AssistantMessageEvent::ThinkingStart { .. }
                | AssistantMessageEvent::ToolCallStart { .. } => return None,
                other => {
                    eprintln!("[ws] unhandled assistant event: {:?}", other);
                    return None;
                }
            };

            json!({
                "type": "message_update",
                "sessionId": session_id,
                "eventType": event_type,
                "delta": delta_payload
            })
        }

        AgentEvent::MessageEnd { .. } => json!({
            "type": "message_end",
            "sessionId": session_id,
            "message": {}
        }),

        AgentEvent::ToolExecutionStart { tool_name, tool_call_id, args, .. } => {
            // Derive a human-readable status from the tool name
            let status = derive_status_from_tool(tool_name);
            json!({
                "type": "tool_execution_start",
                "sessionId": session_id,
                "toolCallId": tool_call_id,
                "toolName": tool_name,
                "args": args,
                "status": status
            })
        }

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
