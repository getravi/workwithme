//! Process lifecycle tracking for long-running tool invocations.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Child;
use std::sync::{Mutex, OnceLock};

/// Represents a running process (serialisable metadata only).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub id: String,
    pub tool_name: String,
    pub pid: u32,
    pub started_at: String,
    pub status: String, // "running", "completed", "failed", "killed"
}

/// Serialisable process metadata registry.
static PROCESS_REGISTRY: OnceLock<Mutex<HashMap<String, ProcessInfo>>> = OnceLock::new();

/// Live child handles — kept separately because `Child` is neither `Clone` nor `Serialize`.
static CHILD_REGISTRY: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();

fn process_registry() -> &'static Mutex<HashMap<String, ProcessInfo>> {
    PROCESS_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn child_registry() -> &'static Mutex<HashMap<String, Child>> {
    CHILD_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Reap any child processes that have exited naturally.
/// Called before listing processes so status is always current.
fn reap_exited_processes() {
    let mut children = child_registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let mut registry = process_registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    let finished: Vec<String> = children
        .iter_mut()
        .filter_map(|(id, child)| match child.try_wait() {
            Ok(Some(status)) => {
                // Process has exited — update metadata and collect id for removal.
                if let Some(info) = registry.get_mut(id) {
                    info.status = if status.success() {
                        "completed".to_string()
                    } else {
                        "failed".to_string()
                    };
                }
                Some(id.clone())
            }
            _ => None,
        })
        .collect();

    for id in finished {
        children.remove(&id);
    }
}

/// Get list of running processes
pub fn list_processes() -> Result<Vec<ProcessInfo>, String> {
    reap_exited_processes();
    Ok(process_registry()
        .lock()
        .unwrap_or_else(|e| {
            eprintln!("[processes] mutex poisoned in list_processes, recovering");
            e.into_inner()
        })
        .values()
        .filter(|p| p.status == "running")
        .cloned()
        .collect())
}

/// Kill a process — signals the OS process and updates the status.
pub fn kill_process(process_id: &str) -> Result<bool, String> {
    let mut registry = process_registry().lock().unwrap_or_else(|e| e.into_inner());

    if let Some(process) = registry.get_mut(process_id) {
        process.status = "killed".to_string();
        // Remove and kill the live child handle so the OS process actually receives SIGKILL.
        if let Some(mut child) = child_registry()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(process_id)
        {
            if let Err(e) = child.kill() {
                eprintln!("[processes] kill() failed for process {}: {}", process_id, e);
            }
        }
        println!("[processes] killed process {}", process_id);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

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

    #[test]
    fn test_process_info_serialization() {
        let info = ProcessInfo {
            id: "abc-123".to_string(),
            tool_name: "read_file".to_string(),
            pid: 0,
            started_at: "2026-01-01T00:00:00+00:00".to_string(),
            status: "running".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        let back: ProcessInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "abc-123");
        assert_eq!(back.tool_name, "read_file");
        assert_eq!(back.status, "running");
    }

    #[test]
    fn test_kill_nonexistent_process_returns_false() {
        let result = kill_process("no-such-process");
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_list_processes_returns_only_running() {
        // All entries from list_processes should have status "running"
        let processes = list_processes().unwrap();
        for p in processes {
            assert_eq!(p.status, "running", "list_processes should only return running processes");
        }
    }

    #[test]
    fn test_process_info_status_values() {
        // Validate that known status strings are consistent
        let statuses = ["running", "completed", "failed", "killed"];
        for status in statuses {
            let info = ProcessInfo {
                id: Uuid::new_v4().to_string(),
                tool_name: "test".to_string(),
                pid: 0,
                started_at: chrono::Local::now().to_rfc3339(),
                status: status.to_string(),
            };
            assert_eq!(info.status, status);
        }
    }
}
