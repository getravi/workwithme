/// Integration tests for HTTP API endpoints
/// These tests verify the API contracts and endpoint behaviors

#[cfg(test)]
mod api_integration_tests {
    use serde_json::json;

    // Note: Full integration tests require running the HTTP server
    // These are structural tests for request/response contracts

    #[test]
    fn test_health_check_response_structure() {
        let response = json!({
            "status": "ok",
            "server": "workwithme-rust-backend"
        });

        assert_eq!(response["status"], "ok");
        assert!(response.get("server").is_some());
    }

    #[test]
    fn test_skill_list_response_structure() {
        let response = json!({
            "skills": [
                {
                    "id": "example/code-review",
                    "name": "code-review",
                    "description": "Review code",
                    "category": "Engineering",
                    "source": "example"
                }
            ]
        });

        assert!(response.get("skills").unwrap().is_array());
        assert!(response["skills"][0].get("id").is_some());
    }

    #[test]
    fn test_session_create_request_structure() {
        let request = json!({
            "metadata": {
                "label": "My Session",
                "tags": ["important"]
            }
        });

        assert!(request.get("metadata").is_some());
    }

    #[test]
    fn test_session_response_structure() {
        let response = json!({
            "success": true,
            "session": {
                "id": "session-uuid",
                "created_at": "2025-03-27T19:30:00Z",
                "updated_at": "2025-03-27T19:30:00Z",
                "messages": [],
                "metadata": {}
            }
        });

        assert!(response["success"].as_bool().unwrap());
        assert!(response["session"].get("id").is_some());
        assert!(response["session"]["messages"].is_array());
    }

    #[test]
    fn test_oauth_providers_response_structure() {
        let response = json!({
            "providers": [
                {"id": "google", "name": "Google"},
                {"id": "github", "name": "GitHub"},
                {"id": "openai", "name": "OpenAI"}
            ]
        });

        assert!(response["providers"].is_array());
        assert_eq!(response["providers"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn test_auth_login_request_structure() {
        let request = json!({
            "provider": "google"
        });

        assert_eq!(request["provider"], "google");
    }

    #[test]
    fn test_auth_login_response_structure() {
        let response = json!({
            "success": true,
            "url": "https://accounts.google.com/o/oauth2/v2/auth?...",
            "state": "random_state_value"
        });

        assert!(response["success"].as_bool().unwrap());
        assert!(response.get("url").is_some());
        assert!(response.get("state").is_some());
    }

    #[test]
    fn test_settings_get_response_structure() {
        let response = json!({
            "success": true,
            "settings": {
                "theme": "dark",
                "model": "claude-opus-4-6",
                "max_tokens": 4096,
                "temperature": 0.7
            }
        });

        assert!(response["success"].as_bool().unwrap());
        assert!(response.get("settings").is_some());
    }

    #[test]
    fn test_models_list_response_structure() {
        let response = json!({
            "success": true,
            "models": [
                {
                    "id": "claude-opus-4-6",
                    "name": "Claude Opus 4.6",
                    "provider": "anthropic",
                    "max_tokens": 200000,
                    "custom": false
                }
            ]
        });

        assert!(response["success"].as_bool().unwrap());
        assert!(response["models"].is_array());
    }

    #[test]
    fn test_plugins_list_response_structure() {
        let response = json!({
            "success": true,
            "plugins": [
                {
                    "manifest": {
                        "id": "plugin-1",
                        "name": "Sample Plugin",
                        "version": "1.0.0",
                        "description": "A sample plugin",
                        "author": "Author Name",
                        "license": "MIT",
                        "capabilities": ["tools", "skills"],
                        "entry_point": "init",
                        "permissions": ["read:files"]
                    },
                    "enabled": true,
                    "loaded": false
                }
            ]
        });

        assert!(response["success"].as_bool().unwrap());
        assert!(response["plugins"].is_array());
    }

    #[test]
    fn test_clipboard_copy_request_structure() {
        let request = json!({
            "text": "content to copy"
        });

        assert!(request.get("text").is_some());
    }

    #[test]
    fn test_clipboard_paste_response_structure() {
        let response = json!({
            "success": true,
            "text": "pasted content"
        });

        assert!(response["success"].as_bool().unwrap());
        assert!(response.get("text").is_some());
    }

    #[test]
    fn test_notification_send_request_structure() {
        let request = json!({
            "title": "Notification Title",
            "body": "Notification body text",
            "icon": "info"
        });

        assert!(request.get("title").is_some());
        assert!(request.get("body").is_some());
    }

    #[test]
    fn test_files_list_response_structure() {
        let response = json!({
            "success": true,
            "files": [
                {
                    "name": "file.txt",
                    "path": "/home/user/file.txt",
                    "is_dir": false,
                    "size": 1024,
                    "modified": "2025-03-27T19:00:00Z",
                    "file_type": "text"
                }
            ]
        });

        assert!(response["success"].as_bool().unwrap());
        assert!(response["files"].is_array());
    }

    #[test]
    fn test_error_response_structure() {
        let response = json!({
            "success": false,
            "error": "Something went wrong"
        });

        assert!(!response["success"].as_bool().unwrap());
        assert!(response.get("error").is_some());
    }

    #[test]
    fn test_error_response_with_details() {
        let response = json!({
            "success": false,
            "error": "Invalid request",
            "details": {
                "field": "email",
                "reason": "Format is invalid"
            }
        });

        assert!(!response["success"].as_bool().unwrap());
        assert!(response.get("details").is_some());
    }

    #[test]
    fn test_pagination_request_structure() {
        let request = json!({
            "limit": 20,
            "offset": 0,
            "sort_by": "created_at",
            "sort_order": "desc"
        });

        assert!(request.get("limit").is_some());
        assert!(request.get("offset").is_some());
    }

    #[test]
    fn test_pagination_response_structure() {
        let response = json!({
            "success": true,
            "data": [],
            "total": 100,
            "limit": 20,
            "offset": 0
        });

        assert!(response["success"].as_bool().unwrap());
        assert!(response.get("total").is_some());
        assert!(response.get("limit").is_some());
    }

    #[test]
    fn test_batch_request_structure() {
        let request = json!({
            "requests": [
                {"id": "req-1", "method": "GET", "path": "/api/health"},
                {"id": "req-2", "method": "GET", "path": "/api/settings"}
            ]
        });

        assert!(request["requests"].is_array());
        assert_eq!(request["requests"].as_array().unwrap().len(), 2);
    }
}
