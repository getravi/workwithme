import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "../Sidebar";
import { SessionContext } from "../context/SessionContext";
import { ChatContext } from "../context/ChatContext";
import { UIContext } from "../context/UIContext";
import type { SessionContextValue } from "../context/SessionContext";
import type { ChatContextValue } from "../context/ChatContext";
import type { UIContextValue } from "../context/UIContext";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const mockSession = {
  id: "s1", path: "/sessions/s1.json", cwd: "/projects/foo",
  name: "Test Chat", firstMessage: "Hello", created: "2026-01-01", modified: "2026-01-02",
};

function makeSessionCtx(o: Partial<SessionContextValue> = {}): SessionContextValue {
  return {
    sessions: [], currentSessionId: null, projectDir: null,
    fetchSessions: vi.fn(), createSession: vi.fn(), archiveSession: vi.fn(),
    setCurrentSessionId: vi.fn(), setLocalProjectDir: vi.fn(), changeProjectDir: vi.fn(),
    ...o,
  };
}
function makeChatCtx(o: Partial<ChatContextValue> = {}): ChatContextValue {
  return {
    messages: [], toolExecutions: [], isProcessing: false, isSteering: false,
    currentToolStatus: null, approvalRequest: null, isApprovingLoading: false, chatError: null,
    handleSubmit: vi.fn(), handleStop: vi.fn(), handleApprovalResponse: vi.fn(),
    clearMessages: vi.fn(), loadSession: vi.fn(), setChatError: vi.fn(),
    ...o,
  };
}
function makeUICtx(o: Partial<UIContextValue> = {}): UIContextValue {
  return {
    isLeftSidebarOpen: true, setIsLeftSidebarOpen: vi.fn(),
    sidebarWidth: 240, setSidebarWidth: vi.fn(),
    showArchived: false, setShowArchived: vi.fn(),
    isPreviewOpen: false, setIsPreviewOpen: vi.fn(),
    isPreviewMaximized: false, setIsPreviewMaximized: vi.fn(),
    activeView: "chat", setActiveView: vi.fn(),
    settingsTab: "connections", setSettingsTab: vi.fn(),
    selectedModel: null, setSelectedModel: vi.fn(),
    availableModels: [], fetchModels: vi.fn(), handleModelChange: vi.fn(),
    sandboxStatus: null, sandboxBannerDismissed: false, setSandboxBannerDismissed: vi.fn(),
    inboxCount: 0, setInboxCount: vi.fn(), fetchInboxCount: vi.fn(),
    isRecording: false, setIsRecording: vi.fn(),
    ...o,
  } as UIContextValue;
}

function Wrap({
  session, chat, ui,
}: {
  session?: Partial<SessionContextValue>;
  chat?: Partial<ChatContextValue>;
  ui?: Partial<UIContextValue>;
}) {
  return (
    <UIContext.Provider value={makeUICtx(ui)}>
      <SessionContext.Provider value={makeSessionCtx(session)}>
        <ChatContext.Provider value={makeChatCtx(chat)}>
          <Sidebar />
        </ChatContext.Provider>
      </SessionContext.Provider>
    </UIContext.Provider>
  );
}

describe("Sidebar", () => {
  it("renders New Chat button", () => {
    render(<Wrap />);
    expect(screen.getByText(/New Chat/i)).toBeInTheDocument();
  });

  it("renders session name in list", () => {
    render(<Wrap session={{ sessions: [mockSession], currentSessionId: null }} />);
    expect(screen.getByText("Test Chat")).toBeInTheDocument();
  });

  it("calls loadSession when session row clicked", () => {
    const loadSession = vi.fn();
    render(
      <Wrap
        session={{ sessions: [mockSession] }}
        chat={{ loadSession }}
      />,
    );
    fireEvent.click(screen.getByText("Test Chat"));
    expect(loadSession).toHaveBeenCalledWith(mockSession);
  });

  it("calls createSession and clearMessages on New Chat click", () => {
    const createSession = vi.fn();
    const clearMessages = vi.fn();
    render(
      <Wrap
        session={{ createSession }}
        chat={{ clearMessages }}
      />,
    );
    fireEvent.click(screen.getByText(/New Chat/i));
    expect(createSession).toHaveBeenCalled();
    expect(clearMessages).toHaveBeenCalled();
  });

  it("clicking Settings nav sets activeView to settings", () => {
    const setActiveView = vi.fn();
    render(<Wrap ui={{ setActiveView } as unknown as UIContextValue} />);
    fireEvent.click(screen.getByTitle(/Open Settings/i));
    expect(setActiveView).toHaveBeenCalledWith("settings");
  });
});
