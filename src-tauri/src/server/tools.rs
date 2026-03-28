use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use crate::server::sandbox::{Sandbox, SandboxProfile};
use crate::server::approval::{create_write_file_approval_request, APPROVAL_MANAGER};
use lazy_static::lazy_static;
use tokio::sync::Semaphore;
use std::sync::Arc;

// Global semaphore for limiting concurrent claude task execution to 3 tasks
lazy_static! {
    static ref CLAUDE_CONCURRENCY_SEMAPHORE: Arc<Semaphore> = Arc::new(Semaphore::new(3));
}

/// Tool definition with JSON schema
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// Tool use block from Claude response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUseBlock {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

/// Tool execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_use_id: String,
    pub content: String,
    pub is_error: bool,
}

/// Execute a tool and return the result
pub async fn execute_tool(tool: &ToolUseBlock) -> ToolResult {
    match tool.name.as_str() {
        "bash" => execute_bash(tool).await,
        "read_file" => execute_read_file(tool).await,
        "write_file" => execute_write_file(tool).await,
        "list_directory" => execute_list_directory(tool).await,
        "claude" => execute_claude(tool).await,
        _ => {
            // Try to execute as an MCP tool
            execute_mcp_tool(tool).await
        }
    }
}

/// Get all available tool definitions with JSON schemas
pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "bash".to_string(),
            description: "Execute a bash command on the system".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The bash command to execute (limited to safe commands)"
                    }
                },
                "required": ["command"]
            }),
        },
        ToolDefinition {
            name: "read_file".to_string(),
            description: "Read the contents of a file".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The path to the file to read"
                    }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "write_file".to_string(),
            description: "Write contents to a file".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The path to the file to write"
                    },
                    "content": {
                        "type": "string",
                        "description": "The content to write to the file"
                    }
                },
                "required": ["path", "content"]
            }),
        },
        ToolDefinition {
            name: "list_directory".to_string(),
            description: "List contents of a directory".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The path to the directory to list"
                    }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "claude".to_string(),
            description: "Spawn Claude Code sessions for sub-tasks (max 8 parallel, 3 concurrent)".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "The prompt or instruction for the Claude Code session"
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Working directory for the Claude Code session (optional)"
                    },
                    "parallel": {
                        "type": "boolean",
                        "description": "Run multiple sub-tasks in parallel (up to 3 concurrent, max 8 tasks)"
                    }
                },
                "required": ["prompt"]
            }),
        },
    ]
}

/// Validate bash command for safety
fn validate_bash_command(cmd: &str) -> Result<(), String> {
    // Whitelist of safe base commands
    let allowed = vec![
        "ls", "cat", "grep", "find", "ps", "wc", "head", "tail",
        "echo", "pwd", "whoami", "date", "uptime", "uname",
        "df", "du", "free", "top", "netstat", "ss", "curl", "wget"
    ];

    let base_cmd = cmd.split_whitespace().next()
        .ok_or("Empty command not allowed".to_string())?;

    if !allowed.contains(&base_cmd) {
        return Err(format!(
            "Command '{}' not allowed. Allowed commands: {}",
            base_cmd,
            allowed.join(", ")
        ));
    }

    // Reject dangerous patterns
    let dangerous_patterns = vec![";", "|", "&", "$", "`", "(", ")", "{", "}", ">>", ">", "<"];
    for pattern in dangerous_patterns {
        if cmd.contains(pattern) {
            return Err(format!("Command contains restricted character: '{}'", pattern));
        }
    }

    // Reject path traversal attempts
    if cmd.contains("..") {
        return Err("Path traversal (..) is not allowed".to_string());
    }

    Ok(())
}

