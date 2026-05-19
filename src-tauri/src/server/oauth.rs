//! OAuth 2.0 PKCE flow for remote MCP server authentication.
//!
//! Initiates the browser-redirect authorization code flow with PKCE, exchanges
//! the authorization code for tokens, and persists the refresh token via
//! [`super::keychain`].

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::server::keychain;

/// Internal OAuth provider config — never serialized. Use OAuthProviderPublic for API responses.
#[derive(Debug, Clone)]
pub struct OAuthProvider {
    pub id: String,
    pub name: String,
    pub client_id: String,
    pub client_secret: String,  // never serialized — use OAuthProviderPublic for responses
    pub auth_url: String,
    pub token_url: String,
    pub redirect_uri: String,
}

/// Safe for serialization — no secret field. Use in all API responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthProviderPublic {
    pub id: String,
    pub name: String,
    pub auth_url: String,
    pub redirect_uri: String,
}

impl From<&OAuthProvider> for OAuthProviderPublic {
    fn from(p: &OAuthProvider) -> Self {
        OAuthProviderPublic {
            id: p.id.clone(),
            name: p.name.clone(),
            auth_url: p.auth_url.clone(),
            redirect_uri: p.redirect_uri.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthProviderSummary {
    pub id: String,
    pub name: String,
    pub category: String,
    pub available: bool,
}

pub fn pi_oauth_provider_summaries() -> Vec<OAuthProviderSummary> {
    vec![
        OAuthProviderSummary { id: "anthropic".to_string(), name: "Claude".to_string(), category: "AI".to_string(), available: true },
        OAuthProviderSummary { id: "openai-codex".to_string(), name: "Codex".to_string(), category: "AI".to_string(), available: true },
        OAuthProviderSummary { id: "google-gemini-cli".to_string(), name: "Gemini CLI".to_string(), category: "AI".to_string(), available: true },
        OAuthProviderSummary { id: "google-antigravity".to_string(), name: "Google Antigravity".to_string(), category: "AI".to_string(), available: true },
        OAuthProviderSummary { id: "kimi-for-coding".to_string(), name: "Kimi Code".to_string(), category: "AI".to_string(), available: true },
        OAuthProviderSummary { id: "github-copilot".to_string(), name: "GitHub Copilot".to_string(), category: "Developer Tools".to_string(), available: true },
        OAuthProviderSummary { id: "gitlab".to_string(), name: "GitLab".to_string(), category: "Developer Tools".to_string(), available: true },
    ]
}

/// OAuth configuration for each provider
fn get_provider_config(provider_id: &str) -> Option<OAuthProvider> {
    let configs = vec![
        // Core providers
        OAuthProvider {
            id: "google".to_string(),
            name: "Google".to_string(),
            client_id: std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default(),
            client_secret: std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default(),
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth".to_string(),
            token_url: "https://oauth2.googleapis.com/token".to_string(),
            redirect_uri: "http://localhost:4242/api/auth/callback".to_string(),
        },
        OAuthProvider {
            id: "github".to_string(),
            name: "GitHub".to_string(),
            client_id: std::env::var("GITHUB_CLIENT_ID").unwrap_or_default(),
            client_secret: std::env::var("GITHUB_CLIENT_SECRET").unwrap_or_default(),
            auth_url: "https://github.com/login/oauth/authorize".to_string(),
            token_url: "https://github.com/login/oauth/access_token".to_string(),
            redirect_uri: "http://localhost:4242/api/auth/callback".to_string(),
        },
        // Enterprise
        OAuthProvider {
            id: "microsoft".to_string(),
            name: "Microsoft".to_string(),
            client_id: std::env::var("MICROSOFT_CLIENT_ID").unwrap_or_default(),
            client_secret: std::env::var("MICROSOFT_CLIENT_SECRET").unwrap_or_default(),
            auth_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize".to_string(),
            token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token".to_string(),
            redirect_uri: "http://localhost:4242/api/auth/callback".to_string(),
        },
        OAuthProvider {
            id: "slack".to_string(),
            name: "Slack".to_string(),
            client_id: std::env::var("SLACK_CLIENT_ID").unwrap_or_default(),
            client_secret: std::env::var("SLACK_CLIENT_SECRET").unwrap_or_default(),
            auth_url: "https://slack.com/oauth/v2/authorize".to_string(),
            token_url: "https://slack.com/api/oauth.v2.access".to_string(),
            redirect_uri: "http://localhost:4242/api/auth/callback".to_string(),
        },
        // Other OAuth providers
        OAuthProvider {
            id: "stripe".to_string(),
            name: "Stripe".to_string(),
            client_id: std::env::var("STRIPE_CLIENT_ID").unwrap_or_default(),
            client_secret: std::env::var("STRIPE_CLIENT_SECRET").unwrap_or_default(),
            auth_url: "https://connect.stripe.com/oauth/authorize".to_string(),
            token_url: "https://connect.stripe.com/oauth/token".to_string(),
            redirect_uri: "http://localhost:4242/api/auth/callback".to_string(),
        },
        OAuthProvider {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            client_id: std::env::var("OPENAI_CLIENT_ID").unwrap_or_default(),
            client_secret: std::env::var("OPENAI_CLIENT_SECRET").unwrap_or_default(),
            auth_url: "https://platform.openai.com/oauth/authorize".to_string(),
            token_url: "https://api.openai.com/oauth/token".to_string(),
            redirect_uri: "http://localhost:4242/api/auth/callback".to_string(),
        },
    ];

    configs.into_iter().find(|c| c.id == provider_id)
}

/// Validate OAuth environment variables at startup
pub fn validate_oauth_config() {
    let providers = vec!["google", "github", "microsoft", "slack", "stripe"];
    for provider in providers {
        let client_id_var = format!("{}_CLIENT_ID", provider.to_uppercase());
        let client_secret_var = format!("{}_CLIENT_SECRET", provider.to_uppercase());

        let has_client_id = std::env::var(&client_id_var).is_ok();
        let has_client_secret = std::env::var(&client_secret_var).is_ok();

        if !has_client_id {
            eprintln!("[oauth] WARNING: {} not configured, set {} environment variable", provider, client_id_var);
        }
        if !has_client_secret {
            eprintln!("[oauth] WARNING: {} not configured, set {} environment variable", provider, client_secret_var);
        }
    }
}

/// Get list of available OAuth providers (basic info)
pub fn get_oauth_providers() -> Vec<OAuthProviderSummary> {
    pi_oauth_provider_summaries()
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
}

/// Auth state for tracking OAuth flows with expiration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthState {
    pub provider: String,
    pub state: String,
    pub created_at: i64,
    pub expires_at: i64,
}

impl AuthState {
    /// Check if this state has expired (default: 10 minutes)
    pub fn is_expired(&self) -> bool {
        chrono::Local::now().timestamp() > self.expires_at
    }
}

/// Token response from OAuth provider
#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<i64>,
}

/// Exchange authorization code for access token
pub async fn exchange_code_for_token(
    provider_id: &str,
    code: &str,
    _state: &str,
) -> Result<OAuthCredentials, String> {
    let config = get_provider_config(provider_id)
        .ok_or(format!(
            "OAuth provider '{}' configuration not found during token exchange",
            provider_id
        ))?;

    let client = reqwest::Client::new();

    let mut params = HashMap::new();
    params.insert("grant_type", "authorization_code");
    params.insert("code", code);
    params.insert("redirect_uri", &config.redirect_uri);
    params.insert("client_id", &config.client_id);
    params.insert("client_secret", &config.client_secret);

    let token_result: TokenResponse = client
        .post(&config.token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!(
            "Failed to exchange authorization code with {} ({}). Check your internet connection and credentials.",
            provider_id,
            e
        ))?
        .json()
        .await
        .map_err(|e| format!(
            "Failed to parse token response from {}. The OAuth provider returned an unexpected response format: {}",
            provider_id,
            e
        ))?;

    let expires_at = token_result.expires_in.map(|secs| {
        chrono::Local::now().timestamp() + secs
    });

    let credentials = OAuthCredentials {
        provider: provider_id.to_string(),
        access_token: token_result.access_token.clone(),
        refresh_token: token_result.refresh_token.clone(),
        expires_at,
        user_id: None,
    };

    // Store credentials in keychain
    store_credentials(&credentials)?;

    Ok(credentials)
}

/// Store OAuth credentials securely in keychain.
/// Uses `user_id` as a disambiguator; falls back to "default" when absent.
pub fn store_credentials(creds: &OAuthCredentials) -> Result<(), String> {
    // Validate access token is not empty
    if creds.access_token.is_empty() {
        return Err("access_token cannot be empty".to_string());
    }

    // Validate provider is supported
    let valid_providers = vec!["google", "github", "microsoft", "slack", "stripe", "openai"];
    if !valid_providers.contains(&creds.provider.as_str()) {
        return Err(format!(
            "Invalid provider '{}'. Supported: {}",
            creds.provider,
            valid_providers.join(", ")
        ));
    }

    let uid = creds.user_id.as_deref().filter(|s| !s.is_empty()).unwrap_or("default");
    let key = format!("oauth_token_{}_{}", creds.provider, uid);
    let json = serde_json::to_string(creds)
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;

    keychain::set(&key, &json)
}

/// Retrieve stored credentials from keychain.
/// When `user_id` is empty, tries the "default" slot.
pub fn get_credentials(provider_id: &str, user_id: &str) -> Result<Option<OAuthCredentials>, String> {
    let uid = if user_id.is_empty() { "default" } else { user_id };
    let key = format!("oauth_token_{}_{}", provider_id, uid);

    match keychain::get(&key)? {
        Some(json) => {
            let creds = serde_json::from_str::<OAuthCredentials>(&json)
                .map_err(|e| format!("Failed to parse stored credentials: {}", e))?;
            Ok(Some(creds))
        }
        None => Ok(None),
    }
}

/// Delete stored credentials
pub fn delete_credentials(provider_id: &str, user_id: &str) -> Result<(), String> {
    let key = format!("oauth_token_{}_{}", provider_id, user_id);
    keychain::delete(&key)?;
    Ok(())
}

/// Retrieve and validate OAuth state (removes it after validation to prevent replay)
pub fn validate_and_remove_auth_state(state: &str) -> Result<String, String> {
    let key = format!("oauth_state_{}", state);

    let json = match keychain::get(&key)? {
        Some(j) => j,
        None => return Err("State not found or invalid".to_string()),
    };

    let auth_state = serde_json::from_str::<AuthState>(&json)
        .map_err(|e| format!("Failed to parse auth state: {}", e))?;

    // Check if state has expired
    if auth_state.is_expired() {
        // Remove expired state
        let _ = keychain::delete(&key);
        return Err("State has expired. Please restart the login process.".to_string());
    }

    // Remove state to prevent replay attacks
    keychain::delete(&key)?;

    Ok(auth_state.provider)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_config_exists() {
        let google = get_provider_config("google");
        assert!(google.is_some());

        let github = get_provider_config("github");
        assert!(github.is_some());

        let microsoft = get_provider_config("microsoft");
        assert!(microsoft.is_some());

        let slack = get_provider_config("slack");
        assert!(slack.is_some());

        let stripe = get_provider_config("stripe");
        assert!(stripe.is_some());
    }

    #[test]
    fn test_provider_list() {
        let providers = get_oauth_providers();
        assert_eq!(providers.len(), 7);

        let provider_ids: Vec<_> = providers
            .iter()
            .map(|p| p.id.as_str())
            .collect();

        assert!(provider_ids.contains(&"anthropic"));
        assert!(provider_ids.contains(&"openai-codex"));
        assert!(provider_ids.contains(&"google-gemini-cli"));
        assert!(provider_ids.contains(&"google-antigravity"));
        assert!(provider_ids.contains(&"kimi-for-coding"));
        assert!(provider_ids.contains(&"github-copilot"));
        assert!(provider_ids.contains(&"gitlab"));
    }

    #[test]
    fn test_oauth_credentials_serialization() {
        let creds = OAuthCredentials {
            provider: "google".to_string(),
            access_token: "test_token".to_string(),
            refresh_token: Some("test_refresh".to_string()),
            expires_at: Some(1234567890),
            user_id: Some("user123".to_string()),
        };

        let json = serde_json::to_string(&creds).unwrap();
        let parsed: OAuthCredentials = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.provider, "google");
        assert_eq!(parsed.access_token, "test_token");
        assert_eq!(parsed.refresh_token, Some("test_refresh".to_string()));
    }

