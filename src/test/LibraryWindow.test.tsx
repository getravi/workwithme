import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  convertFileSrc: (p: string) => `asset://${p}`,
}));

import { LibraryWindow } from "../LibraryWindow";

const baseEntry = {
  id: "e1",
  file_path: "/tmp/shot.png",
  timestamp: Date.now() - 60000,
  app_name: "Figma",
  window_title: "Design System",
  is_draft: false,
  width: 1440,
  height: 900,
  media_type: "image",
  thumbnail_path: null,
};

const mockEntries = [
  baseEntry,
  { ...baseEntry, id: "e2", app_name: "VS Code", window_title: "main.rs", file_path: "/tmp/code.png" },
];

describe("LibraryWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "library_list") return Promise.resolve(mockEntries);
      if (cmd === "library_search") return Promise.resolve(mockEntries.slice(0, 1));
      return Promise.resolve(undefined);
    });
  });

  it("renders the search input", () => {
    render(<LibraryWindow />);
    expect(screen.getByPlaceholderText(/search captures/i)).toBeInTheDocument();
  });

  it("calls library_list on mount", async () => {
    render(<LibraryWindow />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("library_list", { beforeTs: undefined });
    });
  });

  it("shows detail panel when a capture card is selected", async () => {
    render(<LibraryWindow />);
    await waitFor(() => screen.getByTestId("capture-card-e1"));
    fireEvent.click(screen.getByTestId("capture-card-e1"));
    await waitFor(() => {
      expect(screen.getByText("Details")).toBeInTheDocument();
    });
  });

  it("closes detail panel when close button is clicked", async () => {
    render(<LibraryWindow />);
    await waitFor(() => screen.getByTestId("capture-card-e1"));
    fireEvent.click(screen.getByTestId("capture-card-e1"));
    await waitFor(() => screen.getByText("Details"));

    fireEvent.click(screen.getByText("×"));
    await waitFor(() => {
      expect(screen.queryByText("Details")).not.toBeInTheDocument();
    });
  });

  it("hides detail panel after the selected entry is deleted", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "library_list") return Promise.resolve(mockEntries);
      if (cmd === "library_delete") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    render(<LibraryWindow />);
    await waitFor(() => screen.getByTestId("capture-card-e1"));
    fireEvent.click(screen.getByTestId("capture-card-e1"));
    await waitFor(() => screen.getByText("Details"));

    fireEvent.click(screen.getByTestId("delete-btn"));
    fireEvent.click(screen.getByTestId("delete-confirm-yes"));

    await waitFor(() => {
      expect(screen.queryByText("Details")).not.toBeInTheDocument();
    });
  });

  it("passes search query down to the grid (triggers library_search)", async () => {
    render(<LibraryWindow />);
    const input = screen.getByPlaceholderText(/search captures/i);
    fireEvent.change(input, { target: { value: "figma" } });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("library_search", { query: "figma" });
    });
  });
});
