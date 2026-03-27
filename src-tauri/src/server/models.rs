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
    pub description: String,
    pub custom: bool,
}

/// List of builtin models
fn builtin_models() -> Vec<Model> {
    vec![
        Model {
            id: "claude-opus-4-6".to_string(),
            name: "Claude 3.5 Opus".to_string(),
            provider: "Anthropic".to_string(),
            max_tokens: 4096,
            description: "Most capable model, best for complex reasoning".to_string(),
            custom: false,
        },
        Model {
            id: "claude-sonnet-4-6".to_string(),
            name: "Claude 3.5 Sonnet".to_string(),
            provider: "Anthropic".to_string(),
            max_tokens: 4096,
            description: "Balanced model, good for most tasks".to_string(),
            custom: false,
        },
        Model {
            id: "claude-3-5-haiku-20241022".to_string(),
            name: "Claude 3.5 Haiku".to_string(),
            provider: "Anthropic".to_string(),
            max_tokens: 1024,
            description: "Fast and efficient for simple tasks".to_string(),
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
        .unwrap_or_else(|| "claude-opus-4-6".to_string());

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
    fn test_builtin_models() {
        let models = builtin_models();
        assert_eq!(models.len(), 3);
        assert_eq!(models[0].id, "claude-opus-4-6");
    }

    #[test]
    fn test_model_find() {
        let models = builtin_models();
        let found = models.iter().find(|m| m.id == "claude-opus-4-6");
        assert!(found.is_some());
    }
}
