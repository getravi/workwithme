use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::server::keychain;

/// OAuth provider information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthProvider {
    pub id: String,
    pub name: String,
    pub client_id: String,
    pub client_secret: String,
    pub auth_url: String,
    pub token_url: String,
    pub redirect_uri: String,
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
pub fn get_oauth_providers() -> Vec<HashMap<String, String>> {
    vec![
        {
            let mut m = HashMap::new();
            m.insert("id".to_string(), "google".to_string());
            m.insert("name".to_string(), "Google".to_string());
            m.insert("category".to_string(), "Core".to_string());
            m
        },
        {
            let mut m = HashMap::new();
            m.insert("id".to_string(), "github".to_string());
            m.insert("name".to_string(), "GitHub".to_string());
            m.insert("category".to_string(), "Core".to_string());
            m
        },
        {
            let mut m = HashMap::new();
            m.insert("id".to_string(), "microsoft".to_string());
            m.insert("name".to_string(), "Microsoft".to_string());
            m.insert("category".to_string(), "Enterprise".to_string());
            m
        },
        {
            let mut m = HashMap::new();
            m.insert("id".to_string(), "slack".to_string());
            m.insert("name".to_string(), "Slack".to_string());
            m.insert("category".to_string(), "Enterprise".to_string());
            m
        },
        {
            let mut m = HashMap::new();
            m.insert("id".to_string(), "stripe".to_string());
            m.insert("name".to_string(), "Stripe".to_string());
            m.insert("category".to_string(), "Finance".to_string());
            m
        },
    ]
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

impl OAuthCredentials {
    /// Check if access token has expired
    pub fn is_expired(&self) -> bool {
        match self.expires_at {
            Some(expires_at) => chrono::Local::now().timestamp() >= expires_at,
            None => false, // No expiration set, consider valid
        }
    }

    /// Check if token is expired or expiring soon (within 5 minutes)
    pub fn is_expiring_soon(&self) -> bool {
        match self.expires_at {
            Some(expires_at) => {
                let now = chrono::Local::now().timestamp();
                now >= expires_at - 300 // 5 minute buffer
            }
            None => false,
        }
    }

    /// Check if we can refresh this token
    pub fn can_refresh(&self) -> bool {
        self.refresh_token.is_some()
    }
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

/// Generate OAuth authorization URL
pub fn generate_authorization_url(provider_id: &str) -> Result<(String, String), String> {
    let config = get_provider_config(provider_id)
        .ok_or(format!(
            "OAuth provider '{}' not found. Supported providers: google, github, openai",
            provider_id
        ))?;

    if config.client_id.is_empty() || config.client_secret.is_empty() {
        return Err(format!(
            "OAuth credentials not configured for '{}'. Please set{}_CLIENT_ID and {}_CLIENT_SECRET environment variables.",
            provider_id,
            provider_id.to_uppercase(),
            provider_id.to_uppercase()
        ));
    }

    let state = generate_state();
    let scopes = get_provider_scopes(provider_id);

    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}",
        config.auth_url,
        urlencoding::encode(&config.client_id),
        urlencoding::encode(&config.redirect_uri),
        urlencoding::encode(&scopes),
        urlencoding::encode(&state)
    );

    Ok((auth_url, state))
}

/// Generate a random state parameter for CSRF protection
fn generate_state() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

