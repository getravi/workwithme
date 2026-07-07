export type WindowState = "idle" | "recording" | "processing" | "complete" | "error";

export interface TranscriptSegment {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface SummaryResult {
  summary: string;
  action_items: string;
  decisions: string;
}

export function formatTime(secs: number): string {
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
