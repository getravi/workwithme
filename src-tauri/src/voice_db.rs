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
pub fn init_db() -> Result<(), String> {
    let dir = voice_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("create voice dir: {e}"))?;
    let db_path = dir.join("voice.db");
    let conn = Connection::open(&db_path).map_err(|e| format!("open voice db: {e}"))?;
    apply_schema(&conn).map_err(|e| format!("voice schema: {e}"))?;
    VOICE_DB
        .set(Mutex::new(conn))
        .map_err(|_| "VOICE_DB already initialized".to_string())
}

fn db() -> &'static Mutex<Connection> {
    VOICE_DB.get().expect("voice DB not initialized")
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
    let conn = db().lock().unwrap();
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO voice_sessions (id, title, session_type, status, started_at, created_at)
         VALUES (?1, ?2, ?3, 'recording', ?4, ?4)",
        params![id, title, session_type, now],
    )
    .map_err(|e| format!("create_session: {e}"))?;
    Ok(())
}

pub fn update_session_status(id: &str, status: &str) -> Result<(), String> {
    let conn = db().lock().unwrap();
    conn.execute(
        "UPDATE voice_sessions SET status = ?1 WHERE id = ?2",
        params![status, id],
    )
    .map_err(|e| format!("update_session_status: {e}"))?;
    Ok(())
}

/// Sets status='processing', ended_at, and duration_sec.
pub fn finish_session(id: &str, ended_at: i64, duration_sec: i64) -> Result<(), String> {
    let conn = db().lock().unwrap();
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
    let mut conn = db().lock().unwrap();
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
    let conn = db().lock().unwrap();
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
    let conn = db().lock().unwrap();
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
    let conn = db().lock().unwrap();
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
    let conn = db().lock().unwrap();
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
    let conn = db().lock().unwrap();
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
    let conn = db().lock().unwrap();
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
    let conn = db().lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT session_id FROM voice_fts WHERE voice_fts MATCH ?1 LIMIT 50",
        )
        .map_err(|e| format!("search_sessions prepare: {e}"))?;
    let ids = stmt
        .query_map(params![query], |row| row.get::<_, String>(0))
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
