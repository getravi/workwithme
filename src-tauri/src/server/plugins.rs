use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use lazy_static::lazy_static;

/// Plugin manifest metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub license: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub entry_point: String,
    #[serde(default)]
    pub permissions: Vec<String>,
}

/// Plugin metadata and state
#[derive(Debug, Clone, Serialize)]
pub struct Plugin {
    pub manifest: PluginManifest,
    pub path: PathBuf,
    pub enabled: bool,
    pub loaded: bool,
    #[serde(skip)]
    pub wasm_bytes: Option<Vec<u8>>,
}

/// Plugin registry storing all plugins
pub struct PluginRegistry {
    plugins: HashMap<String, Plugin>,
    plugin_dir: PathBuf,
}

lazy_static! {
    static ref REGISTRY: Arc<RwLock<PluginRegistry>> = {
        let plugin_dir = get_plugins_dir();
        Arc::new(RwLock::new(PluginRegistry {
            plugins: HashMap::new(),
            plugin_dir,
        }))
    };
}

/// Get plugins directory: ~/.pi/plugins
fn get_plugins_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi/plugins")
}

/// Initialize the plugin system
pub async fn init_plugins() -> Result<(), String> {
    let plugins_dir = get_plugins_dir();

    // Create plugins directory if it doesn't exist
    if !plugins_dir.exists() {
        std::fs::create_dir_all(&plugins_dir)
            .map_err(|e| format!("Failed to create plugins directory: {}", e))?;
    }

    // Scan and load existing plugins
    scan_plugins().await?;

    Ok(())
}

/// Scan plugins directory and load manifests
async fn scan_plugins() -> Result<(), String> {
    let plugins_dir = get_plugins_dir();

    if !plugins_dir.exists() {
        return Ok(());
    }

    let entries = std::fs::read_dir(&plugins_dir)
        .map_err(|e| format!("Failed to read plugins directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_dir() {
            let manifest_path = path.join("plugin.toml");

            if manifest_path.exists() {
                match load_manifest(&manifest_path).await {
                    Ok(manifest) => {
                        let plugin = Plugin {
                            manifest: manifest.clone(),
                            path: path.clone(),
                            enabled: true,
                            loaded: false,
                            wasm_bytes: None,
                        };

                        let mut registry = REGISTRY.write().await;
                        registry.plugins.insert(manifest.id.clone(), plugin);
                    }
                    Err(e) => {
                        eprintln!("[plugins] failed to load manifest from {}: {}", path.display(), e);
                    }
                }
            }
        }
    }

    Ok(())
}

/// Load plugin manifest from TOML file
async fn load_manifest(path: &Path) -> Result<PluginManifest, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;

    toml::from_str(&content)
        .map_err(|e| format!("Failed to parse manifest TOML: {}", e))
}

/// List all plugins
pub async fn list_plugins() -> Vec<Plugin> {
    let registry = REGISTRY.read().await;
    registry.plugins.values().cloned().collect()
}

/// Get plugin by ID
pub async fn get_plugin(id: &str) -> Option<Plugin> {
    let registry = REGISTRY.read().await;
    registry.plugins.get(id).cloned()
}

/// Install a plugin from a WASM file URL
pub async fn install_plugin(
    url: &str,
    verify_signature: bool,
) -> Result<Plugin, String> {
    // Download WASM file
    let wasm_bytes = download_plugin_wasm(url).await?;

    // Parse and validate manifest
    let manifest = extract_manifest_from_wasm(&wasm_bytes)?;

    if verify_signature {
        verify_plugin_signature(url, &wasm_bytes).await?;
    }

    // Create plugin directory
    let plugins_dir = get_plugins_dir();
    let plugin_dir = plugins_dir.join(&manifest.id);

    std::fs::create_dir_all(&plugin_dir)
        .map_err(|e| format!("Failed to create plugin directory: {}", e))?;

    // Save WASM file
    let wasm_path = plugin_dir.join("plugin.wasm");
    std::fs::write(&wasm_path, &wasm_bytes)
        .map_err(|e| format!("Failed to save plugin WASM: {}", e))?;

    // Save manifest
    let manifest_path = plugin_dir.join("plugin.toml");
    let manifest_toml = toml::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
    std::fs::write(&manifest_path, manifest_toml)
        .map_err(|e| format!("Failed to save manifest: {}", e))?;

    let plugin = Plugin {
        manifest: manifest.clone(),
        path: plugin_dir,
        enabled: true,
        loaded: false,
        wasm_bytes: Some(wasm_bytes),
    };

    // Register plugin
    let mut registry = REGISTRY.write().await;
    registry.plugins.insert(manifest.id.clone(), plugin.clone());

    Ok(plugin)
}

/// Download plugin WASM from URL
async fn download_plugin_wasm(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::new();

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to download plugin: {}", e))?;

    response
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read plugin data: {}", e))
}

