import { type WindowState, type TranscriptSegment, type SummaryResult } from "./types";

interface MeetingTranscriptPanelProps {
  state: WindowState;
  segments: TranscriptSegment[];
  summary: SummaryResult | null;
}

function SummaryView({ summary }: { summary: SummaryResult }) {
  return (
    <div className="flex-1 overflow-auto flex flex-col gap-[16px]">
      <section>
        <h3 className="text-[13px] font-semibold text-[#c5f016] m-0 mb-[6px]">Summary</h3>
        <p className="text-[#d1d5db] text-[13px] leading-[1.6] m-0">{summary.summary}</p>
      </section>
      <section>
        <h3 className="text-[13px] font-semibold text-[#c5f016] m-0 mb-[6px]">Action Items</h3>
        <p className="text-[#d1d5db] text-[13px] leading-[1.6] m-0 whitespace-pre-wrap">
          {summary.action_items}
        </p>
      </section>
      <section>
        <h3 className="text-[13px] font-semibold text-[#c5f016] m-0 mb-[6px]">Decisions</h3>
        <p className="text-[#d1d5db] text-[13px] leading-[1.6] m-0 whitespace-pre-wrap">
          {summary.decisions}
        </p>
      </section>
    </div>
  );
}

export function MeetingTranscriptPanel({ state, segments, summary }: MeetingTranscriptPanelProps) {
  const fullTranscript = segments.map((s) => s.text).join(" ");

  return (
    <div className="flex-1 flex flex-col p-[16px] overflow-hidden">
      <label className="text-[11px] text-[#9ca3af] mb-[6px] uppercase tracking-[0.05em]">
        Transcript
      </label>

      {summary ? (
        <SummaryView summary={summary} />
      ) : state === "recording" && segments.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[#6b7280] text-[13px] text-center">
          Transcript will appear after the meeting ends.
        </div>
      ) : (
        <div className="flex-1 overflow-auto bg-[#182234] rounded-[6px] p-[12px] text-[13px] text-[#d1d5db] leading-[1.6] whitespace-pre-wrap">
          {segments.length > 0 ? (
            fullTranscript
          ) : (
            <span className="text-[#6b7280]">Transcript will appear after the meeting ends.</span>
          )}
        </div>
      )}
    </div>
  );
}
