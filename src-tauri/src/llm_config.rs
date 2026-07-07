//! LLM provider configuration and HTTP call helpers.
//!
//! Config is persisted as JSON at `~/.pi/llm_config.json` and loaded on each
//! Tauri command call.  The API key is stored separately in the system keychain
//! under the service name `"workwithme"`.
//!
//! # SSRF protection
//! [`validate_base_url`] rejects non-localhost `http://` base URLs to prevent
//! server-side request forgery against cloud metadata services (169.254.x.x,
//! internal VPC endpoints, etc.).

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use crate::voice_db;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LlmProvider {
    Anthropic,
    OpenAiCompatible,
}

impl Default for LlmProvider {
    fn default() -> Self {
        LlmProvider::Anthropic
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub provider: LlmProvider,
    /// Base URL (no trailing slash). For Anthropic: "https://api.anthropic.com/v1"
    /// For OpenAI: "https://api.openai.com/v1". For Ollama: "http://localhost:11434/v1"
    pub base_url: String,
    /// Model name e.g. "claude-sonnet-4-6", "gpt-4o", "llama3"
    pub model: String,
    /// Keychain key name for the API key (stored under service "workwithme")
    pub api_key_name: String,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            provider: LlmProvider::Anthropic,
            base_url: "https://api.anthropic.com/v1".to_string(),
            model: "claude-sonnet-4-6".to_string(),
            api_key_name: "anthropic-api-key".to_string(),
        }
    }
}

/// Shared HTTP client — creating a new Client per call is expensive (allocates a connection
/// pool, DNS resolver, and TLS context).  One client reused across all LLM calls is correct.
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(reqwest::Client::new)
}

/// Attach the provider's authentication headers to an outbound request.
/// Anthropic uses `x-api-key` + a version header; OpenAI-compatible uses a
/// bearer token (omitted when the key is empty, e.g. a local Ollama server).
fn apply_auth(
    req: reqwest::RequestBuilder,
    config: &LlmConfig,
    api_key: &str,
) -> reqwest::RequestBuilder {
    match config.provider {
        LlmProvider::Anthropic => req
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01"),
        LlmProvider::OpenAiCompatible if api_key.is_empty() => req,
        LlmProvider::OpenAiCompatible => req.header("Authorization", format!("Bearer {api_key}")),
    }
}

/// Validate that `base_url` is an acceptable origin for outbound LLM requests.
/// Only https:// is allowed for remote hosts; http:// is permitted only for the
/// loopback host to prevent SSRF against cloud metadata endpoints or other
/// internal services.
///
/// The URL is parsed (not prefix-matched) so hostile hosts like
/// `http://localhost.evil.com` or `http://127.0.0.1.evil.com` cannot slip past a
/// naive `starts_with` check.
fn validate_base_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid base_url '{url}': {e}"))?;
    match (parsed.scheme(), parsed.host_str()) {
        ("https", _) => Ok(()),
        ("http", Some("localhost" | "127.0.0.1" | "[::1]" | "::1")) => Ok(()),
        _ => Err(format!(
            "base_url must use https:// or http://localhost (got: {url})"
        )),
    }
}

fn config_path() -> std::path::PathBuf {
    voice_db::voice_dir().join("llm_config.json")
}

/// Read LLM config from disk, falling back to defaults.
pub fn load_config() -> LlmConfig {
    load_config_from(&config_path())
}

/// Persist LLM config to disk.
pub fn save_config(config: &LlmConfig) -> Result<(), String> {
    save_config_to(&config_path(), config)
}

fn load_config_from(path: &std::path::Path) -> LlmConfig {
    match std::fs::read_to_string(path) {
        Ok(s) => match serde_json::from_str(&s) {
            Ok(cfg) => cfg,
            Err(e) => {
                eprintln!("[llm_config] config file is corrupt, resetting to defaults: {e}");
                LlmConfig::default()
            }
        },
        Err(_) => LlmConfig::default(),
    }
}

