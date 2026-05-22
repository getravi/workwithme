import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { Model, SandboxStatus } from "../types";
import type { SettingsTab } from "../SettingsPage";
import { API_BASE } from "../config";
import { fetchWithTimeout } from "../utils/fetch";
import { useSession } from "./SessionContext";

export type ActiveView = "chat" | "inbox" | "settings" | "connectors";

export interface UIContextValue {
  // Sidebar
  isLeftSidebarOpen: boolean;
  setIsLeftSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarWidth: number;
  setSidebarWidth: React.Dispatch<React.SetStateAction<number>>;
  showArchived: boolean;
  setShowArchived: React.Dispatch<React.SetStateAction<boolean>>;
  // Preview panel
  isPreviewOpen: boolean;
  setIsPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isPreviewMaximized: boolean;
  setIsPreviewMaximized: React.Dispatch<React.SetStateAction<boolean>>;
  // Navigation
  activeView: ActiveView;
  setActiveView: React.Dispatch<React.SetStateAction<ActiveView>>;
  settingsTab: SettingsTab;
  setSettingsTab: React.Dispatch<React.SetStateAction<SettingsTab>>;
  // Models
  selectedModel: Model | null;
  setSelectedModel: React.Dispatch<React.SetStateAction<Model | null>>;
  availableModels: Model[];
  fetchModels: () => Promise<void>;
  handleModelChange: (model: Model) => Promise<void>;
  // Sandbox
  sandboxStatus: SandboxStatus | null;
  sandboxBannerDismissed: boolean;
  setSandboxBannerDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  // Inbox
  inboxCount: number;
  setInboxCount: React.Dispatch<React.SetStateAction<number>>;
  fetchInboxCount: () => Promise<void>;
  // Recording
  isRecording: boolean;
  setIsRecording: React.Dispatch<React.SetStateAction<boolean>>;
}

export const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const { currentSessionId } = useSession();

  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [showArchived, setShowArchived] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("chat");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("connections");
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null);
  const [sandboxBannerDismissed, setSandboxBannerDismissed] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);


  const fetchModels = useCallback(async () => {
    try {
      const url = new URL(`${API_BASE}/api/models`);
      if (currentSessionId) url.searchParams.append("sessionId", currentSessionId);
      const res = await fetchWithTimeout(url.toString());
      const data = await res.json() as { models?: Model[]; currentModel?: Model | null };
      setAvailableModels(data.models ?? []);
      if (data.currentModel) {
        setSelectedModel((prev) => prev ?? data.currentModel!);
      } else if (data.models && data.models.length > 0) {
        setSelectedModel((prev) => prev ?? data.models![0]);
      }
    } catch (err) {
      console.error("[UI] fetchModels failed", err);
    }
  }, [currentSessionId]);

  const handleModelChange = useCallback(async (model: Model) => {
    try {
      await fetchWithTimeout(`${API_BASE}/api/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: model.provider, modelId: model.id, sessionId: currentSessionId }),
      });
      setSelectedModel(model);
    } catch (err) {
      console.error("[UI] handleModelChange failed", err);
    }
  }, [currentSessionId]);

  const fetchInboxCount = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/notifications`);
      if (!resp.ok) return;
      const data = await resp.json() as { notifications?: unknown[] };
      setInboxCount((data.notifications ?? []).length);
    } catch {
      // non-critical
    }
  }, []);

  // Fetch models when session changes
  useEffect(() => { fetchModels(); }, [fetchModels]);

  // Fetch sandbox status + inbox count on mount
  useEffect(() => {
    fetchWithTimeout(`${API_BASE}/api/sandbox/status`)
      .then((r) => r.json())
      .then((s: SandboxStatus) => setSandboxStatus(s))
      .catch(() => {}); // non-critical
    fetchInboxCount();
  }, [fetchInboxCount]);

  return (
    <UIContext.Provider
      value={{
        isLeftSidebarOpen, setIsLeftSidebarOpen,
        sidebarWidth, setSidebarWidth,
        showArchived, setShowArchived,
        isPreviewOpen, setIsPreviewOpen,
        isPreviewMaximized, setIsPreviewMaximized,
        activeView, setActiveView,
        settingsTab, setSettingsTab,
        selectedModel, setSelectedModel,
        availableModels, fetchModels, handleModelChange,
        sandboxStatus, sandboxBannerDismissed, setSandboxBannerDismissed,
        inboxCount, setInboxCount, fetchInboxCount,
        isRecording, setIsRecording,
      }}
    >
      {children}
    </UIContext.Provider>
  );
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used within UIProvider");
  return ctx;
}
