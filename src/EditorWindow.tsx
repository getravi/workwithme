import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Arrow, Rect, Text, Circle } from "react-konva";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import Konva from "konva";

// ── Types ──────────────────────────────────────────────────────────────────

export type ToolType = "arrow" | "text" | "rect" | "highlight" | "blur" | "step";
export type StrokeWeight = "thin" | "medium" | "thick";
export type FontSize = "S" | "M" | "L";
export type BlurIntensity = "light" | "strong" | "solid";

export interface Annotation {
  id: string;
  type: ToolType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: Record<string, any>;
}

// ── Store ──────────────────────────────────────────────────────────────────

interface EditorState {
  activeTool: ToolType;
  annotations: Annotation[];
  undoStack: Annotation[][];
  stepCounter: number;
  color: string;
  strokeWeight: StrokeWeight;
  fontSize: FontSize;
  blurIntensity: BlurIntensity;
  setActiveTool: (t: ToolType) => void;
  setColor: (c: string) => void;
  setStrokeWeight: (w: StrokeWeight) => void;
  setFontSize: (s: FontSize) => void;
  setBlurIntensity: (i: BlurIntensity) => void;
  pushAnnotation: (a: Annotation) => void;
  deleteAnnotation: (id: string) => void;
  undo: () => void;
  incrementStepCounter: () => void;
  resetStepCounter: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeTool: "arrow",
  annotations: [],
  undoStack: [],
  stepCounter: 1,
  color: "#ff4444",
  strokeWeight: "medium",
  fontSize: "M",
  blurIntensity: "strong",
  setActiveTool: (t) => set({ activeTool: t }),
  setColor: (c) => set({ color: c }),
  setStrokeWeight: (w) => set({ strokeWeight: w }),
  setFontSize: (s) => set({ fontSize: s }),
  setBlurIntensity: (i) => set({ blurIntensity: i }),
  pushAnnotation: (a) =>
    set((s) => ({
      undoStack: [...s.undoStack.slice(-19), s.annotations],
      annotations: [...s.annotations, a],
    })),
  deleteAnnotation: (id) =>
    set((s) => ({
      undoStack: [...s.undoStack.slice(-19), s.annotations],
      annotations: s.annotations.filter((a) => a.id !== id),
    })),
  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    set({ annotations: prev, undoStack: undoStack.slice(0, -1) });
  },
  incrementStepCounter: () => set((s) => ({ stepCounter: s.stepCounter + 1 })),
  resetStepCounter: () => set({ stepCounter: 1 }),
}));

// ── Annotation renderer ────────────────────────────────────────────────────

const FONT_SIZE_MAP: Record<FontSize, number> = { S: 14, M: 18, L: 24 };
const STROKE_WEIGHT_MAP: Record<StrokeWeight, number> = { thin: 2, medium: 4, thick: 7 };

