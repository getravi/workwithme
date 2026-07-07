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
    let cancelled = false;
    listen<{ x: number; y: number; width: number; height: number }>(
      "recording-region-selected",
      (event) => {
        setRegion(event.payload);
        setAreaMode("region");
        // Show the options window again after region is selected
        getCurrentWindow().show().catch(() => {});
      }
    ).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    });

    return () => {
      cancelled = true;
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
    <div className="w-full h-full bg-[#1a1a2e] text-[#e0e0e0] font-[system-ui,-apple-system,sans-serif] p-[20px] flex flex-col gap-[14px]">
      <div className="text-[15px] font-semibold">Record Screen</div>

      {/* Area selection */}
      <div>
        <div className="text-[11px] text-[#9ca3af] mb-[6px]">Area</div>
        <label className="flex items-center gap-[8px] mb-[6px] cursor-pointer">
          <input
            type="radio"
            data-testid="radio-fullscreen"
            name="area"
            checked={areaMode === "fullscreen"}
            onChange={() => setAreaMode("fullscreen")}
          />
          <span className="text-[13px]">Full Screen</span>
        </label>
        <label className="flex items-center gap-[8px] cursor-pointer">
          <input
            type="radio"
            data-testid="radio-region"
            name="area"
            checked={areaMode === "region"}
            onChange={handleSelectRegion}
          />
          <span className="text-[13px]">
            {region ? `Region: ${region.width}×${region.height}` : "Select Region"}
          </span>
        </label>
      </div>

      {/* Mic selection */}
      <div>
        <div className="text-[11px] text-[#9ca3af] mb-[6px]">Microphone</div>
        <div className="flex items-center gap-[10px]">
          <input
            type="checkbox"
            data-testid="mic-toggle"
            checked={micEnabled}
            disabled={noMics}
            onChange={(e) => setMicEnabled(e.target.checked)}
          />
          {noMics ? (
            <span className="text-[12px] text-[#6b7280]">No mic found</span>
          ) : (
            <select
              value={selectedMicIndex ?? ""}
              disabled={!micEnabled}
              onChange={(e) => setSelectedMicIndex(Number(e.target.value))}
              className="bg-[#374151] border border-[#4b5563] rounded-[4px] text-[#e0e0e0] text-[12px] px-[6px] py-[2px]"
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
        <div className="text-[11px] text-[#f87171]">{error}</div>
      )}

      {/* Actions */}
      <div className="flex gap-[8px] mt-auto">
        <button
          onClick={() => getCurrentWindow().close()}
          className={secondaryBtn}
        >
          Cancel
        </button>
        <button
          data-testid="record-btn"
          onClick={handleRecord}
          disabled={countdown !== null}
          className={`${primaryBtn} ${countdown !== null ? "opacity-70" : "opacity-100"}`}
        >
          {countdown !== null ? `Starting in ${countdown}…` : "▶ Record"}
        </button>
      </div>
    </div>
  );
}

const primaryBtn =
  "flex-1 bg-[#6c63ff] border-none rounded-[6px] text-white px-[12px] py-[8px] text-[13px] cursor-pointer font-semibold";

const secondaryBtn =
  "bg-[#374151] border border-[#4b5563] rounded-[6px] text-[#e0e0e0] px-[12px] py-[8px] text-[13px] cursor-pointer";
