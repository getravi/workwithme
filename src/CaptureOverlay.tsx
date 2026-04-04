import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Point { x: number; y: number; }
interface Rect { x: number; y: number; width: number; height: number; }

/** Pure utility — exported for testing. */
export function computeSelectionRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function CaptureOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<Point>({ x: 0, y: 0 });
  const currentRef = useRef<Point>({ x: 0, y: 0 });

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
    // Size label
    if (rect.width > 40 && rect.height > 20) {
      ctx.fillStyle = "rgba(100, 180, 255, 0.9)";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.fillText(`${Math.round(rect.width)} × ${Math.round(rect.height)}`, rect.x + 4, rect.y - 6);
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
      // Too small — ignore and close
      await getCurrentWindow().close();
      return;
    }
    try {
      const base64Png: string = await invoke("capture_region", {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      await invoke("open_editor_window", { base64Png });
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
