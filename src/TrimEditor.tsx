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
  // Tracks which range thumb is closest to the cursor so we can bring that
  // slider's input to the front (z-index trick for dual-range slider).
  const [frontSlider, setFrontSlider] = useState<"start" | "end">("end");
  const videoRef = useRef<HTMLVideoElement>(null);
  // Refs for use in the close handler where stale closure state is a risk.
  const rawPathRef = useRef<string | null>(null);
  const exportedRef = useRef(false);

  useEffect(() => {
    invoke<string | null>("recording_get_trim_path").then(async (path) => {
      if (!path) return;
      setRawPath(path);
      rawPathRef.current = path;
      const dur = await invoke<number>("recording_get_duration", { path });
      setDurationMs(dur);
      setEndMs(dur);
    });
  }, []);

  // Intercept all close requests (native X button AND programmatic close()) so
  // we can delete the raw temp file whenever the user discards the recording.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (!exportedRef.current && rawPathRef.current) {
        try { await remove(rawPathRef.current); } catch { /* ignore */ }
      }
      await getCurrentWindow().destroy();
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
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
      exportedRef.current = true; // tell close handler not to delete the raw file
      await getCurrentWindow().close();
    } catch (e) {
      setExportError(String(e));
    } finally {
      setExporting(false);
    }
  }

  async function handleCancel() {
    // Cleanup is handled centrally by the onCloseRequested interceptor so we
    // don't have to duplicate the remove() call here.
    await getCurrentWindow().close();
  }

  // Dynamically bring the closer thumb's range input to the front so both the
  // in-point and out-point sliders are independently reachable even though
  // they share the same absolute-positioned bounding box.
  function handleTrackHover(e: React.MouseEvent<HTMLDivElement>) {
    if (durationMs === 0) return;
    const { left, width } = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - left) / width));
    const posMs = ratio * durationMs;
    setFrontSlider(Math.abs(posMs - startMs) <= Math.abs(posMs - endMs) ? "start" : "end");
  }

  function fmtMs(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  const trimDuration = ((endMs - startMs) / 1000).toFixed(1);

  return (
    <div className="flex flex-col w-full h-screen bg-[#0d0d1a] text-[#e0e0e0] font-[system-ui,-apple-system,sans-serif] p-[16px] gap-[12px]">
      {/* Video preview */}
      <div className="flex-1 bg-black rounded-[8px] overflow-hidden min-h-0">
        {rawPath && (
          <video
            ref={videoRef}
            src={convertFileSrc(rawPath)}
            className="w-full h-full object-contain"
            controls
          />
        )}
      </div>

      {/* Timeline */}
      <div className="shrink-0">
        {/* onMouseMove updates frontSlider so the thumb closer to the cursor
            gets a higher z-index — this makes both invisible range inputs
            independently reachable despite occupying the same bounding box. */}
        <div className="relative mb-[8px]" onMouseMove={handleTrackHover}>
          <div className="h-[20px] bg-[#374151] rounded-[4px] relative">
            <div
              className="absolute h-full bg-[#6c63ff] rounded-[4px]"
              style={{
                left: durationMs > 0 ? `${(startMs / durationMs) * 100}%` : "0%",
                width: durationMs > 0 ? `${((endMs - startMs) / durationMs) * 100}%` : "100%",
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
              zIndex: frontSlider === "start" ? 3 : 2,
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
              zIndex: frontSlider === "end" ? 3 : 2,
            }}
          />
        </div>

        <div className="flex justify-between text-[11px] text-[#9ca3af]">
          <span data-testid="start-time-display">{fmtMs(startMs)}</span>
          <span data-testid="duration-label" className="text-[#6c63ff]">
            {fmtMs(durationMs)} · {trimDuration}s selected
          </span>
          <span data-testid="end-time-display">{fmtMs(endMs)}</span>
        </div>
      </div>

      {exportError && (
        <div className="text-[11px] text-[#f87171]">{exportError}</div>
      )}

      <div className="flex gap-[8px] shrink-0">
        <button onClick={handleCancel} className={secondaryBtn}>
          Cancel
        </button>
        <button
          data-testid="export-btn"
          onClick={handleExport}
          disabled={exporting || !rawPath}
          className={primaryBtn}
        >
          {exporting ? "Exporting…" : "Export MP4…"}
        </button>
      </div>
    </div>
  );
}

const primaryBtn =
  "flex-1 bg-[#6c63ff] border-none rounded-[6px] text-white px-[12px] py-[8px] text-[13px] cursor-pointer font-semibold";

const secondaryBtn =
  "bg-[#374151] border border-[#4b5563] rounded-[6px] text-[#e0e0e0] px-[12px] py-[8px] text-[13px] cursor-pointer";
