//! Append-only audit log for security-sensitive operations.
//!
//! Events are written as JSON lines to `~/.pi/audit.log`.
//! Severity levels range from `Info` through `Critical`.
//! Log rotation is left to the host OS or user — this module only appends.

use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

/// Audit event severity levels
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditSeverity {
    Info,
    Warning,
    Critical,
}

impl AuditSeverity {
    pub fn as_str(&self) -> &str {
        match self {
            AuditSeverity::Info => "info",
            AuditSeverity::Warning => "warning",
            AuditSeverity::Critical => "critical",
        }
    }
}

/// Get the audit log file path (~/.pi/audit.log)
pub fn get_audit_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    PathBuf::from(home).join(".pi/audit.log")
}

fn audit_log_path() -> PathBuf {
    get_audit_path()
}

/// Ensure the audit log directory exists
fn ensure_audit_dir() -> Result<(), String> {
    let path = audit_log_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create audit directory: {}", e))?;
    }
    Ok(())
}

/// Log an audit event to the audit log file with severity level
pub fn log_event_with_severity(event_type: &str, severity: AuditSeverity, details: Option<Value>) -> Result<(), String> {
    ensure_audit_dir()?;

    let timestamp = chrono::Local::now().to_rfc3339();
    let event = json!({
        "timestamp": timestamp,
        "type": event_type,
        "severity": severity.as_str(),
        "details": details.unwrap_or(Value::Null),
    });

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(audit_log_path())
        .map_err(|e| format!("Failed to open audit log: {}", e))?;

    writeln!(file, "{}", event.to_string()).map_err(|e| format!("Failed to write to audit log: {}", e))?;

    Ok(())
}

/// Log an audit event to the audit log file (defaults to Info severity)
pub fn log_event(event_type: &str, details: Option<Value>) -> Result<(), String> {
    log_event_with_severity(event_type, AuditSeverity::Info, details)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audit_path_contains_pi_directory() {
        let path = get_audit_path();
        assert!(path.to_string_lossy().contains(".pi"));
    }

    #[test]
    fn test_audit_path_ends_with_audit_log() {
        let path = get_audit_path();
        assert!(path.to_string_lossy().ends_with("audit.log"));
    }

    #[test]
    fn test_log_event_success() {
        let result = log_event("test:event", Some(json!({"key": "value"})));
        assert!(result.is_ok());
    }

    #[test]
    fn test_log_event_with_details() {
        let details = json!({"user": "test", "action": "login"});
        let result = log_event("auth:login", Some(details));
        assert!(result.is_ok());
    }

    #[test]
    fn test_log_event_with_nested_json() {
        let details = json!({
            "session": {
                "id": "test-123",
                "metadata": {
                    "ip": "127.0.0.1",
                    "agent": "test-agent"
                }
            }
        });
        let result = log_event("session:created", Some(details));
        assert!(result.is_ok());
    }

    #[test]
    fn test_audit_severity_strings() {
        assert_eq!(AuditSeverity::Info.as_str(), "info");
        assert_eq!(AuditSeverity::Warning.as_str(), "warning");
        assert_eq!(AuditSeverity::Critical.as_str(), "critical");
    }

    #[test]
    fn test_log_multiple_event_types() {
        let events = vec!["auth:login", "session:created", "file:read", "tool:executed"];
        for event_type in events {
            let result = log_event(event_type, None);
            assert!(result.is_ok());
        }
    }
}
