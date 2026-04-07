import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockEntries = [
  {
    id: "aaa",
    file_path: "/tmp/aaa.png",
    timestamp: Date.now() - 60000,
    app_name: "Figma",
    window_title: "Design System",
    is_draft: false,
    width: 1440,
    height: 900,
  },
  {
    id: "bbb",
    file_path: "/tmp/bbb.png",
    timestamp: Date.now() - 120000,
    app_name: "Xcode",
    window_title: "main.swift",
    is_draft: true,
    width: 1280,
    height: 800,
  },
];

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));

import { LibraryGrid } from "../LibraryGrid";

describe("LibraryGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(mockEntries);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls library_list on mount", async () => {
    render(
      <LibraryGrid query="" selected={null} onSelect={vi.fn()} style={{}} />
    );
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("library_list", { beforeTs: undefined });
    });
  });

  it("calls library_search when query is non-empty after debounce", async () => {
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue(mockEntries);
    render(
      <LibraryGrid query="figma" selected={null} onSelect={vi.fn()} style={{}} />
    );
    await act(async () => {
      vi.advanceTimersByTime(350);
      await vi.runAllTimersAsync();
    });
    expect(mockInvoke).toHaveBeenCalledWith("library_search", { query: "figma" });
  });

  it("calls library_list when query is empty", async () => {
    render(
      <LibraryGrid query="" selected={null} onSelect={vi.fn()} style={{}} />
    );
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("library_list", { beforeTs: undefined });
    });
  });

  it("calls onSelect when a capture card is clicked", async () => {
    const onSelect = vi.fn();
    render(
      <LibraryGrid query="" selected={null} onSelect={onSelect} style={{}} />
    );
    await waitFor(() => screen.getByTestId("capture-card-aaa"));
    fireEvent.click(screen.getByTestId("capture-card-aaa"));
    expect(onSelect).toHaveBeenCalledWith(mockEntries[0]);
  });

  it("shows draft indicator on draft captures only", async () => {
    render(
      <LibraryGrid query="" selected={null} onSelect={vi.fn()} style={{}} />
    );
    await waitFor(() => screen.getByTestId("draft-dot-bbb"));
    expect(screen.getByTestId("draft-dot-bbb")).toBeTruthy();
    expect(screen.queryByTestId("draft-dot-aaa")).toBeNull();
  });
});
