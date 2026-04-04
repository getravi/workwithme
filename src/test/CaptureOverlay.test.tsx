import { describe, it, expect } from "vitest";
import { computeSelectionRect } from "../CaptureOverlay";

describe("computeSelectionRect", () => {
  it("returns positive rect when dragging right-down", () => {
    const rect = computeSelectionRect({ x: 10, y: 20 }, { x: 110, y: 120 });
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 100 });
  });

  it("returns positive rect when dragging left-up", () => {
    const rect = computeSelectionRect({ x: 110, y: 120 }, { x: 10, y: 20 });
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 100 });
  });

  it("returns positive rect when dragging right-up", () => {
    const rect = computeSelectionRect({ x: 10, y: 120 }, { x: 110, y: 20 });
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 100 });
  });

  it("handles zero-size drag", () => {
    const rect = computeSelectionRect({ x: 50, y: 50 }, { x: 50, y: 50 });
    expect(rect).toEqual({ x: 50, y: 50, width: 0, height: 0 });
  });
});
