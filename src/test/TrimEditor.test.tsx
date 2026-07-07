import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockConvertFileSrc = vi.hoisted(() => (p: string) => `asset://${p}`);
const mockSave = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  convertFileSrc: mockConvertFileSrc,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    onCloseRequested: vi.fn().mockResolvedValue(() => {}),
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mockSave,
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  remove: vi.fn().mockResolvedValue(undefined),
}));

import { TrimEditor } from "../TrimEditor";

describe("TrimEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSave.mockResolvedValue("/tmp/trimmed.mp4");
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "recording_get_trim_path") return Promise.resolve("/tmp/raw.mp4");
      if (cmd === "recording_get_duration") return Promise.resolve(60000); // 60s
      return Promise.resolve(undefined);
    });
  });

  it("fetches duration from recording_get_duration on mount", async () => {
    render(<TrimEditor />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("recording_get_duration", {
        path: "/tmp/raw.mp4",
      });
    });
  });

  it("timeline renders with total duration label", async () => {
    render(<TrimEditor />);
    await waitFor(() => {
      expect(screen.getByTestId("duration-label")).toBeTruthy();
      expect(screen.getByTestId("duration-label").textContent).toContain("01:00");
    });
  });

  it("dragging in-point slider updates start display", async () => {
    render(<TrimEditor />);
    await waitFor(() => screen.getByTestId("in-point-slider"));
    const slider = screen.getByTestId("in-point-slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "10000" } });
    await waitFor(() => {
      expect(screen.getByTestId("start-time-display").textContent).toContain("00:10");
    });
  });

  it("Export button calls recording_export with correct params", async () => {
    render(<TrimEditor />);
    await waitFor(() => screen.getByTestId("export-btn"));
    fireEvent.click(screen.getByTestId("export-btn"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("recording_export", {
        input: "/tmp/raw.mp4",
        output: "/tmp/trimmed.mp4",
        startMs: 0,
        endMs: 60000,
      });
    });
  });
});
