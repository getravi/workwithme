use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// File metadata for listing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String,
    pub file_type: String, // "dir", "file", "symlink", "other"
}

/// List directory contents
pub fn list_directory(path: &str) -> Result<Vec<FileEntry>, String> {
    let expanded_path = expand_path(path)?;

    // Security: restrict to home directory
    check_home_directory(&expanded_path)?;

    let entries = fs::read_dir(&expanded_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut files = Vec::new();

    for entry in entries.flatten() {
        if let Ok(metadata) = entry.metadata() {
            let file_name = entry
                .file_name()
                .to_string_lossy()
                .to_string();

            let file_path = entry.path();
            let relative_path = file_path
                .to_string_lossy()
                .to_string();

            let file_type = if metadata.is_dir() {
                "dir"
            } else if metadata.is_symlink() {
                "symlink"
            } else {
                "file"
            };

            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| {
                    t.duration_since(std::time::UNIX_EPOCH)
                        .ok()
                        .map(|d| d.as_secs())
                })
                .unwrap_or(0)
                .to_string();

            files.push(FileEntry {
                name: file_name,
                path: relative_path,
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                modified,
                file_type: file_type.to_string(),
            });
        }
    }

    // Sort: directories first, then alphabetically
    files.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.cmp(&b.name)
        }
    });

    Ok(files)
}

/// Search for files matching a glob pattern
pub fn search_files(path: &str, pattern: &str) -> Result<Vec<FileEntry>, String> {
    let expanded_path = expand_path(path)?;
    check_home_directory(&expanded_path)?;

    let mut results = Vec::new();
    let max_depth = 5; // Limit recursion depth for performance

    for entry in WalkDir::new(&expanded_path)
        .max_depth(max_depth)
        .into_iter()
        .flatten()
    {
        let file_name = entry
            .file_name()
            .to_string_lossy();

        // Simple glob pattern matching (supports * and ?)
        if glob_match(&file_name, pattern) {
            if let Ok(metadata) = entry.metadata() {
                let file_path = entry.path();
                let relative_path = file_path
                    .to_string_lossy()
                    .to_string();

                let file_type = if metadata.is_dir() {
                    "dir"
                } else if metadata.is_symlink() {
                    "symlink"
                } else {
                    "file"
                };

                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .ok()
                            .map(|d| d.as_secs())
                    })
                    .unwrap_or(0)
                    .to_string();

                results.push(FileEntry {
                    name: file_name.to_string(),
                    path: relative_path,
                    is_dir: metadata.is_dir(),
                    size: metadata.len(),
                    modified,
                    file_type: file_type.to_string(),
                });
            }
        }

        if results.len() >= 100 {
            break; // Limit results to prevent huge responses
        }
    }

    Ok(results)
}

/// Get file metadata
pub fn get_file_info(path: &str) -> Result<FileEntry, String> {
    let expanded_path = expand_path(path)?;
    check_home_directory(&expanded_path)?;

    let metadata = fs::metadata(&expanded_path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;

    let file_name = expanded_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let file_type = if metadata.is_dir() {
        "dir"
    } else if metadata.is_symlink() {
        "symlink"
    } else {
        "file"
    };

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_secs())
        })
        .unwrap_or(0)
        .to_string();

    Ok(FileEntry {
        name: file_name,
        path: expanded_path.to_string_lossy().to_string(),
        is_dir: metadata.is_dir(),
        size: metadata.len(),
        modified,
        file_type: file_type.to_string(),
    })
}

/// Expand ~ to home directory with security validation
fn expand_path(path: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;

    // Reject absolute paths - only allow relative paths and tilde expansion
    if path.starts_with('/') {
        return Err("Absolute paths are not allowed".to_string());
    }

    let expanded = if path.starts_with("~/") {
        home.join(&path[2..])
    } else if path.starts_with("~") && !path.contains('/') {
        // Allow ~ alone to refer to home directory
        home.clone()
    } else if path.is_empty() {
        home.clone()
    } else if path.contains("..") {
        return Err("Path traversal (..) is not allowed".to_string());
    } else {
        home.join(path)
    };

    // Canonicalize to resolve symlinks and .. sequences
    let canonical = expanded.canonicalize()
        .map_err(|e| format!("Cannot access path: {}", e))?;

    // Verify the canonical path is within home directory
    let canonical_home = fs::canonicalize(&home)
        .map_err(|e| format!("Cannot verify home directory: {}", e))?;

    if !canonical.starts_with(&canonical_home) {
        return Err("Access denied: path escapes home directory".to_string());
    }

    Ok(canonical)
}

/// Security check: ensure path is within home directory
fn check_home_directory(path: &Path) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;

    let canonical_home = fs::canonicalize(&home)
        .map_err(|e| format!("Cannot canonicalize home directory: {}", e))?;

    // Path must exist to be canonicalized
    let canonical_path = fs::canonicalize(path)
        .map_err(|e| format!("Cannot access path: {}", e))?;

    if !canonical_path.starts_with(&canonical_home) {
        return Err("Access denied: path is outside home directory".to_string());
    }

    Ok(())
}

/// Simple glob pattern matching
fn glob_match(name: &str, pattern: &str) -> bool {
    // Basic glob support: * matches any sequence, ? matches single char
    let mut name_chars = name.chars().peekable();
    let mut pattern_chars = pattern.chars().peekable();

    while let Some(&p) = pattern_chars.peek() {
        match p {
            '*' => {
                pattern_chars.next();
                if pattern_chars.peek().is_none() {
                    return true; // * at end matches everything
                }
                // Match zero or more characters
                while name_chars.peek().is_some() {
                    if glob_match(
                        &name_chars.clone().collect::<String>(),
                        &pattern_chars.clone().collect::<String>(),
                    ) {
                        return true;
                    }
                    name_chars.next();
                }
                return false;
            }
            '?' => {
                pattern_chars.next();
                if name_chars.next().is_none() {
                    return false;
                }
            }
            _ => {
                pattern_chars.next();
                if let Some(&n) = name_chars.peek() {
                    if n == p {
                        name_chars.next();
                    } else {
                        return false;
                    }
                } else {
                    return false;
                }
            }
        }
    }

    name_chars.peek().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_match() {
        assert!(glob_match("test.rs", "*.rs"));
        assert!(glob_match("hello.txt", "*.txt"));
        assert!(!glob_match("file.rs", "*.txt"));
        assert!(glob_match("file", "fil?"));
        assert!(!glob_match("file", "fil"));
    }

    #[test]
    fn test_expand_path() {
        // Test expanding tilde to home directory (which always exists)
        let expanded = expand_path("~").unwrap();
        let home = dirs::home_dir().unwrap().canonicalize().unwrap();
        assert_eq!(expanded, home);
    }
}
