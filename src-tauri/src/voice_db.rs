//! Persistent storage for voice/meeting sessions using SQLite.
//!
//! The database lives at `<data_local_dir>/workwithme/voice/voice.db` and is
//! opened once at app startup via [`init_db`].  The live connection is stored
//! in the process-global [`VOICE_DB`] `OnceLock`.
//!
//! # Schema
//! | Table | Purpose |
//! |---|---|
//! | `voice_sessions` | One row per recording session (status lifecycle) |
//! | `transcript_segments` | Whisper output chunks with timestamps |
//! | `session_notes` | Raw notes + AI-generated summary/actions/decisions |
//! | `voice_fts` (FTS5) | Full-text search over transcript text |
//!
//! Child rows (`transcript_segments`, `session_notes`) are removed via
//! `ON DELETE CASCADE`.  The FTS5 virtual table must be cleaned explicitly
//! before deleting a session — see [`delete_session`].
//!
//! # Poison recovery
//! The `db_conn!()` macro recovers from a poisoned mutex by calling
//! `into_inner()`, allowing future callers to proceed normally even after a
//! panic during a previous operation.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

pub static VOICE_DB: OnceLock<Mutex<Connection>> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VoiceSession {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub session_type: String,
    pub status: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub duration_sec: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptSegment {
    pub id: String,
    pub session_id: String,
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionNotes {
    pub id: String,
    pub session_id: String,
    pub raw_notes: Option<String>,
    pub ai_summary: Option<String>,
    pub ai_action_items: Option<String>,
    pub ai_decisions: Option<String>,
    pub updated_at: i64,
}

/// Returns the voice data directory (where voice.db and WAV files are stored).
pub fn voice_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("workwithme")
        .join("voice")
}

/// Initialize the global voice DB connection. Call once at app launch.
/// Schema versioning via PRAGMA user_version:
///   v1 — initial schema (voice_sessions, transcript_segments, session_notes, voice_fts)
/// To add a migration: increment DB_VERSION, add `if version < N { ... }` block below.
const DB_VERSION: i64 = 1;

pub fn init_db() -> Result<(), String> {
    let dir = voice_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("create voice dir: {e}"))?;
    let db_path = dir.join("voice.db");
    let conn = Connection::open(&db_path).map_err(|e| format!("open voice db: {e}"))?;

    // Foreign keys are OFF by default per-connection in SQLite; without this the
    // ON DELETE CASCADE clauses in the schema are inert and delete_session would
    // orphan transcript_segments / session_notes rows.
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| format!("enable foreign_keys: {e}"))?;

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);

    if version < DB_VERSION {
        apply_schema(&conn).map_err(|e| format!("voice schema: {e}"))?;
        // SQLite's PRAGMA statement does not support bound parameters (?1 style),
        // so format! is intentional here.  DB_VERSION must always be a numeric
        // literal constant — never a value derived from user input.
        conn.execute_batch(&format!("PRAGMA user_version = {DB_VERSION}"))
            .map_err(|e| format!("set user_version: {e}"))?;
    }

    VOICE_DB
        .set(Mutex::new(conn))
        .map_err(|_| "VOICE_DB already initialized".to_string())
}

fn db() -> &'static Mutex<Connection> {
    VOICE_DB.get().expect("voice DB not initialized")
}

/// Acquire the DB connection, recovering from a poisoned mutex.
/// A panic mid-operation poisons the mutex; rather than crashing all future
/// callers we recover the inner connection (the DB itself is still valid).
macro_rules! db_conn {
    () => {
        db().lock().unwrap_or_else(|e| e.into_inner())
    };
}

