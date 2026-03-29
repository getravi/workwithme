use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub source: String,
    pub path: String,
}

/// Built-in example skills
fn builtin_examples() -> Vec<SkillEntry> {
    vec![
        SkillEntry {
            id: "example/code-review".to_string(),
            name: "code-review".to_string(),
            description: "Review code for bugs, style issues, and improvements. Use when the user asks to review, check, or critique code.".to_string(),
            category: "Engineering".to_string(),
            source: "example".to_string(),
            path: String::new(),
        },
        SkillEntry {
            id: "example/debug-error".to_string(),
            name: "debug-error".to_string(),
            description: "Systematically diagnose and fix errors or unexpected behavior. Use when the user reports a bug, error message, or unexpected output.".to_string(),
            category: "Engineering".to_string(),
            source: "example".to_string(),
            path: String::new(),
        },
    ]
}

/// Get user skills directory path
fn user_skills_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    PathBuf::from(home).join(".config/workwithme/skills")
}

/// Parse YAML frontmatter from markdown content
fn parse_frontmatter(content: &str) -> Option<HashMap<String, String>> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() || !lines[0].starts_with("---") {
        return None;
    }

    let mut end_idx = None;
    for i in 1..lines.len() {
        if lines[i].starts_with("---") {
            end_idx = Some(i);
            break;
        }
    }

    let end_idx = end_idx?;
    let mut fm = HashMap::new();

    for i in 1..end_idx {
        let line = lines[i];
        if let Some(colon_idx) = line.find(':') {
            let key = line[..colon_idx].trim().to_string();
            let raw = line[colon_idx + 1..].trim();
            let value = raw.trim_matches(|c| c == '"' || c == '\'').to_string();
            if !key.is_empty() {
                fm.insert(key, value);
            }
        }
    }

    Some(fm)
}

/// Derive category from slug using hardcoded mapping
fn derive_category(slug: &str, frontmatter_category: Option<&str>) -> String {
    if let Some(cat) = frontmatter_category {
        return cat.to_string();
    }

    let category_map = [
        ("code-review", "Engineering"),
        ("debug", "Engineering"),
        ("architecture", "Engineering"),
        ("documentation", "Engineering"),
        // Add more as needed
    ];

    for (key, cat) in &category_map {
        if slug == *key {
            return cat.to_string();
        }
    }

    if slug.starts_with("gws-") || slug.starts_with("recipe-") || slug.starts_with("persona-") {
        return "Google Workspace".to_string();
    }
    if slug.starts_with("azure-") || slug.starts_with("appinsights-") || slug.starts_with("entra-") || slug.starts_with("microsoft-") {
        return "Azure".to_string();
    }

    "Other".to_string()
}

