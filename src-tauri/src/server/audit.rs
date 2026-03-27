use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

/// Get the audit log file path (~/.pi/audit.log)
fn audit_log_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    PathBuf::from(home).join(".pi/audit.log")
}

/// Ensure the audit log directory exists
fn ensure_audit_dir() -> Result<(), String> {
    let path = audit_log_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create audit directory: {}", e))?;
    }
    Ok(())
}

/// Log an audit event to the audit log file
pub fn log_event(event_type: &str, details: Option<Value>) -> Result<(), String> {
    ensure_audit_dir()?;

    let timestamp = chrono::Local::now().to_rfc3339();
    let event = json!({
        "timestamp": timestamp,
        "type": event_type,
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
