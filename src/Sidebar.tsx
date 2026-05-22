import { useMemo, useCallback } from "react";
import {
  Bot, Plus, MessageSquare, FolderOpen, Settings, Bell,
  Sidebar as SidebarIcon, Archive, ArchiveRestore,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSession } from "./context/SessionContext";
import { useChat } from "./context/ChatContext";
import { useUI } from "./context/UIContext";
import { useSidebarResize } from "./hooks/useSidebarResize";
import type { Session } from "./types";

function groupSessionsByProject(items: Session[]): Array<[string, Session[]]> {
  return Object.entries(
    items.reduce((acc, session) => {
      const project = session.cwd || "Recent";
      if (!acc[project]) acc[project] = [];
      acc[project].push(session);
      return acc;
    }, {} as Record<string, Session[]>),
  );
}

function SessionRow({ session }: { session: Session }) {
  const { currentSessionId, archiveSession } = useSession();
  const { loadSession } = useChat();
  const isCurrent = session.id === currentSessionId;
  const label = session.name || session.firstMessage || "New Session";
  const archiveLabel = session.archived ? "Restore chat" : "Archive chat";

  return (
    <div
      onClick={() => loadSession(session)}
      className={`group flex items-center gap-2.5 px-2 py-1 rounded-lg cursor-pointer transition-all ${
        isCurrent ? "bg-[#1f2937] text-white" : "text-gray-400 hover:bg-[#1f2937] hover:text-white"
      } ${session.archived ? "opacity-75" : ""}`}
    >
      <MessageSquare className="w-3 h-3 opacity-30 group-hover:opacity-100 group-hover:text-[#c5f016]" />
      <span className="text-[13px] truncate flex-1">{label}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void archiveSession(session, !session.archived); }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-white hover:bg-[#374151] transition-all"
        title={archiveLabel}
        aria-label={archiveLabel}
      >
        {session.archived ? <ArchiveRestore className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
      </button>
    </div>
  );
}

function ProjectSection({ projectDir }: { projectDir: string | null }) {
  const { changeProjectDir } = useSession();

  const handleSelectProject = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false, title: "Select Project Folder" });
    if (selected && typeof selected === "string") await changeProjectDir(selected);
  }, [changeProjectDir]);

  return (
    <div className="mb-4">
      <div className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1 flex items-center justify-between">
        <span>Project</span>
        <button onClick={handleSelectProject} className="p-1 hover:bg-[#1f2937] rounded text-gray-400 hover:text-gray-200 transition-colors" title="Open Folder">
          <FolderOpen className="w-3 h-3" />
        </button>
      </div>
      {projectDir && (
        <div className="px-2 py-1.5 rounded-lg bg-[#1f2937] border border-[#374151]">
          <div className="flex items-center gap-2 text-[13px] text-gray-300">
            <span className="truncate font-medium">{projectDir.split("/").pop() || projectDir}</span>
          </div>
          <div className="text-[12px] text-gray-500 mt-1 truncate px-6 opacity-60">{projectDir}</div>
        </div>
      )}
    </div>
  );
}

function SidebarFooter() {
  const { isLeftSidebarOpen, setActiveView } = useUI();

  return (
    <div className={`border-t border-[#1f2937]/50 ${isLeftSidebarOpen ? "px-3 py-2.5 flex items-center justify-between" : "py-2.5 flex flex-col items-center gap-2"}`}>
      <button
        onClick={() => setActiveView("settings")}
        className="text-gray-400 hover:text-white transition-colors"
        title="Open Settings"
        aria-label="Open Settings"
      >
        <Settings className="w-4 h-4" />
      </button>
    </div>
  );
}

