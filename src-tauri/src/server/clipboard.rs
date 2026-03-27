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
}
