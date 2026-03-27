const SERVICE: &str = "workwithme";

/// Format account identifier for keychain entry
fn format_account(slug: &str) -> String {
    format!("remote-mcp/{}", slug)
}

/// Get a stored token from the system keychain
pub fn get(slug: &str) -> Result<Option<String>, String> {
    let account = format_account(slug);
    match keyring::Entry::new(SERVICE, &account) {
        Ok(entry) => match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("keychain get failed: {}", e)),
        },
        Err(e) => Err(format!("keychain entry creation failed: {}", e)),
    }
}

/// Store a token in the system keychain
pub fn set(slug: &str, token: &str) -> Result<(), String> {
    let account = format_account(slug);
    match keyring::Entry::new(SERVICE, &account) {
        Ok(entry) => entry.set_password(token).map_err(|e| format!("keychain set failed: {}", e)),
        Err(e) => Err(format!("keychain entry creation failed: {}", e)),
    }
}

/// Delete a token from the system keychain
pub fn delete(slug: &str) -> Result<bool, String> {
    let account = format_account(slug);
    match keyring::Entry::new(SERVICE, &account) {
        Ok(entry) => match entry.delete_credential() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(format!("keychain delete failed: {}", e)),
        },
        Err(e) => Err(format!("keychain entry creation failed: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_account() {
        let account = format_account("oauth_token");
        assert_eq!(account, "remote-mcp/oauth_token");
    }

    #[test]
    fn test_format_account_with_special_chars() {
        let account = format_account("oauth_token_google_user123");
        assert_eq!(account, "remote-mcp/oauth_token_google_user123");
    }

    #[test]
    fn test_service_name_is_correct() {
        assert_eq!(SERVICE, "workwithme");
    }

    #[test]
    fn test_keychain_account_prefix() {
        let account = format_account("test");
        assert!(account.starts_with("remote-mcp/"));
    }

    #[test]
    fn test_multiple_accounts_have_unique_names() {
        let account1 = format_account("google");
        let account2 = format_account("github");
        let account3 = format_account("openai");

        assert_ne!(account1, account2);
        assert_ne!(account2, account3);
        assert_ne!(account1, account3);
    }
}
