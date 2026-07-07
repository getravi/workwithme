import { create } from "zustand";

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

export const FONT_SIZE_MAP: Record<FontSize, number> = { S: 14, M: 18, L: 24 };
export const STROKE_WEIGHT_MAP: Record<StrokeWeight, number> = { thin: 2, medium: 4, thick: 7 };

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
