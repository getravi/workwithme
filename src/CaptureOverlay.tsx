import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { overlayOrigin } from "./overlayOrigin";

interface Point { x: number; y: number; }
interface Rect { x: number; y: number; width: number; height: number; }

interface CaptureOverlayProps {
  mode?: "capture" | "record";
}

/** Pure utility — exported for testing. */
export function computeSelectionRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function CaptureOverlay({ mode = "capture" }: CaptureOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<Point>({ x: 0, y: 0 });
  const currentRef = useRef<Point>({ x: 0, y: 0 });

  const { x: offsetX, y: offsetY } = overlayOrigin();

  // Draw dimmed overlay + selection rect
  function draw(canvas: HTMLCanvasElement, start: Point, current: Point) {
    const ctx = canvas.getContext("2d")!;
    const rect = computeSelectionRect(start, current);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Dim entire screen
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Cut out selected region (shows screen behind it)
    ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
    // Border around selection
    ctx.strokeStyle = "rgba(100, 180, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    // Size label — drawn above the selection, or below when near the top edge.
    if (rect.width > 40 && rect.height > 20) {
      ctx.fillStyle = "rgba(100, 180, 255, 0.9)";
      ctx.font = "12px -apple-system, sans-serif";
      const labelY = rect.y > 18 ? rect.y - 6 : rect.y + rect.height + 14;
      ctx.fillText(`${Math.round(rect.width)} × ${Math.round(rect.height)}`, rect.x + 4, labelY);
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // Initial dim
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await getCurrentWindow().close();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    startRef.current = { x: e.clientX, y: e.clientY };
    currentRef.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    currentRef.current = { x: e.clientX, y: e.clientY };
    const canvas = canvasRef.current;
    if (canvas) draw(canvas, startRef.current, currentRef.current);
  };

  const handleMouseUp = async (e: React.MouseEvent) => {
    if (!dragging) return;
    setDragging(false);
    const rect = computeSelectionRect(startRef.current, { x: e.clientX, y: e.clientY });
    if (rect.width < 5 || rect.height < 5) {
      await getCurrentWindow().close();
      return;
    }
    try {
      if (mode === "record") {
        const { emit } = await import("@tauri-apps/api/event");
        await emit("recording-region-selected", {
          // Translate window-relative coords to global screen coords.
          x: Math.round(rect.x) + offsetX,
          y: Math.round(rect.y) + offsetY,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      } else {
        const base64Png: string = await invoke("capture_region", {
          // Translate window-relative coords to global screen coords.
          x: Math.round(rect.x) + offsetX,
          y: Math.round(rect.y) + offsetY,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
        await invoke("open_editor_window", { base64Png });
      }
    } catch (err) {
      console.error("[capture] failed:", err);
    }
    await getCurrentWindow().close();
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        cursor: "crosshair",
        display: "block",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    />
  );
}
