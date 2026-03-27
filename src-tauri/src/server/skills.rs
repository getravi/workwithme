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
