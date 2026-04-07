import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function RecordingPill() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stopping, setStopping] = useState(false);

  // Retrieve the active session ID on mount
  useEffect(() => {
    invoke<string | null>("recording_get_current_session").then((id) => {
      setSessionId(id);
    });
  }, []);

  // Poll elapsed time every second once we have a session ID
  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(async () => {
      try {
        const ms = await invoke<number>("recording_get_elapsed", { sessionId });
        setElapsedMs(ms);
      } catch {
        // Session ended externally — stop polling
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionId]);

  async function handleStop() {
    if (!sessionId || stopping) return;
    setStopping(true);
    try {
      const rawPath = await invoke<string>("recording_stop", { sessionId });
      await invoke("open_trim_editor", { rawPath });
      await getCurrentWindow().close();
    } catch (e) {
      console.error("[RecordingPill] stop failed:", e);
      setStopping(false);
    }
  }

  const totalSec = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  const elapsed = `${mm}:${ss}`;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        background: "rgba(26, 26, 46, 0.92)",
        borderRadius: 22,
        border: "1px solid rgba(255,255,255,0.1)",
        backdropFilter: "blur(8px)",
        padding: "0 14px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Pulsing red dot */}
      <div
        data-testid="recording-dot"
        style={{
          width: 8,
          height: 8,
          background: "#ef4444",
          borderRadius: "50%",
          animation: "pulse 1s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>

      {/* Elapsed time */}
      <span
        data-testid="elapsed-display"
        style={{ fontSize: 13, color: "#e0e0e0", minWidth: 42, textAlign: "center" }}
      >
        {elapsed}
      </span>

      {/* Stop button */}
      <button
        data-testid="stop-btn"
        onClick={handleStop}
        disabled={stopping}
        style={{
          background: "#374151",
          border: "1px solid #4b5563",
          borderRadius: 4,
          color: "#e0e0e0",
          fontSize: 12,
          padding: "3px 10px",
          cursor: stopping ? "default" : "pointer",
        }}
      >
        {stopping ? "…" : "■ Stop"}
      </button>
    </div>
  );
}
