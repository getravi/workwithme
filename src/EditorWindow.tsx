import { useCallback, useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Arrow, Rect } from "react-konva";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Konva from "konva";
import {
  useEditorStore,
  FONT_SIZE_MAP,
  STROKE_WEIGHT_MAP,
  type ToolType,
} from "./editor/editorStore";
import { AnnotationNode } from "./editor/AnnotationNode";
import { EditorToolbar } from "./editor/EditorToolbar";

// Re-exported so existing importers keep a stable public API.
export {
  useEditorStore,
  type ToolType,
  type StrokeWeight,
  type FontSize,
  type BlurIntensity,
  type Annotation,
} from "./editor/editorStore";

// ── Main component ─────────────────────────────────────────────────────────

export function EditorWindow() {
  const { activeTool, undo, annotations, color, strokeWeight, fontSize, blurIntensity, stepCounter, pushAnnotation, incrementStepCounter } = useEditorStore();
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [copyToast, setCopyToast] = useState(false);
  const stageRef = useRef<Konva.Stage>(null);
  const libraryIdRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [drawing, setDrawing] = useState<{ type: ToolType; startX: number; startY: number } | null>(null);
  const [liveRect, setLiveRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [livePoints, setLivePoints] = useState<number[]>([]);

  // Fetch the captured image from Rust state and load it onto the stage.
  const loadCapture = useCallback(() => {
    invoke<{ image: string; library_id: string | null } | null>("get_captured_image").then((data) => {
      if (!data) return;
      libraryIdRef.current = data.library_id;
      const img = new window.Image();
      img.src = `data:image/png;base64,${data.image}`;
      img.onload = () => {
        setImageEl(img);
        setStageSize({ width: img.naturalWidth, height: img.naturalHeight });
      };
    });
  }, []);

  // Load on mount.
  useEffect(() => { loadCapture(); }, [loadCapture]);

  // When the Rust side reuses this window for a new capture (instead of
  // close→create to avoid the label-conflict race), it emits "reload-capture".
  // Reset annotation state, then load the new image.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<void>("reload-capture", () => {
      useEditorStore.setState({ annotations: [], undoStack: [], stepCounter: 1, activeTool: "arrow" });
      loadCapture();
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [loadCapture]);

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
      if (libraryIdRef.current) {
        const libId = libraryIdRef.current;
        libraryIdRef.current = null;
        invoke("library_finalize", {
          id: libId,
          imageB64: base64Png,
        }).catch((e) => console.error("[editor] library_finalize failed:", e));
      }
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
      // Finalize the library draft with the annotated version
      if (libraryIdRef.current) {
        const libId = libraryIdRef.current;
        libraryIdRef.current = null; // clear so we don't finalize twice
        invoke("library_finalize", {
          id: libId,
          imageB64: base64Png,
        }).catch((e) => console.error("[editor] library_finalize failed:", e));
      }
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
    <div className="flex flex-col w-screen h-screen bg-[#111]">
      <EditorToolbar
        copyToast={copyToast}
        saveOpen={saveOpen}
        setSaveOpen={setSaveOpen}
        onCopy={handleCopy}
        onSave={handleSave}
      />

      {/* Canvas area */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-6">
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
