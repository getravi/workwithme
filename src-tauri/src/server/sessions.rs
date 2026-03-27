use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

/// Get the sessions directory path (~/.pi/sessions)
pub fn sessions_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    PathBuf::from(home).join(".pi/sessions")
}

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

/// Create a new session
pub fn create_session(data: Value) -> Result<String, String> {
    ensure_sessions_dir()?;

    let id = Uuid::new_v4().to_string();
    let path = sessions_dir().join(format!("{}.json", id));

    fs::write(&path, data.to_string()).map_err(|e| format!("Failed to create session: {}", e))?;

    Ok(id)
}

/// Update an existing session
pub fn update_session(id: &str, data: Value) -> Result<(), String> {
    let path = sessions_dir().join(format!("{}.json", id));

    if !path.exists() {
        return Err(format!("Session not found: {}", id));
    }

    fs::write(&path, data.to_string()).map_err(|e| format!("Failed to update session: {}", e))?;

    Ok(())
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
            json!({"id": "test1", "name": "Session 1"}),
            json!({"messages": [], "metadata": null}),
            json!({"nested": {"deep": {"value": 42}}}),
            json!({"array": [1, 2, 3, 4, 5]}),
        ];

        for data in test_cases {
            assert!(data.is_object());
        }
    }

    #[test]
    fn test_uuid_v4_format() {
        let id = Uuid::new_v4().to_string();
        // UUID v4 has 36 characters (including hyphens)
        assert_eq!(id.len(), 36);
        assert!(id.contains('-'));
    }
}