fn apply_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS voice_sessions (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL,
            session_type TEXT NOT NULL DEFAULT 'meeting',
            status       TEXT NOT NULL DEFAULT 'recording',
            started_at   INTEGER NOT NULL,
            ended_at     INTEGER,
            duration_sec INTEGER,
            created_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS vs_started ON voice_sessions(started_at DESC);

        CREATE TABLE IF NOT EXISTS transcript_segments (
            id         TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
            text       TEXT NOT NULL,
            start_ms   INTEGER NOT NULL DEFAULT 0,
            end_ms     INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ts_session ON transcript_segments(session_id);

        CREATE TABLE IF NOT EXISTS session_notes (
            id              TEXT PRIMARY KEY,
            session_id      TEXT NOT NULL UNIQUE REFERENCES voice_sessions(id) ON DELETE CASCADE,
            raw_notes       TEXT,
            ai_summary      TEXT,
            ai_action_items TEXT,
            ai_decisions    TEXT,
            updated_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sn_session ON session_notes(session_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS voice_fts USING fts5(session_id UNINDEXED, text);
    ")
}

// ── Session CRUD ──────────────────────────────────────────────────────────────

pub fn create_session(id: &str, title: &str, session_type: &str) -> Result<(), String> {
    let conn = db_conn!();
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO voice_sessions (id, title, session_type, status, started_at, created_at)
         VALUES (?1, ?2, ?3, 'recording', ?4, ?4)",
        params![id, title, session_type, now],
    )
    .map_err(|e| format!("create_session: {e}"))?;
    Ok(())
}

/// Delete a session and all its associated data (segments, notes, FTS entries).
/// The schema uses ON DELETE CASCADE for child rows; FTS must be cleaned manually.
pub fn delete_session(id: &str) -> Result<(), String> {
    let mut conn = db_conn!();
    let tx = conn.transaction().map_err(|e| format!("delete_session txn: {e}"))?;
    tx.execute("DELETE FROM voice_fts WHERE session_id = ?1", params![id])
        .map_err(|e| format!("delete_session fts: {e}"))?;
    tx.execute("DELETE FROM voice_sessions WHERE id = ?1", params![id])
        .map_err(|e| format!("delete_session: {e}"))?;
    tx.commit().map_err(|e| format!("delete_session commit: {e}"))?;
    Ok(())
}

pub fn update_session_status(id: &str, status: &str) -> Result<(), String> {
    let conn = db_conn!();
    conn.execute(
        "UPDATE voice_sessions SET status = ?1 WHERE id = ?2",
        params![status, id],
    )
    .map_err(|e| format!("update_session_status: {e}"))?;
    Ok(())
}

/// Sets status='processing', ended_at, and duration_sec.
pub fn finish_session(id: &str, ended_at: i64, duration_sec: i64) -> Result<(), String> {
    let conn = db_conn!();
    conn.execute(
        "UPDATE voice_sessions SET status = 'processing', ended_at = ?1, duration_sec = ?2 WHERE id = ?3",
        params![ended_at, duration_sec, id],
    )
    .map_err(|e| format!("finish_session: {e}"))?;
    Ok(())
}

/// Sets status='complete'.
pub fn complete_session(id: &str) -> Result<(), String> {
    update_session_status(id, "complete")
}

// ── Transcript segments ───────────────────────────────────────────────────────

pub fn insert_segment(session_id: &str, text: &str, start_ms: i64, end_ms: i64) -> Result<(), String> {
    let mut conn = db_conn!();
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let tx = conn.transaction().map_err(|e| format!("insert_segment txn: {e}"))?;
    tx.execute(
        "INSERT INTO transcript_segments (id, session_id, text, start_ms, end_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, session_id, text, start_ms, end_ms, now],
    )
    .map_err(|e| format!("insert_segment: {e}"))?;
    tx.execute(
        "INSERT INTO voice_fts (session_id, text) VALUES (?1, ?2)",
        params![session_id, text],
    )
    .map_err(|e| format!("insert_segment fts: {e}"))?;
    tx.commit().map_err(|e| format!("insert_segment commit: {e}"))?;
    Ok(())
}

// ── Notes CRUD ────────────────────────────────────────────────────────────────

pub fn upsert_notes(session_id: &str, raw_notes: Option<&str>) -> Result<(), String> {
    let conn = db_conn!();
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO session_notes (id, session_id, raw_notes, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(session_id) DO UPDATE SET raw_notes = excluded.raw_notes, updated_at = excluded.updated_at",
        params![id, session_id, raw_notes, now],
    )
    .map_err(|e| format!("upsert_notes: {e}"))?;
    Ok(())
}

pub fn update_ai_output(session_id: &str, summary: &str, actions: &str, decisions: &str) -> Result<(), String> {
    let conn = db_conn!();
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE session_notes SET ai_summary = ?1, ai_action_items = ?2, ai_decisions = ?3, updated_at = ?4
         WHERE session_id = ?5",
        params![summary, actions, decisions, now, session_id],
    )
    .map_err(|e| format!("update_ai_output: {e}"))?;
    if conn.changes() == 0 {
        eprintln!("[voice_db] update_ai_output: no session_notes row found for session_id={session_id} (upsert_notes must be called first)");
    }
    Ok(())
}

// ── Queries ───────────────────────────────────────────────────────────────────

pub fn list_sessions() -> Result<Vec<VoiceSession>, String> {
    let conn = db_conn!();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, session_type, status, started_at, ended_at, duration_sec, created_at
             FROM voice_sessions ORDER BY started_at DESC LIMIT 200",
        )
        .map_err(|e| format!("list_sessions prepare: {e}"))?;
    let sessions = stmt
        .query_map([], row_to_session)
        .map_err(|e| format!("list_sessions query: {e}"))?
        .filter_map(|r| {
            r.map_err(|e| eprintln!("[voice_db] list_sessions row error: {e}"))
                .ok()
        })
        .collect();
    Ok(sessions)
}

