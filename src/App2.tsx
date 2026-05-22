import { useWebSocket } from "./context/WebSocketContext";
import { useUI } from "./context/UIContext";
import { useChat } from "./context/ChatContext";
import { Sidebar } from "./Sidebar";
import { ChatArea } from "./ChatArea";
import { MessageInput } from "./MessageInput";
import { ApprovalModal } from "./ApprovalModal";
import { SandboxBanner } from "./SandboxBanner";
import { InboxPage } from "./InboxPage";
import { SettingsTabBar, SettingsContent } from "./SettingsPage";
import type { SettingsTab } from "./SettingsPage";
import { SkillsPage } from "./SkillsPage";
import { ConnectorsPage } from "./ConnectorsPage";
import { ModelSelector } from "./ModelSelector";
import {
  Terminal, PanelRightOpen, PanelRightClose, Maximize2, Minimize2, Loader2,
} from "lucide-react";

export default function App2() {
  const { isConnected } = useWebSocket();
  const {
    activeView, setActiveView, settingsTab, setSettingsTab,
    isPreviewOpen, setIsPreviewOpen,
    isPreviewMaximized, setIsPreviewMaximized,
    selectedModel, availableModels, handleModelChange,
  } = useUI();
  const { toolExecutions } = useChat();

  return (
    <div className="flex h-screen w-full bg-[#141d2e] text-white overflow-hidden">
      <Sidebar />

      {/* Main content area */}
      {activeView === "settings" ? (
        <main className="flex-1 flex flex-col bg-[#111827] min-w-0 min-h-0 rounded-tl-[20px] rounded-bl-[20px] overflow-hidden">
          <SettingsTabBar tab={settingsTab} onChange={setSettingsTab as (tab: SettingsTab) => void} />
          {settingsTab === "skills" ? (
            <SkillsPage />
          ) : settingsTab === "connectors" ? (
            <ConnectorsPage />
          ) : (
            <SettingsContent tab={settingsTab} isConnected={isConnected} />
          )}
        </main>
      ) : activeView === "inbox" ? (
        <InboxPage />
      ) : (
        <main className="flex-1 flex flex-col bg-[#111827] relative min-w-0 rounded-tl-[20px] rounded-bl-[20px] z-10">
          {/* Header */}
          <header className="absolute top-0 left-0 right-0 p-3 flex items-center justify-between z-10" data-tauri-drag-region>
            <ModelSelector
              selected={selectedModel}
              models={availableModels}
              onChange={handleModelChange}
            />
            <button
              onClick={() => { if (isPreviewOpen) setIsPreviewMaximized(false); setIsPreviewOpen((o) => !o); }}
              className="p-1.5 rounded-lg bg-[#182234] border border-[#1f2937] text-gray-400 hover:text-white transition-colors shadow-sm"
              title="Under the hood"
            >
              {isPreviewOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            </button>
          </header>

          <SandboxBanner />
          <ChatArea
            onReconnectClick={() => {
              setSettingsTab("connections");
              setActiveView("settings");
            }}
          />
          <ApprovalModal />
          <MessageInput />
        </main>
      )}

      {/* Right panel — tool executions */}
      <aside
        className={`${
          activeView === "chat" && isPreviewOpen
            ? isPreviewMaximized ? "w-1/2" : "w-1/3"
            : "w-0"
        } flex-shrink-0 transition-all duration-300 border-l border-[#1f2937] bg-[#182234] flex flex-col overflow-hidden shadow-2xl z-30`}
      >
        <div className="px-3 py-2.5 border-b border-[#1f2937] flex items-center justify-between bg-[#141d2e]">
          <h3 className="text-[13px] font-semibold text-gray-300 flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-[#9df0c0]" />
            Under the hood
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsPreviewMaximized((m) => !m)}
              className="p-1 text-gray-400 hover:text-white rounded hover:bg-[#374151] transition-colors"
            >
              {isPreviewMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => { setIsPreviewOpen(false); setIsPreviewMaximized(false); }}
              className="p-1 text-gray-400 hover:text-white rounded hover:bg-[#374151] transition-colors"
            >
              <PanelRightClose className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          {toolExecutions.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-2.5">
              <Terminal className="w-10 h-10 mx-auto opacity-20" />
              <p className="text-[13px]">Nothing here yet.</p>
            </div>
          ) : (
            <div className="space-y-3 pb-8">
              {toolExecutions.map((tool) => (
                <div key={tool.id} className="bg-[#111827] border border-[#374151] rounded-lg overflow-hidden shadow-sm flex flex-col">
                  <div className="px-3 py-1.5 border-b border-[#1f2937] bg-[#182234] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {tool.status === "running" ? (
                        <Loader2 className="w-3.5 h-3.5 text-[#c5f016] animate-spin" />
                      ) : tool.status === "error" ? (
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-[#9df0c0]" />
                      )}
                      <span className="text-[12px] font-medium text-gray-300 font-mono">{tool.name}</span>
                    </div>
                    <span className="text-[12px] uppercase text-gray-500 font-bold bg-[#111827] px-2 py-0.5 rounded">
                      {tool.status}
                    </span>
                  </div>
                  <div className="p-2.5 text-[12px] font-mono text-gray-400 overflow-x-auto whitespace-pre-wrap max-h-44 overflow-y-auto">
                    {tool.args && (
                      <div className="mb-2">
                        <span className="text-gray-500 block mb-1">Args:</span>
                        <span className="text-blue-300">{JSON.stringify(tool.args, null, 2)}</span>
                      </div>
                    )}
                    {tool.result != null && (
                      <div className="mt-2 pt-2 border-t border-[#1f2937]">
                        <span className="text-gray-500 block mb-1">Output:</span>
                        <span className="text-green-300">
                          {typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result, null, 2)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
