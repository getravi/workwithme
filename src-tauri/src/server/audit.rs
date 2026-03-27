use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

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
        let result = log_event("test_event", None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_log_event_with_details() {
        let details = Some(json!({
            "action": "test",
            "user": "test_user"
        }));
        let result = log_event("user_action", details);
        assert!(result.is_ok());
    }

    #[test]
    fn test_log_multiple_event_types() {
        let event_types = vec!["login", "logout", "create", "delete", "execute"];

        for event_type in event_types {
            let result = log_event(event_type, None);
            assert!(result.is_ok(), "Failed to log event: {}", event_type);
        }
    }

    #[test]
    fn test_log_event_with_nested_json() {
        let details = Some(json!({
            "level1": {
                "level2": {
                    "level3": "value"
                }
            },
            "array": [1, 2, 3],
            "boolean": true,
            "number": 42
        }));

        let result = log_event("complex_event", details);
        assert!(result.is_ok());
    }
}
