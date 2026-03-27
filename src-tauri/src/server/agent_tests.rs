/// Comprehensive tests for agent session management
#[cfg(test)]
mod agent_tests {
    use crate::server::agent;
    use serde_json::json;

    #[test]
    fn test_create_session() {
        let session = agent::create_session();
        assert!(!session.id.is_empty());
    }

    #[test]
    fn test_session_has_uuid_format() {
        let session = agent::create_session();
        // UUIDs are 36 characters with hyphens
        assert_eq!(session.id.len(), 36);
        assert!(session.id.contains('-'));
    }

    #[test]
    fn test_sessions_have_unique_ids() {
        let session1 = agent::create_session();
        let session2 = agent::create_session();
        let session3 = agent::create_session();

        assert_ne!(session1.id, session2.id);
        assert_ne!(session2.id, session3.id);
        assert_ne!(session1.id, session3.id);
    }

    #[test]
    fn test_session_has_empty_messages() {
        let session = agent::create_session();
        assert!(session.messages.is_empty());
    }

    #[test]
    fn test_session_has_empty_metadata() {
        let session = agent::create_session();
        assert!(session.metadata.is_null() || session.metadata.as_object().map_or(false, |m| m.is_empty()));
    }

    #[test]
    fn test_session_serialization() {
        let session = agent::create_session();
        let json = serde_json::to_string(&session).unwrap();
        let parsed: crate::server::agent::Session = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, session.id);
        assert_eq!(parsed.messages.len(), session.messages.len());
    }
}
