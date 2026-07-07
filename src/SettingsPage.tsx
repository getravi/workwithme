import { Keyboard, Zap, Network, Link2, Mic } from "lucide-react";
import { VoiceWorkspaceSettings } from "./VoiceWorkspaceSettings";
import { ConnectionsTab } from "./settings/ConnectionsTab";
import { ShortcutsTab } from "./settings/ShortcutsTab";

export type SettingsTab = "connections" | "shortcuts" | "skills" | "connectors" | "voice_workspace";

// ── Tab Bar (exported so App.tsx can render it at the top of main) ─────────────

interface SettingsTabBarProps {
  tab: SettingsTab;
  onChange: (tab: SettingsTab) => void;
}

export function SettingsTabBar({ tab, onChange }: SettingsTabBarProps) {
  return (
    <div className="flex items-center gap-1 px-4 pt-4 pb-0 border-b border-[#1f2937] flex-shrink-0">
      {([
        { id: "connections" as SettingsTab, label: "Providers", icon: Link2 },
        { id: "shortcuts" as SettingsTab, label: "Shortcuts", icon: Keyboard },
        { id: "skills" as SettingsTab, label: "Skills", icon: Zap },
        { id: "connectors" as SettingsTab, label: "Connectors", icon: Network },
        { id: "voice_workspace" as SettingsTab, label: "Voice Workspace", icon: Mic },
      ] as { id: SettingsTab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-t-lg border-b-2 transition-colors -mb-px ${
            tab === id
              ? "text-[#c5f016] border-[#c5f016] bg-[#1f2937]/40"
              : "text-gray-400 border-transparent hover:text-gray-200 hover:bg-[#1f2937]/30"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Connections + Shortcuts content (rendered inline by App.tsx) ──────────────

interface SettingsContentProps {
  tab: SettingsTab;
  isConnected: boolean;
}

export function SettingsContent({ tab, isConnected }: SettingsContentProps) {
  if (tab === "connections") return <div className="flex-1 overflow-y-auto"><ConnectionsTab isConnected={isConnected} /></div>;
  if (tab === "shortcuts") return <div className="flex-1 overflow-y-auto"><ShortcutsTab /></div>;
  if (tab === "voice_workspace") return <div className="flex-1 overflow-y-auto"><VoiceWorkspaceSettings /></div>;
  return null; // skills + connectors rendered as top-level components in App.tsx
}
