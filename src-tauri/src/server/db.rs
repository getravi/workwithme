use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::path::PathBuf;
use std::sync::OnceLock;

/// Global database connection pool - thread-safe initialization
static DB_POOL: OnceLock<SqlitePool> = OnceLock::new();

/// Get or initialize the database pool
pub async fn get_pool() -> Result<SqlitePool, String> {
    // Return existing pool if already initialized
    if let Some(pool) = DB_POOL.get() {
        return Ok(pool.clone());
    }

    // Initialize on first call (OnceLock ensures thread-safe single initialization)
    let pool = initialize_db().await?;
    let _ = DB_POOL.set(pool.clone());

    Ok(pool)
}

/// Initialize SQLite database with schema
async fn initialize_db() -> Result<SqlitePool, String> {
    let db_path = get_db_path();

    // Create .pi directory if it doesn't exist
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create database directory: {}", e))?;
    }

    let database_url = format!("sqlite://{}", db_path.display());

    // Create pool
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .map_err(|e| format!("Failed to connect to database: {}", e))?;

    // Run migrations
    run_migrations(&pool).await?;

    println!("[db] initialized SQLite at {}", db_path.display());
    Ok(pool)
}

/// Run database migrations
async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    // Create sessions table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            cwd TEXT,
            archived BOOLEAN DEFAULT 0,
            status TEXT DEFAULT 'active',
            metadata JSON,
            UNIQUE(id)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create sessions table: {}", e))?;

    // Create messages table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create messages table: {}", e))?;

    // Create tools_executed table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS tools_executed (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            input JSON,
            output TEXT,
            status TEXT,
            timestamp TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create tools_executed table: {}", e))?;

    // Create audit_events table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            details JSON,
            timestamp TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create audit_events table: {}", e))?;

    // Create settings table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value JSON NOT NULL,
            updated_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create settings table: {}", e))?;

    // Create models table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            max_tokens INTEGER,
            custom BOOLEAN DEFAULT 0,
            created_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create models table: {}", e))?;

    // Create indexes for common queries
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived)")
        .execute(pool)
        .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at)")
        .execute(pool)
        .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)")
        .execute(pool)
        .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_tools_session ON tools_executed(session_id)")
        .execute(pool)
        .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp)")
        .execute(pool)
        .await;

    println!("[db] migrations completed");
    Ok(())
}

/// Get database file path: ~/.pi/workwithme.db
pub fn get_db_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi/workwithme.db")
}

/// Migrate data from JSON files to SQLite (called on first run)
pub async fn migrate_from_json(pool: &SqlitePool) -> Result<(), String> {
    println!("[db] checking for JSON data to migrate...");

    // Migrate sessions from ~/.pi/sessions/*.json
    migrate_sessions_from_json(pool).await?;

    // Migrate audit logs from ~/.pi/audit.log
    migrate_audit_from_json(pool).await?;

    println!("[db] migration from JSON complete");
    Ok(())
}

/// Migrate sessions from JSON files to database
async fn migrate_sessions_from_json(pool: &SqlitePool) -> Result<(), String> {
    let sessions_dir = {
        let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
        home.join(".pi/sessions")
    };

    if !sessions_dir.exists() {
        return Ok(()); // No sessions to migrate
    }

    let entries = std::fs::read_dir(&sessions_dir)
        .map_err(|e| format!("Failed to read sessions directory: {}", e))?;

    let mut migrated = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(session) = serde_json::from_str::<serde_json::Value>(&content) {
                    // Insert into database
                    let id = session.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
                    let label = session.get("metadata")
                        .and_then(|m| m.get("label"))
                        .and_then(|l| l.as_str())
                        .unwrap_or(id);
                    let created_at = session.get("created_at").and_then(|v| v.as_str()).unwrap_or("1970-01-01T00:00:00Z");
                    let updated_at = session.get("updated_at").and_then(|v| v.as_str()).unwrap_or(created_at);

                    let _ = sqlx::query(
                        "INSERT OR REPLACE INTO sessions (id, label, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?)"
                    )
                    .bind(id)
                    .bind(label)
                    .bind(created_at)
                    .bind(updated_at)
                    .bind(session.to_string())
                    .execute(pool)
                    .await;

                    migrated += 1;
                }
            }
        }
    }

    if migrated > 0 {
        println!("[db] migrated {} sessions from JSON", migrated);
    }

    Ok(())
}

/// Migrate audit logs from JSON file to database
async fn migrate_audit_from_json(pool: &SqlitePool) -> Result<(), String> {
    let audit_file = {
        let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
        home.join(".pi/audit.log")
    };

    if !audit_file.exists() {
        return Ok(()); // No audit logs to migrate
    }

    let content = std::fs::read_to_string(&audit_file)
        .map_err(|e| format!("Failed to read audit log: {}", e))?;

    let mut migrated = 0;
    for line in content.lines() {
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(line) {
            let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");
            let timestamp = event.get("timestamp").and_then(|v| v.as_str()).unwrap_or("1970-01-01T00:00:00Z");
            let details = event.get("details").cloned().unwrap_or(serde_json::json!({}));

            let _ = sqlx::query(
                "INSERT INTO audit_events (event_type, details, timestamp) VALUES (?, ?, ?)"
            )
            .bind(event_type)
            .bind(details.to_string())
            .bind(timestamp)
            .execute(pool)
            .await;

            migrated += 1;
        }
    }

    if migrated > 0 {
        println!("[db] migrated {} audit events from JSON", migrated);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_path() {
        let path = get_db_path();
        assert!(path.to_string_lossy().contains(".pi"));
        assert!(path.to_string_lossy().ends_with("workwithme.db"));
    }
}
