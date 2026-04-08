import { useState } from "react";
import {
  ChevronDown,
  Terminal,
  FileText,
  Search,
  Globe,
  FolderOpen,
  Wrench,
  Check,
  X,
  Loader2,
  Edit2,
} from "lucide-react";
import { ToolStep } from "./types";

// ── helpers ──────────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ReactNode> = {
  bash:        <Terminal className="w-3.5 h-3.5" />,
  shell:       <Terminal className="w-3.5 h-3.5" />,
  read_file:   <FileText className="w-3.5 h-3.5" />,
  write_file:  <Edit2 className="w-3.5 h-3.5" />,
  edit_file:   <Edit2 className="w-3.5 h-3.5" />,
  glob:        <FolderOpen className="w-3.5 h-3.5" />,
  grep:        <Search className="w-3.5 h-3.5" />,
  web_fetch:   <Globe className="w-3.5 h-3.5" />,
  web_search:  <Globe className="w-3.5 h-3.5" />,
};

function toolIcon(name: string) {
  const key = Object.keys(TOOL_ICONS).find(k => name.toLowerCase().includes(k));
  return key ? TOOL_ICONS[key] : <Wrench className="w-3.5 h-3.5" />;
}

function toolSummary(name: string, args: Record<string, unknown>): string {
  const str = (v: unknown) => String(v ?? "");
  if (args.command)    return str(args.command).slice(0, 80);
  if (args.cmd)        return str(args.cmd).slice(0, 80);
  if (args.file_path)  return str(args.file_path).split("/").slice(-2).join("/");
  if (args.path)       return str(args.path).split("/").slice(-2).join("/");
  if (args.pattern)    return str(args.pattern).slice(0, 80);
  if (args.query)      return str(args.query).slice(0, 80);
  return name;
}

function renderResult(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result.slice(0, 2000);
  try { return JSON.stringify(result, null, 2).slice(0, 2000); }
  catch { return String(result).slice(0, 2000); }
}

// ── single step row ───────────────────────────────────────────────────────────

function StepRow({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const summary = toolSummary(step.name, step.args);
  const resultText = renderResult(step.result);
  const hasDetail = Object.keys(step.args).length > 0 || !!resultText;

  return (
    <div className={`rounded-lg border text-[12px] transition-colors ${
      step.status === "running"
        ? "border-[#c5f016]/20 bg-[#182234]"
        : step.status === "error"
        ? "border-red-500/20 bg-[#1a1215]"
        : "border-[#1f2937] bg-[#141d2e]"
    }`}>
      <button
        type="button"
        onClick={() => hasDetail && setOpen(v => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left ${hasDetail ? "cursor-pointer hover:bg-white/[0.02]" : "cursor-default"} rounded-lg transition-colors`}
      >
        {/* status icon */}
        <span className={
          step.status === "running" ? "text-[#c5f016]" :
          step.status === "error"   ? "text-red-400" :
          "text-emerald-400"
        }>
          {step.status === "running"
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : step.status === "error"
            ? <X className="w-3.5 h-3.5" />
            : <Check className="w-3.5 h-3.5" />}
        </span>

        {/* tool icon */}
        <span className="text-gray-500">{toolIcon(step.name)}</span>

        {/* name */}
        <span className="font-mono text-gray-300 font-medium">{step.name}</span>

        {/* summary */}
        {summary && summary !== step.name && (
          <span className="text-gray-500 truncate flex-1">{summary}</span>
        )}

        {/* expand chevron */}
        {hasDetail && (
          <ChevronDown className={`w-3.5 h-3.5 text-gray-600 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>

      {open && hasDetail && (
        <div className="px-3 pb-3 space-y-2 border-t border-[#1f2937] mt-0.5 pt-2">
          {Object.keys(step.args).length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-600 mb-1">Input</div>
              <pre className="text-[11px] text-gray-400 whitespace-pre-wrap break-words font-mono bg-[#0d1520] rounded p-2 max-h-40 overflow-y-auto">
                {JSON.stringify(step.args, null, 2)}
              </pre>
            </div>
          )}
          {resultText && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-600 mb-1">Output</div>
              <pre className={`text-[11px] whitespace-pre-wrap break-words font-mono bg-[#0d1520] rounded p-2 max-h-52 overflow-y-auto ${step.status === "error" ? "text-red-400" : "text-gray-400"}`}>
                {resultText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── public component ──────────────────────────────────────────────────────────

export function StepIndicator({ steps, isStreaming }: { steps: ToolStep[]; isStreaming?: boolean }) {
  if (!steps || steps.length === 0) return null;

  const hasRunning = steps.some(s => s.status === "running");
  const [collapsed, setCollapsed] = useState(false);

  // While the model is actively running steps, keep them visible.
  // Once done and collapsed by the user, hide them.
  if (!isStreaming && !hasRunning && collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-gray-400 transition-colors mb-2"
      >
        <ChevronDown className="w-3 h-3 -rotate-90" />
        {steps.length} step{steps.length > 1 ? "s" : ""}
      </button>
    );
  }

  return (
    <div className="space-y-1.5 mb-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-gray-600 font-medium">
          {hasRunning ? "Working…" : `${steps.length} step${steps.length > 1 ? "s" : ""}`}
        </span>
        {!hasRunning && !isStreaming && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
          >
            Hide
          </button>
        )}
      </div>
      {steps.map(step => <StepRow key={step.id} step={step} />)}
    </div>
  );
}
