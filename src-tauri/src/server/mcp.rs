use serde_json::{json, Value};
use serde::{Serialize, Deserialize};
use std::fs;
use std::path::PathBuf;

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

/// Get the hardcoded MCP catalog (50+ services)
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
        CatalogEntry {
            slug: "zoom".to_string(),
            name: "Zoom".to_string(),
            description: "Schedule meetings and manage Zoom integrations".to_string(),
            category: "Communication".to_string(),
            url: "https://mcp.zoom.us/v1".to_string(),
            docs_url: Some("https://developers.zoom.us/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "intercom".to_string(),
            name: "Intercom".to_string(),
            description: "Manage customer conversations and support".to_string(),
            category: "Communication".to_string(),
            url: "https://mcp.intercom.com/v1".to_string(),
            docs_url: Some("https://developers.intercom.com/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "zendesk".to_string(),
            name: "Zendesk".to_string(),
            description: "Manage support tickets and customer service".to_string(),
            category: "Communication".to_string(),
            url: "https://mcp.zendesk.com/v1".to_string(),
            docs_url: Some("https://developer.zendesk.com/api".to_string()),
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
        // Design (2)
        CatalogEntry {
            slug: "figma".to_string(),
            name: "Figma".to_string(),
            description: "Access and manage Figma designs and files".to_string(),
            category: "Design".to_string(),
            url: "https://mcp.figma.com/v1".to_string(),
            docs_url: Some("https://www.figma.com/developers/api".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "adobe-creative-cloud".to_string(),
            name: "Adobe Creative Cloud".to_string(),
            description: "Access Adobe Creative Cloud applications".to_string(),
            category: "Design".to_string(),
            url: "https://mcp.adobe.com/v1".to_string(),
            docs_url: Some("https://developer.adobe.com/console".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        // CRM (2)
        CatalogEntry {
            slug: "salesforce".to_string(),
            name: "Salesforce".to_string(),
            description: "Manage Salesforce CRM data and contacts".to_string(),
            category: "CRM".to_string(),
            url: "https://mcp.salesforce.com/v1".to_string(),
            docs_url: Some("https://developer.salesforce.com/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "hubspot".to_string(),
            name: "HubSpot".to_string(),
            description: "Manage HubSpot CRM, marketing, and sales".to_string(),
            category: "CRM".to_string(),
            url: "https://mcp.hubapi.com/v1".to_string(),
            docs_url: Some("https://developers.hubspot.com/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        // Backend & Databases (3)
        CatalogEntry {
            slug: "supabase".to_string(),
            name: "Supabase".to_string(),
            description: "Access Supabase PostgreSQL databases and storage".to_string(),
            category: "Backend".to_string(),
            url: "https://mcp.supabase.com/v1".to_string(),
            docs_url: Some("https://supabase.com/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "firebase".to_string(),
            name: "Firebase".to_string(),
            description: "Access Firebase database and services".to_string(),
            category: "Backend".to_string(),
            url: "https://mcp.firebase.com/v1".to_string(),
            docs_url: Some("https://firebase.google.com/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        CatalogEntry {
            slug: "mongodb".to_string(),
            name: "MongoDB".to_string(),
            description: "Query and manage MongoDB databases".to_string(),
            category: "Backend".to_string(),
            url: "https://mcp.mongodb.com/v1".to_string(),
            docs_url: Some("https://www.mongodb.com/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        // Marketing (1)
        CatalogEntry {
            slug: "mailchimp".to_string(),
            name: "Mailchimp".to_string(),
            description: "Manage email campaigns and marketing lists".to_string(),
            category: "Marketing".to_string(),
            url: "https://mcp.mailchimp.com/v1".to_string(),
            docs_url: Some("https://mailchimp.com/developer".to_string()),
            requires_token: true,
            logo_svg: None,
        },
        // Streaming (1)
        CatalogEntry {
            slug: "twitch".to_string(),
            name: "Twitch".to_string(),
            description: "Access Twitch channels and stream data".to_string(),
            category: "Streaming".to_string(),
            url: "https://mcp.twitch.tv/v1".to_string(),
            docs_url: Some("https://dev.twitch.tv/docs".to_string()),
            requires_token: true,
            logo_svg: None,
        },
    ]
}

/// MCP Tool definition (from tools_list response)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader, Write};

/// Spawn an MCP stdio server and query its tools — used by `load_agent_mcp_tools`
#[allow(dead_code)]
async fn query_mcp_server_tools(server_config: &Value) -> Result<Vec<McpTool>, String> {
    // Get the command to run - could be a direct binary or a node/python script
    let command_str = server_config
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or("MCP server config missing 'command' field".to_string())?;

    // Parse command and args
    let parts: Vec<&str> = command_str.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Empty command in MCP server config".to_string());
    }

    // Spawn the stdio server process
    let mut child = Command::new(parts[0])
        .args(&parts[1..])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn MCP server: {}", e))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or("Failed to get stdin handle".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to get stdout handle".to_string())?;

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    // Send JSON-RPC initialize request
    let init_request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "clientInfo": {
                "name": "workwithme",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    });

    stdin
        .write_all(format!("{}\n", init_request.to_string()).as_bytes())
        .map_err(|e| format!("Failed to write initialize request: {}", e))?;

    // Read initialize response
    let _init_response = lines
        .next()
        .ok_or("No response from MCP server")?
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Send tools_list request
    let tools_request = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    });

    stdin
        .write_all(format!("{}\n", tools_request.to_string()).as_bytes())
        .map_err(|e| format!("Failed to write tools_list request: {}", e))?;

    // Read tools response
    let response_str = lines
        .next()
        .ok_or("No tools response from MCP server")?
        .map_err(|e| format!("Failed to read tools response: {}", e))?;

    let response: Value = serde_json::from_str(&response_str)
        .map_err(|e| format!("Failed to parse tools response: {}", e))?;

    // Extract tools from result
    let tools = response
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .ok_or("Invalid tools response format".to_string())?;

    let mut mcp_tools = Vec::new();
    for tool_value in tools {
        if let Ok(tool) = serde_json::from_value::<McpTool>(tool_value.clone()) {
            mcp_tools.push(tool);
        }
    }

    // Kill the process
    let _ = child.kill();

    Ok(mcp_tools)
}

/// Load all enabled MCP tools from configuration — forward scaffolding for MCP → pi bridge
#[allow(dead_code)]
pub async fn load_agent_mcp_tools() -> Vec<ToolDefinition> {
    let config = match load_mcp_config() {
        Ok(cfg) => cfg,
        Err(_) => return Vec::new(),
    };

    let mut tools = Vec::new();

    if let Some(servers) = config.get("mcpServers").and_then(|s| s.as_object()) {
        for (slug, server_config) in servers {
            // Check if server is enabled
            if let Some(false) = server_config.get("enabled").and_then(|e| e.as_bool()) {
                continue;
            }

            match query_mcp_server_tools(server_config).await {
                Ok(mcp_tools) => {
                    for mcp_tool in mcp_tools {
                        tools.push(ToolDefinition {
                            name: mcp_tool.name,
                            description: mcp_tool.description,
                            input_schema: mcp_tool.input_schema,
                        });
                    }
                }
                Err(e) => {
                    eprintln!("Failed to load tools from MCP server '{}': {}", slug, e);
                }
            }
        }
    }

    tools
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
