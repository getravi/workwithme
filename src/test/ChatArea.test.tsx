import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatArea } from "../ChatArea";
import { ChatContext } from "../context/ChatContext";
import { UIContext } from "../context/UIContext";
import type { ChatContextValue } from "../context/ChatContext";
import type { UIContextValue } from "../context/UIContext";

function makeChatCtx(overrides: Partial<ChatContextValue> = {}): ChatContextValue {
  return {
    messages: [], toolExecutions: [], isProcessing: false, isSteering: false,
    currentToolStatus: null, approvalRequest: null, isApprovingLoading: false, chatError: null,
    handleSubmit: vi.fn(), handleStop: vi.fn(), handleApprovalResponse: vi.fn(),
    clearMessages: vi.fn(), loadSession: vi.fn(), setChatError: vi.fn(),
    ...overrides,
  };
}

function makeUICtx(overrides: Partial<UIContextValue> = {}): UIContextValue {
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
    ...overrides,
  } as UIContextValue;
}

function Wrap({
  chat,
  ui,
  onReconnectClick,
}: {
  chat?: Partial<ChatContextValue>;
  ui?: Partial<UIContextValue>;
  onReconnectClick?: () => void;
}) {
  return (
    <UIContext.Provider value={makeUICtx(ui)}>
      <ChatContext.Provider value={makeChatCtx(chat)}>
        <ChatArea onReconnectClick={onReconnectClick} />
      </ChatContext.Provider>
    </UIContext.Provider>
  );
}

describe("ChatArea", () => {
  it("renders empty state when no messages", () => {
    render(<Wrap />);
    expect(screen.getByText(/Hello, I'm your productivity agent/i)).toBeInTheDocument();
  });

  it("renders user messages", () => {
    render(
      <Wrap chat={{ messages: [{ id: "1", role: "user", content: "Hi there", timestamp: 1 }] }} />,
    );
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });

  it("renders assistant messages", () => {
    render(
      <Wrap
        chat={{
          messages: [{ id: "2", role: "assistant", content: "Hello from AI", timestamp: 1, isStreaming: false }],
        }}
      />,
    );
    expect(screen.getByText(/Hello from AI/i)).toBeInTheDocument();
  });

  it("renders chat error with reconnect button for auth errors", () => {
    const onReconnectClick = vi.fn();
    const setChatError = vi.fn();
    render(
      <Wrap
        chat={{
          chatError: "Your anthropic session has expired. Go to Settings → Connections to reconnect.",
          setChatError,
        }}
        onReconnectClick={onReconnectClick}
      />,
    );
    const btn = screen.getByRole("button", { name: /reconnect/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onReconnectClick).toHaveBeenCalledOnce();
    expect(setChatError).toHaveBeenCalledWith(null);
  });
});
