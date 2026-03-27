use serde::{Deserialize, Serialize};

/// OAuth provider information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthProvider {
    pub id: String,
    pub name: String,
}

/// Get list of available OAuth providers
pub fn get_oauth_providers() -> Vec<OAuthProvider> {
    vec![
        OAuthProvider {
            id: "anthropic".to_string(),
            name: "Anthropic".to_string(),
        },
        OAuthProvider {
            id: "google".to_string(),
            name: "Google".to_string(),
        },
        OAuthProvider {
            id: "github".to_string(),
            name: "GitHub".to_string(),
        },
        OAuthProvider {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
        },
    ]
}

/// Get a specific OAuth provider
pub fn get_oauth_provider(provider_id: &str) -> Option<OAuthProvider> {
    get_oauth_providers()
        .into_iter()
        .find(|p| p.id == provider_id)
}

/// OAuth credentials returned after successful authentication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthCredentials {
    pub provider: String,
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

/// Auth instructions for user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthInstructions {
    pub url: String,
    pub instructions: String,
}
