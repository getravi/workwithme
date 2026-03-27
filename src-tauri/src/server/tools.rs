use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;

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
        _ => ToolResult {
            tool_use_id: tool.id.clone(),
            content: format!("Unknown tool: {}", tool.name),
            is_error: true,
        },
    }
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

    println!("[tools] executing bash: {}", command);

    // Execute the command
    let output = Command::new("sh")
        .arg("-c")
        .arg(command)
        .output();

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