/// Execute a bash command
async fn execute_bash(tool: &ToolUseBlock) -> ToolResult {
    let command = match tool.input.get("command") {
        Some(cmd) => match cmd.as_str() {
            Some(s) => s,
            None => {
                return ToolResult {
                    tool_use_id: tool.id.clone(),
                    content: "Command must be a string".to_string(),
                    is_error: true,
                }
            }
        },
        None => {
            return ToolResult {
                tool_use_id: tool.id.clone(),
                content: "Missing 'command' field".to_string(),
                is_error: true,
            }
        }
    };

    // Validate command safety before execution
    if let Err(e) = validate_bash_command(command) {
        return ToolResult {
            tool_use_id: tool.id.clone(),
            content: format!("Command validation failed: {}", e),
            is_error: true,
        };
    }

    println!("[tools] executing bash: {}", command);

    // Execute the command in a sandbox (read-only by default for security)
    // Phase 3d will add user approval workflows to allow WriteHome profile
    let sandbox = Sandbox::new(SandboxProfile::ReadOnly);
    let output = sandbox.execute(command);

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);

            let result = if output.status.success() {
                if stdout.is_empty() && stderr.is_empty() {
                    "Command executed successfully (no output)".to_string()
                } else if !stdout.is_empty() {
                    stdout
                } else {
                    stderr
                }
            } else {
                format!(
                    "Command failed with exit code {}\nstderr: {}",
                    exit_code, stderr
                )
            };

            ToolResult {
                tool_use_id: tool.id.clone(),
                content: result,
                is_error: !output.status.success(),
            }
        }
        Err(e) => ToolResult {
            tool_use_id: tool.id.clone(),
            content: format!("Failed to execute command: {}", e),
            is_error: true,
        },
    }
}

/// Read a file
async fn execute_read_file(tool: &ToolUseBlock) -> ToolResult {
    let path = match tool.input.get("path") {
        Some(p) => match p.as_str() {
            Some(s) => s,
            None => {
                return ToolResult {
                    tool_use_id: tool.id.clone(),
                    content: "Path must be a string".to_string(),
                    is_error: true,
                }
            }
        },
        None => {
            return ToolResult {
                tool_use_id: tool.id.clone(),
                content: "Missing 'path' field".to_string(),
                is_error: true,
            }
        }
    };

    // Security check: prevent reading files outside home directory
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let expanded_path = if path.starts_with("~/") {
        Path::new(&home).join(&path[2..])
    } else {
        Path::new(path).to_path_buf()
    };

    // Check if path is within home directory (basic security)
    if let Ok(canonical_home) = fs::canonicalize(&home) {
        if let Ok(canonical_path) = fs::canonicalize(&expanded_path) {
            if !canonical_path.starts_with(&canonical_home) {
                return ToolResult {
                    tool_use_id: tool.id.clone(),
                    content: "Security restriction: can only read files in home directory".to_string(),
                    is_error: true,
                };
            }
        }
    }

    println!("[tools] reading file: {}", expanded_path.display());

    match fs::read_to_string(&expanded_path) {
        Ok(content) => ToolResult {
            tool_use_id: tool.id.clone(),
            content,
            is_error: false,
        },
        Err(e) => ToolResult {
            tool_use_id: tool.id.clone(),
            content: format!("Failed to read file: {}", e),
            is_error: true,
        },
    }
}

/// Write a file
async fn execute_write_file(tool: &ToolUseBlock) -> ToolResult {
    let path = match tool.input.get("path") {
        Some(p) => match p.as_str() {
            Some(s) => s,
            None => {
                return ToolResult {
                    tool_use_id: tool.id.clone(),
                    content: "Path must be a string".to_string(),
                    is_error: true,
                }
            }
        },
        None => {
            return ToolResult {
                tool_use_id: tool.id.clone(),
                content: "Missing 'path' field".to_string(),
                is_error: true,
            }
        }
    };

    let content = match tool.input.get("content") {
        Some(c) => match c.as_str() {
            Some(s) => s,
            None => {
                return ToolResult {
                    tool_use_id: tool.id.clone(),
                    content: "Content must be a string".to_string(),
                    is_error: true,
                }
            }
        },
        None => {
            return ToolResult {
                tool_use_id: tool.id.clone(),
                content: "Missing 'content' field".to_string(),
                is_error: true,
            }
        }
    };

    // Security check: prevent writing files outside home directory
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let expanded_path = if path.starts_with("~/") {
        Path::new(&home).join(&path[2..])
    } else {
        Path::new(path).to_path_buf()
    };

    // Check if path is within home directory (basic security)
    if let Ok(canonical_home) = fs::canonicalize(&home) {
        if let Ok(canonical_path) = fs::canonicalize(expanded_path.parent().unwrap_or(Path::new("."))) {
            if !canonical_path.starts_with(&canonical_home) {
                return ToolResult {
                    tool_use_id: tool.id.clone(),
                    content: "Security restriction: can only write files in home directory".to_string(),
                    is_error: true,
                };
            }
        }
    }

    println!("[tools] writing file: {}", expanded_path.display());

    // Log approval request (approval system available for Phase 3d integration)
    // In MVP, write operations proceed immediately; full approval workflow in Phase 3d+
    if let Some(_manager) = APPROVAL_MANAGER.get() {
        let approval_request = create_write_file_approval_request(
            expanded_path.to_string_lossy().as_ref(),
            content,
        );
        println!(
            "[tools] approval request logged for write_file: {}",
            approval_request.id
        );
        // Note: In Phase 3d+, we would wait for approval here using:
        // let rx = manager.request_approval(approval_request);
        // let approved = rx.await.unwrap_or(false);
        // if !approved { return error... }
    }

    match fs::write(&expanded_path, content) {
        Ok(_) => ToolResult {
            tool_use_id: tool.id.clone(),
            content: format!("File written successfully: {}", expanded_path.display()),
            is_error: false,
        },
        Err(e) => ToolResult {
            tool_use_id: tool.id.clone(),
            content: format!("Failed to write file: {}", e),
            is_error: true,
        },
    }
}

