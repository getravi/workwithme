import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

interface MicDevice {
  index: number;
  name: string;
}

export function RecordingOptionsPanel() {
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);
  const [selectedMicIndex, setSelectedMicIndex] = useState<number | null>(null);
  const [areaMode, setAreaMode] = useState<"fullscreen" | "region">("fullscreen");
  const [region, setRegion] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    invoke<MicDevice[]>("recording_list_mics").then((devices) => {
      setMics(devices);
      if (devices.length > 0) {
        setSelectedMicIndex(devices[0].index);
      }
    });

    // Listen for region selected from the overlay window
    listen<{ x: number; y: number; width: number; height: number }>(
      "recording-region-selected",
      (event) => {
        setRegion(event.payload);
        setAreaMode("region");
        // Show the options window again after region is selected
        getCurrentWindow().show().catch(() => {});
      }
    ).then((unlisten) => {
      unlistenRef.current = unlisten;
    });

    return () => {
      unlistenRef.current?.();
    };
  }, []);

  async function handleSelectRegion() {
    try {
      await invoke("open_region_select_recording");
      await getCurrentWindow().hide();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRecord() {
    setCountdown(3);
    await new Promise((r) => setTimeout(r, 1000));
    setCountdown(2);
    await new Promise((r) => setTimeout(r, 1000));
    setCountdown(1);
    await new Promise((r) => setTimeout(r, 1000));
    setCountdown(null);
    try {
      const micDeviceIndex = micEnabled && selectedMicIndex !== null ? selectedMicIndex : null;
      await invoke("recording_start", {
        region: region ?? null,
        micDeviceIndex,
      });
      await invoke("open_recording_pill");
      await getCurrentWindow().close();
    } catch (e) {
      setError(String(e));
      setCountdown(null);
    }
  }

  const noMics = mics.length === 0;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#1a1a2e",
        color: "#e0e0e0",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>Record Screen</div>

      {/* Area selection */}
      <div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>Area</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
          <input
            type="radio"
            data-testid="radio-fullscreen"
            name="area"
            checked={areaMode === "fullscreen"}
            onChange={() => setAreaMode("fullscreen")}
          />
          <span style={{ fontSize: 13 }}>Full Screen</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="radio"
            data-testid="radio-region"
            name="area"
            checked={areaMode === "region"}
            onChange={handleSelectRegion}
            onClick={handleSelectRegion}
          />
          <span style={{ fontSize: 13 }}>
            {region ? `Region: ${region.width}×${region.height}` : "Select Region"}
          </span>
        </label>
      </div>

      {/* Mic selection */}
      <div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>Microphone</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            data-testid="mic-toggle"
            checked={micEnabled}
            disabled={noMics}
            onChange={(e) => setMicEnabled(e.target.checked)}
          />
          {noMics ? (
            <span style={{ fontSize: 12, color: "#6b7280" }}>No mic found</span>
          ) : (
            <select
              value={selectedMicIndex ?? ""}
              disabled={!micEnabled}
              onChange={(e) => setSelectedMicIndex(Number(e.target.value))}
              style={{
                background: "#374151",
                border: "1px solid #4b5563",
                borderRadius: 4,
                color: "#e0e0e0",
                fontSize: 12,
                padding: "2px 6px",
              }}
            >
              {mics.map((m) => (
                <option key={m.index} value={m.index}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: "#f87171" }}>{error}</div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
        <button
          onClick={() => getCurrentWindow().close()}
          style={secondaryBtn}
        >
          Cancel
        </button>
        <button
          data-testid="record-btn"
          onClick={handleRecord}
          disabled={countdown !== null}
          style={{ ...primaryBtn, opacity: countdown !== null ? 0.7 : 1 }}
        >
          {countdown !== null ? `Starting in ${countdown}…` : "▶ Record"}
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
