import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// Capture Tauri event listeners so tests can fire them
const { mockInvoke, mockListen, fireTauriEvent } = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  return {
    mockInvoke: vi.fn(),
    mockListen: vi.fn().mockImplementation((eventName: string, cb: (e: { payload: unknown }) => void) => {
      listeners.set(eventName, cb);
      return Promise.resolve(() => listeners.delete(eventName));
    }),
    fireTauriEvent: (eventName: string, payload: unknown) => {
      listeners.get(eventName)?.({ payload });
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
  emit: vi.fn(),
}));

import { MeetingWindow } from "../MeetingWindow";

describe("MeetingWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({ session_id: "test-session-1" });
  });

  it("shows title input and Start button in idle state", () => {
    render(<MeetingWindow />);
    expect(screen.getByPlaceholderText(/meeting title/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
  });

  it("calls meeting_start when Start is clicked", async () => {
    render(<MeetingWindow />);
    fireEvent.change(screen.getByPlaceholderText(/meeting title/i), {
      target: { value: "Q2 Planning" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("meeting_start", { title: "Q2 Planning" });
    });
  });

  it("shows Stop button while recording", async () => {
    render(<MeetingWindow />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    });
  });

  it("calls meeting_stop when Stop is clicked", async () => {
    mockInvoke
      .mockResolvedValueOnce({ session_id: "test-session-1" })
      .mockResolvedValueOnce("test-session-1");
    render(<MeetingWindow />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    await waitFor(() => screen.getByRole("button", { name: /stop/i }));
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("meeting_stop");
    });
  });

  it("shows error message when meeting_start fails", async () => {
    mockInvoke.mockRejectedValueOnce("Microphone permission denied");
    render(<MeetingWindow />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    await waitFor(() => {
      expect(screen.getByText(/microphone permission denied/i)).toBeInTheDocument();
    });
  });

  it("appends transcript segments to the panel when event fires", async () => {
    render(<MeetingWindow />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    await waitFor(() => screen.getByRole("button", { name: /stop/i }));

    act(() => {
      fireTauriEvent("meeting-transcript-segment", {
        session_id: "test-session-1",
        text: "Hello from Whisper",
        start_ms: 0,
        end_ms: 3000,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Hello from Whisper")).toBeInTheDocument();
    });
  });

  it("transitions to complete state on meeting-transcription-complete event", async () => {
    render(<MeetingWindow />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    await waitFor(() => screen.getByRole("button", { name: /stop/i }));

    act(() => {
      fireTauriEvent("meeting-transcription-complete", { session_id: "test-session-1" });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /generate summary/i })).toBeInTheDocument();
    });
  });

  it("uses 'Untitled Meeting' when title is empty on start", async () => {
    render(<MeetingWindow />);
    // Leave title blank and click Start
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("meeting_start", { title: "Untitled Meeting" });
    });
  });

  it("calls meeting_save_notes with sessionId when notes change", async () => {
    render(<MeetingWindow />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    await waitFor(() => screen.getByRole("button", { name: /stop/i }));

    const notesArea = screen.getByPlaceholderText(/notes/i);
    fireEvent.change(notesArea, { target: { value: "Important decision made" } });

    // Debounce is 300ms — waitFor polls until the assertion passes or times out
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("meeting_save_notes", {
        sessionId: "test-session-1",
        notes: "Important decision made",
      });
    }, { timeout: 1000 });
  });
});