pub fn get_session(id: &str) -> Result<Option<VoiceSession>, String> {
    let conn = db_conn!();
    let result = conn.query_row(
        "SELECT id, title, session_type, status, started_at, ended_at, duration_sec, created_at
         FROM voice_sessions WHERE id = ?1",
        params![id],
        row_to_session,
    );
    match result {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("get_session: {e}")),
    }
}

pub fn get_segments(session_id: &str) -> Result<Vec<TranscriptSegment>, String> {
    let conn = db_conn!();
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, text, start_ms, end_ms, created_at
             FROM transcript_segments WHERE session_id = ?1 ORDER BY start_ms ASC",
        )
        .map_err(|e| format!("get_segments prepare: {e}"))?;
    let segments = stmt
        .query_map(params![session_id], row_to_segment)
        .map_err(|e| format!("get_segments query: {e}"))?
        .filter_map(|r| {
            r.map_err(|e| eprintln!("[voice_db] get_segments row error: {e}"))
                .ok()
        })
        .collect();
    Ok(segments)
}

pub fn get_notes(session_id: &str) -> Result<Option<SessionNotes>, String> {
    let conn = db_conn!();
    let result = conn.query_row(
        "SELECT id, session_id, raw_notes, ai_summary, ai_action_items, ai_decisions, updated_at
         FROM session_notes WHERE session_id = ?1",
        params![session_id],
        row_to_notes,
    );
    match result {
        Ok(n) => Ok(Some(n)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("get_notes: {e}")),
    }
}

pub fn search_sessions(query: &str) -> Result<Vec<String>, String> {
    // An empty phrase literal ("") is invalid in FTS5 and returns a syntax error.
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let conn = db_conn!();
    // Wrap in phrase quotes to prevent FTS5 operator injection (AND/OR/NOT/NEAR/column filters).
    // Inner double-quotes are escaped by doubling them per FTS5 string literal rules.
    let safe_query = format!("\"{}\"", query.replace('"', "\"\""));
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT session_id FROM voice_fts WHERE voice_fts MATCH ?1 LIMIT 50",
        )
        .map_err(|e| format!("search_sessions prepare: {e}"))?;
    let ids = stmt
        .query_map(params![safe_query], |row| row.get::<_, String>(0))
        .map_err(|e| format!("search_sessions query: {e}"))?
        .filter_map(|r| {
            r.map_err(|e| eprintln!("[voice_db] search_sessions row error: {e}"))
                .ok()
        })
        .collect();
    Ok(ids)
}

// ── Row mappers ───────────────────────────────────────────────────────────────