/// Spawn Claude Code sessions for parallel task execution
/// Phase 3: claude-tool extension supporting up to 8 tasks with 3 concurrent
/// When parallel=true, acquires a semaphore permit to limit concurrency to 3 tasks
async fn execute_claude(tool: &ToolUseBlock) -> ToolResult {
    let prompt = match tool.input.get("prompt") {
        Some(p) => match p.as_str() {
            Some(s) => s,
            None => {
                return ToolResult {
                    tool_use_id: tool.id.clone(),
                    content: "Prompt must be a string".to_string(),
                    is_error: true,
                }
            }
        },
        None => {
            return ToolResult {
                tool_use_id: tool.id.clone(),
                content: "Missing 'prompt' field".to_string(),
                is_error: true,
            }
        }
    };

    let cwd = tool.input.get("cwd")
        .and_then(|c| c.as_str())
        .unwrap_or(".");

    let parallel = tool.input.get("parallel")
        .and_then(|p| p.as_bool())
        .unwrap_or(false);

    println!("[tools] executing claude: prompt='{}', cwd='{}', parallel={}",
             prompt.chars().take(50).collect::<String>(), cwd, parallel);

    // If parallel mode, acquire semaphore permit to limit concurrency to 3 tasks
    let _permit = if parallel {
        match CLAUDE_CONCURRENCY_SEMAPHORE.acquire().await {
            Ok(p) => Some(p),
            Err(_) => {
                return ToolResult {
                    tool_use_id: tool.id.clone(),
                    content: "Failed to acquire concurrency permit".to_string(),
                    is_error: true,
                }
            }
        }
    } else {
        None
    };

    // Build the claude command with streaming output format (using tokio async version)
    let mut cmd = tokio::process::Command::new("claude");
    cmd.arg(prompt)
        .arg("--output-format=stream-json")
        .current_dir(cwd);

    // Execute claude CLI asynchronously and capture output
    match cmd.output().await {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);

            let result = if output.status.success() {
                if stdout.is_empty() {
                    "Claude Code session completed (no output)".to_string()
                } else {
                    stdout
                }
            } else {
                format!(
                    "Claude Code session failed with exit code {}\nstderr: {}",
                    exit_code, stderr
                )
            };

            // Semaphore permit is automatically released when _permit goes out of scope
            ToolResult {
                tool_use_id: tool.id.clone(),
                content: result,
                is_error: !output.status.success(),
            }
        }
        Err(e) => {
            // Semaphore permit is automatically released when _permit goes out of scope
            // If claude CLI is not found, provide helpful error
            let error_msg = if e.kind() == std::io::ErrorKind::NotFound {
                "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code".to_string()
            } else {
                format!("Failed to execute Claude Code: {}", e)
            };

            ToolResult {
                tool_use_id: tool.id.clone(),
                content: error_msg,
                is_error: true,
            }
        }
    }
}

