import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));

import { LibraryDetailPanel } from "../LibraryDetailPanel";
import type { CaptureEntry } from "../LibraryWindow";

const entry: CaptureEntry = {
  id: "aaa",
  file_path: "/tmp/aaa.png",
  timestamp: Date.now() - 60000,
  app_name: "Figma",
  window_title: "Design System",
  is_draft: false,
  width: 1440,
  height: 900,
  media_type: "image",
  thumbnail_path: null,
};

const draftEntry: CaptureEntry = { ...entry, id: "bbb", is_draft: true };

describe("LibraryDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  it("shows draft badge when is_draft is true", () => {
    render(
      <LibraryDetailPanel entry={draftEntry} onClose={vi.fn()} onDeleted={vi.fn()} />
    );
    expect(screen.getByTestId("draft-badge")).toBeTruthy();
  });

  it("does not show draft badge when is_draft is false", () => {
    render(
      <LibraryDetailPanel entry={entry} onClose={vi.fn()} onDeleted={vi.fn()} />
    );
    expect(screen.queryByTestId("draft-badge")).toBeNull();
  });

  it("shows app name and window title when both are present", () => {
    render(
      <LibraryDetailPanel entry={entry} onClose={vi.fn()} onDeleted={vi.fn()} />
    );
    expect(screen.getByText("Figma")).toBeTruthy();
    expect(screen.getByText("Design System")).toBeTruthy();
  });

  it("omits app/window section when both are null", () => {
    const bare = { ...entry, app_name: null, window_title: null };
    render(
      <LibraryDetailPanel entry={bare} onClose={vi.fn()} onDeleted={vi.fn()} />
    );
    expect(screen.queryByTestId("app-info")).toBeNull();
  });

  it("shows confirm dialog when delete button is clicked", () => {
    render(
      <LibraryDetailPanel entry={entry} onClose={vi.fn()} onDeleted={vi.fn()} />
    );
    fireEvent.click(screen.getByTestId("delete-btn"));
    expect(screen.getByTestId("delete-confirm-yes")).toBeTruthy();
  });

  it("calls library_delete and onDeleted after confirming delete", async () => {
    const onDeleted = vi.fn();
    render(
      <LibraryDetailPanel entry={entry} onClose={vi.fn()} onDeleted={onDeleted} />
    );
    fireEvent.click(screen.getByTestId("delete-btn"));
    fireEvent.click(screen.getByTestId("delete-confirm-yes"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("library_delete", { id: "aaa" });
      expect(onDeleted).toHaveBeenCalledWith("aaa");
    });
  });
});
