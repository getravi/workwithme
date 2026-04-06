import { describe, it, expect } from "vitest";
import { findWindowAtPoint } from "../WindowCaptureOverlay";
import type { WindowInfo } from "../WindowCaptureOverlay";

const win = (overrides: Partial<WindowInfo> = {}): WindowInfo => ({
  id: 1,
  app_name: "TestApp",
  title: "Test Window",
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  ...overrides,
});

describe("findWindowAtPoint", () => {
  it("returns topmost window when point is inside multiple overlapping windows", () => {
    const front = win({ id: 1, x: 50, y: 50, width: 300, height: 300 });
    const back  = win({ id: 2, x: 0,  y: 0,  width: 500, height: 500 });
    // front is first in list (front-to-back order from CGWindowList)
    const result = findWindowAtPoint([front, back], 100, 100);
    expect(result?.id).toBe(1);
  });

  it("returns the single window when point is inside it", () => {
    const w = win({ x: 100, y: 100, width: 200, height: 150 });
    expect(findWindowAtPoint([w], 150, 150)?.id).toBe(w.id);
  });

  it("returns null when point is outside all windows", () => {
    const w = win({ x: 100, y: 100, width: 200, height: 150 });
    expect(findWindowAtPoint([w], 500, 500)).toBeNull();
  });

  it("returns null when window list is empty", () => {
    expect(findWindowAtPoint([], 100, 100)).toBeNull();
  });

  it("point exactly on the border counts as inside", () => {
    const w = win({ x: 100, y: 100, width: 200, height: 150 });
    // Top-left corner
    expect(findWindowAtPoint([w], 100, 100)?.id).toBe(w.id);
    // Bottom-right corner
    expect(findWindowAtPoint([w], 300, 250)?.id).toBe(w.id);
  });
});
