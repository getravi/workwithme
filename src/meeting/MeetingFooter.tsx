import { type WindowState, type SummaryResult, formatTime } from "./types";

interface MeetingFooterProps {
  state: WindowState;
  error: string | null;
  summary: SummaryResult | null;
  summaryLoading: boolean;
  processingElapsed: number;
  onStop: () => void;
  onReset: () => void;
  onGenerateSummary: () => void;
}

const SECONDARY_BUTTON =
  "bg-[#374151] border border-[#4b5563] rounded-[6px] text-[#f3f4f6] text-[13px] font-medium py-[7px] px-[18px] cursor-pointer";

export function MeetingFooter({
  state,
  error,
  summary,
  summaryLoading,
  processingElapsed,
  onStop,
  onReset,
  onGenerateSummary,
}: MeetingFooterProps) {
  return (
    <div className="flex items-center justify-end gap-[12px] py-[12px] px-[24px] border-t border-[#1f2937]">
      {error && <span className="text-[#f87171] text-[13px] mr-auto">{error}</span>}

      {state === "recording" && (
        <button onClick={onStop} className={SECONDARY_BUTTON}>
          Stop Recording
        </button>
      )}

      {state === "processing" && (
        <span className="text-[#fbbf24] text-[13px] tabular-nums">
          Transcribing… {formatTime(processingElapsed)}
        </span>
      )}

      {state === "error" && (
        <button onClick={onReset} className={SECONDARY_BUTTON}>
          New Meeting
        </button>
      )}

      {state === "complete" && !summary && (
        <button
          onClick={onGenerateSummary}
          disabled={summaryLoading}
          className={`border-none rounded-[6px] text-[13px] font-medium py-[7px] px-[18px] ${
            summaryLoading
              ? "bg-[#312e81] text-[#a5b4fc] cursor-default"
              : "bg-[#4f46e5] text-white cursor-pointer"
          }`}
        >
          {summaryLoading ? "Generating…" : "Generate Summary"}
        </button>
      )}
    </div>
  );
}
