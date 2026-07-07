import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageInput } from "../MessageInput";
import { ChatContext } from "../context/ChatContext";
import { UIContext } from "../context/UIContext";
import { WebSocketContext } from "../context/WebSocketContext";
import { SessionContext } from "../context/SessionContext";
import type { ChatContextValue } from "../context/ChatContext";
import type { UIContextValue } from "../context/UIContext";
import type { WebSocketContextValue } from "../context/WebSocketContext";
import type { SessionContextValue } from "../context/SessionContext";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));

function makeChatCtx(o: Partial<ChatContextValue> = {}): ChatContextValue {
  return {
    messages: [], toolExecutions: [], isProcessing: false, isSteering: false,
    currentToolStatus: null, approvalRequest: null, isLoadingSession: false, chatError: null,
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
    selectedModel: { id: "claude-3", provider: "anthropic", name: "Claude 3" },
    setSelectedModel: vi.fn(),
    availableModels: [{ id: "claude-3", provider: "anthropic", name: "Claude 3" }],
    fetchModels: vi.fn(), handleModelChange: vi.fn(),
    sandboxStatus: null, sandboxBannerDismissed: false, setSandboxBannerDismissed: vi.fn(),
    inboxCount: 0, setInboxCount: vi.fn(), fetchInboxCount: vi.fn(),
    isRecording: false, setIsRecording: vi.fn(),
    ...o,
  } as UIContextValue;
}
function makeWSCtx(o: Partial<WebSocketContextValue> = {}): WebSocketContextValue {
  return { wsSend: vi.fn(), isConnected: true, error: null, subscribe: vi.fn().mockReturnValue(() => {}), ...o };
}
function makeSessionCtx(o: Partial<SessionContextValue> = {}): SessionContextValue {
  return {
    sessions: [], currentSessionId: null, projectDir: null,
    fetchSessions: vi.fn(), createSession: vi.fn(), archiveSession: vi.fn(),
    setCurrentSessionId: vi.fn(), setLocalProjectDir: vi.fn(), changeProjectDir: vi.fn(),
    ...o,
  };
}

function Wrap({
  chat, ui, ws,
}: {
  chat?: Partial<ChatContextValue>;
  ui?: Partial<UIContextValue>;
  ws?: Partial<WebSocketContextValue>;
}) {
  return (
    <WebSocketContext.Provider value={makeWSCtx(ws)}>
      <SessionContext.Provider value={makeSessionCtx()}>
        <UIContext.Provider value={makeUICtx(ui)}>
          <ChatContext.Provider value={makeChatCtx(chat)}>
            <MessageInput />
          </ChatContext.Provider>
        </UIContext.Provider>
      </SessionContext.Provider>
    </WebSocketContext.Provider>
  );
}

describe("MessageInput", () => {
  it("Submit button disabled when not connected", () => {
    render(<Wrap ws={{ isConnected: false }} />);
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("Submit button disabled when input is empty and connected", () => {
    render(<Wrap />);
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("calls handleSubmit with input text on form submit", () => {
    const handleSubmit = vi.fn();
    render(<Wrap chat={{ handleSubmit }} />);
    const textarea = screen.getByPlaceholderText(/Message Agent/i);
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.submit(textarea.closest("form")!);
    expect(handleSubmit).toHaveBeenCalledWith("hello world", []);
  });

  it("shows Stop button when isProcessing", () => {
    render(<Wrap chat={{ isProcessing: true }} />);
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });

  it("shows Steering placeholder when isProcessing", () => {
    render(<Wrap chat={{ isProcessing: true }} />);
    expect(screen.getByPlaceholderText(/Steer the agent/i)).toBeInTheDocument();
  });
});
