use serde_json::{json, Value};
use crate::server::db;

/// Search sessions by label/metadata
pub async fn search_sessions(query: &str) -> Result<Vec<Value>, String> {
    let pool = db::get_pool().await?;

    let rows = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT id, label, created_at, status FROM sessions WHERE label LIKE ? OR id LIKE ? LIMIT 50"
    )
    .bind(format!("%{}%", query))
    .bind(format!("%{}%", query))
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to search sessions: {}", e))?;

    let results = rows
        .into_iter()
        .map(|(id, label, created_at, status)| {
            json!({
                "id": id,
                "label": label,
                "created_at": created_at,
                "status": status
            })
        })
        .collect();

    Ok(results)
}

/// Get paginated sessions list
pub async fn list_sessions_paginated(
    limit: i64,
    offset: i64,
    archived: bool,
) -> Result<(Vec<Value>, i64), String> {
    let pool = db::get_pool().await?;

    // Get total count
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sessions WHERE archived = ?"
    )
    .bind(if archived { 1 } else { 0 })
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Failed to count sessions: {}", e))?;

    // Get paginated results
    let rows = sqlx::query_as::<_, (String, String, String, String, i32)>(
        "SELECT id, label, created_at, updated_at, archived FROM sessions WHERE archived = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?"
    )
    .bind(if archived { 1 } else { 0 })
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch sessions: {}", e))?;

    let sessions = rows
        .into_iter()
        .map(|(id, label, created_at, updated_at, _)| {
            json!({
                "id": id,
                "label": label,
                "created_at": created_at,
                "updated_at": updated_at
            })
        })
        .collect();

    Ok((sessions, count))
}

/// Get audit events within date range
pub async fn get_audit_events_by_date(
    start_date: &str,
    end_date: &str,
    limit: i64,
) -> Result<Vec<Value>, String> {
    let pool = db::get_pool().await?;

    let rows = sqlx::query_as::<_, (String, String, String)>(
        "SELECT event_type, details, timestamp FROM audit_events WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp DESC LIMIT ?"
    )
    .bind(start_date)
    .bind(end_date)
    .bind(limit)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch audit events: {}", e))?;

    let events = rows
        .into_iter()
        .map(|(event_type, details_str, timestamp)| {
            let details = serde_json::from_str::<Value>(&details_str)
                .unwrap_or_else(|_| json!({}));
            json!({
                "event_type": event_type,
                "details": details,
                "timestamp": timestamp
            })
        })
        .collect();

    Ok(events)
}

/// Get tool usage analytics
pub async fn get_tool_analytics() -> Result<Value, String> {
    let pool = db::get_pool().await?;

    let usage = sqlx::query_as::<_, (String, i64)>(
        "SELECT tool_name, COUNT(*) as count FROM tools_executed GROUP BY tool_name ORDER BY count DESC"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch tool analytics: {}", e))?;

    let analytics = usage
        .into_iter()
        .map(|(tool, count)| json!({ "tool": tool, "count": count }))
        .collect::<Vec<_>>();

    Ok(json!({
        "tools": analytics,
        "total": analytics.len()
    }))
}

/// Get session statistics
pub async fn get_session_stats() -> Result<Value, String> {
    let pool = db::get_pool().await?;

    let (total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sessions")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to count sessions: {}", e))?;

    let (active,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sessions WHERE archived = 0")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to count active sessions: {}", e))?;

    let (archived,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sessions WHERE archived = 1")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to count archived sessions: {}", e))?;

    let (messages,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM messages")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to count messages: {}", e))?;

    Ok(json!({
        "total_sessions": total,
        "active_sessions": active,
        "archived_sessions": archived,
        "total_messages": messages,
        "avg_messages_per_session": if total > 0 { messages / total } else { 0 }
    }))
}

/// Pause a session (mark as paused state)
pub async fn pause_session(session_id: &str) -> Result<(), String> {
    let pool = db::get_pool().await?;

    sqlx::query("UPDATE sessions SET status = 'paused', updated_at = ? WHERE id = ?")
        .bind(chrono::Local::now().to_rfc3339())
        .bind(session_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to pause session: {}", e))?;

    Ok(())
}

/// Resume a session
pub async fn resume_session(session_id: &str) -> Result<(), String> {
    let pool = db::get_pool().await?;

    sqlx::query("UPDATE sessions SET status = 'active', updated_at = ? WHERE id = ?")
        .bind(chrono::Local::now().to_rfc3339())
        .bind(session_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to resume session: {}", e))?;

    Ok(())
}

/// Delete session (full removal from database)
pub async fn delete_session(session_id: &str) -> Result<bool, String> {
    let pool = db::get_pool().await?;

    // Delete related records first (cascade)
    let _ = sqlx::query("DELETE FROM messages WHERE session_id = ?")
        .bind(session_id)
        .execute(&pool)
        .await;

    let _ = sqlx::query("DELETE FROM tools_executed WHERE session_id = ?")
        .bind(session_id)
        .execute(&pool)
        .await;

    // Delete session
    let result = sqlx::query("DELETE FROM sessions WHERE id = ?")
        .bind(session_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to delete session: {}", e))?;

    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_analytics_json() {
        let analytics = json!({
            "tools": [
                { "tool": "bash", "count": 5 },
                { "tool": "read_file", "count": 3 }
            ],
            "total": 2
        });

        assert_eq!(analytics.get("total").and_then(|v| v.as_u64()), Some(2));
    }
}
