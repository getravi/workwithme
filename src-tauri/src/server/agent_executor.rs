use crate::server::agent::{AgentSession, Message};
use crate::server::tools::{execute_tool, ToolUseBlock, ToolResult};
use serde_json::json;

/// Execute an agent loop: send message to Claude, parse response, execute tools, repeat
pub async fn execute_agent_message(
    api_key: &str,
    session: &mut AgentSession,
    user_message: &str,
    max_iterations: u32,
) -> Result<String, String> {
    // Add user message to history
    session.messages.push(Message {
        role: "user".to_string(),
        content: user_message.to_string(),
    });

    let mut iteration = 0;
    let mut final_response = String::new();

    loop {
        iteration += 1;
        if iteration > max_iterations {
            return Err(format!("Max iterations ({}) reached", max_iterations));
        }

        println!("[agent] iteration {} - calling Claude API", iteration);

        // Call Claude API
        let response_text = crate::server::agent::call_claude_api(api_key, session, user_message)
            .await?;

        println!("[agent] received response from Claude");

        // Add assistant response to history
        session.messages.push(Message {
            role: "assistant".to_string(),
            content: response_text.clone(),
        });

        // Check if response contains tool use blocks
        if response_text.contains("```tool-use") || response_text.contains("<tool_use>") {
            println!("[agent] parsing tool use blocks");
            let tools = parse_tool_blocks(&response_text);

            if tools.is_empty() {
                // No valid tool blocks found, return response as-is
                final_response = response_text;
                break;
            }

            // Execute all tools
            let mut tool_results = Vec::new();
            for tool in tools {
                println!("[agent] executing tool: {}", tool.name);
                let result = execute_tool(&tool).await;
                tool_results.push(result);
            }

            // Add tool results back to session
            let tool_results_str = tool_results
                .iter()
                .map(|r| {
                    format!(
                        "Tool `{}` {}:\n{}",
                        r.tool_use_id,
                        if r.is_error { "error" } else { "result" },
                        r.content
                    )
                })
                .collect::<Vec<_>>()
                .join("\n\n");

            session.messages.push(Message {
                role: "user".to_string(),
                content: format!("Tool results:\n{}", tool_results_str),
            });

            // Continue loop to get next Claude response
        } else {
            // No tool use, response is complete
            final_response = response_text;
            break;
        }
    }

    // Update session timestamp
    session.updated_at = chrono::Local::now().to_rfc3339();

    Ok(final_response)
}

/// Parse tool use blocks from Claude response
fn parse_tool_blocks(response: &str) -> Vec<ToolUseBlock> {
    let mut tools = Vec::new();

    // Look for markdown code blocks with tool-use language tag
    let lines: Vec<&str> = response.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        if lines[i].starts_with("```tool-use") || lines[i] == "```tool-use" {
            // Found tool-use block start
            let mut tool_content = String::new();
            i += 1;

            // Collect content until closing ```
            while i < lines.len() && !lines[i].starts_with("```") {
                if !tool_content.is_empty() {
                    tool_content.push('\n');
                }
                tool_content.push_str(lines[i]);
                i += 1;
            }

            // Try to parse as JSON
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&tool_content) {
                if let Some(tool_obj) = json.as_object() {
                    if let (Some(id), Some(name), Some(input)) =
                        (tool_obj.get("id"), tool_obj.get("name"), tool_obj.get("input"))
                    {
                        if let (Some(id_str), Some(name_str)) = (id.as_str(), name.as_str()) {
                            tools.push(ToolUseBlock {
                                id: id_str.to_string(),
                                name: name_str.to_string(),
                                input: input.clone(),
                            });
                        }
                    }
                }
            }
        }
        i += 1;
    }

    tools
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_tool_blocks() {
        let response = r#"
Let me check what files are in that directory.

```tool-use
{"id": "tool_1", "name": "bash", "input": {"command": "ls -la"}}
```

Here's what I found.
        "#;

        let tools = parse_tool_blocks(response);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "bash");
    }
}
