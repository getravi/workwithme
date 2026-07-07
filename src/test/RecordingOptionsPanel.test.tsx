import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockGetCurrentWindow = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mockGetCurrentWindow,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { RecordingOptionsPanel } from "../RecordingOptionsPanel";

const mockMics = [
  { index: 0, name: "Built-in Microphone" },
  { index: 1, name: "USB Headset" },
];

describe("RecordingOptionsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentWindow.mockReturnValue({ close: vi.fn(), hide: vi.fn(), show: vi.fn() });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "recording_list_mics") return Promise.resolve(mockMics);
      return Promise.resolve(undefined);
    });
  });

  it("lists mic devices from recording_list_mics on mount", async () => {
    render(<RecordingOptionsPanel />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("recording_list_mics");
      expect(screen.getByText("Built-in Microphone")).toBeTruthy();
    });
  });

  it("mic toggle is disabled when no devices returned", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "recording_list_mics") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    render(<RecordingOptionsPanel />);
    await waitFor(() => {
      const toggle = screen.getByTestId("mic-toggle");
      expect((toggle as HTMLInputElement).disabled).toBe(true);
    });
  });

  it("Select Region radio calls open_region_select_recording", async () => {
    render(<RecordingOptionsPanel />);
    await waitFor(() => screen.getByTestId("radio-region"));
    fireEvent.click(screen.getByTestId("radio-region"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("open_region_select_recording");
    });
  });

  it("Record button disables and shows countdown when clicked", async () => {
    render(<RecordingOptionsPanel />);
    await waitFor(() => screen.getByTestId("record-btn"));
    expect(screen.getByTestId("record-btn").textContent).toBe("▶ Record");
    fireEvent.click(screen.getByTestId("record-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("record-btn").textContent).toContain("Starting in");
    });
  });
});
