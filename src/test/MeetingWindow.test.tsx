import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockInvoke, mockListen } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn().mockReturnValue(Promise.resolve(() => {})),
}));

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
});
