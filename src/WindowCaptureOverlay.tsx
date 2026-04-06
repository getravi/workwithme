import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface WindowInfo {
  id: number;
  app_name: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pure utility — exported for testing.
 *  Returns the first window in the list (topmost z-order, as CGWindowList
 *  returns them front-to-back) whose rect contains the point.
 *  Point on the border counts as inside. */
export function findWindowAtPoint(
  windows: WindowInfo[],
  x: number,
  y: number
): WindowInfo | null {
  for (const w of windows) {
    if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) {
      return w;
    }
  }
  return null;
}

// Canvas drawing helpers ─────────────────────────────────────────────────────

function drawDim(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, w, h);
}

function drawHighlight(
  ctx: CanvasRenderingContext2D,
  win: WindowInfo,
  canvasW: number,
  canvasH: number
) {
  ctx.clearRect(0, 0, canvasW, canvasH);
  drawDim(ctx, canvasW, canvasH);
  // Cut out the hovered window so the real window shows through
  ctx.clearRect(win.x, win.y, win.width, win.height);
  // Blue border
  ctx.strokeStyle = "rgba(100, 180, 255, 0.9)";
  ctx.lineWidth = 2;
  ctx.strokeRect(win.x + 0.5, win.y + 0.5, win.width - 1, win.height - 1);
}

// Component ──────────────────────────────────────────────────────────────────

export function WindowCaptureOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const hoveredRef = useRef<WindowInfo | null>(null);
  const logicalSizeRef = useRef({ w: 0, h: 0 });

  // Load window list on mount
  useEffect(() => {
    invoke<WindowInfo[]>("get_window_list")
      .then((wins) => {
        setWindows(wins);
        setLoaded(true);
      })
      .catch((err) => {
        console.error("[window-capture] get_window_list failed:", err);
        setLoaded(true);
      });
  }, []);

  // Draw initial dim once loaded
  useEffect(() => {
    if (!loaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    logicalSizeRef.current = { w: cssW, h: cssH };
    drawDim(ctx, cssW, cssH);
  }, [loaded]);

  // Escape key closes
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await getCurrentWindow().close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = logicalSizeRef.current;
    const found = findWindowAtPoint(windows, e.clientX, e.clientY);
    hoveredRef.current = found;
    const ctx = canvas.getContext("2d")!;
    if (found) {
      drawHighlight(ctx, found, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
      drawDim(ctx, w, h);
    }
  };

  const handleClick = async () => {
    const hovered = hoveredRef.current;
    if (!hovered) {
      await getCurrentWindow().close();
      return;
    }
    try {
      await invoke("capture_window", { windowId: hovered.id });
    } catch (err) {
      console.error("[window-capture] capture_window failed:", err);
    }
    await getCurrentWindow().close();
  };

  // Empty list state
  if (loaded && windows.length === 0) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "default",
        }}
        onClick={handleClick}
      >
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14 }}>
          No capturable windows found.
        </p>
      </div>
    );
  }

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
      onMouseMove={handleMouseMove}
      onClick={handleClick}
    />
  );
}
