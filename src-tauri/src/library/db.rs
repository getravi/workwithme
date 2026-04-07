use rusqlite::{Connection, params};
use serde::Serialize;
use std::sync::{Mutex, OnceLock};

pub static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

#[derive(Debug, Serialize, Clone)]
pub struct CaptureEntry {
    pub id: String,
    pub file_path: String,
    pub timestamp: i64,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub is_draft: bool,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub media_type: String,
    pub thumbnail_path: Option<String>,
}

/// Open an in-memory connection (used by tests).
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    apply_schema(&conn)?;
    Ok(conn)
}

/// Initialize the global DB connection. Call once at app launch.
pub fn init_db() -> Result<(), String> {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("workwithme")
        .join("captures");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create captures dir: {e}"))?;
    let db_path = dir.join("library.db");
    let conn = Connection::open(&db_path).map_err(|e| format!("open db: {e}"))?;
    apply_schema(&conn).map_err(|e| format!("schema: {e}"))?;
    DB.set(Mutex::new(conn)).map_err(|_| "DB already initialized".to_string())
}

fn db() -> &'static Mutex<Connection> {
    DB.get().expect("library DB not initialized")
}

fn apply_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS captures (
            id           TEXT PRIMARY KEY,
            file_path    TEXT NOT NULL,
            timestamp    INTEGER NOT NULL,
            app_name     TEXT,
            window_title TEXT,
            is_draft     INTEGER NOT NULL DEFAULT 1,
            width        INTEGER,
            height       INTEGER
        );
        CREATE INDEX IF NOT EXISTS captures_ts ON captures(timestamp DESC);
        CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts USING fts5(
            id UNINDEXED,
            app_name,
            window_title,
            ocr_text
        );
    ")?;

    // Safe migration: add media_type if absent (SQLite has no IF NOT EXISTS on ALTER)
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(captures)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !columns.iter().any(|c| c == "media_type") {
        conn.execute_batch(
            "ALTER TABLE captures ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image'",
        )?;
    }
    if !columns.iter().any(|c| c == "thumbnail_path") {
        conn.execute_batch("ALTER TABLE captures ADD COLUMN thumbnail_path TEXT")?;
    }

    Ok(())
}

/// Save a draft capture to the global DB and return its UUID.
pub fn save_draft(file_path: &str, app_name: Option<&str>, window_title: Option<&str>, width: i32, height: i32) -> Result<String, String> {
    let conn = db().lock().unwrap();
    save_draft_conn(&conn, file_path, app_name, window_title, width, height)
}

pub fn save_draft_conn(conn: &Connection, file_path: &str, app_name: Option<&str>, window_title: Option<&str>, width: i32, height: i32) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let ts = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO captures (id, file_path, timestamp, app_name, window_title, is_draft, width, height)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)",
        params![id, file_path, ts, app_name, window_title, width, height],
    ).map_err(|e| format!("insert draft: {e}"))?;
    conn.execute(
        "INSERT INTO captures_fts (id, app_name, window_title, ocr_text) VALUES (?1, ?2, ?3, '')",
        params![id, app_name.unwrap_or(""), window_title.unwrap_or("")],
    ).map_err(|e| format!("insert fts: {e}"))?;
    Ok(id)
}

/// Mark a capture as finalized (annotated version saved).
pub fn finalize(id: &str) -> Result<(), String> {
    let conn = db().lock().unwrap();
    finalize_conn(&conn, id)
}

pub fn finalize_conn(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("UPDATE captures SET is_draft = 0 WHERE id = ?1", params![id])
        .map_err(|e| format!("finalize: {e}"))?;
    Ok(())
}

/// List captures newest-first, optionally paginated (50 per page).
pub fn list(before_ts: Option<i64>) -> Result<Vec<CaptureEntry>, String> {
    let conn = db().lock().unwrap();
    list_conn(&conn, before_ts)
}

pub fn list_conn(conn: &Connection, before_ts: Option<i64>) -> Result<Vec<CaptureEntry>, String> {
    let ts_filter = before_ts.unwrap_or(i64::MAX);
    let mut stmt = conn.prepare(
        "SELECT id, file_path, timestamp, app_name, window_title, is_draft, width, height,
                media_type, thumbnail_path
         FROM captures WHERE timestamp < ?1 ORDER BY timestamp DESC LIMIT 50"
    ).map_err(|e| format!("prepare list: {e}"))?;
    let entries = stmt.query_map(params![ts_filter], row_to_entry)
        .map_err(|e| format!("query list: {e}"))?
        .filter_map(|r| {
            r.map_err(|e| eprintln!("[library/db] list row error: {e}")).ok()
        })
        .collect();
    Ok(entries)
}

/// FTS5 search.
pub fn search(query: &str) -> Result<Vec<CaptureEntry>, String> {
    let conn = db().lock().unwrap();
    search_conn(&conn, query)
}

pub fn search_conn(conn: &Connection, query: &str) -> Result<Vec<CaptureEntry>, String> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.file_path, c.timestamp, c.app_name, c.window_title, c.is_draft,
                c.width, c.height, c.media_type, c.thumbnail_path
         FROM captures_fts f
         JOIN captures c ON c.id = f.id
         WHERE captures_fts MATCH ?1
         ORDER BY c.timestamp DESC LIMIT 50"
    ).map_err(|e| format!("prepare search: {e}"))?;
    let entries = stmt.query_map(params![query], row_to_entry)
        .map_err(|e| format!("query search: {e}"))?
        .filter_map(|r| {
            r.map_err(|e| eprintln!("[library/db] search row error: {e}")).ok()
        })
        .collect();
    Ok(entries)
}

