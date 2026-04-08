use serde::{Deserialize, Serialize};
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

fn config_path() -> std::path::PathBuf {
    voice_db::voice_dir().join("llm_config.json")
}

/// Read LLM config from disk, falling back to defaults.
pub fn load_config() -> LlmConfig {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => LlmConfig::default(),
    }
}

/// Persist LLM config to disk.
pub fn save_config(config: &LlmConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create config dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize LLM config: {e}"))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("failed to write LLM config: {e}"))
}

/// Read the API key for the current config from keychain.
pub fn get_api_key(config: &LlmConfig) -> Result<String, String> {
    keyring::Entry::new("workwithme", &config.api_key_name)
        .map_err(|e| format!("keychain access error: {e}"))?
        .get_password()
        .map_err(|e| format!("API key '{}' not found in keychain: {e}", config.api_key_name))
}

/// Store an API key in keychain under the config's api_key_name.
pub fn set_api_key(config: &LlmConfig, key: &str) -> Result<(), String> {
    keyring::Entry::new("workwithme", &config.api_key_name)
        .map_err(|e| format!("keychain access error: {e}"))?
        .set_password(key)
        .map_err(|e| format!("failed to store API key '{}' in keychain: {e}", config.api_key_name))
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
    let client = reqwest::Client::new();

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

            let response = client
                .post(&url)
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
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

            let mut request = client
                .post(&url)
                .header("content-type", "application/json")
                .json(&body);

            if !api_key.is_empty() {
                request = request.header("Authorization", format!("Bearer {api_key}"));
            }

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
pub fn llm_test_connection() -> Result<String, String> {
    let config = load_config();
    let api_key = get_api_key(&config)?;

    let rt = tokio::runtime::Runtime::new()
        .map_err(|e| format!("failed to create tokio runtime: {e}"))?;

    rt.block_on(async {
        call_llm(&config, &api_key, None, "Hi", 1).await?;
        Ok("ok".to_string())
    })
}