/// Extract plugin manifest from WASM custom section
fn extract_manifest_from_wasm(_wasm_bytes: &[u8]) -> Result<PluginManifest, String> {
    // For now, use a simple approach: require manifest.toml in plugin directory
    // In production, this would parse WASM custom sections
    Ok(PluginManifest {
        id: "placeholder".to_string(),
        name: "Placeholder Plugin".to_string(),
        version: "0.1.0".to_string(),
        description: "Placeholder plugin".to_string(),
        author: "Unknown".to_string(),
        license: "MIT".to_string(),
        capabilities: vec![],
        entry_point: "init".to_string(),
        permissions: vec![],
    })
}

/// Verify plugin signature (stub for now)
async fn verify_plugin_signature(_url: &str, _wasm_bytes: &[u8]) -> Result<(), String> {
    // In production: verify GPG/Ed25519 signature
    Ok(())
}

/// Enable a plugin
pub async fn enable_plugin(id: &str) -> Result<(), String> {
    let mut registry = REGISTRY.write().await;

    if let Some(plugin) = registry.plugins.get_mut(id) {
        plugin.enabled = true;
        Ok(())
    } else {
        Err(format!("Plugin not found: {}", id))
    }
}

/// Disable a plugin
pub async fn disable_plugin(id: &str) -> Result<(), String> {
    let mut registry = REGISTRY.write().await;

    if let Some(plugin) = registry.plugins.get_mut(id) {
        plugin.enabled = false;
        plugin.loaded = false;
        Ok(())
    } else {
        Err(format!("Plugin not found: {}", id))
    }
}

/// Uninstall a plugin
pub async fn uninstall_plugin(id: &str) -> Result<(), String> {
    let mut registry = REGISTRY.write().await;

    if let Some(plugin) = registry.plugins.remove(id) {
        // Delete plugin directory
        std::fs::remove_dir_all(&plugin.path)
            .map_err(|e| format!("Failed to delete plugin directory: {}", e))?;
        Ok(())
    } else {
        Err(format!("Plugin not found: {}", id))
    }
}

/// Load a plugin's WASM module
pub async fn load_plugin_wasm(id: &str) -> Result<Vec<u8>, String> {
    let plugin = get_plugin(id)
        .await
        .ok_or(format!("Plugin not found: {}", id))?;

    let wasm_path = plugin.path.join("plugin.wasm");

    std::fs::read(&wasm_path)
        .map_err(|e| format!("Failed to load plugin WASM: {}", e))
}

/// Call a plugin function with JSON input
pub async fn call_plugin_function(
    id: &str,
    function: &str,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let plugin = get_plugin(id)
        .await
        .ok_or(format!("Plugin not found: {}", id))?;

    if !plugin.enabled {
        return Err(format!("Plugin is disabled: {}", id));
    }

    // In production: use wasmtime to execute plugin function
    // For now, return a stub response
    Ok(serde_json::json!({
        "success": true,
        "plugin": id,
        "function": function,
        "input": input
    }))
}

/// Get plugin stats
pub async fn get_plugin_stats() -> serde_json::Value {
    let registry = REGISTRY.read().await;

    let total = registry.plugins.len();
    let enabled = registry.plugins.values().filter(|p| p.enabled).count();
    let loaded = registry.plugins.values().filter(|p| p.loaded).count();

    serde_json::json!({
        "total": total,
        "enabled": enabled,
        "loaded": loaded,
        "plugins": registry.plugins.iter().map(|(id, p)| {
            serde_json::json!({
                "id": id,
                "name": p.manifest.name,
                "version": p.manifest.version,
                "enabled": p.enabled,
                "loaded": p.loaded
            })
        }).collect::<Vec<_>>()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plugin_manifest_serialization() {
        let manifest = PluginManifest {
            id: "test-plugin".to_string(),
            name: "Test Plugin".to_string(),
            version: "1.0.0".to_string(),
            description: "A test plugin".to_string(),
            author: "Test Author".to_string(),
            license: "MIT".to_string(),
            capabilities: vec!["tools".to_string(), "skills".to_string()],
            entry_point: "init".to_string(),
            permissions: vec!["read:files".to_string()],
        };

        let json = serde_json::to_string(&manifest).unwrap();
        let parsed: PluginManifest = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, "test-plugin");
        assert_eq!(parsed.capabilities.len(), 2);
    }

    #[test]
    fn test_plugins_dir_path() {
        let path = get_plugins_dir();
        assert!(path.to_string_lossy().contains(".pi/plugins"));
    }

    #[test]
    fn test_plugin_creation() {
        let manifest = PluginManifest {
            id: "test".to_string(),
            name: "Test".to_string(),
            version: "1.0.0".to_string(),
            description: "Test".to_string(),
            author: "Test".to_string(),
            license: "MIT".to_string(),
            capabilities: vec![],
            entry_point: "init".to_string(),
            permissions: vec![],
        };

        let plugin = Plugin {
            manifest: manifest.clone(),
            path: PathBuf::from("/tmp/test"),
            enabled: true,
            loaded: false,
            wasm_bytes: None,
        };

        assert_eq!(plugin.manifest.id, "test");
        assert!(plugin.enabled);
        assert!(!plugin.loaded);
    }
}
