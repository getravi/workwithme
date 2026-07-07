import { type WindowState, formatTime } from "./types";

interface MeetingHeaderProps {
  state: WindowState;
  title: string;
  elapsed: number;
}

export function MeetingHeader({ state, title, elapsed }: MeetingHeaderProps) {
  if (state === "idle") {
    return (
      <div className="flex items-center gap-[12px] pt-[24px] px-[32px] pb-[16px] border-b border-[#1f2937]">
        <span className="text-[16px] font-semibold text-[#f3f4f6]">New Meeting</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-[12px] py-[12px] px-[24px] border-b border-[#1f2937]">
      {/* Red status dot — pulses while active, steady on error */}
      {(state === "recording" || state === "processing" || state === "error") && (
        <div
          className="w-[8px] h-[8px] bg-[#ef4444] rounded-full flex-shrink-0"
          style={{ animation: state === "error" ? undefined : "pulse 1s ease-in-out infinite" }}
        />
      )}
      <span className="font-semibold text-[15px] text-[#f3f4f6]">
        {title || "Untitled Meeting"}
      </span>
      {(state === "recording" || state === "processing") && (
        <span className="ml-auto tabular-nums text-[#9ca3af] text-[13px]">
          {formatTime(elapsed)}
        </span>
      )}
      {state === "complete" && (
        <span className="ml-auto text-[#6ee7b7] text-[13px]">Complete</span>
      )}
      {state === "error" && (
        <span className="ml-auto text-[#f87171] text-[13px]">Transcription Failed</span>
      )}
    </div>
  );
}
