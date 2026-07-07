//! HTTP endpoint handlers for the `sessions` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(rename = "includeArchived")]
    pub include_archived: Option<bool>,
}

#[derive(Deserialize)]
pub struct LoadRequest {
    pub path: String,
}

#[derive(Deserialize)]
pub struct ArchiveRequest {
    pub path: String,
    pub archived: bool,
}

/// List sessions. Returns a plain JSON array.
/// Accepts ?includeArchived=true to include archived sessions.
pub async fn list(Query(q): Query<ListQuery>) -> Json<serde_json::Value> {
    let include_archived = q.include_archived.unwrap_or(false);
    match sessions::list_sessions_all(include_archived) {
        Ok(session_list) => Json(serde_json::Value::Array(session_list)),
        Err(_) => Json(serde_json::Value::Array(vec![])),
    }
}

/// Load a session by absolute file path.
/// Returns { success, sessionId, messages, toolExecutions, cwd }.
pub async fn load(Json(req): Json<LoadRequest>) -> (StatusCode, Json<serde_json::Value>) {
    match sessions::load_session_by_path(&req.path) {
        Ok(Some(session)) => {
            let session_id = session.get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let cwd = session.get("cwd")
                .or_else(|| session.get("working_directory"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let messages = session.get("messages")
                .cloned()
                .unwrap_or(json!([]));
            let tool_executions = session.get("toolExecutions")
                .or_else(|| session.get("tool_executions"))
                .cloned()
                .unwrap_or(json!([]));

            (StatusCode::OK, Json(json!({
                "success": true,
                "sessionId": session_id,
                "messages": messages,
                "toolExecutions": tool_executions,
                "cwd": cwd
            })))
        }
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({
            "success": false,
            "error": "Session not found"
        }))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({
            "success": false,
            "error": e
        }))),
    }
}

/// Archive or unarchive a session by its absolute file path.
pub async fn archive_by_path(Json(req): Json<ArchiveRequest>) -> (StatusCode, Json<serde_json::Value>) {
    match sessions::set_archived_by_path(&req.path, req.archived) {
        Ok(true) => (StatusCode::OK, Json(json!({ "success": true }))),
        Ok(false) => (StatusCode::NOT_FOUND, Json(json!({
            "success": false,
            "error": "Session not found"
        }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "success": false,
            "error": e
        }))),
    }
}

/// Load a session by ID
pub async fn get(Path(id): Path<String>) -> Json<serde_json::Value> {
    match sessions::load_session(&id) {
        Ok(Some(session)) => {
            Json(json!({
                "success": true,
                "session": session
            }))
        }
        Ok(None) => {
            Json(json!({
                "success": false,
                "error": "Session not found"
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

/// Create a new session
pub async fn create(Json(data): Json<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
    match sessions::create_session(data) {
        Ok(id) => (
            StatusCode::CREATED,
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
        )
    }
}

/// Update a session
pub async fn update(Path(id): Path<String>, Json(data): Json<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
    match sessions::update_session(&id, data) {
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

/// Archive a session
pub async fn archive(Path(id): Path<String>) -> Json<serde_json::Value> {
    match sessions::archive_session(&id) {
        Ok(true) => {
            Json(json!({
                "success": true,
                "archived": true
            }))
        }
        Ok(false) => {
            Json(json!({
                "success": false,
                "error": "Session not found"
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