export function Sidebar() {
  const { sessions, projectDir, createSession } = useSession();
  const { clearMessages } = useChat();
  const {
    isLeftSidebarOpen, setIsLeftSidebarOpen,
    activeView, setActiveView,
    inboxCount, setInboxCount,
    showArchived, setShowArchived,
    sidebarWidth,
  } = useUI();
  const { handleSidebarResizeStart } = useSidebarResize();

  const activeSessions = useMemo(() => sessions.filter((s) => !s.archived), [sessions]);
  const archivedSessions = useMemo(() => sessions.filter((s) => s.archived), [sessions]);
  const groupedActive = useMemo(() => groupSessionsByProject(activeSessions), [activeSessions]);
  const groupedArchived = useMemo(() => groupSessionsByProject(archivedSessions), [archivedSessions]);

  const handleNewChat = useCallback(() => {
    clearMessages();
    createSession();
    setActiveView("chat");
  }, [clearMessages, createSession, setActiveView]);

  return (
    <aside
      className="flex-shrink-0 bg-[#141d2e] flex flex-col overflow-hidden relative transition-all duration-300"
      style={{ width: isLeftSidebarOpen ? sidebarWidth : 52, boxShadow: "8px 0 24px rgba(0,0,0,0.5)" }}
    >
      {/* Traffic lights zone */}
      <div className="h-[52px] flex-shrink-0 flex items-end justify-end px-2 pb-1" data-tauri-drag-region>
        <button
          onClick={() => setIsLeftSidebarOpen((o) => !o)}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[#1f2937] transition-colors"
          title={isLeftSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          <SidebarIcon className="w-4 h-4" />
        </button>
      </div>

      {isLeftSidebarOpen && (
        <div className="px-3 pb-2.5 flex items-center gap-2 border-b border-[#1f2937]/50">
          <Bot className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <h2 className="text-[13px] font-semibold text-gray-200 truncate">
            Work with <span className="text-[#c5f016]">Me</span>
          </h2>
        </div>
      )}

      {/* New Chat */}
      <div className={isLeftSidebarOpen ? "p-2.5" : "flex justify-center py-2"}>
        {isLeftSidebarOpen ? (
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 bg-[#1f2937] hover:bg-[#374151] rounded-lg px-2.5 py-1.5 text-[13px] text-[#f3f4f6] font-medium transition-colors border border-transparent hover:border-[#4b5563]"
          >
            <Plus className="w-3.5 h-3.5 text-[#c5f016]" />
            New Chat
          </button>
        ) : (
          <button onClick={handleNewChat} className="p-2 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[#1f2937] transition-colors" title="New Chat">
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nav: Inbox */}
      <div className={`flex flex-col ${isLeftSidebarOpen ? "px-2.5 gap-0.5 pb-1" : "items-center gap-1 px-1 pb-1"}`}>
        <button
          onClick={() => { setActiveView("inbox"); setInboxCount(0); }}
          title="Inbox"
          className={`relative rounded-lg transition-colors ${
            isLeftSidebarOpen
              ? `w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] font-medium ${activeView === "inbox" ? "bg-[#1f2937] text-[#c5f016]" : "text-gray-400 hover:bg-[#1f2937] hover:text-gray-200"}`
              : `p-2 ${activeView === "inbox" ? "text-[#c5f016] bg-[#1f2937]" : "text-gray-500 hover:text-gray-200 hover:bg-[#1f2937]"}`
          }`}
        >
          <div className="relative flex-shrink-0">
            <Bell className={isLeftSidebarOpen ? "w-3.5 h-3.5" : "w-4 h-4"} />
            {inboxCount > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#c5f016] text-[#111827] text-[9px] font-bold flex items-center justify-center">
                {inboxCount > 9 ? "9+" : inboxCount}
              </span>
            )}
          </div>
          {isLeftSidebarOpen && "Inbox"}
        </button>
      </div>

      {/* Sessions list — expanded only */}
      {isLeftSidebarOpen && (
        <>
          <div className="mx-2.5 my-1.5 border-t border-[#1f2937]/60" />
          <div className="flex-1 overflow-y-auto px-2.5 py-2 scrollbar-thin scrollbar-thumb-gray-800">
            <ProjectSection projectDir={projectDir} />
            <div className="space-y-3">
              {groupedActive.map(([project, projectSessions]) => (
                <div key={project} className="space-y-1">
                  <div className="text-[12px] font-bold text-gray-500 uppercase tracking-tighter mb-1 px-1 flex items-center gap-2 opacity-50">
                    <FolderOpen className="w-2.5 h-2.5" />
                    <span className="truncate">{project.split("/").pop() || project}</span>
                  </div>
                  {projectSessions.map((s) => <SessionRow key={s.id} session={s} />)}
                </div>
              ))}
              {activeSessions.length === 0 && archivedSessions.length === 0 && (
                <div className="text-[12px] text-gray-600 px-2 italic">No history yet</div>
              )}
              {archivedSessions.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[#1f2937]/60">
                  <button
                    type="button"
                    onClick={() => setShowArchived((v) => !v)}
                    className="w-full flex items-center justify-between px-1 text-[12px] font-bold text-gray-500 uppercase tracking-[0.2em] hover:text-gray-300 transition-colors"
                  >
                    <span>Archived</span>
                    <span>{showArchived ? "Hide" : `${archivedSessions.length}`}</span>
                  </button>
                  {showArchived && groupedArchived.map(([project, projectSessions]) => (
                    <div key={project} className="space-y-1">
                      <div className="text-[12px] font-bold text-gray-500 uppercase tracking-tighter mb-1 px-1 flex items-center gap-2 opacity-40">
                        <FolderOpen className="w-2.5 h-2.5" />
                        <span className="truncate">{project.split("/").pop() || project}</span>
                      </div>
                      {projectSessions.map((s) => <SessionRow key={s.id} session={s} />)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {!isLeftSidebarOpen && <div className="flex-1" />}

      {/* Footer */}
      <SidebarFooter />

      {isLeftSidebarOpen && (
        <div
          onMouseDown={handleSidebarResizeStart}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-white/10 active:bg-white/20 transition-colors z-50"
        />
      )}
    </aside>
  );
}
