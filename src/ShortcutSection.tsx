import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Keyboard } from "lucide-react";

export interface ShortcutsConfig {
  dictate: string;
  capture_region: string;
  capture_window: string;
  screen_recording: string;
  new_meeting: string;
}

export type ShortcutAction = keyof ShortcutsConfig;

// Single source of truth for the rows: their order, human labels (used in the
// conflict message), and descriptions. Keys are typed against ShortcutsConfig so
// a missing/renamed action is a compile error rather than a silent cast.
const SHORTCUT_DEFS = [
  { action: "dictate", label: "Dictate", description: "Dictate into active window (global)" },
  { action: "capture_region", label: "Capture Region", description: "Capture screen region" },
  { action: "capture_window", label: "Capture Window", description: "Capture window" },
  { action: "screen_recording", label: "Record Screen", description: "Record screen" },
  { action: "new_meeting", label: "New Meeting", description: "Open new meeting" },
] as const satisfies readonly { action: ShortcutAction; label: string; description: string }[];

function formatShortcutForRust(e: KeyboardEvent): string | null {
  // Ignore bare modifier presses
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.metaKey) parts.push("Super");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  // Must have at least one modifier for a global shortcut
  if (parts.length === 0) return null;

  if (e.key === " ") parts.push("Space");
  else if (e.key === "Enter") parts.push("Enter");
  else if (e.key === "Escape") parts.push("Escape");
  else if (/^[0-9]$/.test(e.key)) parts.push(`Digit${e.key}`);
  else if (/^[a-zA-Z]$/.test(e.key)) parts.push(`Key${e.key.toUpperCase()}`);
  else if (/^F[1-9][0-2]?$/.test(e.key)) parts.push(e.key);
  else return null;

  return parts.join("+");
}

function displayShortcut(shortcut: string): string[] {
  return shortcut.split("+").map((part) => {
    switch (part) {
      case "Super": return "⌘";
      case "Shift": return "⇧";
      case "Ctrl": return "⌃";
      case "Alt": return "⌥";
      case "Space": return "Space";
      default:
        if (part.startsWith("Digit")) return part.slice(5);
        if (part.startsWith("Key")) return part.slice(3);
        return part;
    }
  });
}

export function ShortcutSection({
  shortcuts,
  onChange,
}: {
  shortcuts: ShortcutsConfig;
  onChange: (next: ShortcutsConfig) => void;
}) {
  const [editingAction, setEditingAction] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(action: ShortcutAction, newShortcut: string) {
    // Reject a key already bound to another action.
    const conflict = SHORTCUT_DEFS.find(
      (d) => d.action !== action && shortcuts[d.action] === newShortcut,
    );
    if (conflict) {
      setError(`Already assigned to "${conflict.label}"`);
      return;
    }
    try {
      await invoke("voice_set_shortcut", { action, shortcut: newShortcut });
      onChange({ ...shortcuts, [action]: newShortcut });
      setEditingAction(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section>
      <h3 className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
        <Keyboard className="w-3.5 h-3.5" /> Keyboard Shortcuts
      </h3>
      <div className="space-y-1 bg-[#111827] rounded-lg border border-[#1f2937] p-1">
        {SHORTCUT_DEFS.map(({ action, description }) => (
          <ShortcutRow
            key={action}
            description={description}
            shortcut={shortcuts[action]}
            isEditing={editingAction === action}
            onStartEdit={() => { setEditingAction(action); setError(null); }}
            onCancelEdit={() => setEditingAction(null)}
            onSave={(newShortcut) => handleSave(action, newShortcut)}
          />
        ))}
      </div>
      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      <p className="mt-2 text-[11px] text-gray-500">Click a shortcut to change it. Global shortcuts work system-wide when the app is running.</p>
    </section>
  );
}

interface ShortcutRowProps {
  description: string;
  shortcut: string;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (shortcut: string) => Promise<void>;
}

function ShortcutRow({ description, shortcut, isEditing, onStartEdit, onCancelEdit, onSave }: ShortcutRowProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isEditing) {
      setPending(null);
      ref.current?.focus();
    }
  }, [isEditing]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!isEditing) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      onCancelEdit();
      return;
    }

    const formatted = formatShortcutForRust(e.nativeEvent);
    if (formatted) setPending(formatted);
  }

  async function handleConfirm() {
    if (!pending) return;
    setSaving(true);
    await onSave(pending);
    setSaving(false);
    setPending(null);
  }

  const displayKeys = pending ? displayShortcut(pending) : displayShortcut(shortcut);

  return (
    <div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-[#1f2937]/60">
      <span className="text-[13px] text-gray-300">{description}</span>
      <div className="flex items-center gap-2 flex-shrink-0">
        {isEditing && (
          <span className="text-[11px] text-gray-500">
            {pending ? "↵ confirm · Esc cancel" : "Press new shortcut…"}
          </span>
        )}
        <button
          ref={ref}
          onClick={isEditing ? undefined : onStartEdit}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (!saving) onCancelEdit(); }}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-mono transition-colors outline-none ${
            isEditing
              ? "border-[#c5f016]/60 bg-[#1f2937] text-[#c5f016]"
              : "border-[#374151] bg-[#1f2937] text-gray-300 hover:border-[#4b5563] cursor-pointer"
          }`}
        >
          {displayKeys.map((k, i) => (
            <span key={i}>{k}</span>
          ))}
        </button>
        {isEditing && pending && !saving && (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleConfirm}
            className="text-[11px] text-[#c5f016] hover:text-[#d6f733] transition-colors"
          >
            Save
          </button>
        )}
        {saving && (
          <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
        )}
      </div>
    </div>
  );
}
