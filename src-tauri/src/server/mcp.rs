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
        "192.168.",
        "10.",
        "172.1",
        "172.2",
        "172.3",
        "[::1]",
        "[::ffff:",
        "169.254.",
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

/// Get the hardcoded MCP catalog (40+ services)
pub fn get_catalog() -> Vec<CatalogEntry> {
    vec![
        // Productivity (10)
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
            docs_url: Some("https://zapier.com/docs/mcp".to_string()),
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
            docs_url: Some("https://developer.atlassian.com/cloud/trello/api".to_string()),
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
        // Google (7)
        CatalogEntry {
            slug: "google-drive".to_string(),
            name: "Google Drive".to_string(),
            description: "Access and manage files in Google Drive".to_string(),
            category: "Google".to_string(),
            url: "https://mcp.googleapis.com/drive/v1".to_string(),
            docs_url: Some("https://developers.google.com/drive/api".to_string()),
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
            docs_url: Some("https://developers.google.com/calendar/api".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "google-docs".to_string(),
            name: "Google Docs".to_string(),
            description: "Create and edit Google Docs".to_string(),
            category: "Google".to_string(),
            url: "https://mcp.googleapis.com/docs/v1".to_string(),
            docs_url: Some("https://developers.google.com/docs/api".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "google-sheets".to_string(),
            name: "Google Sheets".to_string(),
            description: "Read and write Google Sheets spreadsheets".to_string(),
            category: "Google".to_string(),
            url: "https://mcp.googleapis.com/sheets/v1".to_string(),
            docs_url: Some("https://developers.google.com/sheets/api".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "google-slides".to_string(),
            name: "Google Slides".to_string(),
            description: "Create and manage Google Slides presentations".to_string(),
            category: "Google".to_string(),
            url: "https://mcp.googleapis.com/slides/v1".to_string(),
            docs_url: Some("https://developers.google.com/slides/api".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "youtube".to_string(),
            name: "YouTube".to_string(),
            description: "Access YouTube data and manage content".to_string(),
            category: "Google".to_string(),
            url: "https://mcp.googleapis.com/youtube/v1".to_string(),
            docs_url: Some("https://developers.google.com/youtube/v3".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        // Development (8)
        CatalogEntry {
            slug: "github".to_string(),
            name: "GitHub".to_string(),
            description: "Manage repositories, issues, and pull requests".to_string(),
            category: "Development".to_string(),
            url: "https://mcp.github.com/v1".to_string(),
            docs_url: Some("https://docs.github.com/en/rest".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "gitlab".to_string(),
            name: "GitLab".to_string(),
            description: "Access GitLab projects and CI/CD pipelines".to_string(),
            category: "Development".to_string(),
            url: "https://mcp.gitlab.com/v1".to_string(),
            docs_url: Some("https://docs.gitlab.com/ee/api".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "bitbucket".to_string(),
            name: "Bitbucket".to_string(),
            description: "Manage Bitbucket repositories and pipelines".to_string(),
            category: "Development".to_string(),
            url: "https://mcp.bitbucket.com/v1".to_string(),
            docs_url: Some("https://developer.atlassian.com/cloud/bitbucket/rest".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "vercel".to_string(),
            name: "Vercel".to_string(),
            description: "Deploy and manage projects on Vercel".to_string(),
            category: "Development".to_string(),
            url: "https://mcp.vercel.com/v1".to_string(),
            docs_url: Some("https://vercel.com/docs/api".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "heroku".to_string(),
            name: "Heroku".to_string(),
            description: "Deploy and manage apps on Heroku".to_string(),
            category: "Development".to_string(),
            url: "https://mcp.heroku.com/v1".to_string(),
            docs_url: Some("https://devcenter.heroku.com/articles/platform-api-reference".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "aws".to_string(),
            name: "Amazon AWS".to_string(),
            description: "Access and manage AWS resources".to_string(),
            category: "Development".to_string(),
            url: "https://mcp.aws.amazon.com/v1".to_string(),
            docs_url: Some("https://docs.aws.amazon.com/sdk".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "azure".to_string(),
            name: "Microsoft Azure".to_string(),
            description: "Manage Azure resources and services".to_string(),
            category: "Development".to_string(),
            url: "https://mcp.azure.com/v1".to_string(),
            docs_url: Some("https://learn.microsoft.com/en-us/azure".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "gcp".to_string(),
            name: "Google Cloud Platform".to_string(),
            description: "Access GCP resources and services".to_string(),
            category: "Development".to_string(),
            url: "https://mcp.googleapis.com/cloud/v1".to_string(),
            docs_url: Some("https://cloud.google.com/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        // Communication (5)
        CatalogEntry {
            slug: "slack".to_string(),
            name: "Slack".to_string(),
            description: "Send messages and manage Slack workspaces".to_string(),
            category: "Communication".to_string(),
            url: "https://mcp.slack.com/v1".to_string(),
            docs_url: Some("https://api.slack.com".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "discord".to_string(),
            name: "Discord".to_string(),
            description: "Manage Discord servers and send messages".to_string(),
            category: "Communication".to_string(),
            url: "https://mcp.discord.com/v1".to_string(),
            docs_url: Some("https://discord.com/developers/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "telegram".to_string(),
            name: "Telegram".to_string(),
            description: "Send messages via Telegram bot".to_string(),
            category: "Communication".to_string(),
            url: "https://mcp.telegram.org/v1".to_string(),
            docs_url: Some("https://core.telegram.org/bots/api".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "twilio".to_string(),
            name: "Twilio".to_string(),
            description: "Send SMS and voice messages".to_string(),
            category: "Communication".to_string(),
            url: "https://mcp.twilio.com/v1".to_string(),
            docs_url: Some("https://www.twilio.com/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "sendgrid".to_string(),
            name: "SendGrid".to_string(),
            description: "Send emails with SendGrid".to_string(),
            category: "Communication".to_string(),
            url: "https://mcp.sendgrid.com/v1".to_string(),
            docs_url: Some("https://docs.sendgrid.com".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        // Data & Analytics (5)
        CatalogEntry {
            slug: "datadog".to_string(),
            name: "Datadog".to_string(),
            description: "Monitor and analyze metrics with Datadog".to_string(),
            category: "Data & Analytics".to_string(),
            url: "https://mcp.datadoghq.com/v1".to_string(),
            docs_url: Some("https://docs.datadoghq.com/api".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "elastic".to_string(),
            name: "Elastic".to_string(),
            description: "Search and analyze data with Elastic".to_string(),
            category: "Data & Analytics".to_string(),
            url: "https://mcp.elastic.co/v1".to_string(),
            docs_url: Some("https://www.elastic.co/guide/en/elasticsearch/reference".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "mixpanel".to_string(),
            name: "Mixpanel".to_string(),
            description: "Track and analyze user analytics".to_string(),
            category: "Data & Analytics".to_string(),
            url: "https://mcp.mixpanel.com/v1".to_string(),
            docs_url: Some("https://developer.mixpanel.com".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "segment".to_string(),
            name: "Segment".to_string(),
            description: "Collect and manage customer data".to_string(),
            category: "Data & Analytics".to_string(),
            url: "https://mcp.segment.com/v1".to_string(),
            docs_url: Some("https://segment.com/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "tableau".to_string(),
            name: "Tableau".to_string(),
            description: "Create and share data visualizations".to_string(),
            category: "Data & Analytics".to_string(),
            url: "https://mcp.tableau.com/v1".to_string(),
            docs_url: Some("https://help.tableau.com/current/api".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        // Finance (3)
        CatalogEntry {
            slug: "stripe".to_string(),
            name: "Stripe".to_string(),
            description: "Process payments and manage subscriptions".to_string(),
            category: "Finance".to_string(),
            url: "https://mcp.stripe.com/v1".to_string(),
            docs_url: Some("https://stripe.com/docs/api".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "square".to_string(),
            name: "Square".to_string(),
            description: "Manage payments and invoices".to_string(),
            category: "Finance".to_string(),
            url: "https://mcp.squareup.com/v1".to_string(),
            docs_url: Some("https://developer.squareup.com/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "quickbooks".to_string(),
            name: "QuickBooks".to_string(),
            description: "Manage accounting and invoices".to_string(),
            category: "Finance".to_string(),
            url: "https://mcp.quickbooks.intuit.com/v1".to_string(),
            docs_url: Some("https://developer.intuit.com/app/developer/qbo/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_config_path() {
        let path = mcp_config_path();
        assert!(path.to_string_lossy().contains(".pi/agent/mcp.json"));
    }

    #[test]
    fn test_catalog_has_entries() {
        let catalog = get_catalog();
        assert!(catalog.len() >= 35); // We have 38 entries
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
}
