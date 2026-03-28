// Phase 3: Approval Flow for Sensitive Operations
// ================================================
//
// Manages approvals for sandbox escapes, file writes, and privileged operations
// - Request-response pattern with oneshot channels
// - 30-second auto-denial timeout for security
// - CancellationToken integration for agent abortion

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::oneshot;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

/// Global approval manager instance
pub static APPROVAL_MANAGER: OnceLock<ApprovalManager> = OnceLock::new();

/// Initialize the global approval manager
pub fn init_approval_manager() {
    let _ = APPROVAL_MANAGER.set(ApprovalManager::new());
}

/// Approval request for sensitive operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub id: String,
    pub operation_type: String,
    pub description: String,
    pub details: serde_json::Value,
}

/// Approval response from user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalResponse {
    pub id: String,
    pub approved: bool,
}

/// Manages pending approval requests
pub struct ApprovalManager {
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

impl ApprovalManager {
    /// Create new approval manager
    pub fn new() -> Self {
        ApprovalManager {
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Request approval for an operation
    /// Returns a channel to wait for the user's response
    pub fn request_approval(&self, request: ApprovalRequest) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        let mut pending = match self.pending.lock() {
            Ok(p) => p,
            Err(poisoned) => {
                eprintln!("[approval] mutex poisoned in request_approval, recovering");
                poisoned.into_inner()
            }
        };
        pending.insert(request.id.clone(), tx);
        rx
    }

    /// Respond to an approval request
    pub fn respond(&self, response: ApprovalResponse) -> bool {
        let mut pending = match self.pending.lock() {
            Ok(p) => p,
            Err(poisoned) => {
                eprintln!("[approval] mutex poisoned in respond, recovering");
                poisoned.into_inner()
            }
        };
        if let Some(tx) = pending.remove(&response.id) {
            tx.send(response.approved).ok();
            true
        } else {
            false
        }
    }

    /// Get list of pending approvals (for future frontend integration)
    pub fn get_pending(&self) -> Vec<String> {
        let pending = match self.pending.lock() {
            Ok(p) => p,
            Err(poisoned) => {
                eprintln!("[approval] mutex poisoned in get_pending, recovering");
                poisoned.into_inner()
            }
        };
        pending.keys().cloned().collect()
    }
}

impl Clone for ApprovalManager {
    fn clone(&self) -> Self {
        ApprovalManager {
            pending: Arc::clone(&self.pending),
        }
    }
}

impl Default for ApprovalManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Create an approval request for file write operation
pub fn create_write_file_approval_request(
    path: &str,
    content_preview: &str,
) -> ApprovalRequest {
    let content_preview = if content_preview.len() > 200 {
        format!("{}...", &content_preview[..200])
    } else {
        content_preview.to_string()
    };

    ApprovalRequest {
        id: Uuid::new_v4().to_string(),
        operation_type: "write_file".to_string(),
        description: format!("Write file: {}", path),
        details: serde_json::json!({
            "path": path,
            "content_preview": content_preview,
        }),
    }
}

/// Create an approval request for bash command with write access
pub fn create_bash_write_approval_request(command: &str) -> ApprovalRequest {
    let command_preview = if command.len() > 100 {
        format!("{}...", &command[..100])
    } else {
        command.to_string()
    };

    ApprovalRequest {
        id: Uuid::new_v4().to_string(),
        operation_type: "bash_write".to_string(),
        description: "Execute bash command with write access".to_string(),
        details: serde_json::json!({
            "command": command_preview,
        }),
    }
}

/// Phase 3: Create approval request for sandbox escape (privilege escalation)
pub fn create_sandbox_approval_request(
    operation: &str,
    reason: &str,
    details: serde_json::Value,
) -> ApprovalRequest {
    ApprovalRequest {
        id: Uuid::new_v4().to_string(),
        operation_type: "sandbox_escape".to_string(),
        description: format!("Sandbox escape: {} ({})", operation, reason),
        details: serde_json::json!({
            "operation": operation,
            "reason": reason,
            "context": details,
        }),
    }
}

/// Phase 3: Wait for approval with 30-second timeout
/// Returns true if approved, false if denied or timeout expires
pub async fn wait_for_approval_with_timeout(rx: oneshot::Receiver<bool>) -> bool {
    match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(approved)) => approved,
        Ok(Err(_)) => {
            // Channel closed without response
            eprintln!("[approval] channel closed without response, auto-denying");
            false
        }
        Err(_) => {
            // 30-second timeout expired
            eprintln!("[approval] approval timeout (30s), auto-denying for security");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_approval_request_and_response() {
        let manager = ApprovalManager::new();
        let request = create_write_file_approval_request("/tmp/test.txt", "test content");
        let request_id = request.id.clone();

        let rx = manager.request_approval(request);

        // Simulate user approval
        let response = ApprovalResponse {
            id: request_id,
            approved: true,
        };
        manager.respond(response);

        // Wait for response
        let approved = rx.await.unwrap();
        assert!(approved);
    }

    #[tokio::test]
    async fn test_approval_rejection() {
        let manager = ApprovalManager::new();
        let request = create_write_file_approval_request("/tmp/test.txt", "test content");
        let request_id = request.id.clone();

        let rx = manager.request_approval(request);

        let response = ApprovalResponse {
            id: request_id,
            approved: false,
        };
        manager.respond(response);

        let approved = rx.await.unwrap();
        assert!(!approved);
    }

    #[test]
    fn test_invalid_response_id() {
        let manager = ApprovalManager::new();
        let request = create_write_file_approval_request("/tmp/test.txt", "test content");
        let _rx = manager.request_approval(request);

        let response = ApprovalResponse {
            id: "invalid_id".to_string(),
            approved: true,
        };
        let result = manager.respond(response);
        assert!(!result);
    }

    #[test]
    fn test_sandbox_approval_request_creation() {
        let request = create_sandbox_approval_request(
            "read_system_files",
            "requires root",
            serde_json::json!({"required_level": "root"}),
        );

        assert_eq!(request.operation_type, "sandbox_escape");
        assert!(request.description.contains("Sandbox escape"));
        assert!(request.details.get("operation").is_some());
    }

    #[tokio::test]
    async fn test_approval_timeout() {
        let (_tx, rx) = tokio::sync::oneshot::channel();
        // Don't send anything - let it timeout
        let approved = wait_for_approval_with_timeout(rx).await;
        assert!(!approved); // Should deny on timeout
    }

    #[tokio::test]
    async fn test_approval_with_timeout_approved() {
        let (tx, rx) = tokio::sync::oneshot::channel();
        tx.send(true).ok();
        let approved = wait_for_approval_with_timeout(rx).await;
        assert!(approved);
    }

    #[tokio::test]
    async fn test_approval_with_timeout_denied() {
        let (tx, rx) = tokio::sync::oneshot::channel();
        tx.send(false).ok();
        let approved = wait_for_approval_with_timeout(rx).await;
        assert!(!approved);
    }
}
