import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Mock Konva — canvas is not available in jsdom
vi.mock("react-konva", () => ({
  Stage: ({ children }: { children: React.ReactNode }) => <div data-testid="konva-stage">{children}</div>,
  Layer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Image: () => <div data-testid="konva-image" />,
  Arrow: () => <div data-testid="konva-arrow" />,
  Rect: () => <div data-testid="konva-rect" />,
  Text: () => <div data-testid="konva-text" />,
  Circle: () => <div data-testid="konva-circle" />,
  Transformer: () => <div data-testid="konva-transformer" />,
}));
vi.mock("konva", () => ({ default: {} }));

import { EditorWindow } from "../EditorWindow";
import { useEditorStore } from "../EditorWindow";

describe("EditorWindow store", () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeTool: "arrow",
      annotations: [],
      undoStack: [],
      stepCounter: 1,
      color: "#ff4444",
      strokeWeight: "medium",
      fontSize: "M",
      blurIntensity: "strong",
    });
  });

  it("starts with arrow tool active", () => {
    expect(useEditorStore.getState().activeTool).toBe("arrow");
  });

  it("setActiveTool changes the active tool", () => {
    useEditorStore.getState().setActiveTool("text");
    expect(useEditorStore.getState().activeTool).toBe("text");
  });

  it("stepCounter increments when a step annotation is added", () => {
    useEditorStore.getState().incrementStepCounter();
    expect(useEditorStore.getState().stepCounter).toBe(2);
  });

  it("undo removes last annotation and restores previous", () => {
    const store = useEditorStore.getState();
    store.pushAnnotation({ id: "a1", type: "arrow" as const, props: {} });
    store.pushAnnotation({ id: "a2", type: "arrow" as const, props: {} });
    expect(useEditorStore.getState().annotations).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations).toHaveLength(1);
    expect(useEditorStore.getState().annotations[0].id).toBe("a1");
  });

  it("undo does nothing when annotations is empty", () => {
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations).toHaveLength(0);
  });

  it("deleteAnnotation removes by id", () => {
    const store = useEditorStore.getState();
    store.pushAnnotation({ id: "x1", type: "rect" as const, props: {} });
    store.pushAnnotation({ id: "x2", type: "rect" as const, props: {} });
    useEditorStore.getState().deleteAnnotation("x1");
    const ids = useEditorStore.getState().annotations.map(a => a.id);
    expect(ids).toEqual(["x2"]);
  });
});
