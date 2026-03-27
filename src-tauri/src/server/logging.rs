use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use chrono::Local;

/// Log level
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
}

impl LogLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_uppercase().as_str() {
            "DEBUG" => Some(LogLevel::Debug),
            "INFO" => Some(LogLevel::Info),
            "WARN" => Some(LogLevel::Warn),
            "ERROR" => Some(LogLevel::Error),
            _ => None,
        }
    }
}

/// Logging configuration
pub struct LogConfig {
    pub level: LogLevel,
    pub file_path: PathBuf,
}

lazy_static::lazy_static! {
    static ref LOG_CONFIG: Mutex<LogConfig> = {
        let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
        Mutex::new(LogConfig {
            level: LogLevel::Info,
            file_path: home.join(".pi/debug.log"),
        })
    };
}

/// Write a log entry
pub fn log(level: LogLevel, module: &str, message: &str) {
    let config = match LOG_CONFIG.lock() {
        Ok(c) => c,
        Err(poisoned) => {
            eprintln!("[logging] mutex poisoned, recovering: {}", poisoned);
            poisoned.into_inner()
        }
    };

    // Only log if level is at or above configured level
    if level < config.level {
        return;
    }

    let timestamp = Local::now().to_rfc3339();
    let entry = json!({
        "timestamp": timestamp,
        "level": level.as_str(),
        "module": module,
        "message": message
    });

    // Write to file
    if let Some(parent) = config.file_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&config.file_path)
    {
        let _ = writeln!(file, "{}", entry.to_string());
    }

    // Also print to console
    eprintln!("[{}] {}: {}", level.as_str(), module, message);
}

pub fn debug(module: &str, message: &str) {
    log(LogLevel::Debug, module, message);
}

pub fn info(module: &str, message: &str) {
    log(LogLevel::Info, module, message);
}

pub fn warn(module: &str, message: &str) {
    log(LogLevel::Warn, module, message);
}

pub fn error(module: &str, message: &str) {
    log(LogLevel::Error, module, message);
}

/// Set log level
pub fn set_log_level(level: LogLevel) -> Result<(), String> {
    let mut config = match LOG_CONFIG.lock() {
        Ok(c) => c,
        Err(poisoned) => {
            eprintln!("[logging] mutex poisoned in set_log_level, recovering");
            poisoned.into_inner()
        }
    };
    config.level = level;
    Ok(())
}

/// Get current log level
pub fn get_log_level() -> LogLevel {
    match LOG_CONFIG.lock() {
        Ok(config) => config.level,
        Err(poisoned) => {
            eprintln!("[logging] mutex poisoned in get_log_level, using default");
            poisoned.into_inner().level
        }
    }
}

/// Get recent log entries
pub fn get_recent_logs(limit: usize) -> Result<Vec<Value>, String> {
    let config = LOG_CONFIG.lock().unwrap();

    if !config.file_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&config.file_path)
        .map_err(|e| format!("Failed to read log file: {}", e))?;

    let mut logs = Vec::new();

    for line in content.lines().rev().take(limit) {
        if let Ok(json) = serde_json::from_str::<Value>(line) {
            logs.push(json);
        }
    }

    Ok(logs)
}

/// Clear log file
pub fn clear_logs() -> Result<(), String> {
    let config = LOG_CONFIG.lock().unwrap();
    std::fs::write(&config.file_path, "")
        .map_err(|e| format!("Failed to clear logs: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_level_ordering() {
        assert!(LogLevel::Debug < LogLevel::Info);
        assert!(LogLevel::Info < LogLevel::Warn);
        assert!(LogLevel::Warn < LogLevel::Error);
    }

    #[test]
    fn test_log_level_as_str() {
        assert_eq!(LogLevel::Debug.as_str(), "DEBUG");
        assert_eq!(LogLevel::Info.as_str(), "INFO");
        assert_eq!(LogLevel::Error.as_str(), "ERROR");
    }

    #[test]
    fn test_log_level_from_str() {
        assert_eq!(LogLevel::from_str("DEBUG"), Some(LogLevel::Debug));
        assert_eq!(LogLevel::from_str("info"), Some(LogLevel::Info));
        assert_eq!(LogLevel::from_str("INVALID"), None);
    }
}
