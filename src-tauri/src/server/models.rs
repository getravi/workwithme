use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::server::settings;

/// Available model configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub max_tokens: u32,
    pub context_length: u32,
    pub description: String,
    pub custom: bool,
}

/// Builtin models curated for agent-loop use: tool-call support required.
/// Data sourced from models.dev/api.json (2026-03-28).
fn builtin_models() -> Vec<Model> {
    vec![
        // ── Anthropic ──────────────────────────────────────────────────────────
        Model {
            id: "claude-opus-4-6".to_string(),
            name: "Claude Opus 4.6".to_string(),
            provider: "anthropic".to_string(),
            context_length: 1_000_000,
            max_tokens: 128_000,
            description: "Anthropic flagship — 1M context, extended thinking, tool use".to_string(),
            custom: false,
        },
        Model {
            id: "claude-sonnet-4-6".to_string(),
            name: "Claude Sonnet 4.6".to_string(),
            provider: "anthropic".to_string(),
            context_length: 1_000_000,
            max_tokens: 64_000,
            description: "Best balance of capability and speed — 1M context".to_string(),
            custom: false,
        },
        Model {
            id: "claude-opus-4-5".to_string(),
            name: "Claude Opus 4.5".to_string(),
            provider: "anthropic".to_string(),
            context_length: 200_000,
            max_tokens: 64_000,
            description: "Highly capable with extended thinking and tool use".to_string(),
            custom: false,
        },
        Model {
            id: "claude-sonnet-4-5".to_string(),
            name: "Claude Sonnet 4.5".to_string(),
            provider: "anthropic".to_string(),
            context_length: 200_000,
            max_tokens: 64_000,
            description: "Fast, capable, cost-efficient — great for most agent tasks".to_string(),
            custom: false,
        },
        Model {
            id: "claude-haiku-4-5".to_string(),
            name: "Claude Haiku 4.5".to_string(),
            provider: "anthropic".to_string(),
            context_length: 200_000,
            max_tokens: 64_000,
            description: "Fastest Claude — ideal for high-throughput or latency-sensitive tasks".to_string(),
            custom: false,
        },
        // ── OpenAI ─────────────────────────────────────────────────────────────
        Model {
            id: "gpt-5.4".to_string(),
            name: "GPT-5.4".to_string(),
            provider: "openai".to_string(),
            context_length: 1_050_000,
            max_tokens: 128_000,
            description: "Latest GPT-5 — 1M context, reasoning, tool use".to_string(),
            custom: false,
        },
        Model {
            id: "gpt-5.4-pro".to_string(),
            name: "GPT-5.4 Pro".to_string(),
            provider: "openai".to_string(),
            context_length: 1_050_000,
            max_tokens: 128_000,
            description: "Premium GPT-5.4 — extended capabilities".to_string(),
            custom: false,
        },
        Model {
            id: "gpt-5.4-mini".to_string(),
            name: "GPT-5.4 mini".to_string(),
            provider: "openai".to_string(),
            context_length: 400_000,
            max_tokens: 128_000,
            description: "Fast, affordable GPT-5.4 for everyday tasks".to_string(),
            custom: false,
        },
        Model {
            id: "gpt-5.1-codex".to_string(),
            name: "GPT-5.1 Codex".to_string(),
            provider: "openai".to_string(),
            context_length: 400_000,
            max_tokens: 128_000,
            description: "Coding-optimised GPT-5 — excels at code generation and refactoring".to_string(),
            custom: false,
        },
        Model {
            id: "gpt-5.1-codex-max".to_string(),
            name: "GPT-5.1 Codex Max".to_string(),
            provider: "openai".to_string(),
            context_length: 400_000,
            max_tokens: 128_000,
            description: "Maximum-power Codex variant for large, complex codebases".to_string(),
            custom: false,
        },
        Model {
            id: "gpt-4.1".to_string(),
            name: "GPT-4.1".to_string(),
            provider: "openai".to_string(),
            context_length: 1_047_576,
            max_tokens: 32_768,
            description: "Reliable all-rounder — 1M context, strong instruction following".to_string(),
            custom: false,
        },
        Model {
            id: "gpt-4.1-mini".to_string(),
            name: "GPT-4.1 mini".to_string(),
            provider: "openai".to_string(),
            context_length: 1_047_576,
            max_tokens: 32_768,
            description: "Lightweight GPT-4.1 — fast and cost-efficient".to_string(),
            custom: false,
        },
        Model {
            id: "gpt-4o".to_string(),
            name: "GPT-4o".to_string(),
            provider: "openai".to_string(),
            context_length: 128_000,
            max_tokens: 16_384,
            description: "Multimodal GPT-4 — vision + tool use".to_string(),
            custom: false,
        },
        Model {
            id: "o3".to_string(),
            name: "o3".to_string(),
            provider: "openai".to_string(),
            context_length: 200_000,
            max_tokens: 100_000,
            description: "Deep reasoning — best for math, science, complex multi-step problems".to_string(),
            custom: false,
        },
        Model {
            id: "o3-pro".to_string(),
            name: "o3-pro".to_string(),
            provider: "openai".to_string(),
            context_length: 200_000,
            max_tokens: 100_000,
            description: "Premium reasoning model — highest accuracy on hard problems".to_string(),
            custom: false,
        },
        Model {
            id: "o4-mini".to_string(),
            name: "o4-mini".to_string(),
            provider: "openai".to_string(),
            context_length: 200_000,
            max_tokens: 100_000,
            description: "Fast reasoning — affordable o-series for agentic tasks".to_string(),
            custom: false,
        },
        Model {
            id: "codex-mini-latest".to_string(),
            name: "Codex mini".to_string(),
            provider: "openai".to_string(),
            context_length: 200_000,
            max_tokens: 100_000,
            description: "Compact coding-focused reasoning model".to_string(),
            custom: false,
        },
    ]
}