function AnnotationNode({
  ann,
  isSelected,
  onSelect,
}: {
  ann: Annotation;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const p = ann.props;
  const handleClick = () => onSelect(ann.id);

  if (ann.type === "arrow") {
    return (
      <Arrow
        points={p.points}
        stroke={p.color}
        strokeWidth={p.strokeWidth}
        fill={p.color}
        pointerLength={10}
        pointerWidth={8}
        onClick={handleClick}
        opacity={isSelected ? 0.75 : 1}
        draggable
      />
    );
  }
  if (ann.type === "text") {
    return (
      <Text
        x={p.x} y={p.y}
        text={p.text}
        fontSize={p.fontSize}
        fill={p.color}
        onClick={handleClick}
        opacity={isSelected ? 0.75 : 1}
        draggable
      />
    );
  }
  if (ann.type === "rect") {
    return (
      <Rect
        x={p.x} y={p.y} width={p.width} height={p.height}
        stroke={p.color}
        strokeWidth={p.strokeWidth}
        fill={p.fill ?? "transparent"}
        onClick={handleClick}
        opacity={isSelected ? 0.75 : 1}
        draggable
      />
    );
  }
  if (ann.type === "highlight") {
    return (
      <Rect
        x={p.x} y={p.y} width={p.width} height={p.height}
        fill={p.color}
        listening={false}
        opacity={isSelected ? 0.5 : 1}
      />
    );
  }
  if (ann.type === "blur") {
    return (
      <Rect
        x={p.x} y={p.y} width={p.width} height={p.height}
        fill={p.fill}
        onClick={handleClick}
        opacity={isSelected ? 0.75 : 1}
        draggable
      />
    );
  }
  if (ann.type === "step") {
    return (
      <>
        <Circle
          x={p.x} y={p.y} radius={14}
          fill={p.color}
          onClick={handleClick}
          opacity={isSelected ? 0.75 : 1}
          draggable
        />
        <Text
          x={p.x - 14} y={p.y - 14}
          width={28} height={28}
          text={String(p.step)}
          fontSize={13}
          fontStyle="bold"
          fill="#fff"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </>
    );
  }
  return null;
}

// ── Toolbar ────────────────────────────────────────────────────────────────

const TOOL_COLORS = ["#ff4444", "#44aaff", "#44dd44", "#ffdd44", "#ffffff"];
const HIGHLIGHT_COLORS = ["rgba(255,221,0,0.4)", "rgba(0,255,128,0.4)", "rgba(0,170,255,0.4)", "rgba(255,80,80,0.4)"];
const labelStyle: React.CSSProperties = { fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1 };
const optBtnStyle: React.CSSProperties = { width: 30, height: 26, background: "#2a2a3e", border: "none", borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
const TOOLS: { id: ToolType; label: string }[] = [
  { id: "arrow", label: "→" },
  { id: "text", label: "T" },
  { id: "rect", label: "□" },
  { id: "highlight", label: "〰" },
  { id: "blur", label: "▓" },
  { id: "step", label: "①" },
];

function ToolOptions() {
  const { activeTool, color, strokeWeight, fontSize, blurIntensity,
          setColor, setStrokeWeight, setFontSize, setBlurIntensity } = useEditorStore();

  const swatch = (c: string, key: string) => (
    <button
      key={key}
      onClick={() => setColor(c)}
      style={{
        width: 20, height: 20, borderRadius: "50%", background: c,
        border: color === c ? "2px solid #fff" : "2px solid transparent",
        cursor: "pointer", padding: 0,
      }}
    />
  );

  if (activeTool === "arrow" || activeTool === "rect") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={labelStyle}>Color</span>
      <div style={{ display: "flex", gap: 4 }}>{TOOL_COLORS.map((c) => swatch(c, c))}</div>
      <span style={{ ...labelStyle, marginLeft: 8 }}>Weight</span>
      {(["thin", "medium", "thick"] as StrokeWeight[]).map((w) => (
        <button key={w} onClick={() => setStrokeWeight(w)}
          style={{ ...optBtnStyle, border: strokeWeight === w ? "1px solid #6c63ff" : "1px solid transparent" }}>
          <div style={{ height: w === "thin" ? 1.5 : w === "medium" ? 3 : 5, width: 14, background: "#aaa", borderRadius: 2 }} />
        </button>
      ))}
    </div>
  );

  if (activeTool === "text") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={labelStyle}>Color</span>
      <div style={{ display: "flex", gap: 4 }}>{TOOL_COLORS.map((c) => swatch(c, c))}</div>
      <span style={{ ...labelStyle, marginLeft: 8 }}>Size</span>
      {(["S", "M", "L"] as FontSize[]).map((s) => (
        <button key={s} onClick={() => setFontSize(s)}
          style={{ ...optBtnStyle, border: fontSize === s ? "1px solid #6c63ff" : "1px solid transparent", fontSize: 11, color: "#aaa" }}>
          {s}
        </button>
      ))}
    </div>
  );

  if (activeTool === "highlight") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={labelStyle}>Color</span>
      <div style={{ display: "flex", gap: 4 }}>{HIGHLIGHT_COLORS.map((c) => swatch(c, c))}</div>
    </div>
  );

  if (activeTool === "blur") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={labelStyle}>Intensity</span>
      {(["light", "strong", "solid"] as BlurIntensity[]).map((i) => (
        <button key={i} onClick={() => setBlurIntensity(i)}
          style={{ ...optBtnStyle, border: blurIntensity === i ? "1px solid #6c63ff" : "1px solid transparent", fontSize: 11, color: "#aaa", padding: "0 8px" }}>
          {i === "solid" ? "Solid ■" : i.charAt(0).toUpperCase() + i.slice(1)}
        </button>
      ))}
    </div>
  );

  if (activeTool === "step") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={labelStyle}>Color</span>
      <div style={{ display: "flex", gap: 4 }}>{TOOL_COLORS.slice(0, 3).map((c) => swatch(c, c))}</div>
      <span style={{ ...labelStyle, marginLeft: 8, color: "#555" }}>Auto-increments ①②③…</span>
    </div>
  );

  return null;
}

