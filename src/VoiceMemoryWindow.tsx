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
      <span className="text-[#22c55e] text-[14px]">✓</span>
    );
  }
  if (status === "processing") {
    return (
      <span className="text-[#f59e0b] text-[14px]">⟳</span>
    );
  }
  // recording or other
  return (
    <span className="inline-block w-2 h-2 rounded-full bg-[#ef4444]" />
  );
}

// ---- Spinner ----

function Spinner() {
  return (
    <div className="flex justify-center items-center p-8">
      <div
        className="w-6 h-6 border-2 border-[#374151] border-t-[#6366f1] rounded-full"
        style={{ animation: "spin 0.8s linear infinite" }}
      />
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

  const handleDeleteSession = async (e: React.MouseEvent, session: VoiceSession) => {
    e.stopPropagation();
    try {
      await invoke("meeting_delete", { sessionId: session.id });
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      if (selectedSession?.id === session.id) {
        setSelectedSession(null);
        setDetail(null);
      }
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  };

  return (
    <div className="flex h-screen bg-[#111827] text-[#e0e0e0] font-[system-ui,-apple-system,sans-serif] overflow-hidden">
      {/* Left panel */}
      <div className="w-72 flex-shrink-0 border-r border-[#1f2937] flex flex-col overflow-hidden">
        {/* Search */}
        <div className="pt-3 px-3 pb-2 flex-shrink-0">
          <div className="relative">
            <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[#6b7280] text-[14px] pointer-events-none">
              🔍
            </span>
            <input
              type="text"
              placeholder="Search sessions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-[#1f2937] border border-[#374151] rounded-md py-[7px] pl-[30px] pr-[12px] text-[#e0e0e0] text-[13px] outline-none box-border"
            />
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <Spinner />
          ) : sessions.length === 0 ? (
            <div className="p-4 text-[#6b7280] text-[13px] leading-[1.5]">
              No sessions yet. Start a meeting to capture your first session.
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => handleSelectSession(s)}
                className="py-[10px] px-3 cursor-pointer border-b border-[#1f2937] flex flex-col gap-1"
                style={{ background: selectedSession?.id === s.id ? "#1f2937" : "transparent" }}
              >
                <div className="flex items-center gap-1.5">
                  <StatusIcon status={s.status} />
                  <span className="text-[13px] font-medium flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                    {s.title}
                  </span>
                  {(s.status === "error" || s.status === "recording") && (
                    <button
                      onClick={(e) => handleDeleteSession(e, s)}
                      title="Delete this session"
                      className="bg-transparent border-none text-[#6b7280] cursor-pointer text-[14px] py-0 px-[2px] leading-none flex-shrink-0"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-[#6b7280] flex gap-2">
                  <span>{formatDate(s.started_at)}</span>
                  <span>{formatDuration(s.duration_sec)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedSession ? (
          <div className="flex-1 flex items-center justify-center text-[#6b7280] text-[14px]">
            Select a session to view details
          </div>
        ) : detailLoading ? (
          <Spinner />
        ) : detail ? (
          <>
            {/* Header */}
            <div className="pt-4 px-5 pb-0 border-b border-[#1f2937] flex-shrink-0">
              <div className="mb-1">
                <h2 className="m-0 text-[16px] font-semibold">{detail.session.title}</h2>
                <div className="text-[12px] text-[#6b7280] mt-0.5">
                  {formatDate(detail.session.started_at)} · {formatDuration(detail.session.duration_sec)}
                </div>
              </div>
              {/* Tabs */}
              <div className="flex gap-0 mt-3">
                {(["summary", "transcript", "notes"] as DetailTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`bg-transparent border-none py-1.5 px-4 cursor-pointer text-[13px] capitalize border-b-2 ${
                      activeTab === tab
                        ? "border-[#6366f1] text-[#e0e0e0] font-semibold"
                        : "border-transparent text-[#6b7280] font-normal"
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto py-4 px-5">
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
                    <div className="text-[#6b7280] text-[13px]">
                      No summary yet. Open the meeting and click Generate Summary.
                    </div>
                  )}
                </div>
              )}

              {activeTab === "transcript" && (
                <div>
                  {detail.segments.length > 0 ? (
                    <p className="text-[13px] leading-[1.7] m-0 whitespace-pre-wrap">
                      {detail.segments.map((seg) => seg.text).join(" ")}
                    </p>
                  ) : (
                    <div className="text-[#6b7280] text-[13px]">No transcript available.</div>
                  )}
                </div>
              )}

              {activeTab === "notes" && (
                <div>
                  {detail.notes?.raw_notes ? (
                    <p className="text-[13px] leading-[1.7] m-0 whitespace-pre-wrap">
                      {detail.notes.raw_notes}
                    </p>
                  ) : (
                    <div className="text-[#6b7280] text-[13px]">No notes were taken.</div>
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
    <div className="mb-5">
      <h3 className="text-[12px] font-semibold text-[#6b7280] uppercase tracking-wider m-0 mb-1.5">
        {title}
      </h3>
      <div className="text-[13px] leading-[1.7] whitespace-pre-wrap">{children}</div>
    </div>
  );
}
