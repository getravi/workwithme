/// Clipboard integration for copying and pasting text
/// Uses arboard crate for cross-platform support (Windows, macOS, Linux)

pub fn copy_to_clipboard(text: &str) -> Result<(), String> {
    match arboard::Clipboard::new() {
        Ok(mut clipboard) => {
            clipboard
                .set_text(text)
                .map_err(|e| format!("Failed to copy to clipboard: {}", e))
        }
        Err(e) => Err(format!("Failed to access clipboard: {}", e)),
    }
}

pub fn paste_from_clipboard() -> Result<String, String> {
    match arboard::Clipboard::new() {
        Ok(mut clipboard) => {
            clipboard
                .get_text()
                .map_err(|e| format!("Failed to paste from clipboard: {}", e))
        }
        Err(e) => Err(format!("Failed to access clipboard: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clipboard_functions_exist() {
        // Just verify the functions are callable
        // Actual clipboard operations may not work in test environment
        let _ = copy_to_clipboard("test");
        let _ = paste_from_clipboard();
    }

    #[test]
    fn test_copy_to_clipboard_roundtrip() {
        // If clipboard is available, verify copy+paste roundtrip.
        // Some environments (CI, headless) return empty string — tolerate that.
        let text = "workwithme-test-string-12345";
        if copy_to_clipboard(text).is_ok() {
            match paste_from_clipboard() {
                Ok(pasted) => {
                    // Accept exact match OR empty string (headless env with no clipboard daemon)
                    assert!(
                        pasted == text || pasted.is_empty(),
                        "unexpected clipboard value: {:?}",
                        pasted
                    );
                }
                Err(_) => {} // clipboard unavailable in this env
            }
        }
    }

    #[test]
    fn test_copy_empty_string() {
        // Empty string should not panic
        let result = copy_to_clipboard("");
        // May succeed or fail depending on environment, but should not panic
        let _ = result;
    }

    #[test]
    fn test_copy_unicode_string() {
        let text = "Hello 世界 🌍";
        // Should not panic regardless of clipboard availability
        let _ = copy_to_clipboard(text);
    }
}
