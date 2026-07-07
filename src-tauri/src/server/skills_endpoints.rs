//! HTTP endpoint handlers for the `skills` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;

/// List all skills
pub async fn list() -> Json<serde_json::Value> {
    let skills = skills::list_skills();
    Json(json!({
        "skills": skills
    }))
}

/// Get skill details
pub async fn get(Path((source, slug)): Path<(String, String)>) -> Json<serde_json::Value> {
    match skills::get_skill_content(&source, &slug) {
        Some(content) => {
            Json(json!({
                "success": true,
                "content": content
            }))
        }
        None => {
            Json(json!({
                "success": false,
                "error": "Skill not found"
            }))
        }
    }
}