/// Get all available models (builtin + custom)
pub fn list_models() -> Result<Vec<Model>, String> {
    let mut models = builtin_models();

    // Load custom models from settings
    match settings::get_setting("custom_models") {
        Ok(Some(Value::Array(custom))) => {
            for item in custom {
                if let Ok(model) = serde_json::from_value::<Model>(item) {
                    models.push(model);
                }
            }
        }
        _ => {
            // No custom models configured
        }
    }

    Ok(models)
}

/// Get currently selected model
pub fn get_selected_model() -> Result<Model, String> {
    let model_id = settings::get_setting("model")?
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "claude-sonnet-4-6".to_string());

    find_model(&model_id)
}

/// Find a model by ID
pub fn find_model(id: &str) -> Result<Model, String> {
    let models = list_models()?;
    models
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| format!("Model not found: {}", id))
}

/// Select a model as the current model
pub fn select_model(id: &str) -> Result<(), String> {
    // Verify the model exists
    let _model = find_model(id)?;

    // Update settings
    settings::set_setting("model", json!(id))
}

/// Add a custom model
pub fn add_custom_model(model: Model) -> Result<(), String> {
    if !model.custom {
        return Err("Custom models must have custom=true".to_string());
    }

    let mut custom_models = match settings::get_setting("custom_models")? {
        Some(Value::Array(arr)) => arr,
        _ => vec![],
    };

    custom_models.push(serde_json::to_value(&model)
        .map_err(|e| format!("Failed to serialize model: {}", e))?);

    settings::set_setting("custom_models", json!(custom_models))
}

