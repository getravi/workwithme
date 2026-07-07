import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockSessions = [
  { id: "s1", title: "Q2 Planning", type: "meeting", status: "complete",
    started_at: Date.now() - 3600000, ended_at: Date.now() - 3000000, duration_sec: 600, created_at: Date.now() - 3600000 },
  { id: "s2", title: "Customer Call", type: "meeting", status: "complete",
    started_at: Date.now() - 7200000, ended_at: Date.now() - 6600000, duration_sec: 1800, created_at: Date.now() - 7200000 },
];

const mockSessionsWithError = [
  { id: "s1", title: "Q2 Planning", type: "meeting", status: "complete",
    started_at: Date.now() - 3600000, ended_at: Date.now() - 3000000, duration_sec: 600, created_at: Date.now() - 3600000 },
  { id: "s3", title: "Failed Recording", type: "meeting", status: "error",
    started_at: Date.now() - 1800000, ended_at: null, duration_sec: null, created_at: Date.now() - 1800000 },
  { id: "s4", title: "Active Recording", type: "meeting", status: "recording",
    started_at: Date.now() - 300000, ended_at: null, duration_sec: null, created_at: Date.now() - 300000 },
];

const mockDetail = {
  session: mockSessions[0],
  segments: [{ id: "seg1", session_id: "s1", text: "Let's discuss the roadmap", start_ms: 0, end_ms: 5000, created_at: Date.now() }],
  notes: { id: "n1", session_id: "s1", raw_notes: "Important notes", ai_summary: "Planning meeting summary",
           ai_action_items: "- Review PRD", ai_decisions: "- Launch in Q3", updated_at: Date.now() },
};

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
vi.mock("@tauri-apps/api/event", () => ({ listen: mockListen }));

import { VoiceMemoryWindow } from "../VoiceMemoryWindow";

describe("VoiceMemoryWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "meeting_list") return Promise.resolve(mockSessions);
      if (cmd === "meeting_get") return Promise.resolve(mockDetail);
      if (cmd === "meeting_search") return Promise.resolve(mockSessions);
      return Promise.resolve(null);
    });
  });

  it("loads and shows session list on mount", async () => {
    render(<VoiceMemoryWindow />);
    await waitFor(() => {
      expect(screen.getByText("Q2 Planning")).toBeInTheDocument();
      expect(screen.getByText("Customer Call")).toBeInTheDocument();
    });
  });

  it("calls meeting_get when session is clicked", async () => {
    render(<VoiceMemoryWindow />);
    await waitFor(() => screen.getByText("Q2 Planning"));
    fireEvent.click(screen.getByText("Q2 Planning"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("meeting_get", { sessionId: "s1" });
    });
  });

  it("shows session detail after clicking a session", async () => {
    render(<VoiceMemoryWindow />);
    await waitFor(() => screen.getByText("Q2 Planning"));
    fireEvent.click(screen.getByText("Q2 Planning"));
    await waitFor(() => {
      expect(screen.getByText("Planning meeting summary")).toBeInTheDocument();
    });
  });

  it("calls meeting_search when typing in search bar", async () => {
    render(<VoiceMemoryWindow />);
    await waitFor(() => screen.getByPlaceholderText(/search/i));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "planning" } });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("meeting_search", { query: "planning" });
    });
  });

  it("shows delete button only for error and recording sessions", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "meeting_list") return Promise.resolve(mockSessionsWithError);
      return Promise.resolve(null);
    });
    render(<VoiceMemoryWindow />);
    await waitFor(() => screen.getByText("Failed Recording"));

    // complete sessions should NOT have a delete button
    const completeRow = screen.getByText("Q2 Planning").closest("div[style]")!;
    expect(completeRow.querySelector("button")).toBeNull();

    // error and recording sessions SHOULD have a delete (✕) button
    const errorRow = screen.getByText("Failed Recording").closest("div[style]")!;
    expect(errorRow.querySelector("button")).not.toBeNull();

    const recordingRow = screen.getByText("Active Recording").closest("div[style]")!;
    expect(recordingRow.querySelector("button")).not.toBeNull();
  });

  it("calls meeting_delete and removes session from list when delete button is clicked", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "meeting_list") return Promise.resolve(mockSessionsWithError);
      if (cmd === "meeting_delete") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    render(<VoiceMemoryWindow />);
    await waitFor(() => screen.getByText("Failed Recording"));

    const errorRow = screen.getByText("Failed Recording").closest("div[style]")!;
    const deleteBtn = errorRow.querySelector("button")!;
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("meeting_delete", { sessionId: "s3" });
      expect(screen.queryByText("Failed Recording")).not.toBeInTheDocument();
    });
  });

  it("deselects session when the selected session is deleted", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "meeting_list") return Promise.resolve(mockSessionsWithError);
      if (cmd === "meeting_get") return Promise.resolve({
        session: mockSessionsWithError[2],
        segments: [],
        notes: null,
      });
      if (cmd === "meeting_delete") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    render(<VoiceMemoryWindow />);
    await waitFor(() => screen.getByText("Active Recording"));

    // Select the recording session by clicking its title text in the list
    fireEvent.click(screen.getByText("Active Recording"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("meeting_get", { sessionId: "s4" });
    });

    // After selection "Active Recording" appears in both list and detail header.
    // mockSessionsWithError has 2 deletable sessions (error=index 0, recording=index 1)
    // so getAllByTitle returns them in list order — pick the recording session's button.
    const deleteBtns = screen.getAllByTitle("Delete this session");
    fireEvent.click(deleteBtns[1]); // index 1 = Active Recording (recording status)

    await waitFor(() => {
      expect(screen.queryByText("Active Recording")).not.toBeInTheDocument();
      // Detail panel should clear — "Select a session" placeholder returns
      expect(screen.getByText(/select a session/i)).toBeInTheDocument();
    });
  });

  it("refreshes session list when meeting-transcription-complete fires", async () => {
    render(<VoiceMemoryWindow />);
    await waitFor(() => screen.getByText("Q2 Planning"));

    const callsBefore = mockInvoke.mock.calls.filter((c) => c[0] === "meeting_list").length;

    act(() => {
      fireTauriEvent("meeting-transcription-complete", {});
    });

    await waitFor(() => {
      const callsAfter = mockInvoke.mock.calls.filter((c) => c[0] === "meeting_list").length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });
});