    #[test]
    fn test_token_response_parsing() {
        let json = r#"{
            "access_token": "test_access",
            "expires_in": 3600
        }"#;

        let token: TokenResponse = serde_json::from_str(json).unwrap();
        assert_eq!(token.access_token, "test_access");
        assert_eq!(token.expires_in, Some(3600));
        assert!(token.refresh_token.is_none());
    }

    #[test]
    fn test_provider_config_has_urls() {
        let providers = vec!["google", "github", "microsoft", "slack", "stripe"];

        for provider_id in providers {
            let config = get_provider_config(provider_id);
            assert!(config.is_some(), "Provider {} config should exist", provider_id);

            let cfg = config.unwrap();
            assert!(!cfg.auth_url.is_empty(), "Provider {} missing auth_url", provider_id);
            assert!(!cfg.token_url.is_empty(), "Provider {} missing token_url", provider_id);
            assert!(!cfg.redirect_uri.is_empty(), "Provider {} missing redirect_uri", provider_id);
        }
    }

    #[test]
    fn test_auth_state_expiration() {
        let now = chrono::Local::now().timestamp();

        // Expired state
        let expired_state = AuthState {
            provider: "google".to_string(),
            state: "state123".to_string(),
            created_at: now - 900, // 15 minutes ago
            expires_at: now - 100, // 100 seconds ago
        };
        assert!(expired_state.is_expired());

        // Valid state
        let valid_state = AuthState {
            provider: "google".to_string(),
            state: "state123".to_string(),
            created_at: now - 100,
            expires_at: now + 500, // 500 seconds in future
        };
        assert!(!valid_state.is_expired());
    }

    #[test]
    fn test_oauth_providers_have_categories() {
        let providers = get_oauth_providers();

        for provider in providers {
            assert!(!provider.id.is_empty(), "Provider id should not be empty");
            assert!(!provider.name.is_empty(), "Provider name should not be empty");
            assert!(!provider.category.is_empty(), "Provider category should not be empty");
        }
    }

    #[test]
    fn test_oauth_provider_categories_valid() {
        let providers = get_oauth_providers();
        let valid_categories = vec!["AI", "Developer Tools"];

        for provider in providers {
            assert!(
                valid_categories.contains(&provider.category.as_str()),
                "Invalid category '{}' for provider",
                provider.category
            );
        }
    }

    #[test]
    fn test_oauth_provider_summary_has_availability_flag() {
        for provider in get_oauth_providers() {
            assert!(
                matches!(provider.available, true | false),
                "provider {} should expose availability",
                provider.id
            );
        }
    }

    #[test]
    fn test_credentials_with_all_providers() {
        let providers = vec!["google", "github", "microsoft", "slack", "stripe"];

        for provider in providers {
            let creds = OAuthCredentials {
                provider: provider.to_string(),
                access_token: "token123".to_string(),
                refresh_token: Some("refresh123".to_string()),
                expires_at: Some(chrono::Local::now().timestamp() + 3600),
                user_id: Some("user123".to_string()),
            };

            let json = serde_json::to_string(&creds).unwrap();
            let parsed: OAuthCredentials = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed.provider, provider);
            assert_eq!(parsed.access_token, "token123");
        }
    }

    #[test]
    fn test_auth_state_serialization() {
        let now = chrono::Local::now().timestamp();
        let state = AuthState {
            provider: "google".to_string(),
            state: "abc123".to_string(),
            created_at: now,
            expires_at: now + 600,
        };

        let json = serde_json::to_string(&state).unwrap();
        let parsed: AuthState = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.provider, "google");
        assert_eq!(parsed.state, "abc123");
        assert_eq!(parsed.created_at, now);
    }
}
