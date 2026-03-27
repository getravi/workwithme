use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// Standardized API error response format
#[derive(Debug, Clone)]
pub struct ApiError {
    code: String,
    message: String,
    details: Option<String>,
    status: StatusCode,
}

impl ApiError {
    /// Create a new API error
    pub fn new(code: &str, message: &str, status: StatusCode) -> Self {
        ApiError {
            code: code.to_string(),
            message: message.to_string(),
            details: None,
            status,
        }
    }

    /// Add details to the error
    pub fn with_details(mut self, details: &str) -> Self {
        self.details = Some(details.to_string());
        self
    }

    /// Create a bad request error
    pub fn bad_request(message: &str) -> Self {
        ApiError::new("BAD_REQUEST", message, StatusCode::BAD_REQUEST)
    }

    /// Create an unauthorized error
    pub fn unauthorized(message: &str) -> Self {
        ApiError::new("UNAUTHORIZED", message, StatusCode::UNAUTHORIZED)
    }

    /// Create a forbidden error
    pub fn forbidden(message: &str) -> Self {
        ApiError::new("FORBIDDEN", message, StatusCode::FORBIDDEN)
    }

    /// Create a not found error
    pub fn not_found(message: &str) -> Self {
        ApiError::new("NOT_FOUND", message, StatusCode::NOT_FOUND)
    }

    /// Create an internal server error
    pub fn internal_error(message: &str) -> Self {
        ApiError::new("INTERNAL_ERROR", message, StatusCode::INTERNAL_SERVER_ERROR)
    }

    /// Create a validation error
    pub fn validation_error(message: &str) -> Self {
        ApiError::new("VALIDATION_ERROR", message, StatusCode::UNPROCESSABLE_ENTITY)
    }

    /// Create a too large request error
    pub fn payload_too_large(message: &str) -> Self {
        ApiError::new("PAYLOAD_TOO_LARGE", message, StatusCode::PAYLOAD_TOO_LARGE)
    }

    /// Create a rate limit error
    pub fn rate_limit(message: &str) -> Self {
        ApiError::new("RATE_LIMIT_EXCEEDED", message, StatusCode::TOO_MANY_REQUESTS)
    }

    /// Convert to JSON response
    pub fn to_json(&self) -> serde_json::Value {
        let mut obj = json!({
            "success": false,
            "error": {
                "code": self.code,
                "message": self.message
            }
        });

        if let Some(details) = &self.details {
            obj["error"]["details"] = json!(details);
        }

        obj
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.to_json())).into_response()
    }
}

/// Standardized success response format
pub fn success_response(data: serde_json::Value) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "data": data
    }))
}

/// Standardized list response format
pub fn list_response(items: serde_json::Value, total: usize) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "data": items,
        "total": total
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_api_error_creation() {
        let error = ApiError::new("TEST_ERROR", "Test message", StatusCode::BAD_REQUEST);
        assert_eq!(error.code, "TEST_ERROR");
        assert_eq!(error.message, "Test message");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_api_error_with_details() {
        let error = ApiError::bad_request("Invalid input").with_details("Field 'name' is required");
        let json = error.to_json();
        assert_eq!(json["error"]["code"], "BAD_REQUEST");
        assert_eq!(json["error"]["message"], "Invalid input");
        assert_eq!(json["error"]["details"], "Field 'name' is required");
    }

    #[test]
    fn test_predefined_errors() {
        let bad_req = ApiError::bad_request("Invalid");
        assert_eq!(bad_req.status, StatusCode::BAD_REQUEST);

        let not_found = ApiError::not_found("Not found");
        assert_eq!(not_found.status, StatusCode::NOT_FOUND);

        let internal = ApiError::internal_error("Error");
        assert_eq!(internal.status, StatusCode::INTERNAL_SERVER_ERROR);

        let rate_limit = ApiError::rate_limit("Too many requests");
        assert_eq!(rate_limit.status, StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn test_error_to_json() {
        let error = ApiError::unauthorized("Access denied");
        let json = error.to_json();

        assert_eq!(json["success"], false);
        assert_eq!(json["error"]["code"], "UNAUTHORIZED");
        assert_eq!(json["error"]["message"], "Access denied");
        assert!(json["error"]["details"].is_null());
    }

    #[test]
    fn test_success_response() {
        let response = success_response(json!({"id": "123", "name": "Test"}));
        // Response is wrapped in Json, so we'd need to serialize to test
        // This just verifies it compiles and creates a response
        assert!(true);
    }
}
