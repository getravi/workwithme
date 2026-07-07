//! HTTP endpoint handlers for the `oauth` API surface.
//! Extracted from `server/mod.rs`; `super::*` resolves to the parent `server` module.

use super::*;
use axum::extract::Query;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct LoginRequest {
    pub provider: String,
}

#[derive(Deserialize)]
pub struct CompleteLoginRequest {
    #[serde(rename = "pendingId", alias = "pending_id")]
    pub pending_id: String,
    #[serde(rename = "codeInput", alias = "code_input")]
    pub code_input: Option<String>,
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct LogoutRequest {
    pub provider: String,
    pub user_id: String,
}

/// List available OAuth providers
pub async fn list_providers() -> Json<serde_json::Value> {
    let providers = oauth::get_oauth_providers();
    Json(json!({
        "providers": providers
    }))
}

/// Initiate a pi_agent_rust-backed OAuth login flow.
pub async fn login(Query(req): Query<LoginRequest>) -> (StatusCode, Json<serde_json::Value>) {
    let provider = req.provider.clone();
    let pending_id = uuid::Uuid::new_v4().to_string();

    if provider == "kimi-for-coding" {
        match pi::auth::start_kimi_code_device_flow().await {
            Ok(device) => {
                let verification_url = device
                    .verification_uri_complete
                    .clone()
                    .unwrap_or_else(|| device.verification_uri.clone());
                pi_oauth_pending().lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .insert(pending_id.clone(), PiOAuthPending {
                        provider: provider.clone(),
                        kind: PiOAuthPendingKind::DeviceFlow,
                        verifier: String::new(),
                        device_code: Some(device.device_code),
                    });

                (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "provider": provider,
                        "pendingId": pending_id,
                        "kind": "device",
                        "url": verification_url,
                        "instructions": format!(
                            "If prompted, enter this code: {}. After approving access in the browser, click Complete setup.",
                            device.user_code
                        ),
                        "message": "Open the link below and approve access to continue."
                    }))
                )
            }
            Err(e) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "success": false, "error": e.to_string() }))
            ),
        }
    } else {
        let oauth_result = if provider == "anthropic" {
            pi::auth::start_anthropic_oauth().map(|info| (info.provider, info.url, info.verifier, info.instructions))
        } else if provider == "openai-codex" {
            pi::auth::start_openai_codex_oauth().map(|info| (info.provider, info.url, info.verifier, info.instructions))
        } else if provider == "google-gemini-cli" {
            pi::auth::start_google_gemini_cli_oauth().map(|info| (info.provider, info.url, info.verifier, info.instructions))
        } else if provider == "google-antigravity" {
            pi::auth::start_google_antigravity_oauth().map(|info| (info.provider, info.url, info.verifier, info.instructions))
        } else if provider == "github-copilot" || provider == "copilot" {
            let client_id = std::env::var("GITHUB_COPILOT_CLIENT_ID").unwrap_or_default();
            let config = pi::auth::CopilotOAuthConfig {
                client_id,
                ..pi::auth::CopilotOAuthConfig::default()
            };
            pi::auth::start_copilot_browser_oauth(&config).map(|info| (info.provider, info.url, info.verifier, info.instructions))
        } else if provider == "gitlab" || provider == "gitlab-duo" {
            let client_id = std::env::var("GITLAB_CLIENT_ID").unwrap_or_default();
            let base_url = std::env::var("GITLAB_BASE_URL")
                .unwrap_or_else(|_| "https://gitlab.com".to_string());
            let config = pi::auth::GitLabOAuthConfig {
                client_id,
                base_url,
                ..pi::auth::GitLabOAuthConfig::default()
            };
            pi::auth::start_gitlab_oauth(&config).map(|info| (info.provider, info.url, info.verifier, info.instructions))
        } else {
            Err(pi::error::Error::auth(format!("Login not supported for {provider}")))
        };

        match oauth_result {
            Ok((resolved_provider, url, verifier, instructions)) => {
                pi_oauth_pending().lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .insert(pending_id.clone(), PiOAuthPending {
                        provider: resolved_provider.clone(),
                        kind: PiOAuthPendingKind::OAuth,
                        verifier,
                        device_code: None,
                    });

                (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "provider": resolved_provider,
                        "pendingId": pending_id,
                        "kind": "oauth",
                        "url": url,
                        "instructions": instructions,
                        "message": "Open the link below, then paste the callback URL or authorization code to continue."
                    }))
                )
            }
            Err(e) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "success": false, "error": e.to_string() }))
            ),
        }
    }
}