// ── Main component ─────────────────────────────────────────────────────────

export function EditorWindow() {
  const { activeTool, setActiveTool, undo, annotations, color, strokeWeight, fontSize, blurIntensity, stepCounter, pushAnnotation, incrementStepCounter } = useEditorStore();
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [copyToast, setCopyToast] = useState(false);
  const stageRef = useRef<Konva.Stage>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [drawing, setDrawing] = useState<{ type: ToolType; startX: number; startY: number } | null>(null);
  const [liveRect, setLiveRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [livePoints, setLivePoints] = useState<number[]>([]);

  // Load captured image from Rust state
  useEffect(() => {
    invoke<string | null>("get_captured_image").then((b64) => {
      if (!b64) return;
      const img = new window.Image();
      img.src = `data:image/png;base64,${b64}`;
      img.onload = () => {
        setImageEl(img);
        setStageSize({ width: img.naturalWidth, height: img.naturalHeight });
      };
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        useEditorStore.getState().deleteAnnotation(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, selectedId]);

  async function handleCopy() {
    if (!stageRef.current) return;
    const dataUrl = stageRef.current.toDataURL({ pixelRatio: 2 });
    const base64Png = dataUrl.replace(/^data:image\/png;base64,/, "");
    try {
      await invoke("copy_image_to_clipboard", { base64Png });
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 2000);
    } catch (err) {
      console.error("[editor] copy failed:", err);
    }
  }

  async function handleSave(format: "png" | "jpg") {
    if (!stageRef.current) return;
    const dataUrl = stageRef.current.toDataURL({ pixelRatio: 2, mimeType: format === "jpg" ? "image/jpeg" : "image/png" });
    const base64Png = dataUrl.replace(/^data:image\/(png|jpeg);base64,/, "");
    try {
      await invoke("save_image_to_file", { base64Png });
    } catch (err) {
      console.error("[editor] save failed:", err);
    }
  }

  function getRelativePos(e: Konva.KonvaEventObject<MouseEvent>) {
    const stage = e.target.getStage()!;
    const pos = stage.getPointerPosition()!;
    return pos;
  }

  function handleStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.target !== e.target.getStage() && e.target.getClassName() !== "Image") return;
    setSelectedId(null);
    const pos = getRelativePos(e);
    if (activeTool === "step") {
      pushAnnotation({
        id: crypto.randomUUID(),
        type: "step",
        props: { x: pos.x, y: pos.y, step: stepCounter, color },
      });
      incrementStepCounter();
      return;
    }
    if (activeTool === "text") {
      const text = window.prompt("Enter text:");
      if (text) {
        pushAnnotation({
          id: crypto.randomUUID(),
          type: "text",
          props: { x: pos.x, y: pos.y, text, color, fontSize: FONT_SIZE_MAP[fontSize] },
        });
      }
      return;
    }
    setDrawing({ type: activeTool, startX: pos.x, startY: pos.y });
    setLiveRect(null);
    setLivePoints([pos.x, pos.y, pos.x, pos.y]);
  }

  function handleStageMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!drawing) return;
    const pos = getRelativePos(e);
    if (drawing.type === "arrow") {
      setLivePoints([drawing.startX, drawing.startY, pos.x, pos.y]);
    } else {
      setLiveRect({
        x: Math.min(drawing.startX, pos.x),
        y: Math.min(drawing.startY, pos.y),
        w: Math.abs(pos.x - drawing.startX),
        h: Math.abs(pos.y - drawing.startY),
      });
    }
  }

  function handleStageMouseUp(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!drawing) return;
    const pos = getRelativePos(e);
    const sw = STROKE_WEIGHT_MAP[strokeWeight];

    if (drawing.type === "arrow") {
      const pts = [drawing.startX, drawing.startY, pos.x, pos.y];
      if (Math.abs(pts[2] - pts[0]) > 5 || Math.abs(pts[3] - pts[1]) > 5) {
        pushAnnotation({ id: crypto.randomUUID(), type: "arrow", props: { points: pts, color, strokeWidth: sw } });
      }
    } else if (drawing.type === "rect" && liveRect && liveRect.w > 5 && liveRect.h > 5) {
      pushAnnotation({ id: crypto.randomUUID(), type: "rect", props: { x: liveRect.x, y: liveRect.y, width: liveRect.w, height: liveRect.h, color, strokeWidth: sw, fill: undefined } });
    } else if (drawing.type === "highlight" && liveRect && liveRect.w > 5 && liveRect.h > 5) {
      pushAnnotation({ id: crypto.randomUUID(), type: "highlight", props: { x: liveRect.x, y: liveRect.y, width: liveRect.w, height: liveRect.h, color } });
    } else if (drawing.type === "blur" && liveRect && liveRect.w > 5 && liveRect.h > 5) {
      const fill = blurIntensity === "solid" ? "rgba(0,0,0,0.92)"
        : blurIntensity === "strong" ? "rgba(20,20,20,0.82)"
        : "rgba(80,80,80,0.55)";
      pushAnnotation({ id: crypto.randomUUID(), type: "blur", props: { x: liveRect.x, y: liveRect.y, width: liveRect.w, height: liveRect.h, fill } });
    }
    setDrawing(null);
    setLiveRect(null);
    setLivePoints([]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100vw", height: "100vh", background: "#111" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "6px 10px", background: "#1a1a2e",
        borderBottom: "1px solid #333", flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 3 }}>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTool(t.id)}
              style={{
                width: 32, height: 32, background: activeTool === t.id ? "#6c63ff" : "#2a2a3e",
                border: "none", borderRadius: 6, cursor: "pointer",
                color: activeTool === t.id ? "#fff" : "#aaa", fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              title={t.id}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 24, background: "#333", margin: "0 4px" }} />
        <div style={{ flex: 1 }}><ToolOptions /></div>
        <div style={{ width: 1, height: 24, background: "#333", margin: "0 4px" }} />
        <button onClick={undo} style={{ width: 32, height: 32, background: "#2a2a3e", border: "none", borderRadius: 6, cursor: "pointer", color: "#aaa", fontSize: 16 }} title="Undo (⌘Z)">↩</button>
        <div style={{ width: 1, height: 24, background: "#333", margin: "0 4px" }} />
        <button onClick={handleCopy} style={{ width: 32, height: 32, background: "#2a2a3e", border: "none", borderRadius: 6, cursor: "pointer", color: "#aaa", fontSize: 14 }} title="Copy to clipboard">
          {copyToast ? "✓" : "📋"}
        </button>
        <div style={{ position: "relative" }}>
          <button onClick={() => setSaveOpen((o) => !o)}
            style={{ height: 32, padding: "0 12px", background: "#2a3e2a", border: "none", borderRadius: 6, cursor: "pointer", color: "#5fb85f", fontSize: 12, fontWeight: 600 }}>
            Save ▾
          </button>
          {saveOpen && (
            <div style={{ position: "absolute", top: 36, right: 0, background: "#1a1a2e", border: "1px solid #333", borderRadius: 6, overflow: "hidden", zIndex: 100 }}>
              {["png", "jpg"].map((fmt) => (
                <button key={fmt} onClick={() => { setSaveOpen(false); handleSave(fmt as "png" | "jpg"); }}
                  style={{ display: "block", width: "100%", padding: "8px 16px", background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, textAlign: "left" }}>
                  Save as {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}
          onClick={(e) => {
            if (e.target === e.target.getStage()) setSelectedId(null);
          }}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
        >
          <Layer>
            {imageEl && (
              <KonvaImage image={imageEl} x={0} y={0} width={stageSize.width} height={stageSize.height} />
            )}
            {annotations.map((ann) => (
              <AnnotationNode
                key={ann.id}
                ann={ann}
                isSelected={selectedId === ann.id}
                onSelect={setSelectedId}
              />
            ))}
            {drawing && livePoints.length === 4 && drawing.type === "arrow" && (
              <Arrow
                points={livePoints}
                stroke={color}
                strokeWidth={STROKE_WEIGHT_MAP[strokeWeight]}
                fill={color}
                pointerLength={10}
                pointerWidth={8}
                listening={false}
                opacity={0.7}
              />
            )}
            {drawing && liveRect && drawing.type !== "arrow" && (
              <Rect
                x={liveRect.x} y={liveRect.y} width={liveRect.w} height={liveRect.h}
                stroke={drawing.type === "blur" ? "#888" : color}
                strokeWidth={1}
                fill={drawing.type === "highlight" ? color : drawing.type === "blur" ? "rgba(80,80,80,0.4)" : "transparent"}
                dash={[4, 4]}
                listening={false}
                opacity={0.7}
              />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