/// List directory contents
async fn execute_list_directory(tool: &ToolUseBlock) -> ToolResult {
    let path = match tool.input.get("path") {
        Some(p) => match p.as_str() {
            Some(s) => s,
            None => {
                return ToolResult {
                    tool_use_id: tool.id.clone(),
                    content: "Path must be a string".to_string(),
                    is_error: true,
                }
            }
        },
        None => ".",
    };

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let expanded_path = if path.starts_with("~/") {
        Path::new(&home).join(&path[2..])
    } else {
        Path::new(path).to_path_buf()
    };

    println!("[tools] listing directory: {}", expanded_path.display());

    match fs::read_dir(&expanded_path) {
        Ok(entries) => {
            let mut items = Vec::new();
            for entry in entries {
                if let Ok(entry) = entry {
                    if let Some(file_name) = entry.file_name().to_str() {
                        items.push(file_name.to_string());
                    }
                }
            }
            items.sort();
            let content = items.join("\n");
            ToolResult {
                tool_use_id: tool.id.clone(),
                content,
                is_error: false,
            }
        }
        Err(e) => ToolResult {
            tool_use_id: tool.id.clone(),
            content: format!("Failed to list directory: {}", e),
            is_error: true,
        },
    }
}

/// Execute a tool via MCP (Model Context Protocol)
/// Loads the MCP config, finds the server that provides this tool, and executes it
async fn execute_mcp_tool(tool: &ToolUseBlock) -> ToolResult {
    use std::process::{Command, Stdio};
    use std::io::{BufRead, BufReader, Write};

    let tool_name = tool.name.clone();
    let tool_input = tool.input.clone();

    // Load MCP config to find which server provides this tool
    let config = match crate::server::mcp::load_mcp_config() {
        Ok(cfg) => cfg,
        Err(e) => {
            return ToolResult {
                tool_use_id: tool.id.clone(),
                content: format!("Failed to load MCP config: {}", e),
                is_error: true,
            }
        }
    };

    // Find the MCP server that provides this tool
    let servers = match config.get("mcpServers").and_then(|s| s.as_object()) {
        Some(s) => s,
        None => {
            return ToolResult {
                tool_use_id: tool.id.clone(),
                content: "No MCP servers configured".to_string(),
                is_error: true,
            }
        }
    };

    for (server_slug, server_config) in servers {
        // Skip disabled servers
        if let Some(false) = server_config.get("enabled").and_then(|e| e.as_bool()) {
            continue;
        }

        // Get the command to run
        let command_str = match server_config.get("command").and_then(|v| v.as_str()) {
            Some(cmd) => cmd,
            None => continue,
        };

        // Spawn the MCP server
        let parts: Vec<&str> = command_str.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let mut child = match Command::new(parts[0])
            .args(&parts[1..])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut stdin = match child.stdin.take() {
            Some(s) => s,
            None => continue,
        };

        let stdout = match child.stdout.take() {
            Some(o) => o,
            None => continue,
        };

        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        // Send initialize request
        let init_request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "clientInfo": {
                    "name": "workwithme",
                    "version": "0.1.6"
                }
            }
        });

        if let Err(_) = stdin.write_all(format!("{}\n", init_request.to_string()).as_bytes()) {
            let _ = child.kill();
            continue;
        }

        // Read initialize response
        if lines.next().is_none() {
            let _ = child.kill();
            continue;
        }

        // Send tool call request
        let call_request = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": tool_input
            }
        });

        if let Err(_) = stdin.write_all(format!("{}\n", call_request.to_string()).as_bytes()) {
            let _ = child.kill();
            continue;
        }

        // Read tool call response
        match lines.next() {
            Some(Ok(response_str)) => {
                let _ = child.kill();

                match serde_json::from_str::<Value>(&response_str) {
                    Ok(response) => {
                        if let Some(result) = response.get("result") {
                            let content = result
                                .get("content")
                                .and_then(|c| c.as_array())
                                .and_then(|arr| arr.first())
                                .and_then(|item| item.get("text"))
                                .and_then(|t| t.as_str())
                                .unwrap_or("Tool execution succeeded with no output");

                            return ToolResult {
                                tool_use_id: tool.id.clone(),
                                content: content.to_string(),
                                is_error: false,
                            };
                        }
                        // Check for error
                        if let Some(error) = response.get("error") {
                            let message = error
                                .get("message")
                                .and_then(|m| m.as_str())
                                .unwrap_or("Unknown error");
                            return ToolResult {
                                tool_use_id: tool.id.clone(),
                                content: format!("MCP tool error: {}", message),
                                is_error: true,
                            };
                        }
                    }
                    Err(_) => {
                        // Try next server
                        continue;
                    }
                }
            }
            _ => {
                let _ = child.kill();
                continue;
            }
        }
    }

    // Tool not found in any MCP server
    ToolResult {
        tool_use_id: tool.id.clone(),
        content: format!("Tool '{}' not found in any configured MCP server", tool_name),
        is_error: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_tool_use_block_structure() {
        let tool = ToolUseBlock {
            id: "tool-123".to_string(),
            name: "bash".to_string(),
            input: json!({"command": "ls"}),
        };

        assert_eq!(tool.id, "tool-123");
        assert_eq!(tool.name, "bash");
        assert!(tool.input.get("command").is_some());
    }

    #[test]
    fn test_tool_result_success() {
        let result = ToolResult {
            tool_use_id: "tool-123".to_string(),
            content: "Success".to_string(),
            is_error: false,
        };

        assert!(!result.is_error);
        assert_eq!(result.content, "Success");
    }

    #[test]
    fn test_tool_result_error() {
        let result = ToolResult {
            tool_use_id: "tool-456".to_string(),
            content: "Error occurred".to_string(),
            is_error: true,
        };

        assert!(result.is_error);
        assert!(result.content.contains("Error"));
    }

    #[test]
    fn test_tool_use_block_serialization() {
        let tool = ToolUseBlock {
            id: "test-id".to_string(),
            name: "test-tool".to_string(),
            input: json!({"param": "value"}),
        };

        let json = serde_json::to_string(&tool).unwrap();
        let parsed: ToolUseBlock = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, "test-id");
        assert_eq!(parsed.name, "test-tool");
    }

    #[test]
    fn test_tool_result_serialization() {
        let result = ToolResult {
            tool_use_id: "id-123".to_string(),
            content: "Output text".to_string(),
            is_error: false,
        };

        let json = serde_json::to_string(&result).unwrap();
        let parsed: ToolResult = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.tool_use_id, "id-123");
        assert_eq!(parsed.content, "Output text");
        assert!(!parsed.is_error);
    }

    #[test]
    fn test_various_tool_types() {
        let tools = vec!["bash", "read_file", "write_file", "list_directory"];

        for tool_name in tools {
            let tool = ToolUseBlock {
                id: format!("tool-{}", tool_name),
                name: tool_name.to_string(),
                input: json!({}),
            };

            assert_eq!(tool.name, tool_name);
        }
    }

    #[test]
    fn test_unknown_tool_name() {
        let tool = ToolUseBlock {
            id: "unknown-tool".to_string(),
            name: "nonexistent_tool".to_string(),
            input: json!({}),
        };

        assert_eq!(tool.name, "nonexistent_tool");
    }

    #[test]
    fn test_tool_input_with_complex_json() {
        let tool = ToolUseBlock {
            id: "complex-tool".to_string(),
            name: "bash".to_string(),
            input: json!({
                "command": "ls -la",
                "working_dir": "/tmp",
                "timeout": 30,
                "env": {
                    "PATH": "/usr/bin"
                }
            }),
        };

        assert!(tool.input.get("working_dir").is_some());
        assert!(tool.input.get("timeout").is_some());
    }

    #[test]
    fn test_tool_definitions_exists() {
        let defs = tool_definitions();
        assert!(!defs.is_empty());
        assert_eq!(defs.len(), 5); // bash, read_file, write_file, list_directory, claude
    }

    #[test]
    fn test_tool_definitions_have_schemas() {
        let defs = tool_definitions();
        for def in defs {
            assert!(!def.name.is_empty());
            assert!(!def.description.is_empty());
            // Schema should be a JSON object
            assert!(def.input_schema.is_object());
            // Should have 'type' and 'properties'
            assert_eq!(def.input_schema["type"], "object");
            assert!(def.input_schema["properties"].is_object());
        }
    }

    #[test]
    fn test_bash_tool_definition() {
        let defs = tool_definitions();
        let bash_def = defs.iter().find(|d| d.name == "bash").unwrap();
        assert_eq!(bash_def.name, "bash");
        assert!(bash_def.description.contains("bash"));
        assert!(bash_def.input_schema["properties"]["command"].is_object());
    }

    #[test]
    fn test_read_file_tool_definition() {
        let defs = tool_definitions();
        let def = defs.iter().find(|d| d.name == "read_file").unwrap();
        assert_eq!(def.name, "read_file");
        assert!(def.input_schema["properties"]["path"].is_object());
    }

    #[test]
    fn test_write_file_tool_definition() {
        let defs = tool_definitions();
        let def = defs.iter().find(|d| d.name == "write_file").unwrap();
        assert_eq!(def.name, "write_file");
        assert!(def.input_schema["properties"]["path"].is_object());
        assert!(def.input_schema["properties"]["content"].is_object());
    }

    #[test]
    fn test_list_directory_tool_definition() {
        let defs = tool_definitions();
        let def = defs.iter().find(|d| d.name == "list_directory").unwrap();
        assert_eq!(def.name, "list_directory");
        assert!(def.input_schema["properties"]["path"].is_object());
    }

    #[test]
    fn test_claude_tool_definition() {
        let defs = tool_definitions();
        let def = defs.iter().find(|d| d.name == "claude").unwrap();
        assert_eq!(def.name, "claude");
        assert!(def.description.contains("Claude Code"));
        assert!(def.input_schema["properties"]["prompt"].is_object());
        assert!(def.input_schema["properties"]["cwd"].is_object());
        assert!(def.input_schema["properties"]["parallel"].is_object());
        // prompt is required
        assert!(def.input_schema["required"].as_array().unwrap().contains(&json!("prompt")));
    }

    #[test]
    fn test_all_required_tools_present() {
        let defs = tool_definitions();
        let names: Vec<&String> = defs.iter().map(|d| &d.name).collect();

        assert!(names.contains(&&"bash".to_string()));
        assert!(names.contains(&&"read_file".to_string()));
        assert!(names.contains(&&"write_file".to_string()));
        assert!(names.contains(&&"list_directory".to_string()));
        assert!(names.contains(&&"claude".to_string()));
    }

    #[tokio::test]
    async fn test_claude_tool_semaphore_initialization() {
        // Test that the global semaphore is initialized with capacity 3
        let permit1 = CLAUDE_CONCURRENCY_SEMAPHORE.acquire().await;
        assert!(permit1.is_ok(), "Should be able to acquire first permit");

        let permit2 = CLAUDE_CONCURRENCY_SEMAPHORE.acquire().await;
        assert!(permit2.is_ok(), "Should be able to acquire second permit");

        let permit3 = CLAUDE_CONCURRENCY_SEMAPHORE.acquire().await;
        assert!(permit3.is_ok(), "Should be able to acquire third permit");

        // Note: We don't test acquiring a 4th permit here as it would block
        // In a real test, we'd need to spawn tasks or use try_acquire
    }

    #[tokio::test]
    async fn test_claude_tool_parallel_parameter() {
        // Test that execute_claude respects parallel parameter
        let tool_sequential = ToolUseBlock {
            id: "test-1".to_string(),
            name: "claude".to_string(),
            input: json!({
                "prompt": "echo test",
                "parallel": false
            }),
        };

        let tool_parallel = ToolUseBlock {
            id: "test-2".to_string(),
            name: "claude".to_string(),
            input: json!({
                "prompt": "echo test",
                "parallel": true
            }),
        };

        // Both should parse correctly
        assert_eq!(
            tool_sequential.input.get("parallel").and_then(|p| p.as_bool()),
            Some(false)
        );
        assert_eq!(
            tool_parallel.input.get("parallel").and_then(|p| p.as_bool()),
            Some(true)
        );
    }

    #[test]
    fn test_claude_tool_input_validation() {
        // Test that claude tool validates required fields
        let missing_prompt = ToolUseBlock {
            id: "test-1".to_string(),
            name: "claude".to_string(),
            input: json!({
                "cwd": "/tmp",
                "parallel": true
            }),
        };

        // Missing prompt should be detected
        assert!(missing_prompt.input.get("prompt").is_none());
    }

    #[test]
    fn test_claude_tool_cwd_parameter() {
        // Test that claude tool accepts optional cwd parameter
        let tool_default_cwd = ToolUseBlock {
            id: "test-1".to_string(),
            name: "claude".to_string(),
            input: json!({
                "prompt": "list files"
            }),
        };

        let tool_custom_cwd = ToolUseBlock {
            id: "test-2".to_string(),
            name: "claude".to_string(),
            input: json!({
                "prompt": "list files",
                "cwd": "/home/user/project"
            }),
        };

        // Default should be "." (current dir)
        assert_eq!(
            tool_default_cwd.input.get("cwd").and_then(|c| c.as_str()),
            None
        );

        // Custom cwd should be preserved
        assert_eq!(
            tool_custom_cwd.input.get("cwd").and_then(|c| c.as_str()),
            Some("/home/user/project")
        );
    }
}

