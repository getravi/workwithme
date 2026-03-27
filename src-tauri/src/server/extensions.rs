use serde_json::json;

/// Generate a short, descriptive name for a session using Claude Haiku
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
pub async fn generate_session_label_with_fallback(api_key: &str) -> String {
    match generate_session_label(api_key).await {
        Ok(label) => label,
        Err(e) => {
            println!("[extensions] failed to generate session label: {}", e);
            // Fallback: use a simple default
            format!("session-{}", uuid::Uuid::new_v4().to_string()[..8].to_string())
        }
    }
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
}
