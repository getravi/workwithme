//! HTTP endpoint handlers for the `notifications` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

#[derive(Deserialize)]
pub struct NotificationRequest {
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub level: String,
}

/// Send a notification
pub async fn send(Json(req): Json<NotificationRequest>) -> (StatusCode, Json<serde_json::Value>) {
    let level = if req.level.is_empty() {
        "info"
    } else {
        &req.level
    };

    match notifications::send_notification(&req.title, &req.body, level) {
        Ok(id) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "id": id
            }))
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "error": e
            }))
        ),
    }
}

/// Get recent notifications
pub async fn list() -> Json<serde_json::Value> {
    match notifications::get_recent_notifications(50) {
        Ok(notifs) => {
            Json(json!({
                "success": true,
                "notifications": notifs
            }))
        }
        Err(e) => {
            Json(json!({
                "success": false,
                "error": e
            }))
        }
    }
}