/// Delete a capture from DB and return its file path (caller deletes the file).
pub fn delete(id: &str) -> Result<Option<String>, String> {
    let conn = db().lock().unwrap();
    let file_path: Option<String> = conn
        .query_row("SELECT file_path FROM captures WHERE id = ?1", params![id], |r| r.get(0))
        .ok();
    conn.execute_batch("BEGIN").map_err(|e| format!("begin: {e}"))?;
    conn.execute("DELETE FROM captures WHERE id = ?1", params![id])
        .map_err(|e| format!("delete: {e}"))?;
    conn.execute("DELETE FROM captures_fts WHERE id = ?1", params![id])
        .map_err(|e| format!("delete fts: {e}"))?;
    conn.execute_batch("COMMIT").map_err(|e| format!("commit: {e}"))?;
    Ok(file_path)
}

/// Update FTS OCR text after background OCR completes.
pub fn update_ocr(id: &str, ocr_text: &str) -> Result<(), String> {
    let conn = db().lock().unwrap();
    update_ocr_conn(&conn, id, ocr_text)
}

pub fn update_ocr_conn(conn: &Connection, id: &str, ocr_text: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE captures_fts SET ocr_text = ?1 WHERE id = ?2",
        params![ocr_text, id],
    ).map_err(|e| format!("update ocr: {e}"))?;
    if conn.changes() == 0 {
        eprintln!("[library/db] update_ocr: no FTS row found for id={id}");
    }
    Ok(())
}

/// Delete captures older than 30 days and return their file paths.
pub fn prune() -> Result<Vec<String>, String> {
    let conn = db().lock().unwrap();
    prune_conn(&conn)
}

pub fn prune_conn(conn: &Connection) -> Result<Vec<String>, String> {
    let cutoff = chrono::Utc::now().timestamp_millis() - (30i64 * 24 * 60 * 60 * 1000);
    let mut stmt = conn.prepare("SELECT file_path FROM captures WHERE timestamp < ?1")
        .map_err(|e| format!("prepare prune: {e}"))?;
    let paths: Vec<String> = stmt.query_map(params![cutoff], |r| r.get(0))
        .map_err(|e| format!("query prune: {e}"))?
        .filter_map(|r| {
            r.map_err(|e| eprintln!("[library/db] prune row error: {e}")).ok()
        })
        .collect();
    conn.execute("DELETE FROM captures WHERE timestamp < ?1", params![cutoff])
        .map_err(|e| format!("delete old: {e}"))?;
    conn.execute("DELETE FROM captures_fts WHERE id NOT IN (SELECT id FROM captures)", [])
        .map_err(|e| format!("prune fts: {e}"))?;
    Ok(paths)
}

fn row_to_entry(row: &rusqlite::Row) -> rusqlite::Result<CaptureEntry> {
    Ok(CaptureEntry {
        id: row.get(0)?,
        file_path: row.get(1)?,
        timestamp: row.get(2)?,
        app_name: row.get(3)?,
        window_title: row.get(4)?,
        is_draft: row.get::<_, i32>(5)? != 0,
        width: row.get(6)?,
        height: row.get(7)?,
        media_type: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "image".into()),
        thumbnail_path: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_init_creates_tables() {
        let conn = open_in_memory().expect("in-memory DB");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='captures'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_save_and_list_draft() {
        let conn = open_in_memory().expect("in-memory DB");
        let id = save_draft_conn(&conn, "/tmp/test.png", None, None, 100, 100).unwrap();
        let entries = list_conn(&conn, None).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, id);
        assert!(entries[0].is_draft);
    }

    #[test]
    fn test_finalize_clears_draft() {
        let conn = open_in_memory().expect("in-memory DB");
        let id = save_draft_conn(&conn, "/tmp/test.png", None, None, 100, 100).unwrap();
        finalize_conn(&conn, &id).unwrap();
        let entries = list_conn(&conn, None).unwrap();
        assert!(!entries[0].is_draft);
    }

    #[test]
    fn test_prune_removes_old_entries() {
        let conn = open_in_memory().expect("in-memory DB");
        let old_ts = chrono::Utc::now().timestamp_millis() - (31i64 * 24 * 60 * 60 * 1000);
        conn.execute(
            "INSERT INTO captures (id, file_path, timestamp, is_draft, width, height, media_type)
             VALUES (?1, ?2, ?3, 1, 0, 0, 'image')",
            params!["old-id", "/tmp/old.png", old_ts],
        ).unwrap();
        conn.execute(
            "INSERT INTO captures_fts (id, app_name, window_title, ocr_text) VALUES ('old-id', '', '', '')",
            [],
        ).unwrap();
        prune_conn(&conn).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM captures WHERE id='old-id'", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_search_fts() {
        let conn = open_in_memory().expect("in-memory DB");
        let id = save_draft_conn(&conn, "/tmp/test.png", Some("Figma"), Some("Design System"), 800, 600).unwrap();
        update_ocr_conn(&conn, &id, "button component").unwrap();
        let results = search_conn(&conn, "button").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, id);
    }
}
