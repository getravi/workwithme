//! HTTP endpoint handlers for the `audit` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

#[derive(Deserialize)]
pub struct AuditLogRequest {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub details: Option<serde_json::Value>,
}

/// Log an audit event
pub async fn log(Json(req): Json<AuditLogRequest>) -> (StatusCode, Json<serde_json::Value>) {
    match audit::log_event(&req.event_type, req.details) {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "success": true
            }))
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "error": e
            }))
        )
    }
}
