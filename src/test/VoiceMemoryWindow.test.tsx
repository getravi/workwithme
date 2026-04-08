import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockSessions = [
  { id: "s1", title: "Q2 Planning", type: "meeting", status: "complete",
    started_at: Date.now() - 3600000, ended_at: Date.now() - 3000000, duration_sec: 600, created_at: Date.now() - 3600000 },
  { id: "s2", title: "Customer Call", type: "meeting", status: "complete",
    started_at: Date.now() - 7200000, ended_at: Date.now() - 6600000, duration_sec: 1800, created_at: Date.now() - 7200000 },
];

const mockDetail = {
  session: mockSessions[0],
  segments: [{ id: "seg1", session_id: "s1", text: "Let's discuss the roadmap", start_ms: 0, end_ms: 5000, created_at: Date.now() }],
  notes: { id: "n1", session_id: "s1", raw_notes: "Important notes", ai_summary: "Planning meeting summary",
           ai_action_items: "- Review PRD", ai_decisions: "- Launch in Q3", updated_at: Date.now() },
};

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockReturnValue(Promise.resolve(() => {})),
}));

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

  it("calls meeting_search when typing in search bar", async () => {
    render(<VoiceMemoryWindow />);
    await waitFor(() => screen.getByPlaceholderText(/search/i));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "planning" } });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("meeting_search", { query: "planning" });
    });
  });
});