fn row_to_session(row: &rusqlite::Row) -> rusqlite::Result<VoiceSession> {
    Ok(VoiceSession {
        id: row.get(0)?,
        title: row.get(1)?,
        session_type: row.get(2)?,
        status: row.get(3)?,
        started_at: row.get(4)?,
        ended_at: row.get(5)?,
        duration_sec: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn row_to_segment(row: &rusqlite::Row) -> rusqlite::Result<TranscriptSegment> {
    Ok(TranscriptSegment {
        id: row.get(0)?,
        session_id: row.get(1)?,
        text: row.get(2)?,
        start_ms: row.get(3)?,
        end_ms: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn row_to_notes(row: &rusqlite::Row) -> rusqlite::Result<SessionNotes> {
    Ok(SessionNotes {
        id: row.get(0)?,
        session_id: row.get(1)?,
        raw_notes: row.get(2)?,
        ai_summary: row.get(3)?,
        ai_action_items: row.get(4)?,
        ai_decisions: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Once;

    // Initialize an in-memory SQLite DB into VOICE_DB exactly once for all
    // tests in this module.  Tests share the same DB and use unique IDs to
    // avoid collisions when run in parallel.
    static DB_INIT: Once = Once::new();

    fn ensure_db() {
        DB_INIT.call_once(|| {
            let conn = Connection::open_in_memory().expect("in-memory db");
            conn.pragma_update(None, "foreign_keys", true)
                .expect("enable foreign_keys");
            apply_schema(&conn).expect("apply schema");
            VOICE_DB.set(Mutex::new(conn)).expect("set VOICE_DB");
        });
    }

    fn unique_id() -> String {
        uuid::Uuid::new_v4().to_string()
    }

    // ── voice_dir ─────────────────────────────────────────────────────────────

    #[test]
    fn voice_dir_is_under_data_local() {
        let dir = voice_dir();
        // Should end with workwithme/voice regardless of platform
        assert!(dir.ends_with("workwithme/voice") || dir.ends_with("workwithme\\voice"));
    }

    // ── search_sessions empty-query guard ─────────────────────────────────────

    #[test]
    fn search_sessions_empty_query_returns_empty_without_db() {
        // This early-return path runs before any DB access — no DB needed.
        assert_eq!(search_sessions("").unwrap(), Vec::<String>::new());
        assert_eq!(search_sessions("   ").unwrap(), Vec::<String>::new());
    }

    // ── session CRUD ──────────────────────────────────────────────────────────

    #[test]
    fn create_and_get_session_round_trip() {
        ensure_db();
        let id = unique_id();
        create_session(&id, "Test Meeting", "meeting").unwrap();
        let session = get_session(&id).unwrap().expect("session should exist");
        assert_eq!(session.id, id);
        assert_eq!(session.title, "Test Meeting");
        assert_eq!(session.status, "recording");
    }

    #[test]
    fn get_session_returns_none_for_unknown_id() {
        ensure_db();
        assert!(get_session("does-not-exist-xyz").unwrap().is_none());
    }

    #[test]
    fn update_session_status_changes_status() {
        ensure_db();
        let id = unique_id();
        create_session(&id, "Status Test", "meeting").unwrap();
        update_session_status(&id, "complete").unwrap();
        let session = get_session(&id).unwrap().unwrap();
        assert_eq!(session.status, "complete");
    }

    #[test]
    fn delete_session_removes_row() {
        ensure_db();
        let id = unique_id();
        create_session(&id, "To Delete", "meeting").unwrap();
        assert!(get_session(&id).unwrap().is_some());
        delete_session(&id).unwrap();
        assert!(get_session(&id).unwrap().is_none());
    }

    // ── transcript segments ───────────────────────────────────────────────────

    #[test]
    fn insert_and_get_segments() {
        ensure_db();
        let session_id = unique_id();
        create_session(&session_id, "Segment Test", "meeting").unwrap();
        insert_segment(&session_id, "Hello world", 0, 3000).unwrap();
        insert_segment(&session_id, "Goodbye world", 3000, 6000).unwrap();
        let segs = get_segments(&session_id).unwrap();
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].text, "Hello world");
        assert_eq!(segs[1].start_ms, 3000);
    }

    #[test]
    fn delete_session_cascades_to_segments() {
        ensure_db();
        let session_id = unique_id();
        create_session(&session_id, "Cascade Test", "meeting").unwrap();
        insert_segment(&session_id, "Segment A", 0, 1000).unwrap();
        delete_session(&session_id).unwrap();
        let segs = get_segments(&session_id).unwrap();
        assert!(segs.is_empty(), "segments should be removed on cascade");
    }

    // ── notes ─────────────────────────────────────────────────────────────────

    #[test]
    fn upsert_notes_creates_and_updates() {
        ensure_db();
        let session_id = unique_id();
        create_session(&session_id, "Notes Test", "meeting").unwrap();

        upsert_notes(&session_id, Some("First draft")).unwrap();
        let notes = get_notes(&session_id).unwrap().unwrap();
        assert_eq!(notes.raw_notes.as_deref(), Some("First draft"));

        // Upsert should update, not create a duplicate
        upsert_notes(&session_id, Some("Revised notes")).unwrap();
        let notes2 = get_notes(&session_id).unwrap().unwrap();
        assert_eq!(notes2.raw_notes.as_deref(), Some("Revised notes"));
        assert_eq!(notes2.session_id, session_id);
    }
}