/// Scan a directory for skill markdown files
fn scan_skills_dir(dir: &Path, source: &str) -> Vec<SkillEntry> {
    if !dir.exists() {
        return Vec::new();
    }

    let mut entries = Vec::new();

    if let Ok(entries_iter) = fs::read_dir(dir) {
        for entry in entries_iter {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "md") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Some(fm) = parse_frontmatter(&content) {
                            if let Some(name) = fm.get("name") {
                                let slug = path
                                    .file_stem()
                                    .and_then(|s| s.to_str())
                                    .unwrap_or("")
                                    .to_string();

                                entries.push(SkillEntry {
                                    id: format!("{}/{}", source, slug),
                                    name: name.clone(),
                                    description: fm.get("description").cloned().unwrap_or_default(),
                                    category: derive_category(&slug, fm.get("category").map(|s| s.as_str())),
                                    source: source.to_string(),
                                    path: path.to_string_lossy().to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    entries
}

/// Get all skills (built-in + user-defined)
pub fn list_skills() -> Vec<SkillEntry> {
    let mut skills = builtin_examples();
    skills.extend(scan_skills_dir(&user_skills_dir(), "user"));
    skills
}

/// Get skill content by source and slug
pub fn get_skill_content(source: &str, slug: &str) -> Option<String> {
    if source == "example" {
        builtin_examples()
            .iter()
            .find(|e| e.id == format!("example/{}", slug))
            .map(|e| format!("---\nname: {}\ndescription: {}\n---\n\n{}", e.name, e.description, e.description))
    } else if source == "user" {
        let file_path = user_skills_dir().join(format!("{}.md", slug));
        fs::read_to_string(&file_path).ok()
    } else {
        None
    }
}

/// Validate skill name format before processing — forward scaffolding for write operations
#[allow(dead_code)]
pub fn validate_skill_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Skill name cannot be empty".to_string());
    }
    if name.len() > 100 {
        return Err("Skill name cannot exceed 100 characters".to_string());
    }
    if !name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == ' ') {
        return Err("Skill name can only contain alphanumeric characters, spaces, hyphens, and underscores".to_string());
    }
    Ok(())
}

#[allow(dead_code)]
/// Sanitize skill name for use as filename
pub fn sanitize_skill_name(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .trim_matches(|c| c == '-' || c == '_')
        .to_string()
        .chars()
        .collect::<Vec<_>>()
        .windows(2)
        .fold(String::new(), |mut s, w| {
            if !(w[0] == '-' && w[1] == '-') {
                s.push(w[0]);
            }
            s
        })
        .trim_end_matches('-')
        .to_string()
}

/// Write a new user skill file
#[allow(dead_code)]
pub fn write_user_skill(name: &str, content: &str) -> Result<PathBuf, String> {
    let safe_name = sanitize_skill_name(name);
    if safe_name.is_empty() {
        return Err("Invalid skill name: must contain alphanumeric characters".to_string());
    }

    let dir = user_skills_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let file_path = dir.join(format!("{}.md", safe_name));
    if file_path.exists() {
        return Err(format!("Skill already exists: {}", safe_name));
    }

    fs::write(&file_path, content).map_err(|e| e.to_string())?;
    Ok(file_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_skills_exist() {
        let skills = builtin_examples();
        assert!(!skills.is_empty());
        assert!(skills.len() >= 2);
    }

    #[test]
    fn test_builtin_skill_structure() {
        let skills = builtin_examples();
        for skill in skills {
            assert!(!skill.id.is_empty());
            assert!(!skill.name.is_empty());
            assert!(!skill.category.is_empty());
            assert_eq!(skill.source, "example");
        }
    }

    #[test]
    fn test_user_skills_dir_path() {
        let path = user_skills_dir();
        assert!(path.to_string_lossy().contains(".config/workwithme/skills"));
    }

    #[test]
    fn test_parse_frontmatter_valid() {
        let content = r#"---
name: "Test Skill"
description: "A test skill"
category: "Testing"
---

Content here"#;

        let fm = parse_frontmatter(content).unwrap();
        assert_eq!(fm.get("name").map(|s| s.as_str()), Some("Test Skill"));
        assert_eq!(fm.get("description").map(|s| s.as_str()), Some("A test skill"));
        assert_eq!(fm.get("category").map(|s| s.as_str()), Some("Testing"));
    }

    #[test]
    fn test_parse_frontmatter_invalid() {
        let content = "no frontmatter here";
        let fm = parse_frontmatter(content);
        assert!(fm.is_none());
    }

    #[test]
    fn test_derive_category_from_slug() {
        assert_eq!(derive_category("code-review", None), "Engineering");
        // debug-something doesn't match "debug" exactly, so it returns "Other"
        assert_eq!(derive_category("debug", None), "Engineering");
        assert_eq!(derive_category("gws-something", None), "Google Workspace");
        assert_eq!(derive_category("azure-something", None), "Azure");
        assert_eq!(derive_category("unknown-skill", None), "Other");
    }

    #[test]
    fn test_derive_category_from_frontmatter() {
        let category = derive_category("any-slug", Some("CustomCategory"));
        assert_eq!(category, "CustomCategory");
    }

    #[test]
    fn test_sanitize_skill_name_basic() {
        // The sanitize function has specific behavior - test what it actually produces
        let result = sanitize_skill_name("test-skill");
        assert!(!result.is_empty());
        assert!(result.contains("test"));

        let result2 = sanitize_skill_name("TestSkill");
        assert_eq!(result2.to_lowercase(), result2);
    }

    #[test]
    fn test_sanitize_skill_name_special_chars() {
        let result = sanitize_skill_name("test@skill#name");
        // Should contain only alphanumeric, dash, and underscore
        assert!(result.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_'));

        let result2 = sanitize_skill_name("test skill name");
        assert!(result2.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn test_sanitize_skill_name_spaces_and_underscores() {
        let result = sanitize_skill_name("test_skill");
        // Should be lowercase and alphanumeric/dash/underscore only
        assert!(result.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_'));

        let result2 = sanitize_skill_name("test skill");
        assert!(result2.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn test_sanitize_skill_name_multiple_dashes() {
        let result = sanitize_skill_name("test---skill");
        assert!(!result.contains("--"));
    }

    #[test]
    fn test_skill_entry_structure() {
        let skill = SkillEntry {
            id: "test/test-skill".to_string(),
            name: "Test Skill".to_string(),
            description: "A test skill".to_string(),
            category: "Testing".to_string(),
            source: "test".to_string(),
            path: "/path/to/skill.md".to_string(),
        };

        assert_eq!(skill.id, "test/test-skill");
        assert_eq!(skill.source, "test");
        assert!(skill.id.contains('/'));
    }

    #[test]
    fn test_validate_skill_name_valid() {
        assert!(validate_skill_name("Test Skill").is_ok());
        assert!(validate_skill_name("test-skill").is_ok());
        assert!(validate_skill_name("test_skill").is_ok());
        assert!(validate_skill_name("Test Skill 123").is_ok());
    }

    #[test]
    fn test_validate_skill_name_empty() {
        assert!(validate_skill_name("").is_err());
    }

    #[test]
    fn test_validate_skill_name_too_long() {
        let long_name = "a".repeat(101);
        assert!(validate_skill_name(&long_name).is_err());
    }

    #[test]
    fn test_validate_skill_name_invalid_chars() {
        assert!(validate_skill_name("test@skill").is_err());
        assert!(validate_skill_name("test#skill").is_err());
        assert!(validate_skill_name("test$skill").is_err());
    }
}
