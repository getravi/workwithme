const SERVICE: &str = "workwithme";

/// Get a stored token from the system keychain
pub fn get(slug: &str) -> Result<Option<String>, String> {
    let account = format!("remote-mcp/{}", slug);
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
    let account = format!("remote-mcp/{}", slug);
    match keyring::Entry::new(SERVICE, &account) {
        Ok(entry) => entry.set_password(token).map_err(|e| format!("keychain set failed: {}", e)),
        Err(e) => Err(format!("keychain entry creation failed: {}", e)),
    }
}

/// Delete a token from the system keychain
pub fn delete(slug: &str) -> Result<bool, String> {
    let account = format!("remote-mcp/{}", slug);
    match keyring::Entry::new(SERVICE, &account) {
        Ok(entry) => match entry.delete_credential() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(format!("keychain delete failed: {}", e)),
        },
        Err(e) => Err(format!("keychain entry creation failed: {}", e)),
    }
}
