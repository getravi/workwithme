//! Global keyboard shortcut configuration for voice and capture actions.
//!
//! Shortcuts are persisted as JSON at `<data_local_dir>/workwithme/shortcuts.json`
//! and loaded at app startup into [`ShortcutsState`] (Tauri managed state).
//!
//! # Shortcut string format
//! Shortcuts are represented as `"Modifier+…+Key"` strings, e.g.
//! `"Super+Shift+Space"` or `"Super+Ctrl+Digit4"`.  [`parse`] converts these
//! into the `(Modifiers, Code)` pair expected by `tauri_plugin_global_shortcut`.
//!
//! Recognised modifiers: `Super` / `Cmd` / `Command`, `Shift`, `Ctrl` / `Control`,
//! `Alt` / `Option`.  Unknown tokens cause [`parse`] to return `None`.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri_plugin_global_shortcut::{Code, Modifiers};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutsConfig {
    pub dictate: String,
    pub capture_region: String,
    pub capture_window: String,
    pub screen_recording: String,
    pub new_meeting: String,
}

impl Default for ShortcutsConfig {
    fn default() -> Self {
        Self {
            dictate: "Super+Shift+Space".to_string(),
            capture_region: "Super+Ctrl+4".to_string(),
            capture_window: "Super+Ctrl+5".to_string(),
            screen_recording: "Super+Ctrl+6".to_string(),
            new_meeting: "Super+Ctrl+7".to_string(),
        }
    }
}

fn shortcuts_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("workwithme")
        .join("shortcuts.json")
}

pub fn load() -> ShortcutsConfig {
    load_from(&shortcuts_path())
}

pub fn save(config: &ShortcutsConfig) -> Result<(), String> {
    save_to(&shortcuts_path(), config)
}

fn load_from(path: &std::path::Path) -> ShortcutsConfig {
    if let Ok(data) = std::fs::read_to_string(path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        ShortcutsConfig::default()
    }
}

fn save_to(path: &std::path::Path, config: &ShortcutsConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }
    let data = serde_json::to_string_pretty(config).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(path, data).map_err(|e| format!("write shortcuts: {e}"))?;
    Ok(())
}

/// Parse a shortcut string like "Super+Shift+Space" or "Super+Ctrl+Digit4"
/// into a (Modifiers, Code) pair for use with `shortcut.matches()`.
pub fn parse(shortcut: &str) -> Option<(Modifiers, Code)> {
    let parts: Vec<&str> = shortcut.split('+').collect();
    if parts.is_empty() {
        return None;
    }
    let key_str = *parts.last()?;
    let mut mods = Modifiers::empty();
    for part in &parts[..parts.len() - 1] {
        match *part {
            "Super" | "Cmd" | "Command" => mods |= Modifiers::SUPER,
            "Shift" => mods |= Modifiers::SHIFT,
            "Ctrl" | "Control" => mods |= Modifiers::CONTROL,
            "Alt" | "Option" => mods |= Modifiers::ALT,
            _ => return None,
        }
    }
    let code = parse_code(key_str)?;
    Some((mods, code))
}

