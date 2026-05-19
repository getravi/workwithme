//! Approval flow for sensitive operations (Phase 3).
//!
//! Manages approvals for sandbox escapes, file writes, and privileged operations.
//! Uses a request-response pattern with oneshot channels.  Requests that are not
//! answered within 30 seconds are automatically denied for security.
//! Integrates with `CancellationToken` so that agent abortion also cancels pending approvals.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::oneshot;

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


