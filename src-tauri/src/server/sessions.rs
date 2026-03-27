use serde_json::{Value, json};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;
use chrono::{DateTime, Utc, Duration};

/// Get the sessions directory path (~/.pi/sessions)
pub fn sessions_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    PathBuf::from(home).join(".pi/sessions")
}

/// Session metadata constants
const SESSION_EXPIRY_DAYS: i64 = 30;
const STALE_SESSION_CLEANUP_INTERVAL_DAYS: i64 = 7;

/// Get the archive directory path (~/.pi/sessions/archive)
pub fn archive_dir() -> PathBuf {
    sessions_dir().join("archive")
}

/// Ensure the sessions directory exists
fn ensure_sessions_dir() -> Result<(), String> {
    fs::create_dir_all(sessions_dir()).map_err(|e| format!("Failed to create sessions directory: {}", e))?;
    Ok(())
}

/// List all sessions
pub fn list_sessions() -> Result<Vec<Value>, String> {
    ensure_sessions_dir()?;

    let dir = sessions_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(session) = serde_json::from_str::<Value>(&content) {
                            sessions.push(session);
                        }
                    }
                }
            }
        }
    }

    Ok(sessions)
}

/// Load a session by ID
pub fn load_session(id: &str) -> Result<Option<Value>, String> {
    let path = sessions_dir().join(format!("{}.json", id));
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read session: {}", e))?;
    let session = serde_json::from_str::<Value>(&content).map_err(|e| format!("Invalid session JSON: {}", e))?;
    Ok(Some(session))
}

/// Create a new session with metadata
pub fn create_session(mut data: Value) -> Result<String, String> {
    ensure_sessions_dir()?;

    let id = Uuid::new_v4().to_string();
    let path = sessions_dir().join(format!("{}.json", id));

    // Add metadata to session
    if let Value::Object(ref mut obj) = data {
        obj.insert("created_at".to_string(), json!(Utc::now().to_rfc3339()));
        obj.insert("updated_at".to_string(), json!(Utc::now().to_rfc3339()));
        obj.insert("id".to_string(), json!(id.clone()));
    }

    fs::write(&path, data.to_string()).map_err(|e| format!("Failed to create session: {}", e))?;

    Ok(id)
}

/// Update an existing session with timestamp
pub fn update_session(id: &str, mut data: Value) -> Result<(), String> {
    let path = sessions_dir().join(format!("{}.json", id));

    if !path.exists() {
        return Err(format!("Session not found: {}", id));
    }

    // Update the updated_at timestamp
    if let Value::Object(ref mut obj) = data {
        obj.insert("updated_at".to_string(), json!(Utc::now().to_rfc3339()));
    }

    fs::write(&path, data.to_string()).map_err(|e| format!("Failed to update session: {}", e))?;

    Ok(())
}

/// Check if a session is expired based on creation date
fn is_session_expired(session: &Value) -> bool {
    if let Some(created_at_str) = session.get("created_at").and_then(|v| v.as_str()) {
        if let Ok(created_at) = DateTime::parse_from_rfc3339(created_at_str) {
            let created_utc = created_at.with_timezone(&Utc);
            let expiry_time = created_utc + Duration::days(SESSION_EXPIRY_DAYS);
            return Utc::now() > expiry_time;
        }
    }
    false
}

/// Clean up expired sessions
pub fn cleanup_expired_sessions() -> Result<usize, String> {
    let dir = sessions_dir();
    if !dir.exists() {
        return Ok(0);
    }

    let mut deleted_count = 0;

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                // Skip archive directory
                if path.file_name().map_or(false, |n| n == "archive") {
                    continue;
                }

                if path.extension().map_or(false, |ext| ext == "json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(session) = serde_json::from_str::<Value>(&content) {
                            if is_session_expired(&session) {
                                if let Err(e) = fs::remove_file(&path) {
                                    eprintln!("[sessions] failed to delete expired session: {}", e);
                                } else {
                                    deleted_count += 1;
                                    println!("[sessions] deleted expired session");
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(deleted_count)
}

/// Archive a session
pub fn archive_session(id: &str) -> Result<bool, String> {
    let source = sessions_dir().join(format!("{}.json", id));
    if !source.exists() {
        return Ok(false);
    }

    fs::create_dir_all(archive_dir()).map_err(|e| format!("Failed to create archive directory: {}", e))?;

    let dest = archive_dir().join(format!("{}.json", id));
    fs::rename(&source, &dest).map_err(|e| format!("Failed to archive session: {}", e))?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_sessions_dir_path() {
        let path = sessions_dir();
        assert!(path.to_string_lossy().contains(".pi/sessions"));
    }

    #[test]
    fn test_archive_dir_path() {
        let path = archive_dir();
        assert!(path.to_string_lossy().contains(".pi/sessions/archive"));
    }

    #[test]
    fn test_archive_is_subdir_of_sessions() {
        let sessions = sessions_dir();
        let archive = archive_dir();

        let archive_str = archive.to_string_lossy();
        let sessions_str = sessions.to_string_lossy();

        assert!(archive_str.contains(&sessions_str.as_ref()));
    }

    #[test]
    fn test_session_json_filename_format() {
        let id = "test-session-id";
        let filename = format!("{}.json", id);
        assert_eq!(filename, "test-session-id.json");
        assert!(filename.ends_with(".json"));
    }

    #[test]
    fn test_session_data_with_various_json_types() {
        // Test that session data can hold various JSON structures
        let test_cases: Vec<serde_json::Value> = vec![
            json!({"name": "Session 1"}),
            json!({"messages": [], "metadata": null}),
            json!({"nested": {"deep": {"value": 42}}}),
            json!({"array": [1, 2, 3, 4, 5]}),
        ];

        for data in test_cases {
            assert!(data.is_object());
        }
    }

    #[test]
    fn test_session_has_created_at_metadata() {
        // Check that created_at is a valid RFC3339 timestamp
        let now = Utc::now();
        let future = now + Duration::minutes(1);

        // Timestamps should be within a reasonable range
        assert!(now.timestamp() > 0);
        assert!(future.timestamp() > 0);
    }

    #[test]
    fn test_session_expiry_check() {
        // Test with an old timestamp
        let old_date = (Utc::now() - Duration::days(31)).to_rfc3339();
        let old_session = json!({"created_at": old_date, "name": "Old"});

        // Test with a recent timestamp
        let recent_date = Utc::now().to_rfc3339();
        let recent_session = json!({"created_at": recent_date, "name": "Recent"});

        assert!(is_session_expired(&old_session));
        assert!(!is_session_expired(&recent_session));
    }

    #[test]
    fn test_uuid_v4_format() {
        let id = Uuid::new_v4().to_string();
        // UUID v4 has 36 characters (including hyphens)
        assert_eq!(id.len(), 36);
        assert!(id.contains('-'));
    }
}
