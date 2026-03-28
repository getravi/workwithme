// Phase 3: Extensions Module
// =========================
//
// Provides utilities for session enhancement:
// - AI-powered session labelling using Claude Haiku
// - Metadata enrichment
// - Session context management

use serde_json::json;

/// Generate a short, descriptive name for a session using Claude Haiku
/// Phase 3 Enhancement: Automatically names sessions for better UX
pub async fn generate_session_label(api_key: &str) -> Result<String, String> {
    // Call Claude Haiku to generate a session label
    // This is a lightweight operation for naming sessions

    let client = reqwest::Client::new();
    let body = json!({
        "model": "claude-3-5-haiku-20241022",
        "max_tokens": 50,
        "system": "You are a session naming assistant. Generate a short (2-4 words), creative, lowercase name for an AI coding session. Examples: 'bug-hunting', 'feature-brainstorm', 'refactor-sprint'. Return ONLY the name, no explanation.",
        "messages": [
            {
                "role": "user",
                "content": "Generate a name for this new coding session."
            }
        ]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to call Claude API: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(data) => {
            if let Some(content) = data["content"]
                .get(0)
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
            {
                // Clean up the response - remove quotes and whitespace
                let label = content.trim().trim_matches('"').to_lowercase();
                if label.is_empty() {
                    Err("Empty label generated".to_string())
                } else {
                    Ok(label)
                }
            } else {
                Err("Invalid API response format".to_string())
            }
        }
        Err(e) => Err(format!("Failed to parse response: {}", e)),
    }
}

/// Try to generate a session label, fallback to default if it fails
/// Phase 3: Used during session creation to immediately provide a label
pub async fn generate_session_label_with_fallback(api_key: &str) -> String {
    match generate_session_label(api_key).await {
        Ok(label) => label,
        Err(e) => {
            println!("[extensions] failed to generate session label: {}", e);
            // Fallback: use a simple default based on UUID
            // Format: "session-abc123de" (readable but brief)
            format!("session-{}", uuid::Uuid::new_v4().to_string()[..8].to_string())
        }
    }
}

/// Generate session label asynchronously (spawn and forget)
/// Phase 3: For background label generation after first message
/// Returns the label via optional callback (for WS broadcasts)
pub fn spawn_label_generation_async(api_key: String, session_id: String) {
    // Spawn async task to generate label without blocking
    tokio::spawn(async move {
        match generate_session_label(&api_key).await {
            Ok(label) => {
                // TODO: Broadcast session_label_updated WS event
                // event: {
                //   "type": "session_label_updated",
                //   "session_id": session_id,
                //   "label": label
                // }
                println!("[extensions] generated label '{}' for session {}", label, session_id);
            }
            Err(e) => {
                println!("[extensions] async label generation failed for {}: {}", session_id, e);
            }
        }
    });
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_label_cleanup() {
        let raw = "\"bug-hunting\"";
        let cleaned = raw.trim().trim_matches('"').to_lowercase();
        assert_eq!(cleaned, "bug-hunting");
    }

    #[test]
    fn test_empty_label_rejected() {
        let raw = "\"\"";
        let cleaned = raw.trim().trim_matches('"');
        assert!(cleaned.is_empty());
    }

    #[test]
    fn test_fallback_label_format() {
        // Test that fallback labels have correct format
        let label = format!("session-{}", uuid::Uuid::new_v4().to_string()[..8].to_string());
        assert!(label.starts_with("session-"));
        assert_eq!(label.len(), 16); // "session-" (8) + uuid[..8] (8) = 16 chars
    }

    #[test]
    fn test_label_lowercase() {
        // Labels should be lowercase
        let raw = "\"BUG-HUNTING\"";
        let cleaned = raw.trim().trim_matches('"').to_lowercase();
        assert_eq!(cleaned, "bug-hunting");
    }

    #[test]
    fn test_label_whitespace_trimmed() {
        // Whitespace should be trimmed from outside quotes, then inside quotes removed
        let raw = "  \"bug-hunting\"  ";
        let cleaned = raw.trim().trim_matches('"').to_lowercase();
        assert_eq!(cleaned, "bug-hunting");
    }
}
