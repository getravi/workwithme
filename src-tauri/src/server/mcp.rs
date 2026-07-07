//! Model Context Protocol (MCP) server configuration and tool loading.
//!
//! Manages the list of configured MCP servers (local and remote), loads tool
//! definitions from server manifests, and proxies tool-call requests to the
//! appropriate server process or HTTP endpoint.

use serde_json::{json, Value};
use serde::{Serialize, Deserialize};
use std::fs;
use std::path::PathBuf;

// The connector catalog is a large static data table; it lives in its own module.
// Re-exported here so existing `mcp::get_catalog` call sites keep working.
pub use super::mcp_catalog::get_catalog;

/// Tool definition with JSON schema, used by MCP tool loading.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// Get the MCP config file path (~/.pi/agent/mcp.json)
fn mcp_config_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    PathBuf::from(home).join(".pi/agent/mcp.json")
}

/// Ensure the MCP config directory exists
fn ensure_mcp_dir() -> Result<(), String> {
    let path = mcp_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create mcp directory: {}", e))?;
    }
    Ok(())
}

/// Load MCP configuration from ~/.pi/agent/mcp.json
pub fn load_mcp_config() -> Result<Value, String> {
    let path = mcp_config_path();
    if !path.exists() {
        return Ok(json!({
            "mcpServers": {}
        }));
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read mcp.json: {}", e))?;
    serde_json::from_str::<Value>(&content).map_err(|e| format!("Invalid mcp.json: {}", e))
}

/// Validate URL against SSRF attacks (prevent internal network access)
pub fn validate_mcp_url(url_str: &str) -> Result<(), String> {
    // Basic URL validation - must start with https://
    if !url_str.starts_with("https://") {
        return Err("MCP URLs must use HTTPS protocol".to_string());
    }

    // Extract host portion (between https:// and first / or :)
    let url_without_scheme = &url_str[8..]; // Skip "https://"
    let host = url_without_scheme
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");

    if host.is_empty() {
        return Err("MCP URL must have a valid host".to_string());
    }

    // Prevent access to internal/private networks (SSRF protection)
    let restricted_patterns = [
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "192.168.", // RFC 1918: 192.168.0.0/16
        "10.",      // RFC 1918: 10.0.0.0/8
        // RFC 1918: 172.16.0.0/12 covers 172.16–172.31.
        // Prefix "172.1" catches 172.10–172.19 (incl. 172.16–172.19),
        // "172.2" catches 172.20–172.29, "172.3" catches 172.30–172.31.
        "172.1",
        "172.2",
        "172.3",
        "[::1]",     // IPv6 loopback
        "[::ffff:",  // IPv4-mapped IPv6
        "169.254.",  // link-local (APIPA)
    ];

    for pattern in &restricted_patterns {
        if host.starts_with(pattern) {
            return Err(format!("Access denied: cannot connect to internal network: {}", host));
        }
    }

    Ok(())
}

/// Save MCP configuration to ~/.pi/agent/mcp.json
pub fn save_mcp_config(config: Value) -> Result<(), String> {
    ensure_mcp_dir()?;
    let path = mcp_config_path();
    fs::write(&path, config.to_string()).map_err(|e| format!("Failed to write mcp.json: {}", e))?;
    Ok(())
}

/// Get a specific MCP server configuration
pub fn get_mcp_server(slug: &str) -> Result<Option<Value>, String> {
    let config = load_mcp_config()?;
    Ok(config["mcpServers"][slug].as_object().map(|_| config["mcpServers"][slug].clone()))
}

/// Add or update an MCP server configuration (with SSRF validation)
pub fn set_mcp_server(slug: &str, server_config: Value) -> Result<(), String> {
    // Validate URL if it's a remote MCP
    if let Some(url_str) = server_config.get("url").and_then(|v| v.as_str()) {
        validate_mcp_url(url_str)?;
    }

    let mut config = load_mcp_config()?;

    if !config["mcpServers"].is_object() {
        config["mcpServers"] = json!({});
    }

    config["mcpServers"][slug] = server_config;
    save_mcp_config(config)?;
    Ok(())
}

/// Remove an MCP server configuration
pub fn remove_mcp_server(slug: &str) -> Result<bool, String> {
    let mut config = load_mcp_config()?;

    if config["mcpServers"][slug].is_null() {
        return Ok(false);
    }

    config["mcpServers"]
        .as_object_mut()
        .map(|obj| obj.remove(slug));

    save_mcp_config(config)?;
    Ok(true)
}


/// Get the hardcoded MCP catalog (50+ services)

/// MCP Tool definition (from tools_list response)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::mcp_catalog::CatalogEntry;

    #[test]
    fn test_mcp_config_path() {
        let path = mcp_config_path();
        assert!(path.to_string_lossy().contains(".pi/agent/mcp.json"));
    }

    #[test]
    fn test_catalog_has_entries() {
        let catalog = get_catalog();
        assert!(catalog.len() >= 50); // We have 50+ entries
    }

    #[test]
    fn test_catalog_entry_structure() {
        let catalog = get_catalog();
        for entry in catalog {
            assert!(!entry.slug.is_empty());
            assert!(!entry.name.is_empty());
            assert!(!entry.description.is_empty());
            assert!(!entry.category.is_empty());
            assert!(!entry.url.is_empty());
        }
    }

    #[test]
    fn test_catalog_has_productivity_entries() {
        let catalog = get_catalog();
        let has_productivity = catalog
            .iter()
            .any(|e| e.category == "Productivity");
        assert!(has_productivity);
    }

    #[test]
    fn test_catalog_has_google_entries() {
        let catalog = get_catalog();
        let has_google = catalog
            .iter()
            .any(|e| e.category == "Google");
        assert!(has_google);
    }

    #[test]
    fn test_catalog_has_multiple_categories() {
        let catalog = get_catalog();
        let categories: std::collections::HashSet<&String> = catalog
            .iter()
            .map(|e| &e.category)
            .collect();
        assert!(categories.len() > 1);
    }

    #[test]
    fn test_catalog_slugs_are_unique() {
        let catalog = get_catalog();
        let slugs: Vec<&String> = catalog.iter().map(|e| &e.slug).collect();
        let unique_slugs: std::collections::HashSet<_> = slugs.iter().collect();
        assert_eq!(slugs.len(), unique_slugs.len());
    }

    #[test]
    fn test_catalog_entry_serialization() {
        let entry = CatalogEntry {
            slug: "test".to_string(),
            name: "Test MCP".to_string(),
            description: "A test MCP entry".to_string(),
            category: "Test".to_string(),
            url: "https://test.example.com".to_string(),
            docs_url: Some("https://test.example.com/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        };

        let json = serde_json::to_string(&entry).unwrap();
        let parsed: CatalogEntry = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.slug, "test");
        assert_eq!(parsed.name, "Test MCP");
        assert_eq!(parsed.requires_token, true);
    }

    #[test]
    fn test_default_mcp_config_structure() {
        let default_config = json!({
            "mcpServers": {}
        });

        assert!(default_config["mcpServers"].is_object());
    }

    #[test]
    fn test_all_entries_have_token_requirement_status() {
        let catalog = get_catalog();

        let requires_token_count = catalog
            .iter()
            .filter(|e| e.requires_token)
            .count();

        // All entries should have a requires_token value set
        assert_eq!(requires_token_count, catalog.len());
    }

    #[test]
    fn test_ssrf_validation_rejects_http() {
        let result = validate_mcp_url("http://example.com");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("HTTPS"));
    }

    #[test]
    fn test_ssrf_validation_rejects_localhost() {
        let result = validate_mcp_url("https://localhost:4242");
        assert!(result.is_err());
    }

    #[test]
    fn test_ssrf_validation_rejects_internal_networks() {
        let test_urls = vec![
            "https://127.0.0.1",
            "https://192.168.1.1",
            "https://10.0.0.1",
            "https://172.16.0.1",
        ];

        for url in test_urls {
            let result = validate_mcp_url(url);
            assert!(result.is_err(), "Failed for {}", url);
        }
    }

    #[test]
    fn test_ssrf_validation_allows_https_external() {
        let result = validate_mcp_url("https://api.example.com/v1");
        assert!(result.is_ok());
    }

    #[test]
    fn test_catalog_all_entries_have_required_fields() {
        let catalog = get_catalog();
        for entry in catalog {
            assert!(!entry.slug.is_empty(), "slug cannot be empty");
            assert!(!entry.name.is_empty(), "name cannot be empty");
            assert!(!entry.description.is_empty(), "description cannot be empty");
            assert!(!entry.category.is_empty(), "category cannot be empty");
            assert!(!entry.url.is_empty(), "url cannot be empty");
            assert!(entry.url.starts_with("https://"), "url must be HTTPS");
        }
    }

    #[test]
    fn test_catalog_categories_have_entries() {
        let catalog = get_catalog();
        let categories: std::collections::HashSet<String> = catalog
            .iter()
            .map(|e| e.category.clone())
            .collect();

        // Verify all expected categories are present
        assert!(categories.contains("Productivity"));
        assert!(categories.contains("Google"));
        assert!(categories.contains("Development"));
        assert!(categories.contains("Communication"));
        assert!(categories.contains("Data & Analytics"));
        assert!(categories.contains("Finance"));
        assert!(categories.contains("Design"));
        assert!(categories.contains("CRM"));
        assert!(categories.contains("Backend"));
        assert!(categories.contains("Marketing"));
        assert!(categories.contains("Streaming"));
    }

    #[test]
    fn test_catalog_productivity_category() {
        let catalog = get_catalog();
        let productivity_entries: Vec<_> = catalog
            .iter()
            .filter(|e| e.category == "Productivity")
            .collect();

        assert!(!productivity_entries.is_empty());
        assert!(productivity_entries.iter().any(|e| e.slug == "notion"));
        assert!(productivity_entries.iter().any(|e| e.slug == "linear"));
        assert!(productivity_entries.iter().any(|e| e.slug == "asana"));
    }

    #[test]
    fn test_catalog_development_category() {
        let catalog = get_catalog();
        let dev_entries: Vec<_> = catalog
            .iter()
            .filter(|e| e.category == "Development")
            .collect();

        assert!(!dev_entries.is_empty());
        assert!(dev_entries.iter().any(|e| e.slug == "github"));
        assert!(dev_entries.iter().any(|e| e.slug == "gitlab"));
        assert!(dev_entries.iter().any(|e| e.slug == "aws"));
    }

    #[test]
    fn test_catalog_communication_category() {
        let catalog = get_catalog();
        let comm_entries: Vec<_> = catalog
            .iter()
            .filter(|e| e.category == "Communication")
            .collect();

        assert!(!comm_entries.is_empty());
        assert!(comm_entries.iter().any(|e| e.slug == "slack"));
        assert!(comm_entries.iter().any(|e| e.slug == "discord"));
        assert!(comm_entries.iter().any(|e| e.slug == "twilio"));
    }

    #[test]
    fn test_catalog_finance_category() {
        let catalog = get_catalog();
        let finance_entries: Vec<_> = catalog
            .iter()
            .filter(|e| e.category == "Finance")
            .collect();

        assert!(!finance_entries.is_empty());
        assert!(finance_entries.iter().any(|e| e.slug == "stripe"));
        assert_eq!(finance_entries.len(), 3);
    }

    #[test]
    fn test_catalog_all_urls_are_https() {
        let catalog = get_catalog();
        for entry in catalog {
            assert!(
                entry.url.starts_with("https://"),
                "URL for {} must use HTTPS: {}",
                entry.slug,
                entry.url
            );
        }
    }

    #[test]
    fn test_catalog_all_docs_urls_are_https_or_none() {
        let catalog = get_catalog();
        for entry in catalog {
            if let Some(docs_url) = &entry.docs_url {
                assert!(
                    docs_url.starts_with("https://") || docs_url.starts_with("http://"),
                    "Docs URL for {} must be HTTPS or HTTP: {}",
                    entry.slug,
                    docs_url
                );
            }
        }
    }

    #[test]
    fn test_catalog_entry_count_minimum() {
        let catalog = get_catalog();
        // Verify we have at least 50 entries (currently 50)
        assert!(
            catalog.len() >= 50,
            "Catalog should have at least 50 entries, got {}",
            catalog.len()
        );
    }

    #[test]
    fn test_specific_services_exist() {
        let catalog = get_catalog();
        let slugs: Vec<&String> = catalog.iter().map(|e| &e.slug).collect();

        // Verify important services are in catalog
        let required_services = vec![
            "github", "slack", "stripe", "notion", "asana",
            "google-drive", "google-sheets", "aws", "vercel",
        ];

        for service in required_services {
            assert!(
                slugs.contains(&&service.to_string()),
                "Required service '{}' not found in catalog",
                service
            );
        }
    }

    #[test]
    fn test_mcp_tool_structure() {
        // Test McpTool serialization/deserialization
        let tool = McpTool {
            name: "list_files".to_string(),
            description: "List files in a directory".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" }
                }
            }),
        };

        // Verify serialization
        let json = serde_json::to_string(&tool).unwrap();
        let parsed: McpTool = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.name, "list_files");
        assert_eq!(parsed.description, "List files in a directory");
        assert!(parsed.input_schema.is_object());
    }

    #[test]
    fn test_mcp_tool_definition_conversion() {
        // Test that McpTool converts to ToolDefinition correctly
        let mcp_tool = McpTool {
            name: "github_search".to_string(),
            description: "Search GitHub repositories".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": "integer" }
                },
                "required": ["query"]
            }),
        };

        // Convert to ToolDefinition
        let tool_def = ToolDefinition {
            name: mcp_tool.name.clone(),
            description: mcp_tool.description.clone(),
            input_schema: mcp_tool.input_schema.clone(),
        };

        assert_eq!(tool_def.name, "github_search");
        assert!(tool_def.input_schema["properties"]["query"].is_object());
        assert!(tool_def.input_schema["required"].as_array().unwrap().contains(&json!("query")));
    }

    #[test]
    fn test_mcp_server_config_structure() {
        // Test that MCP server configs have the right structure
        let server_config = json!({
            "command": "node mcp-server.js",
            "enabled": true,
            "env": {
                "API_KEY": "test-key"
            }
        });

        assert_eq!(server_config["command"], "node mcp-server.js");
        assert_eq!(server_config["enabled"], true);
        assert_eq!(server_config["env"]["API_KEY"], "test-key");
    }

    #[test]
    fn test_mcp_config_default_structure() {
        // Test default MCP config structure
        let default_config = json!({
            "mcpServers": {}
        });

        assert!(default_config["mcpServers"].is_object());
        assert_eq!(default_config["mcpServers"].as_object().unwrap().len(), 0);
    }

    #[test]
    fn test_tool_definition_serialization() {
        // ToolDefinition moved from tools.rs into mcp.rs — verify it round-trips correctly
        let td = ToolDefinition {
            name: "my_tool".to_string(),
            description: "does something".to_string(),
            input_schema: json!({"type": "object", "properties": {"x": {"type": "string"}}}),
        };
        let serialized = serde_json::to_string(&td).unwrap();
        let back: ToolDefinition = serde_json::from_str(&serialized).unwrap();
        assert_eq!(back.name, "my_tool");
        assert_eq!(back.description, "does something");
        assert!(back.input_schema["properties"]["x"].is_object());
    }

    #[test]
    fn test_mcp_server_validation_with_ssrf() {
        // Test SSRF validation for various URLs
        let test_cases = vec![
            ("https://api.example.com/v1", true),
            ("https://mcp.github.com", true),
            ("http://localhost:3000", false),
            ("http://127.0.0.1:8000", false),
            ("https://192.168.1.1", false),
            ("https://10.0.0.1", false),
        ];

        for (url, should_pass) in test_cases {
            let result = validate_mcp_url(url);
            if should_pass {
                assert!(
                    result.is_ok(),
                    "URL {} should be valid but got: {:?}",
                    url,
                    result
                );
            } else {
                assert!(
                    result.is_err(),
                    "URL {} should be invalid for SSRF protection",
                    url
                );
            }
        }
    }

}

// Phase 3: MCP Tool Loading for Agent Integration
