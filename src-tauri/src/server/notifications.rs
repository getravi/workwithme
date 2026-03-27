use serde::{Serialize, Deserialize};
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use chrono::Local;

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

/// Send a desktop notification and log it
pub fn send_notification(
    title: &str,
    body: &str,
    level: &str,
) -> Result<String, String> {
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
}
