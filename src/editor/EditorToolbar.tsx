import {
  useEditorStore,
  type ToolType,
  type StrokeWeight,
  type FontSize,
  type BlurIntensity,
} from "./editorStore";

// ── Tool palette + option controls ─────────────────────────────────────────

const TOOL_COLORS = ["#ff4444", "#44aaff", "#44dd44", "#ffdd44", "#ffffff"];
const HIGHLIGHT_COLORS = ["rgba(255,221,0,0.4)", "rgba(0,255,128,0.4)", "rgba(0,170,255,0.4)", "rgba(255,80,80,0.4)"];
const LABEL_CLS = "text-[11px] text-[#666] uppercase tracking-[1px]";
const OPT_BTN_CLS = "w-[30px] h-[26px] bg-[#2a2a3e] rounded cursor-pointer flex items-center justify-center";
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
    <div className="flex items-center gap-2">
      <span className={LABEL_CLS}>Color</span>
      <div className="flex gap-1">{TOOL_COLORS.map((c) => swatch(c, c))}</div>
      <span className={`${LABEL_CLS} ml-2`}>Weight</span>
      {(["thin", "medium", "thick"] as StrokeWeight[]).map((w) => (
        <button key={w} onClick={() => setStrokeWeight(w)}
          className={`${OPT_BTN_CLS} border ${strokeWeight === w ? "border-[#6c63ff]" : "border-transparent"}`}>
          <div style={{ height: w === "thin" ? 1.5 : w === "medium" ? 3 : 5, width: 14, background: "#aaa", borderRadius: 2 }} />
        </button>
      ))}
    </div>
  );

  if (activeTool === "text") return (
    <div className="flex items-center gap-2">
      <span className={LABEL_CLS}>Color</span>
      <div className="flex gap-1">{TOOL_COLORS.map((c) => swatch(c, c))}</div>
      <span className={`${LABEL_CLS} ml-2`}>Size</span>
      {(["S", "M", "L"] as FontSize[]).map((s) => (
        <button key={s} onClick={() => setFontSize(s)}
          className={`${OPT_BTN_CLS} border ${fontSize === s ? "border-[#6c63ff]" : "border-transparent"} text-[11px] text-[#aaa]`}>
          {s}
        </button>
      ))}
    </div>
  );

  if (activeTool === "highlight") return (
    <div className="flex items-center gap-2">
      <span className={LABEL_CLS}>Color</span>
      <div className="flex gap-1">{HIGHLIGHT_COLORS.map((c) => swatch(c, c))}</div>
    </div>
  );

  if (activeTool === "blur") return (
    <div className="flex items-center gap-2">
      <span className={LABEL_CLS}>Intensity</span>
      {(["light", "strong", "solid"] as BlurIntensity[]).map((i) => (
        <button key={i} onClick={() => setBlurIntensity(i)}
          className={`${OPT_BTN_CLS} border ${blurIntensity === i ? "border-[#6c63ff]" : "border-transparent"} text-[11px] text-[#aaa] px-2`}>
          {i === "solid" ? "Solid ■" : i.charAt(0).toUpperCase() + i.slice(1)}
        </button>
      ))}
    </div>
  );

  if (activeTool === "step") return (
    <div className="flex items-center gap-2">
      <span className={LABEL_CLS}>Color</span>
      <div className="flex gap-1">{TOOL_COLORS.slice(0, 3).map((c) => swatch(c, c))}</div>
      <span className={`text-[11px] uppercase tracking-[1px] ml-2 text-[#555]`}>Auto-increments ①②③…</span>
    </div>
  );

  return null;
}

// ── Toolbar ────────────────────────────────────────────────────────────────

export function EditorToolbar({
  copyToast,
  saveOpen,
  setSaveOpen,
  onCopy,
  onSave,
}: {
  copyToast: boolean;
  saveOpen: boolean;
  setSaveOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onCopy: () => void;
  onSave: (format: "png" | "jpg") => void;
}) {
  const { activeTool, setActiveTool, undo } = useEditorStore();

  return (
    <div className="flex items-center gap-1 px-2.5 py-1.5 bg-[#1a1a2e] border-b border-[#333] flex-shrink-0">
      <div className="flex gap-[3px]">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTool(t.id)}
            className={`w-8 h-8 rounded-md cursor-pointer text-[14px] flex items-center justify-center ${
              activeTool === t.id ? "bg-[#6c63ff] text-white" : "bg-[#2a2a3e] text-[#aaa]"
            }`}
            title={t.id}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="w-px h-6 bg-[#333] mx-1" />
      <div className="flex-1"><ToolOptions /></div>
      <div className="w-px h-6 bg-[#333] mx-1" />
      <button onClick={undo} className="w-8 h-8 bg-[#2a2a3e] rounded-md cursor-pointer text-[#aaa] text-[16px]" title="Undo (⌘Z)">↩</button>
      <div className="w-px h-6 bg-[#333] mx-1" />
      <button onClick={onCopy} className="w-8 h-8 bg-[#2a2a3e] rounded-md cursor-pointer text-[#aaa] text-[14px]" title="Copy to clipboard">
        {copyToast ? "✓" : "📋"}
      </button>
      <div className="relative">
        <button onClick={() => setSaveOpen((o) => !o)}
          className="h-8 px-3 bg-[#2a3e2a] rounded-md cursor-pointer text-[#5fb85f] text-[12px] font-semibold">
          Save ▾
        </button>
        {saveOpen && (
          <div className="absolute top-9 right-0 bg-[#1a1a2e] border border-[#333] rounded-md overflow-hidden z-[100]">
            {["png", "jpg"].map((fmt) => (
              <button key={fmt} onClick={() => { setSaveOpen(false); onSave(fmt as "png" | "jpg"); }}
                className="block w-full px-4 py-2 bg-transparent text-[#ccc] cursor-pointer text-[12px] text-left">
                Save as {fmt.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