fn parse_code(key: &str) -> Option<Code> {
    match key {
        "Space" => Some(Code::Space),
        "Enter" | "Return" => Some(Code::Enter),
        "Escape" | "Esc" => Some(Code::Escape),
        "Tab" => Some(Code::Tab),
        "0" | "Digit0" => Some(Code::Digit0),
        "1" | "Digit1" => Some(Code::Digit1),
        "2" | "Digit2" => Some(Code::Digit2),
        "3" | "Digit3" => Some(Code::Digit3),
        "4" | "Digit4" => Some(Code::Digit4),
        "5" | "Digit5" => Some(Code::Digit5),
        "6" | "Digit6" => Some(Code::Digit6),
        "7" | "Digit7" => Some(Code::Digit7),
        "8" | "Digit8" => Some(Code::Digit8),
        "9" | "Digit9" => Some(Code::Digit9),
        "A" | "a" | "KeyA" => Some(Code::KeyA),
        "B" | "b" | "KeyB" => Some(Code::KeyB),
        "C" | "c" | "KeyC" => Some(Code::KeyC),
        "D" | "d" | "KeyD" => Some(Code::KeyD),
        "E" | "e" | "KeyE" => Some(Code::KeyE),
        "F" | "f" | "KeyF" => Some(Code::KeyF),
        "G" | "g" | "KeyG" => Some(Code::KeyG),
        "H" | "h" | "KeyH" => Some(Code::KeyH),
        "I" | "i" | "KeyI" => Some(Code::KeyI),
        "J" | "j" | "KeyJ" => Some(Code::KeyJ),
        "K" | "k" | "KeyK" => Some(Code::KeyK),
        "L" | "l" | "KeyL" => Some(Code::KeyL),
        "M" | "m" | "KeyM" => Some(Code::KeyM),
        "N" | "n" | "KeyN" => Some(Code::KeyN),
        "O" | "o" | "KeyO" => Some(Code::KeyO),
        "P" | "p" | "KeyP" => Some(Code::KeyP),
        "Q" | "q" | "KeyQ" => Some(Code::KeyQ),
        "R" | "r" | "KeyR" => Some(Code::KeyR),
        "S" | "s" | "KeyS" => Some(Code::KeyS),
        "T" | "t" | "KeyT" => Some(Code::KeyT),
        "U" | "u" | "KeyU" => Some(Code::KeyU),
        "V" | "v" | "KeyV" => Some(Code::KeyV),
        "W" | "w" | "KeyW" => Some(Code::KeyW),
        "X" | "x" | "KeyX" => Some(Code::KeyX),
        "Y" | "y" | "KeyY" => Some(Code::KeyY),
        "Z" | "z" | "KeyZ" => Some(Code::KeyZ),
        "F1" => Some(Code::F1),
        "F2" => Some(Code::F2),
        "F3" => Some(Code::F3),
        "F4" => Some(Code::F4),
        "F5" => Some(Code::F5),
        "F6" => Some(Code::F6),
        "F7" => Some(Code::F7),
        "F8" => Some(Code::F8),
        "F9" => Some(Code::F9),
        "F10" => Some(Code::F10),
        "F11" => Some(Code::F11),
        "F12" => Some(Code::F12),
        _ => None,
    }
}