/// Get provider-specific OAuth scopes
fn get_provider_scopes(provider_id: &str) -> String {
    match provider_id {
        "google" => "openid profile email".to_string(),
        "github" => "user:email read:user repo".to_string(),
        "microsoft" => "openid profile email offline_access".to_string(),
        "slack" => "admin".to_string(),
        "stripe" => "read_write".to_string(),
        _ => String::new(),
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
    #[allow(dead_code)]
    pub token_type: String,
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

/// Store OAuth credentials securely in keychain
pub fn store_credentials(creds: &OAuthCredentials) -> Result<(), String> {
    // Require user_id to prevent credential collisions
    let user_id = creds.user_id.as_ref()
        .ok_or("user_id required for credential storage".to_string())?;

    if user_id.is_empty() {
        return Err("user_id cannot be empty".to_string());
    }

    // Validate access token is not empty
    if creds.access_token.is_empty() {
        return Err("access_token cannot be empty".to_string());
    }

    // Validate provider is supported
    let valid_providers = vec!["google", "github", "microsoft", "slack", "stripe"];
    if !valid_providers.contains(&creds.provider.as_str()) {
        return Err(format!(
            "Invalid provider '{}'. Supported: {}",
            creds.provider,
            valid_providers.join(", ")
        ));
    }

    let key = format!("oauth_token_{}_{}", creds.provider, user_id);
    let json = serde_json::to_string(creds)
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;

    keychain::set(&key, &json)
}

/// Retrieve stored credentials from keychain
pub fn get_credentials(provider_id: &str, user_id: &str) -> Result<Option<OAuthCredentials>, String> {
    let key = format!("oauth_token_{}_{}", provider_id, user_id);

    match keychain::get(&key)? {
        Some(json) => {
            let creds = serde_json::from_str::<OAuthCredentials>(&json)
                .map_err(|e| format!("Failed to parse stored credentials: {}", e))?;
            Ok(Some(creds))
        }
        None => Ok(None),
    }
}

/// Refresh an access token using refresh token
pub async fn refresh_access_token(
    provider_id: &str,
    user_id: &str,
) -> Result<OAuthCredentials, String> {
    let mut creds = get_credentials(provider_id, user_id)?
        .ok_or("No stored credentials found".to_string())?;

    let refresh_token = creds.refresh_token.clone()
        .ok_or("No refresh token available".to_string())?;

    let config = get_provider_config(provider_id)
        .ok_or("Provider not found".to_string())?;

    let client = reqwest::Client::new();

    let mut params = HashMap::new();
    params.insert("grant_type", "refresh_token");
    params.insert("refresh_token", &refresh_token);
    params.insert("client_id", &config.client_id);
    params.insert("client_secret", &config.client_secret);

    let token_result: TokenResponse = client
        .post(&config.token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    creds.access_token = token_result.access_token.clone();
    creds.expires_at = token_result.expires_in.map(|secs| {
        chrono::Local::now().timestamp() + secs
    });

    if let Some(new_refresh) = token_result.refresh_token {
        creds.refresh_token = Some(new_refresh);
    }

    store_credentials(&creds)?;

    Ok(creds)
}

/// Delete stored credentials
pub fn delete_credentials(provider_id: &str, user_id: &str) -> Result<(), String> {
    let key = format!("oauth_token_{}_{}", provider_id, user_id);
    keychain::delete(&key)?;
    Ok(())
}

/// Store OAuth state with expiration (10 minutes default)
pub fn store_auth_state(provider_id: &str, state: &str) -> Result<(), String> {
    let now = chrono::Local::now().timestamp();
    let expires_at = now + 600; // 10 minutes

    let auth_state = AuthState {
        provider: provider_id.to_string(),
        state: state.to_string(),
        created_at: now,
        expires_at,
    };

    let key = format!("oauth_state_{}", state);
    let json = serde_json::to_string(&auth_state)
        .map_err(|e| format!("Failed to serialize auth state: {}", e))?;

    keychain::set(&key, &json)
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
        assert_eq!(providers.len(), 5);

        let provider_ids: Vec<_> = providers
            .iter()
            .filter_map(|p| p.get("id").map(|v| v.as_str()))
            .collect();

        assert!(provider_ids.contains(&"google"));
        assert!(provider_ids.contains(&"github"));
        assert!(provider_ids.contains(&"microsoft"));
        assert!(provider_ids.contains(&"slack"));
        assert!(provider_ids.contains(&"stripe"));
    }

    #[test]
    fn test_generate_state() {
        let state1 = generate_state();
        let state2 = generate_state();

        assert_eq!(state1.len(), 32);
        assert_eq!(state2.len(), 32);
        assert_ne!(state1, state2); // States should be different (with high probability)
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
    fn test_scopes_generation() {
        let google_scopes = get_provider_scopes("google");
        assert!(google_scopes.contains("openid"));
        assert!(google_scopes.contains("profile"));
        assert!(google_scopes.contains("email"));

        let github_scopes = get_provider_scopes("github");
        assert!(github_scopes.contains("user:email"));
        assert!(github_scopes.contains("read:user"));

        let unknown_scopes = get_provider_scopes("unknown");
        assert!(unknown_scopes.is_empty());
    }

    #[test]
    fn test_token_response_parsing() {
        let json = r#"{
            "access_token": "test_access",
            "token_type": "Bearer",
            "expires_in": 3600
        }"#;

        let token: TokenResponse = serde_json::from_str(json).unwrap();
        assert_eq!(token.access_token, "test_access");
        assert_eq!(token.token_type, "Bearer");
        assert_eq!(token.expires_in, Some(3600));
        assert!(token.refresh_token.is_none());
    }
}
