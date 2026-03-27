use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

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

/// Add or update an MCP server configuration
pub fn set_mcp_server(slug: &str, server_config: Value) -> Result<(), String> {
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

/// MCP catalog entry
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CatalogEntry {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs_url: Option<String>,
    pub requires_token: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_svg: Option<String>,
}

/// Get the hardcoded MCP catalog
pub fn get_catalog() -> Vec<CatalogEntry> {
    vec![
        // Productivity
        CatalogEntry {
            slug: "atlassian".to_string(),
            name: "Atlassian".to_string(),
            description: "Connect Jira, Confluence, and other Atlassian tools".to_string(),
            category: "Productivity".to_string(),
            url: "https://mcp.atlassian.com/v1/mcp".to_string(),
            docs_url: Some("https://developer.atlassian.com/cloud/mcp".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "notion".to_string(),
            name: "Notion".to_string(),
            description: "Access and manage your Notion workspace".to_string(),
            category: "Productivity".to_string(),
            url: "https://mcp.notion.com/v1".to_string(),
            docs_url: Some("https://developers.notion.com/docs/mcp".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "linear".to_string(),
            name: "Linear".to_string(),
            description: "Manage Linear issues and projects".to_string(),
            category: "Productivity".to_string(),
            url: "https://mcp.linear.app/sse".to_string(),
            docs_url: Some("https://linear.app/docs/mcp".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "zapier".to_string(),
            name: "Zapier".to_string(),
            description: "Automate workflows across thousands of apps".to_string(),
            category: "Productivity".to_string(),
            url: "https://mcp.zapier.com/v1".to_string(),
            docs_url: Some("https://zapier.com/developer/documentation/mcp".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "asana".to_string(),
            name: "Asana".to_string(),
            description: "Manage tasks and projects in Asana".to_string(),
            category: "Productivity".to_string(),
            url: "https://mcp.asana.com/v1".to_string(),
            docs_url: Some("https://developers.asana.com/docs/mcp".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "airtable".to_string(),
            name: "Airtable".to_string(),
            description: "Access and modify Airtable bases and records".to_string(),
            category: "Productivity".to_string(),
            url: "https://mcp.airtable.com/v1".to_string(),
            docs_url: Some("https://airtable.com/developers/web/api/introduction".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "monday".to_string(),
            name: "Monday.com".to_string(),
            description: "Manage boards and items in Monday.com".to_string(),
            category: "Productivity".to_string(),
            url: "https://mcp.monday.com/v1".to_string(),
            docs_url: Some("https://developer.monday.com/apps/docs/mcp".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "clickup".to_string(),
            name: "ClickUp".to_string(),
            description: "Manage tasks and docs in ClickUp".to_string(),
            category: "Productivity".to_string(),
            url: "https://mcp.clickup.com/v1".to_string(),
            docs_url: Some("https://clickup.com/api/developer-portal/mcp".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "trello".to_string(),
            name: "Trello".to_string(),
            description: "Access boards, lists and cards in Trello".to_string(),
            category: "Productivity".to_string(),
            url: "https://mcp.trello.com/v1".to_string(),
            docs_url: Some("https://developer.atlassian.com/cloud/trello/rest/api-group-actions/".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "coda".to_string(),
            name: "Coda".to_string(),
            description: "Read and write Coda docs and tables".to_string(),
            category: "Productivity".to_string(),
            url: "https://mcp.coda.io/v1".to_string(),
            docs_url: Some("https://coda.io/developers/apis/v1".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        // Google
        CatalogEntry {
            slug: "google-drive".to_string(),
            name: "Google Drive".to_string(),
            description: "Access and manage files in Google Drive".to_string(),
            category: "Google".to_string(),
            url: "https://mcp.googleapis.com/drive/v1".to_string(),
            docs_url: Some("https://developers.google.com/drive/api/guides/about-sdk".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "gmail".to_string(),
            name: "Gmail".to_string(),
            description: "Read and send emails via Gmail".to_string(),
            category: "Google".to_string(),
            url: "https://mcp.googleapis.com/gmail/v1".to_string(),
            docs_url: Some("https://developers.google.com/gmail/api/guides".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "google-calendar".to_string(),
            name: "Google Calendar".to_string(),
            description: "Manage events in Google Calendar".to_string(),
            category: "Google".to_string(),
            url: "https://mcp.googleapis.com/calendar/v1".to_string(),
            docs_url: Some("https://developers.google.com/calendar/api/guides/overview".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "google-docs".to_string(),
            name: "Google Docs".to_string(),
            description: "Create and edit Google Docs".to_string(),
            category: "Google".to_string(),
            url: "https://mcp.googleapis.com/docs/v1".to_string(),
            docs_url: Some("https://developers.google.com/docs/api/how-tos/overview".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "google-sheets".to_string(),
            name: "Google Sheets".to_string(),
            description: "Read and write Google Sheets spreadsheets".to_string(),
            category: "Google".to_string(),
            url: "https://mcp.googleapis.com/sheets/v1".to_string(),
            docs_url: Some("https://developers.google.com/sheets/api/guides/concepts".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "google-slides".to_string(),
            name: "Google Slides".to_string(),
            description: "Create and manage Google Slides presentations".to_string(),
            category: "Google".to_string(),
            url: "https://mcp.googleapis.com/slides/v1".to_string(),
            docs_url: Some("https://developers.google.com/slides/api/guides/overview".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "youtube".to_string(),
            name: "YouTube".to_string(),
            description: "Access YouTube data and manage content".to_string(),
            category: "Google".to_string(),
            url: "https://mcp.googleapis.com/youtube/v1".to_string(),
            docs_url: Some("https://developers.google.com/youtube/v3/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        // Add more as needed - keeping it focused on most common services for Phase 2
    ]
}
