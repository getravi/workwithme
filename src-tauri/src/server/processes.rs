use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

/// Represents a running process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub id: String,
    pub tool_name: String,
    pub pid: u32,
    pub started_at: String,
    pub status: String, // "running", "completed", "failed"
}

lazy_static::lazy_static! {
    static ref PROCESS_REGISTRY: Arc<Mutex<HashMap<String, ProcessInfo>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

/// Spawn a new tracked process
pub fn spawn_process(tool_name: &str, command: &mut Command) -> Result<String, String> {
    let process_id = Uuid::new_v4().to_string();
    let now = chrono::Local::now().to_rfc3339();

    let _child = command
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;

    let process_info = ProcessInfo {
        id: process_id.clone(),
        tool_name: tool_name.to_string(),
        pid: 0, // We don't track the actual PID currently
        started_at: now,
        status: "running".to_string(),
    };

    let mut registry = match PROCESS_REGISTRY.lock() {
        Ok(r) => r,
        Err(poisoned) => {
            eprintln!("[processes] mutex poisoned in spawn_process, recovering");
            poisoned.into_inner()
        }
    };
    registry.insert(process_id.clone(), process_info);

    println!("[processes] spawned process {}: {}", process_id, tool_name);
    Ok(process_id)
}

/// Get list of running processes
pub fn list_processes() -> Result<Vec<ProcessInfo>, String> {
    let registry = match PROCESS_REGISTRY.lock() {
        Ok(r) => r,
        Err(poisoned) => {
            eprintln!("[processes] mutex poisoned in list_processes, recovering");
            poisoned.into_inner()
        }
    };
    Ok(registry
        .values()
        .filter(|p| p.status == "running")
        .cloned()
        .collect())
}

/// Kill a process
pub fn kill_process(process_id: &str) -> Result<bool, String> {
    let mut registry = PROCESS_REGISTRY.lock().unwrap();

    if let Some(process) = registry.get_mut(process_id) {
        process.status = "killed".to_string();
        println!("[processes] killed process {}", process_id);
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Mark process as completed
pub fn mark_completed(process_id: &str) -> Result<(), String> {
    let mut registry = PROCESS_REGISTRY.lock().unwrap();

    if let Some(process) = registry.get_mut(process_id) {
        process.status = "completed".to_string();
    }

    Ok(())
}

/// Get process info
pub fn get_process(process_id: &str) -> Result<Option<ProcessInfo>, String> {
    let registry = PROCESS_REGISTRY.lock().unwrap();
    Ok(registry.get(process_id).cloned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_info_creation() {
        let info = ProcessInfo {
            id: "test-id".to_string(),
            tool_name: "bash".to_string(),
            pid: 1234,
            started_at: chrono::Local::now().to_rfc3339(),
            status: "running".to_string(),
        };

        assert_eq!(info.tool_name, "bash");
        assert_eq!(info.status, "running");
    }

    #[test]
    fn test_list_empty_processes() {
        let processes = list_processes();
        assert!(processes.is_ok());
    }
}