fn save_config_to(path: &std::path::Path, config: &LlmConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create config dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize LLM config: {e}"))?;
    std::fs::write(path, json)
        .map_err(|e| format!("failed to write LLM config: {e}"))
}

/// Read the API key for the current config from keychain.
pub fn get_api_key(config: &LlmConfig) -> Result<String, String> {
    keyring::Entry::new("workwithme", &config.api_key_name)
        .map_err(|e| format!("keychain access error: {e}"))?
        .get_password()
        .map_err(|e| format!("API key '{}' not found in keychain: {e}", config.api_key_name))
}

/// Send a prompt to the configured LLM and return the text response.
/// This is an async function — callers must be in an async context.
pub async fn call_llm(
    config: &LlmConfig,
    api_key: &str,
    system_prompt: Option<&str>,
    user_message: &str,
    max_tokens: u32,
) -> Result<String, String> {
    validate_base_url(&config.base_url)?;
    let client = http_client();

    match config.provider {
        LlmProvider::Anthropic => {
            let url = format!("{}/messages", config.base_url);
            let mut body = serde_json::json!({
                "model": config.model,
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": user_message}]
            });
            if let Some(sys) = system_prompt {
                body["system"] = serde_json::Value::String(sys.to_string());
            }

            let response = apply_auth(client.post(&url), config, api_key)
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Anthropic API request failed: {e}"))?;

            let status = response.status();
            if !status.is_success() {
                let text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic API error {status}: {text}"));
            }

            #[derive(serde::Deserialize)]
            struct AnthropicResponse {
                content: Vec<AnthropicContent>,
            }
            #[derive(serde::Deserialize)]
            struct AnthropicContent {
                text: String,
            }

            let resp: AnthropicResponse = response
                .json()
                .await
                .map_err(|e| format!("failed to parse Anthropic response: {e}"))?;

            resp.content
                .into_iter()
                .next()
                .map(|c| c.text)
                .ok_or_else(|| "Anthropic returned empty content".to_string())
        }

        LlmProvider::OpenAiCompatible => {
            let url = format!("{}/chat/completions", config.base_url);

            let messages = if let Some(sys) = system_prompt {
                serde_json::json!([
                    {"role": "system", "content": sys},
                    {"role": "user", "content": user_message}
                ])
            } else {
                serde_json::json!([
                    {"role": "user", "content": user_message}
                ])
            };

            let body = serde_json::json!({
                "model": config.model,
                "max_tokens": max_tokens,
                "messages": messages
            });

            let request = apply_auth(
                client.post(&url).header("content-type", "application/json").json(&body),
                config,
                api_key,
            );

            let response = request
                .send()
                .await
                .map_err(|e| format!("OpenAI-compatible API request failed: {e}"))?;

            let status = response.status();
            if !status.is_success() {
                let text = response.text().await.unwrap_or_default();
                return Err(format!("OpenAI-compatible API error {status}: {text}"));
            }

            #[derive(serde::Deserialize)]
            struct OpenAiResponse {
                choices: Vec<OpenAiChoice>,
            }
            #[derive(serde::Deserialize)]
            struct OpenAiChoice {
                message: OpenAiMessage,
            }
            #[derive(serde::Deserialize)]
            struct OpenAiMessage {
                content: String,
            }

            let resp: OpenAiResponse = response
                .json()
                .await
                .map_err(|e| format!("failed to parse OpenAI-compatible response: {e}"))?;

            resp.choices
                .into_iter()
                .next()
                .map(|c| c.message.content)
                .ok_or_else(|| "OpenAI-compatible API returned no choices".to_string())
        }
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn llm_get_config() -> Result<LlmConfig, String> {
    Ok(load_config())
}

#[tauri::command]
pub fn llm_save_config(config: LlmConfig) -> Result<(), String> {
    save_config(&config)
}

#[tauri::command]
pub fn llm_set_api_key(api_key_name: String, key: String) -> Result<(), String> {
    keyring::Entry::new("workwithme", &api_key_name)
        .map_err(|e| format!("keychain access error: {e}"))?
        .set_password(&key)
        .map_err(|e| format!("failed to store API key '{api_key_name}' in keychain: {e}"))
}

#[tauri::command]
pub async fn llm_test_connection() -> Result<String, String> {
    let config = load_config();
    let api_key = get_api_key(&config)?;
    validate_base_url(&config.base_url)?;

    // Use GET /v1/models instead of a completions call — it validates the API key and
    // reachability without consuming any tokens or incurring billing charges.
    let url = format!("{}/models", config.base_url);
    let req = apply_auth(http_client().get(&url), &config, &api_key);

    let response = req.send().await.map_err(|e| format!("connection test failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error {status}: {text}"));
    }
    Ok("ok".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── validate_base_url ─────────────────────────────────────────────────────

    #[test]
    fn https_is_always_allowed() {
        assert!(validate_base_url("https://api.anthropic.com/v1").is_ok());
        assert!(validate_base_url("https://api.openai.com/v1").is_ok());
    }

    #[test]
    fn http_localhost_is_allowed() {
        assert!(validate_base_url("http://localhost:11434/v1").is_ok());
        assert!(validate_base_url("http://127.0.0.1:8080/v1").is_ok());
    }

    #[test]
    fn http_remote_host_is_rejected() {
        assert!(validate_base_url("http://example.com/v1").is_err());
        assert!(validate_base_url("http://192.168.1.1/v1").is_err());
        // Cloud metadata endpoint — must be blocked
        assert!(validate_base_url("http://169.254.169.254/latest/meta-data").is_err());
    }

    #[test]
    fn http_lookalike_localhost_hosts_are_rejected() {
        // A prefix check (starts_with) would wrongly allow these — parsing must not.
        assert!(validate_base_url("http://localhost.evil.com/v1").is_err());
        assert!(validate_base_url("http://127.0.0.1.evil.com/v1").is_err());
        assert!(validate_base_url("http://localhost@evil.com/v1").is_err());
    }

    #[test]
    fn missing_scheme_is_rejected() {
        assert!(validate_base_url("api.openai.com/v1").is_err());
        assert!(validate_base_url("ftp://example.com").is_err());
    }

    // ── filesystem round-trip ─────────────────────────────────────────────────

    #[test]
    fn save_and_load_round_trip() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("llm_config.json");

        let cfg = LlmConfig {
            provider: LlmProvider::OpenAiCompatible,
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4o".to_string(),
            api_key_name: "openai-api-key".to_string(),
        };
        save_config_to(&path, &cfg).unwrap();
        let loaded = load_config_from(&path);
        assert_eq!(loaded.provider, LlmProvider::OpenAiCompatible);
        assert_eq!(loaded.model, "gpt-4o");
        assert_eq!(loaded.base_url, "https://api.openai.com/v1");
    }

    #[test]
    fn save_creates_parent_directories() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nested").join("deep").join("llm_config.json");
        let cfg = LlmConfig::default();
        save_config_to(&path, &cfg).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn load_returns_default_when_file_missing() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nonexistent.json");
        let cfg = load_config_from(&path);
        assert_eq!(cfg.provider, LlmProvider::Anthropic);
        assert!(!cfg.model.is_empty());
    }

    #[test]
    fn load_returns_default_on_corrupt_json() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, b"this is not json {{{{").unwrap();
        let cfg = load_config_from(&path);
        // Must not panic and must return a usable default
        assert_eq!(cfg.provider, LlmProvider::Anthropic);
    }

    #[test]
    fn save_produces_valid_json() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("llm_config.json");
        save_config_to(&path, &LlmConfig::default()).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(parsed.get("model").is_some());
        assert!(parsed.get("provider").is_some());
    }
}
