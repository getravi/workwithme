import { useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";
import { remove } from "@tauri-apps/plugin-fs";

export function TrimEditor() {
  const [rawPath, setRawPath] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [startMs, setStartMs] = useState(0);
  const [endMs, setEndMs] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    invoke<string | null>("recording_get_trim_path").then(async (path) => {
      if (!path) return;
      setRawPath(path);
      const dur = await invoke<number>("recording_get_duration", { path });
      setDurationMs(dur);
      setEndMs(dur);
    });
  }, []);

  function handleStartChange(ms: number) {
    setStartMs(ms);
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
  }

  function handleEndChange(ms: number) {
    setEndMs(ms);
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
  }

  async function handleExport() {
    if (!rawPath) return;
    const outputPath = await save({
      defaultPath: `recording-${new Date().toISOString().slice(0, 10)}.mp4`,
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    });
    if (!outputPath) return;

    setExporting(true);
    setExportError(null);
    try {
      await invoke("recording_export", {
        input: rawPath,
        output: outputPath,
        startMs,
        endMs,
      });
      await invoke("library_save_video", { exportedPath: outputPath });
      await getCurrentWindow().close();
    } catch (e) {
      setExportError(String(e));
    } finally {
      setExporting(false);
    }
  }

  async function handleCancel() {
    if (rawPath) {
      try {
        await remove(rawPath);
      } catch { /* ignore */ }
    }
    await getCurrentWindow().close();
  }

  function fmtMs(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  const trimDuration = ((endMs - startMs) / 1000).toFixed(1);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0d0d1a",
        color: "#e0e0e0",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 16,
        gap: 12,
      }}
    >
      {/* Video preview */}
      <div style={{ flex: 1, background: "#000", borderRadius: 8, overflow: "hidden", minHeight: 0 }}>
        {rawPath && (
          <video
            ref={videoRef}
            src={convertFileSrc(rawPath)}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            controls
          />
        )}
      </div>

      {/* Timeline */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ position: "relative", marginBottom: 8 }}>
          <div
            style={{
              height: 20,
              background: "#374151",
              borderRadius: 4,
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: durationMs > 0 ? `${(startMs / durationMs) * 100}%` : "0%",
                width: durationMs > 0 ? `${((endMs - startMs) / durationMs) * 100}%` : "100%",
                height: "100%",
                background: "#6c63ff",
                borderRadius: 4,
              }}
            />
          </div>

          <input
            data-testid="in-point-slider"
            type="range"
            min={0}
            max={durationMs}
            value={startMs}
            onChange={(e) => handleStartChange(Number(e.target.value))}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              opacity: 0,
              cursor: "ew-resize",
              height: "100%",
            }}
          />

          <input
            data-testid="out-point-slider"
            type="range"
            min={0}
            max={durationMs}
            value={endMs}
            onChange={(e) => handleEndChange(Number(e.target.value))}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              opacity: 0,
              cursor: "ew-resize",
              height: "100%",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "#9ca3af",
          }}
        >
          <span data-testid="start-time-display">{fmtMs(startMs)}</span>
          <span data-testid="duration-label" style={{ color: "#6c63ff" }}>
            {fmtMs(durationMs)} · {trimDuration}s selected
          </span>
          <span data-testid="end-time-display">{fmtMs(endMs)}</span>
        </div>
      </div>

      {exportError && (
        <div style={{ fontSize: 11, color: "#f87171" }}>{exportError}</div>
      )}

      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button onClick={handleCancel} style={secondaryBtn}>
          Cancel
        </button>
        <button
          data-testid="export-btn"
          onClick={handleExport}
          disabled={exporting || !rawPath}
          style={primaryBtn}
        >
          {exporting ? "Exporting…" : "Export MP4…"}
        </button>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  flex: 1,
  background: "#6c63ff",
  border: "none",
  borderRadius: 6,
  color: "#fff",
  padding: "8px 12px",
  fontSize: 13,
  cursor: "pointer",
  fontWeight: 600,
};

const secondaryBtn: React.CSSProperties = {
  background: "#374151",
  border: "1px solid #4b5563",
  borderRadius: 6,
  color: "#e0e0e0",
  padding: "8px 12px",
  fontSize: 13,
  cursor: "pointer",
};
