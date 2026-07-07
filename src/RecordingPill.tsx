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
    <div className="w-full h-full flex items-center justify-center gap-[10px] bg-[rgba(26,26,46,0.92)] rounded-[22px] border border-[rgba(255,255,255,0.1)] backdrop-blur-[8px] px-[14px] py-0 font-[system-ui,-apple-system,sans-serif]">
      {/* Pulsing red dot */}
      <div
        data-testid="recording-dot"
        className="w-[8px] h-[8px] bg-[#ef4444] rounded-full [animation:pulse_1s_ease-in-out_infinite]"
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
        className="text-[13px] text-[#e0e0e0] min-w-[42px] text-center"
      >
        {elapsed}
      </span>

      {/* Stop button */}
      <button
        data-testid="stop-btn"
        onClick={handleStop}
        disabled={stopping}
        className={`bg-[#374151] border border-[#4b5563] rounded-[4px] text-[#e0e0e0] text-[12px] px-[10px] py-[3px] ${stopping ? "cursor-default" : "cursor-pointer"}`}
      >
        {stopping ? "…" : "■ Stop"}
      </button>
    </div>
  );
}