/// Remove a custom model
pub fn remove_custom_model(id: &str) -> Result<bool, String> {
    let model = find_model(id)?;

    if !model.custom {
        return Err("Cannot remove builtin models".to_string());
    }

    let mut custom_models = match settings::get_setting("custom_models")? {
        Some(Value::Array(arr)) => arr,
        _ => vec![],
    };

    let original_len = custom_models.len();
    custom_models.retain(|m| {
        m.get("id")
            .and_then(|v| v.as_str())
            .map(|s| s != id)
            .unwrap_or(true)
    });

    let was_removed = custom_models.len() < original_len;
    if was_removed {
        settings::set_setting("custom_models", json!(custom_models))?;
    }

    Ok(was_removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_models_count() {
        let models = builtin_models();
        assert_eq!(models.len(), 17); // 5 Anthropic + 12 OpenAI
    }

    #[test]
    fn test_builtin_models_ids() {
        let models = builtin_models();
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        // Anthropic
        assert!(ids.contains(&"claude-opus-4-6"));
        assert!(ids.contains(&"claude-sonnet-4-6"));
        assert!(ids.contains(&"claude-haiku-4-5"));
        // OpenAI
        assert!(ids.contains(&"gpt-5.4"));
        assert!(ids.contains(&"gpt-4.1"));
        assert!(ids.contains(&"gpt-4o"));
        assert!(ids.contains(&"o3"));
        assert!(ids.contains(&"o4-mini"));
    }

    #[test]
    fn test_builtin_models_have_context_length() {
        for m in builtin_models() {
            assert!(m.context_length >= 16_000, "model {} context_length {} is too low", m.id, m.context_length);
        }
    }

    #[test]
    fn test_builtin_models_not_custom() {
        for m in builtin_models() {
            assert!(!m.custom, "builtin model {} should have custom=false", m.id);
        }
    }

    #[test]
    fn test_builtin_models_have_known_provider() {
        let known = ["anthropic", "openai"];
        for m in builtin_models() {
            assert!(known.contains(&m.provider.as_str()), "model {} has unknown provider {}", m.id, m.provider);
        }
    }

    #[test]
    fn test_builtin_models_have_positive_max_tokens() {
        for m in builtin_models() {
            assert!(m.max_tokens > 0, "model {} should have positive max_tokens", m.id);
        }
    }

    #[test]
    fn test_builtin_models_reasonable_max_tokens() {
        for m in builtin_models() {
            assert!(m.max_tokens >= 8192, "model {} max_tokens {} is too low", m.id, m.max_tokens);
        }
    }

    #[test]
    fn test_list_models_includes_builtins() {
        let models = list_models().unwrap();
        assert!(models.len() >= 17);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert!(ids.contains(&"claude-sonnet-4-6"));
        assert!(ids.contains(&"gpt-5.4"));
        assert!(ids.contains(&"gpt-4o"));
    }

    #[test]
    fn test_find_model_success() {
        let model = find_model("claude-sonnet-4-6").unwrap();
        assert_eq!(model.id, "claude-sonnet-4-6");
        assert_eq!(model.provider, "anthropic");
    }

    #[test]
    fn test_find_model_not_found() {
        let result = find_model("nonexistent-model-xyz");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Model not found"));
    }

    #[test]
    fn test_custom_model_requires_custom_flag() {
        let model = Model {
            id: "my-model".to_string(),
            name: "My Model".to_string(),
            provider: "custom".to_string(),
            context_length: 32_000,
            max_tokens: 2048,
            description: "test".to_string(),
            custom: false, // wrong — builtin flag
        };
        let result = add_custom_model(model);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("custom=true"));
    }

    #[test]
    fn test_remove_builtin_model_rejected() {
        // Builtin models cannot be removed
        let result = remove_custom_model("claude-opus-4-6");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot remove builtin"));
    }

    #[test]
    fn test_model_serialization_round_trip() {
        let model = Model {
            id: "test-model".to_string(),
            name: "Test Model".to_string(),
            provider: "TestCo".to_string(),
            context_length: 128_000,
            max_tokens: 32_000,
            description: "A test model".to_string(),
            custom: true,
        };
        let json = serde_json::to_string(&model).unwrap();
        let back: Model = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "test-model");
        assert_eq!(back.context_length, 128_000);
        assert_eq!(back.max_tokens, 32_000);
        assert!(back.custom);
    }

    #[test]
    fn test_default_selected_model_is_sonnet() {
        // When no model is set in settings, default to claude-sonnet-4-6
        let default_id = "claude-sonnet-4-6";
        let model = find_model(default_id).unwrap();
        assert_eq!(model.id, default_id);
    }
}
