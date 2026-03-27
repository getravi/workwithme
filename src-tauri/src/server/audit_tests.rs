/// Comprehensive tests for audit logging module
#[cfg(test)]
mod audit_tests {
    use crate::server::audit;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    fn get_test_audit_file() -> PathBuf {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home.join(".pi/audit_test.log")
    }

    #[test]
    fn test_log_event_basic() {
        let result = audit::log_event("test_event", Some(json!({"key": "value"})));
        assert!(result.is_ok());
    }

    #[test]
    fn test_log_event_without_details() {
        let result = audit::log_event("simple_event", None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_log_event_with_complex_details() {
        let details = Some(json!({
            "user": "test_user",
            "action": "login",
            "ip": "127.0.0.1",
            "timestamp": "2025-03-27T19:30:00Z",
            "nested": {
                "field1": "value1",
                "field2": 42
            }
        }));

        let result = audit::log_event("user_action", details);
        assert!(result.is_ok());
    }

    #[test]
    fn test_log_multiple_events() {
        // Simulate multiple audit events
        let events = vec![
            ("event1", Some(json!({"id": 1}))),
            ("event2", Some(json!({"id": 2}))),
            ("event3", None),
        ];

        for (event_type, details) in events {
            let result = audit::log_event(event_type, details);
            assert!(result.is_ok());
        }
    }

    #[test]
    fn test_log_event_types() {
        let event_types = vec![
            "auth_login",
            "auth_logout",
            "session_create",
            "session_delete",
            "tool_execute",
            "file_read",
            "file_write",
            "error",
        ];

        for event_type in event_types {
            let result = audit::log_event(event_type, None);
            assert!(result.is_ok());
        }
    }

    #[test]
    fn test_get_audit_path() {
        let path = audit::get_audit_path();
        assert!(path.to_string_lossy().contains(".pi"));
        assert!(path.to_string_lossy().ends_with("audit.log"));
    }
}
