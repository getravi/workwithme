use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

/// Settings storage path: ~/.pi/settings.json
fn settings_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi/settings.json")
}

/// Default settings
fn default_settings() -> Value {
    json!({
        "theme": "dark",
        "model": "claude-opus-4-6",
        "max_tokens": 4096,
        "temperature": 1.0,
        "api_key_type": "keychain",
        "auto_save_sessions": true,
        "notification_enabled": true,
        "font_size": 14,
        "editor_wrap": true
    })
}

/// Load all settings
pub fn load_settings() -> Result<Value, String> {
    let path = settings_path();

    if !path.exists() {
        // Create default settings if they don't exist
        let defaults = default_settings();
        save_settings(&defaults)?;
        return Ok(defaults);
    }

    match fs::read_to_string(&path) {
        Ok(content) => {
            match serde_json::from_str::<Value>(&content) {
                Ok(settings) => Ok(settings),
                Err(e) => {
                    eprintln!("[settings] failed to parse settings.json: {}", e);
                    // Fall back to defaults on parse error
                    Ok(default_settings())
                }
            }
        }
        Err(e) => {
            eprintln!("[settings] failed to read settings.json: {}", e);
            // Fall back to defaults on read error
            Ok(default_settings())
        }
    }
}

/// Save all settings
pub fn save_settings(settings: &Value) -> Result<(), String> {
    let path = settings_path();

    // Create .pi directory if it doesn't exist
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create settings directory: {}", e))?;
    }

    let json_string = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&path, json_string).map_err(|e| format!("Failed to write settings: {}", e))?;

    println!("[settings] saved settings to {}", path.display());
    Ok(())
}

/// Get a single setting
pub fn get_setting(key: &str) -> Result<Option<Value>, String> {
    let settings = load_settings()?;
    Ok(settings.get(key).cloned())
}

/// Set a single setting
pub fn set_setting(key: &str, value: Value) -> Result<(), String> {
    let mut settings = load_settings()?;

    if let Some(obj) = settings.as_object_mut() {
        obj.insert(key.to_string(), value);
    }

    save_settings(&settings)
}

/// Remove a setting
pub fn delete_setting(key: &str) -> Result<bool, String> {
    let mut settings = load_settings()?;

    if let Some(obj) = settings.as_object_mut() {
        let existed = obj.remove(key).is_some();
        save_settings(&settings)?;
        return Ok(existed);
    }

    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let defaults = default_settings();
        assert_eq!(defaults.get("theme").and_then(|v| v.as_str()), Some("dark"));
        assert_eq!(
            defaults.get("model").and_then(|v| v.as_str()),
            Some("claude-opus-4-6")
        );
    }

    #[test]
    fn test_setting_key_access() {
        let defaults = default_settings();
        let theme = defaults.get("theme");
        assert!(theme.is_some());
    }

    #[test]
    fn test_default_settings_all_keys_present() {
        let defaults = default_settings();
        let obj = defaults.as_object().expect("defaults should be an object");
        assert!(obj.contains_key("theme"));
        assert!(obj.contains_key("model"));
        assert!(obj.contains_key("max_tokens"));
        assert!(obj.contains_key("temperature"));
        assert!(obj.contains_key("auto_save_sessions"));
        assert!(obj.contains_key("notification_enabled"));
        assert!(obj.contains_key("font_size"));
        assert!(obj.contains_key("editor_wrap"));
    }

    #[test]
    fn test_default_settings_numeric_values() {
        let defaults = default_settings();
        assert_eq!(defaults["max_tokens"].as_u64(), Some(4096));
        assert_eq!(defaults["font_size"].as_u64(), Some(14));
    }

    #[test]
    fn test_default_settings_boolean_values() {
        let defaults = default_settings();
        assert_eq!(defaults["auto_save_sessions"].as_bool(), Some(true));
        assert_eq!(defaults["notification_enabled"].as_bool(), Some(true));
        assert_eq!(defaults["editor_wrap"].as_bool(), Some(true));
    }

    #[test]
    fn test_default_settings_temperature_is_float() {
        let defaults = default_settings();
        let temp = defaults["temperature"].as_f64();
        assert!(temp.is_some());
        let t = temp.unwrap();
        assert!(t > 0.0 && t <= 2.0, "temperature should be in (0, 2]");
    }

    #[test]
    fn test_settings_path_is_under_home() {
        let path = settings_path();
        let home = dirs::home_dir().unwrap();
        assert!(path.starts_with(&home), "settings path should be under home dir");
    }

    #[test]
    fn test_settings_path_filename() {
        let path = settings_path();
        assert_eq!(path.file_name().and_then(|n| n.to_str()), Some("settings.json"));
    }

    #[test]
    fn test_settings_path_parent_dir() {
        let path = settings_path();
        let parent = path.parent().unwrap();
        assert_eq!(parent.file_name().and_then(|n| n.to_str()), Some(".pi"));
    }
}
