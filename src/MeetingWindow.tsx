import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useDebouncedSave } from "./hooks/useDebouncedSave";
import { type WindowState, type TranscriptSegment, type SummaryResult } from "./meeting/types";
import { MeetingHeader } from "./meeting/MeetingHeader";
import { MeetingIdlePanel } from "./meeting/MeetingIdlePanel";
import { MeetingNotes } from "./meeting/MeetingNotes";
import { MeetingTranscriptPanel } from "./meeting/MeetingTranscriptPanel";
import { MeetingFooter } from "./meeting/MeetingFooter";

export function MeetingWindow() {
  const [state, setState] = useState<WindowState>("idle");
  const [title, setTitle] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [processingElapsed, setProcessingElapsed] = useState(0);

  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Debounced notes save that also flushes on unmount, so notes aren't lost when
  // the window closes mid-debounce (e.g. user types then immediately closes it).
  const saveNotes = useDebouncedSave<{ sessionId: string; notes: string }>(
    ({ sessionId: sid, notes: n }) => {
      invoke("meeting_save_notes", { sessionId: sid, notes: n }).catch(() => {});
    },
    300,
  );

  // Set up Tauri event listeners.
  // All four listen() calls are awaited together with Promise.all so that the cleanup
  // function always has every unlisten handle — previously individual .then() pushes
  // could race against a fast unmount and leave stale listeners firing on dead components.
  useEffect(() => {
    let mounted = true;
    const unlisteners: Array<() => void> = [];

    Promise.all([
      listen<TranscriptSegment & { session_id?: string }>(
        "meeting-transcript-segment",
        (event) => {
          const seg = event.payload;
          // Filter by session_id if present
          if (seg.session_id && sessionId && seg.session_id !== sessionId) return;
          setSegments((prev) => [...prev, { text: seg.text, start_ms: seg.start_ms, end_ms: seg.end_ms }]);
        }
      ),
      listen<{ session_id?: string }>("meeting-transcription-complete", (event) => {
        if (event.payload.session_id && sessionId && event.payload.session_id !== sessionId) return;
        setState("complete");
      }),
      listen<SummaryResult>("meeting-summary-ready", (event) => {
        setSummary(event.payload);
        setSummaryLoading(false);
      }),
      listen<{ error: string }>("meeting-summary-error", (event) => {
        setError(event.payload.error ?? "Summary failed");
        setSummaryLoading(false);
      }),
      listen<{ session_id: string; error: string }>("meeting-transcription-error", (event) => {
        if (event.payload.session_id && sessionId && event.payload.session_id !== sessionId) return;
        setError(event.payload.error ?? "Transcription failed");
        setState("error");
      }),
    ]).then((fns) => {
      if (mounted) {
        unlisteners.push(...fns);
      } else {
        // Component unmounted before promises resolved — clean up immediately
        fns.forEach((fn) => fn());
      }
    });

    return () => {
      mounted = false;
      unlisteners.forEach((fn) => fn());
    };
  }, [sessionId]);

  // Timer: poll elapsed every 1s while recording
  useEffect(() => {
    if (state !== "recording") {
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
      return;
    }

    elapsedIntervalRef.current = setInterval(async () => {
      try {
        const secs = await invoke<number>("meeting_get_elapsed");
        setElapsed(secs);
      } catch {
        clearInterval(elapsedIntervalRef.current!);
        elapsedIntervalRef.current = null;
      }
    }, 1000);

    return () => {
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
    };
  }, [state]);

  // Processing elapsed timer — ticks every second while transcription is running
  useEffect(() => {
    setProcessingElapsed(0);
    if (state !== "processing") return;
    const id = setInterval(() => setProcessingElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  // Auto-save notes (debounced 300ms, flushed on unmount)
  function handleNotesChange(value: string) {
    setNotes(value);
    if (sessionId) saveNotes({ sessionId, notes: value });
  }

  async function handleStart() {
    try {
      setError(null);
      const effectiveTitle = title.trim() || "Untitled Meeting";
      if (!title.trim()) setTitle(effectiveTitle);
      const result = await invoke<{ session_id: string }>("meeting_start", { title: effectiveTitle });
      setSessionId(result.session_id);
      setState("recording");
      setElapsed(0);
      setSegments([]);
      setSummary(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleStop() {
    try {
      setState("processing");
      await invoke("meeting_stop");
    } catch (e) {
      setError(String(e));
      setState("recording");
    }
  }

  async function handleGenerateSummary() {
    try {
      setSummaryLoading(true);
      setError(null);
      await invoke("meeting_generate_summary", { sessionId });
    } catch (e) {
      setError(String(e));
      setSummaryLoading(false);
    }
  }

  function handleReset() {
    setState("idle");
    setError(null);
    setSessionId(null);
    setSegments([]);
    setSummary(null);
  }

  return (
    <div className="w-full h-screen flex flex-col bg-[#111827] text-[#f3f4f6] font-[Inter,system-ui,sans-serif] text-[14px]">
      <MeetingHeader state={state} title={title} elapsed={elapsed} />

      {/* Body */}
      <div className="flex-1 overflow-hidden flex">
        {state === "idle" ? (
          <MeetingIdlePanel title={title} onTitleChange={setTitle} onStart={handleStart} error={error} />
        ) : (
          // Recording / Processing / Complete: two-column layout
          <div className="flex-1 flex overflow-hidden">
            <MeetingNotes notes={notes} onNotesChange={handleNotesChange} />
            <MeetingTranscriptPanel state={state} segments={segments} summary={summary} />
          </div>
        )}
      </div>

      {state !== "idle" && (
        <MeetingFooter
          state={state}
          error={error}
          summary={summary}
          summaryLoading={summaryLoading}
          processingElapsed={processingElapsed}
          onStop={handleStop}
          onReset={handleReset}
          onGenerateSummary={handleGenerateSummary}
        />
      )}
    </div>
  );
}
