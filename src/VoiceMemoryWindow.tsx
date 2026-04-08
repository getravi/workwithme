import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ---- Interfaces ----

interface VoiceSession {
  id: string;
  title: string;
  type: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  duration_sec: number | null;
  created_at: number;
}

interface TranscriptSegment {
  id: string;
  session_id: string;
  text: string;
  start_ms: number;
  end_ms: number;
  created_at: number;
}

interface SessionNotes {
  id: string;
  session_id: string;
  raw_notes: string | null;
  ai_summary: string | null;
  ai_action_items: string | null;
  ai_decisions: string | null;
  updated_at: number;
}

interface MeetingDetail {
  session: VoiceSession;
  segments: TranscriptSegment[];
  notes: SessionNotes | null;
}

type DetailTab = "summary" | "transcript" | "notes";

// ---- Helper functions ----

function formatDuration(secs: number | null): string {
  if (secs == null) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// ---- Status Icon ----

function StatusIcon({ status }: { status: string }) {
  if (status === "complete") {
    return (
      <span style={{ color: "#22c55e", fontSize: 14 }}>✓</span>
    );
  }
  if (status === "processing") {
    return (
      <span style={{ color: "#f59e0b", fontSize: 14 }}>⟳</span>
    );
  }
  // recording or other
  return (
    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#ef4444" }} />
  );
}

// ---- Spinner ----

function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 32 }}>
      <div style={{
        width: 24, height: 24, border: "2px solid #374151",
        borderTopColor: "#6366f1", borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ---- Main Component ----

export function VoiceMemoryWindow() {
  const [sessions, setSessions] = useState<VoiceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedSession, setSelectedSession] = useState<VoiceSession | null>(null);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("summary");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenRef = useRef(0); // incremented per search to discard stale results

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<VoiceSession[]>("meeting_list");
      setSessions(result);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Listen for transcription complete event
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("meeting-transcription-complete", () => {
      loadSessions();
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [loadSessions]);

  // Debounced search — generation counter prevents stale results from overwriting newer ones
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (query.trim()) {
        const gen = ++searchGenRef.current;
        const result = await invoke<VoiceSession[]>("meeting_search", { query: query.trim() });
        if (gen === searchGenRef.current) setSessions(result);
      } else {
        loadSessions();
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, loadSessions]);

  const handleSelectSession = async (session: VoiceSession) => {
    setSelectedSession(session);
    setActiveTab("summary");
    setDetailLoading(true);
    try {
      const d = await invoke<MeetingDetail>("meeting_get", { sessionId: session.id });
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      background: "#111827",
      color: "#e0e0e0",
      fontFamily: "system-ui, -apple-system, sans-serif",
      overflow: "hidden",
    }}>
      {/* Left panel */}
      <div style={{
        width: 288,
        flexShrink: 0,
        borderRight: "1px solid #1f2937",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Search */}
        <div style={{ padding: "12px 12px 8px", flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <span style={{
              position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
              color: "#6b7280", fontSize: 14, pointerEvents: "none",
            }}>
              🔍
            </span>
            <input
              type="text"
              placeholder="Search sessions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: "100%",
                background: "#1f2937",
                border: "1px solid #374151",
                borderRadius: 6,
                padding: "7px 12px 7px 30px",
                color: "#e0e0e0",
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <Spinner />
          ) : sessions.length === 0 ? (
            <div style={{ padding: 16, color: "#6b7280", fontSize: 13, lineHeight: 1.5 }}>
              No sessions yet. Start a meeting to capture your first session.
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => handleSelectSession(s)}
                style={{
                  padding: "10px 12px",
                  cursor: "pointer",
                  background: selectedSession?.id === s.id ? "#1f2937" : "transparent",
                  borderBottom: "1px solid #1f2937",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <StatusIcon status={s.status} />
                  <span style={{
                    fontSize: 13, fontWeight: 500, flex: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {s.title}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", display: "flex", gap: 8 }}>
                  <span>{formatDate(s.started_at)}</span>
                  <span>{formatDuration(s.duration_sec)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!selectedSession ? (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: "#6b7280", fontSize: 14,
          }}>
            Select a session to view details
          </div>
        ) : detailLoading ? (
          <Spinner />
        ) : detail ? (
          <>
            {/* Header */}
            <div style={{ padding: "16px 20px 0", borderBottom: "1px solid #1f2937", flexShrink: 0 }}>
              <div style={{ marginBottom: 4 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{detail.session.title}</h2>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                  {formatDate(detail.session.started_at)} · {formatDuration(detail.session.duration_sec)}
                </div>
              </div>
              {/* Tabs */}
              <div style={{ display: "flex", gap: 0, marginTop: 12 }}>
                {(["summary", "transcript", "notes"] as DetailTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      background: "none",
                      border: "none",
                      borderBottom: activeTab === tab ? "2px solid #6366f1" : "2px solid transparent",
                      padding: "6px 16px",
                      color: activeTab === tab ? "#e0e0e0" : "#6b7280",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: activeTab === tab ? 600 : 400,
                      textTransform: "capitalize",
                    }}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {activeTab === "summary" && (
                <div>
                  {detail.notes?.ai_summary ? (
                    <>
                      <Section title="Summary">{detail.notes.ai_summary}</Section>
                      {detail.notes.ai_action_items && (
                        <Section title="Action Items">{detail.notes.ai_action_items}</Section>
                      )}
                      {detail.notes.ai_decisions && (
                        <Section title="Decisions">{detail.notes.ai_decisions}</Section>
                      )}
                    </>
                  ) : (
                    <div style={{ color: "#6b7280", fontSize: 13 }}>
                      No summary yet. Open the meeting and click Generate Summary.
                    </div>
                  )}
                </div>
              )}

              {activeTab === "transcript" && (
                <div>
                  {detail.segments.length > 0 ? (
                    <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>
                      {detail.segments.map((seg) => seg.text).join(" ")}
                    </p>
                  ) : (
                    <div style={{ color: "#6b7280", fontSize: 13 }}>No transcript available.</div>
                  )}
                </div>
              )}

              {activeTab === "notes" && (
                <div>
                  {detail.notes?.raw_notes ? (
                    <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>
                      {detail.notes.raw_notes}
                    </p>
                  ) : (
                    <div style={{ color: "#6b7280", fontSize: 13 }}>No notes were taken.</div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 6px" }}>
        {title}
      </h3>
      <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{children}</div>
    </div>
  );
}
