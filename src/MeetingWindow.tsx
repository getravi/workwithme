import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type WindowState = "idle" | "recording" | "processing" | "complete";

interface TranscriptSegment {
  text: string;
  start_ms: number;
  end_ms: number;
}

interface SummaryResult {
  summary: string;
  action_items: string;
  decisions: string;
}

function formatTime(secs: number): string {
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function MeetingWindow() {
  const [state, setState] = useState<WindowState>("idle");
  const [title, setTitle] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Set up Tauri event listeners
  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    listen<TranscriptSegment & { session_id?: string }>(
      "meeting-transcript-segment",
      (event) => {
        const seg = event.payload;
        // Filter by session_id if present
        if (seg.session_id && sessionId && seg.session_id !== sessionId) return;
        setSegments((prev) => [...prev, { text: seg.text, start_ms: seg.start_ms, end_ms: seg.end_ms }]);
      }
    ).then((unlisten) => unlisteners.push(unlisten));

    listen("meeting-transcription-complete", () => {
      setState("complete");
    }).then((unlisten) => unlisteners.push(unlisten));

    listen<SummaryResult>("meeting-summary-ready", (event) => {
      setSummary(event.payload);
      setSummaryLoading(false);
    }).then((unlisten) => unlisteners.push(unlisten));

    listen<{ error: string }>("meeting-summary-error", (event) => {
      setError(event.payload.error ?? "Summary failed");
      setSummaryLoading(false);
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [sessionId]);

  // Timer: poll elapsed every 1s while recording
  useEffect(() => {
    if (state !== "recording") {
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
      return;
    }

    elapsedIntervalRef.current = setInterval(async () => {
      try {
        const secs = await invoke<number>("meeting_get_elapsed");
        setElapsed(secs);
      } catch {
        clearInterval(elapsedIntervalRef.current!);
        elapsedIntervalRef.current = null;
      }
    }, 1000);

    return () => {
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
    };
  }, [state]);

  // Auto-save notes (debounced 300ms)
  function handleNotesChange(value: string) {
    setNotes(value);
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    notesDebounceRef.current = setTimeout(() => {
      if (sessionId) {
        invoke("meeting_save_notes", { sessionId, notes: value }).catch(() => {});
      }
    }, 300);
  }

  async function handleStart() {
    try {
      setError(null);
      const result = await invoke<{ session_id: string }>("meeting_start", { title });
      setSessionId(result.session_id);
      setState("recording");
      setElapsed(0);
      setSegments([]);
      setSummary(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleStop() {
    try {
      setState("processing");
      await invoke("meeting_stop");
    } catch (e) {
      setError(String(e));
      setState("recording");
    }
  }

  async function handleGenerateSummary() {
    try {
      setSummaryLoading(true);
      setError(null);
      await invoke("meeting_generate_summary", { sessionId });
    } catch (e) {
      setError(String(e));
      setSummaryLoading(false);
    }
  }

  const fullTranscript = segments.map((s) => s.text).join(" ");

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#111827",
        color: "#f3f4f6",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 14,
      }}
    >
      {/* Header */}
      {state === "idle" ? (
        <div
          style={{
            padding: "24px 32px 16px",
            borderBottom: "1px solid #1f2937",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600, color: "#f3f4f6" }}>
            New Meeting
          </span>
        </div>
      ) : (
        <div
          style={{
            padding: "12px 24px",
            borderBottom: "1px solid #1f2937",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* Pulsing red dot when recording */}
          {(state === "recording" || state === "processing") && (
            <>
              <div
                style={{
                  width: 8,
                  height: 8,
                  background: "#ef4444",
                  borderRadius: "50%",
                  animation: "pulse 1s ease-in-out infinite",
                  flexShrink: 0,
                }}
              />
            </>
          )}
          <span style={{ fontWeight: 600, fontSize: 15, color: "#f3f4f6" }}>
            {title || "Untitled Meeting"}
          </span>
          {(state === "recording" || state === "processing") && (
            <span
              style={{
                marginLeft: "auto",
                fontVariantNumeric: "tabular-nums",
                color: "#9ca3af",
                fontSize: 13,
              }}
            >
              {formatTime(elapsed)}
            </span>
          )}
          {state === "complete" && (
            <span style={{ marginLeft: "auto", color: "#6ee7b7", fontSize: 13 }}>
              Complete
            </span>
          )}
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {state === "idle" ? (
          // Idle: centered title input + start button
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              padding: 32,
            }}
          >
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStart()}
              placeholder="Meeting title…"
              style={{
                background: "#1f2937",
                border: "1px solid #374151",
                borderRadius: 8,
                color: "#f3f4f6",
                fontSize: 16,
                padding: "10px 16px",
                width: "100%",
                maxWidth: 400,
                outline: "none",
              }}
            />
            <button
              onClick={handleStart}
              style={{
                background: "#4f46e5",
                border: "none",
                borderRadius: 8,
                color: "#fff",
                fontSize: 15,
                fontWeight: 600,
                padding: "10px 28px",
                cursor: "pointer",
                width: "100%",
                maxWidth: 400,
              }}
            >
              Start Recording
            </button>
            {error && (
              <p style={{ color: "#f87171", fontSize: 13 }}>{error}</p>
            )}
          </div>
        ) : (
          // Recording / Processing / Complete: two-column layout
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* Left: notes */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                borderRight: "1px solid #1f2937",
                padding: 16,
              }}
            >
              <label
                style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Type rough notes here…"
                style={{
                  flex: 1,
                  background: "#182234",
                  border: "1px solid #374151",
                  borderRadius: 6,
                  color: "#f3f4f6",
                  fontSize: 13,
                  padding: 12,
                  resize: "none",
                  outline: "none",
                  lineHeight: 1.5,
                }}
              />
            </div>

            {/* Right: transcript / summary */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                padding: 16,
                overflow: "hidden",
              }}
            >
              <label
                style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                Transcript
              </label>

              {summary ? (
                // Summary view
                <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
                  <section>
                    <h3 style={{ fontSize: 13, fontWeight: 600, color: "#c5f016", margin: "0 0 6px" }}>
                      Summary
                    </h3>
                    <p style={{ color: "#d1d5db", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                      {summary.summary}
                    </p>
                  </section>
                  <section>
                    <h3 style={{ fontSize: 13, fontWeight: 600, color: "#c5f016", margin: "0 0 6px" }}>
                      Action Items
                    </h3>
                    <p style={{ color: "#d1d5db", fontSize: 13, lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>
                      {summary.action_items}
                    </p>
                  </section>
                  <section>
                    <h3 style={{ fontSize: 13, fontWeight: 600, color: "#c5f016", margin: "0 0 6px" }}>
                      Decisions
                    </h3>
                    <p style={{ color: "#d1d5db", fontSize: 13, lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>
                      {summary.decisions}
                    </p>
                  </section>
                </div>
              ) : state === "recording" && segments.length === 0 ? (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#6b7280",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  Transcript will appear after the meeting ends.
                </div>
              ) : (
                <div
                  style={{
                    flex: 1,
                    overflow: "auto",
                    background: "#182234",
                    borderRadius: 6,
                    padding: 12,
                    fontSize: 13,
                    color: "#d1d5db",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {segments.length > 0 ? fullTranscript : (
                    <span style={{ color: "#6b7280" }}>
                      Transcript will appear after the meeting ends.
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {state !== "idle" && (
        <div
          style={{
            padding: "12px 24px",
            borderTop: "1px solid #1f2937",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
          }}
        >
          {error && (
            <span style={{ color: "#f87171", fontSize: 13, marginRight: "auto" }}>
              {error}
            </span>
          )}

          {state === "recording" && (
            <button
              onClick={handleStop}
              style={{
                background: "#374151",
                border: "1px solid #4b5563",
                borderRadius: 6,
                color: "#f3f4f6",
                fontSize: 13,
                fontWeight: 500,
                padding: "7px 18px",
                cursor: "pointer",
              }}
            >
              Stop Recording
            </button>
          )}

          {state === "processing" && (
            <span style={{ color: "#fbbf24", fontSize: 13 }}>
              Transcribing…
            </span>
          )}

          {state === "complete" && !summary && (
            <button
              onClick={handleGenerateSummary}
              disabled={summaryLoading}
              style={{
                background: summaryLoading ? "#312e81" : "#4f46e5",
                border: "none",
                borderRadius: 6,
                color: summaryLoading ? "#a5b4fc" : "#fff",
                fontSize: 13,
                fontWeight: 500,
                padding: "7px 18px",
                cursor: summaryLoading ? "default" : "pointer",
              }}
            >
              {summaryLoading ? "Generating…" : "Generate Summary"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
