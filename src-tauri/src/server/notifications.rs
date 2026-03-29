use serde::{Serialize, Deserialize};
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use chrono::Local;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;

lazy_static::lazy_static! {
    /// Rate limiter for notifications (max 10 per minute per title)
    static ref NOTIFICATION_RATE_LIMITER: Arc<Mutex<HashMap<String, Vec<i64>>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

/// Notification entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub title: String,
    pub body: String,
    pub level: String, // "info", "warning", "error", "success"
    pub timestamp: String,
}

/// Notifications log file path: ~/.pi/notifications.log
fn notifications_log_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi/notifications.log")
}

/// Check if notification should be rate limited (max 10 per minute per title)
fn should_rate_limit(title: &str) -> bool {
    const MAX_NOTIFICATIONS_PER_MINUTE: usize = 10;
    const MINUTE_IN_SECS: i64 = 60;

    let now = chrono::Local::now().timestamp();
    let mut limiter = match NOTIFICATION_RATE_LIMITER.lock() {
        Ok(l) => l,
        Err(poisoned) => {
            eprintln!("[notifications] rate limiter mutex poisoned, recovering");
            poisoned.into_inner()
        }
    };

    let timestamps = limiter.entry(title.to_string()).or_insert_with(Vec::new);

    // Remove timestamps older than 1 minute
    timestamps.retain(|&ts| now - ts < MINUTE_IN_SECS);

    // Check if we've exceeded the limit
    if timestamps.len() >= MAX_NOTIFICATIONS_PER_MINUTE {
        return true;
    }

    // Add current timestamp
    timestamps.push(now);
    false
}

/// Send a desktop notification and log it
pub fn send_notification(
    title: &str,
    body: &str,
    level: &str,
) -> Result<String, String> {
    // Check rate limit
    if should_rate_limit(title) {
        return Err(format!(
            "Notification rate limit exceeded for '{}'. Max 10 per minute.",
            title
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let timestamp = Local::now().to_rfc3339();

    // Send desktop notification using notify-rust
    #[cfg(target_os = "macos")]
    {
        use notify_rust::Notification as DesktopNotification;
        let _ = DesktopNotification::new()
            .summary(title)
            .body(body)
            .show();
    }

    #[cfg(target_os = "linux")]
    {
        use notify_rust::Notification as DesktopNotification;
        let _ = DesktopNotification::new()
            .summary(title)
            .body(body)
            .show();
    }

    #[cfg(target_os = "windows")]
    {
        use notify_rust::Notification as DesktopNotification;
        let _ = DesktopNotification::new()
            .summary(title)
            .body(body)
            .show();
    }

    // Log to file
    log_notification(&Notification {
        id: id.clone(),
        title: title.to_string(),
        body: body.to_string(),
        level: level.to_string(),
        timestamp,
    })?;

    println!("[notifications] sent: {} - {}", level, title);
    Ok(id)
}

/// Log notification to file
fn log_notification(notification: &Notification) -> Result<(), String> {
    let path = notifications_log_path();

    // Create .pi directory if it doesn't exist
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create notifications directory: {}", e))?;
    }

    let entry = json!({
        "id": notification.id,
        "title": notification.title,
        "body": notification.body,
        "level": notification.level,
        "timestamp": notification.timestamp
    });

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open notifications log: {}", e))?;

    writeln!(file, "{}", entry.to_string())
        .map_err(|e| format!("Failed to write notification: {}", e))?;

    Ok(())
}

/// Get recent notifications
pub fn get_recent_notifications(limit: usize) -> Result<Vec<Notification>, String> {
    let path = notifications_log_path();

    if !path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read notifications log: {}", e))?;

    let mut notifications = Vec::new();

    for line in content.lines().rev().take(limit) {
        if let Ok(json) = serde_json::from_str::<Value>(line) {
            if let (Some(id), Some(title), Some(body), Some(level), Some(timestamp)) = (
                json.get("id").and_then(|v| v.as_str()),
                json.get("title").and_then(|v| v.as_str()),
                json.get("body").and_then(|v| v.as_str()),
                json.get("level").and_then(|v| v.as_str()),
                json.get("timestamp").and_then(|v| v.as_str()),
            ) {
                notifications.push(Notification {
                    id: id.to_string(),
                    title: title.to_string(),
                    body: body.to_string(),
                    level: level.to_string(),
                    timestamp: timestamp.to_string(),
                });
            }
        }
    }

    Ok(notifications)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_notification_creation() {
        let notif = Notification {
            id: "test-id".to_string(),
            title: "Test".to_string(),
            body: "Body".to_string(),
            level: "info".to_string(),
            timestamp: Local::now().to_rfc3339(),
        };

        assert_eq!(notif.title, "Test");
        assert_eq!(notif.level, "info");
    }

    #[test]
    fn test_notifications_path() {
        let path = notifications_log_path();
        assert!(path.to_string_lossy().contains(".pi"));
    }

    #[test]
    fn test_notification_serialization_roundtrip() {
        let notif = Notification {
            id: "abc-123".to_string(),
            title: "Agent complete".to_string(),
            body: "Task finished successfully".to_string(),
            level: "success".to_string(),
            timestamp: "2026-01-01T00:00:00+00:00".to_string(),
        };
        let json = serde_json::to_string(&notif).unwrap();
        let back: Notification = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "abc-123");
        assert_eq!(back.title, "Agent complete");
        assert_eq!(back.level, "success");
    }

    #[test]
    fn test_notifications_log_path_filename() {
        let path = notifications_log_path();
        assert_eq!(
            path.file_name().and_then(|n| n.to_str()),
            Some("notifications.log")
        );
    }

    #[test]
    fn test_notifications_log_path_under_home() {
        let path = notifications_log_path();
        let home = dirs::home_dir().unwrap();
        assert!(path.starts_with(&home));
    }

    #[test]
    fn test_get_recent_notifications_no_file() {
        // Should return empty vec when log file doesn't exist yet
        // (This is true in a fresh environment)
        let result = get_recent_notifications(10);
        assert!(result.is_ok());
    }

    #[test]
    fn test_rate_limit_allows_first_notification() {
        // First notification for a unique title should not be rate limited
        let unique_title = format!("test-title-{}", uuid::Uuid::new_v4());
        let limited = should_rate_limit(&unique_title);
        assert!(!limited, "first notification should not be rate limited");
    }

    #[test]
    fn test_rate_limit_blocks_after_max() {
        let unique_title = format!("burst-test-{}", uuid::Uuid::new_v4());
        // Send 10 — should all be allowed
        for _ in 0..10 {
            let limited = should_rate_limit(&unique_title);
            assert!(!limited);
        }
        // 11th should be rate limited
        let limited = should_rate_limit(&unique_title);
        assert!(limited, "11th notification should be rate limited");
    }
}