pub async fn complete_login(Json(req): Json<CompleteLoginRequest>) -> (StatusCode, Json<serde_json::Value>) {
    let pending = {
        pi_oauth_pending().lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(&req.pending_id)
            .cloned()
    };

    let Some(pending) = pending else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "success": false, "error": "Login session not found or expired." }))
        );
    };

    let mut auth = match pi::auth::AuthStorage::load_async(pi::config::Config::auth_path()).await {
        Ok(auth) => auth,
        Err(e) => return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() }))
        ),
    };

    let credential_result = match pending.kind {
        PiOAuthPendingKind::OAuth => {
            let code_input = req.code_input.as_deref().unwrap_or("").trim().to_string();
            if code_input.is_empty() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "success": false, "error": "Paste the callback URL or authorization code to continue." }))
                );
            }

            if pending.provider == "anthropic" {
                pi::auth::complete_anthropic_oauth(&code_input, &pending.verifier).await.map_err(|e| e.to_string())
            } else if pending.provider == "openai-codex" {
                pi::auth::complete_openai_codex_oauth(&code_input, &pending.verifier).await.map_err(|e| e.to_string())
            } else if pending.provider == "google-gemini-cli" {
                pi::auth::complete_google_gemini_cli_oauth(&code_input, &pending.verifier).await.map_err(|e| e.to_string())
            } else if pending.provider == "google-antigravity" {
                pi::auth::complete_google_antigravity_oauth(&code_input, &pending.verifier).await.map_err(|e| e.to_string())
            } else if pending.provider == "github-copilot" || pending.provider == "copilot" {
                let client_id = std::env::var("GITHUB_COPILOT_CLIENT_ID").unwrap_or_default();
                let config = pi::auth::CopilotOAuthConfig {
                    client_id,
                    ..pi::auth::CopilotOAuthConfig::default()
                };
                pi::auth::complete_copilot_browser_oauth(&config, &code_input, &pending.verifier).await.map_err(|e| e.to_string())
            } else if pending.provider == "gitlab" || pending.provider == "gitlab-duo" {
                let client_id = std::env::var("GITLAB_CLIENT_ID").unwrap_or_default();
                let base_url = std::env::var("GITLAB_BASE_URL")
                    .unwrap_or_else(|_| "https://gitlab.com".to_string());
                let config = pi::auth::GitLabOAuthConfig {
                    client_id,
                    base_url,
                    ..pi::auth::GitLabOAuthConfig::default()
                };
                pi::auth::complete_gitlab_oauth(&config, &code_input, &pending.verifier).await.map_err(|e| e.to_string())
            } else {
                Err(format!("Login completion not supported for {}", pending.provider))
            }
        }
        PiOAuthPendingKind::DeviceFlow => {
            let Some(device_code) = pending.device_code.as_deref() else {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "success": false, "error": "Device flow is missing a device code." }))
                );
            };

            match pi::auth::poll_kimi_code_device_flow(device_code).await {
                pi::auth::DeviceFlowPollResult::Success(credential) => Ok(credential),
                pi::auth::DeviceFlowPollResult::Pending => Err("Authorization is still pending. Approve access in the browser, then try again.".to_string()),
                pi::auth::DeviceFlowPollResult::SlowDown => Err("Authorization server asked to slow down. Wait a few seconds and try again.".to_string()),
                pi::auth::DeviceFlowPollResult::Expired => Err("Device code expired. Start setup again.".to_string()),
                pi::auth::DeviceFlowPollResult::AccessDenied => Err("Authorization was denied.".to_string()),
                pi::auth::DeviceFlowPollResult::Error(err) => Err(err),
            }
        }
    };

    match credential_result {
        Ok(credential) => {
            auth.set(pending.provider.clone(), credential);
            if let Err(e) = auth.save_async().await {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "success": false, "error": e.to_string() }))
                );
            }

            pi_oauth_pending().lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(&req.pending_id);

            (
                StatusCode::OK,
                Json(json!({ "success": true, "provider": pending.provider }))
            )
        }
        Err(error) => {
            let status = if error.contains("pending") || error.contains("slow down") {
                StatusCode::CONFLICT
            } else {
                StatusCode::BAD_REQUEST
            };
            (status, Json(json!({ "success": false, "error": error })))
        }
    }
}

/// Handle OAuth callback
pub async fn callback(Query(query): Query<CallbackQuery>) -> (StatusCode, Json<serde_json::Value>) {
    if let Some(error) = query.error {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "error": format!("OAuth error: {}", error)
            }))
        );
    }

    let code = match query.code {
        Some(c) => c,
        None => return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "error": "Missing authorization code"
            }))
        ),
    };

    let state = match query.state {
        Some(s) => s,
        None => return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "error": "Missing state parameter"
            }))
        ),
    };

    // Validate and retrieve provider from state, removes state after validation
    let provider = match oauth::validate_and_remove_auth_state(&state) {
        Ok(p) => p,
        Err(e) => return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "error": format!("State validation failed: {}", e)
            }))
        ),
    };

    match oauth::exchange_code_for_token(&provider, &code, &state).await {
        Ok(creds) => {
            // Signal the waiting SSE stream that auth completed successfully
            if let Some(tx) = oauth_completions().lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(&state)
            {
                let _ = tx.send(Ok(()));
            }

            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "credentials": {
                        "provider": creds.provider,
                        "access_token": creds.access_token,
                        "refresh_token": creds.refresh_token,
                        "expires_at": creds.expires_at
                    }
                }))
            )
        }
        Err(e) => {
            // Signal the waiting SSE stream that auth failed
            if let Some(tx) = oauth_completions().lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(&state)
            {
                let _ = tx.send(Err(format!("Token exchange failed: {}", e)));
            }

            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "error": format!("Token exchange failed: {}", e)
                }))
            )
        }
    }
}

/// Get authentication status
pub async fn status() -> Json<serde_json::Value> {
    let mut authenticated = vec![];
    let auth = pi::auth::AuthStorage::load(pi::config::Config::auth_path()).ok();

    for provider in oauth::get_oauth_providers() {
        let is_active = auth.as_ref().map(|auth| {
            !matches!(
                auth.credential_status(&provider.id),
                pi::auth::CredentialStatus::Missing | pi::auth::CredentialStatus::OAuthExpired { .. }
            )
        }).unwrap_or(false);

        if is_active {
            authenticated.push(provider.id);
        }
    }

    Json(json!({
        "authenticated_providers": authenticated,
        "has_credentials": !authenticated.is_empty()
    }))
}

/// Logout from OAuth provider
pub async fn logout(Json(req): Json<LogoutRequest>) -> Json<serde_json::Value> {
    match oauth::delete_credentials(&req.provider, &req.user_id) {
        Ok(_) => {
            Json(json!({
                "success": true,
                "message": format!("Logged out from {}", req.provider)
            }))
        }
        Err(e) => {
            Json(json!({
                "success": false,
                "error": e
            }))
        }
    }
}