/// Tauri managed state wrapper — holds the live shortcuts config.
/// Uses Arc so it can be cloned into the shortcut handler closure.
pub struct ShortcutsState(pub Arc<Mutex<ShortcutsConfig>>);

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::{Code, Modifiers};

    // ── parse ─────────────────────────────────────────────────────────────────

    #[test]
    fn parse_super_shift_space() {
        let (mods, code) = parse("Super+Shift+Space").expect("should parse");
        assert!(mods.contains(Modifiers::SUPER));
        assert!(mods.contains(Modifiers::SHIFT));
        assert!(!mods.contains(Modifiers::CONTROL));
        assert_eq!(code, Code::Space);
    }

    #[test]
    fn parse_super_ctrl_digit4() {
        let (mods, code) = parse("Super+Ctrl+Digit4").expect("should parse");
        assert!(mods.contains(Modifiers::SUPER));
        assert!(mods.contains(Modifiers::CONTROL));
        assert_eq!(code, Code::Digit4);
    }

    #[test]
    fn parse_cmd_alias_works() {
        let (mods, _) = parse("Cmd+Space").expect("Cmd alias should parse");
        assert!(mods.contains(Modifiers::SUPER));
    }

    #[test]
    fn parse_unknown_modifier_returns_none() {
        assert!(parse("Win+Space").is_none());
    }

    #[test]
    fn parse_unknown_key_returns_none() {
        assert!(parse("Super+Backspace").is_none());
    }

    #[test]
    fn parse_empty_string_returns_none() {
        assert!(parse("").is_none());
    }

    // ── parse_code ────────────────────────────────────────────────────────────

    #[test]
    fn parse_code_space() {
        assert_eq!(parse_code("Space"), Some(Code::Space));
    }

    #[test]
    fn parse_code_digit_aliases() {
        assert_eq!(parse_code("4"), Some(Code::Digit4));
        assert_eq!(parse_code("Digit4"), Some(Code::Digit4));
    }

    #[test]
    fn parse_code_letter_aliases() {
        assert_eq!(parse_code("a"), Some(Code::KeyA));
        assert_eq!(parse_code("A"), Some(Code::KeyA));
        assert_eq!(parse_code("KeyA"), Some(Code::KeyA));
    }

    #[test]
    fn parse_code_function_keys() {
        assert_eq!(parse_code("F1"), Some(Code::F1));
        assert_eq!(parse_code("F12"), Some(Code::F12));
    }

    #[test]
    fn parse_code_enter_aliases() {
        assert_eq!(parse_code("Enter"), Some(Code::Enter));
        assert_eq!(parse_code("Return"), Some(Code::Enter));
    }

    #[test]
    fn parse_code_escape_aliases() {
        assert_eq!(parse_code("Escape"), Some(Code::Escape));
        assert_eq!(parse_code("Esc"), Some(Code::Escape));
    }

    #[test]
    fn parse_code_unknown_returns_none() {
        assert_eq!(parse_code("Backspace"), None);
        assert_eq!(parse_code("Delete"), None);
        assert_eq!(parse_code(""), None);
    }

    // ── filesystem round-trip ─────────────────────────────────────────────────

    #[test]
    fn save_and_load_round_trip() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("shortcuts.json");

        let cfg = ShortcutsConfig {
            dictate: "Super+Alt+D".to_string(),
            capture_region: "Super+Ctrl+Digit4".to_string(),
            capture_window: "Super+Ctrl+Digit5".to_string(),
            screen_recording: "Super+Ctrl+Digit6".to_string(),
            new_meeting: "Super+Ctrl+Digit7".to_string(),
        };
        save_to(&path, &cfg).unwrap();
        let loaded = load_from(&path);
        assert_eq!(loaded.dictate, "Super+Alt+D");
        assert_eq!(loaded.capture_region, "Super+Ctrl+Digit4");
    }

    #[test]
    fn save_creates_parent_directories() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nested").join("shortcuts.json");
        save_to(&path, &ShortcutsConfig::default()).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn load_returns_defaults_when_file_missing() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nonexistent.json");
        let cfg = load_from(&path);
        // Defaults should be non-empty parseable shortcut strings
        assert!(!cfg.dictate.is_empty());
        assert!(parse(&cfg.dictate).is_some(), "default dictate shortcut must be parseable");
    }

    #[test]
    fn load_returns_defaults_on_corrupt_json() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, b"not valid json !!!").unwrap();
        let cfg = load_from(&path);
        assert!(!cfg.dictate.is_empty());
    }

    #[test]
    fn all_default_shortcuts_are_parseable() {
        let cfg = ShortcutsConfig::default();
        assert!(parse(&cfg.dictate).is_some(),         "dictate");
        assert!(parse(&cfg.capture_region).is_some(),  "capture_region");
        assert!(parse(&cfg.capture_window).is_some(),  "capture_window");
        assert!(parse(&cfg.screen_recording).is_some(),"screen_recording");
        assert!(parse(&cfg.new_meeting).is_some(),     "new_meeting");
    }
}

#[tauri::command]
pub fn voice_get_shortcuts(state: tauri::State<ShortcutsState>) -> ShortcutsConfig {
    state.0.lock().expect("mutex poisoned: shortcuts config").clone()
}

#[tauri::command]
pub fn voice_set_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<ShortcutsState>,
    action: String,
    shortcut: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    // Validate the new shortcut is parseable before making changes
    if parse(&shortcut).is_none() {
        return Err(format!("cannot parse shortcut '{shortcut}'"));
    }

    let old_shortcut = {
        let config = state.0.lock().expect("mutex poisoned: shortcuts config");
        match action.as_str() {
            "dictate" => config.dictate.clone(),
            "capture_region" => config.capture_region.clone(),
            "capture_window" => config.capture_window.clone(),
            "screen_recording" => config.screen_recording.clone(),
            "new_meeting" => config.new_meeting.clone(),
            _ => return Err(format!("unknown shortcut action '{action}'")),
        }
    };

    // Skip if unchanged
    if old_shortcut == shortcut {
        return Ok(());
    }

    // Re-register: unregister old, register new
    let _ = app.global_shortcut().unregister(old_shortcut.as_str());
    app.global_shortcut()
        .register(shortcut.as_str())
        .map_err(|e| format!("register shortcut: {e}"))?;

    // Update in-memory state
    {
        let mut config = state.0.lock().expect("mutex poisoned: shortcuts config");
        match action.as_str() {
            "dictate" => config.dictate = shortcut,
            "capture_region" => config.capture_region = shortcut,
            "capture_window" => config.capture_window = shortcut,
            "screen_recording" => config.screen_recording = shortcut,
            "new_meeting" => config.new_meeting = shortcut,
            _ => {}
        }
        save(&config)?;
    }

    Ok(())
}
