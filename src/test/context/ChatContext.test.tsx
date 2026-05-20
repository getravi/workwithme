import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { ChatProvider, useChat } from "../../context/ChatContext";
import { WebSocketContext } from "../../context/WebSocketContext";
import { SessionContext } from "../../context/SessionContext";
import type { WebSocketContextValue } from "../../context/WebSocketContext";
import type { SessionContextValue } from "../../context/SessionContext";

function makeWSCtx(overrides: Partial<WebSocketContextValue> = {}): WebSocketContextValue {
  return {
    wsSend: vi.fn().mockReturnValue(true),
    isConnected: true,
    error: null,
    subscribe: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

function makeSessionCtx(overrides: Partial<SessionContextValue> = {}): SessionContextValue {
  return {
    sessions: [],
    currentSessionId: "sess-1",
    projectDir: null,
    fetchSessions: vi.fn(),
    createSession: vi.fn(),
    archiveSession: vi.fn(),
    setCurrentSessionId: vi.fn(),
    setLocalProjectDir: vi.fn(),
    changeProjectDir: vi.fn(),
    ...overrides,
  };
}

function Providers({
  children,
  ws,
  session,
}: {
  children: React.ReactNode;
  ws?: Partial<WebSocketContextValue>;
  session?: Partial<SessionContextValue>;
}) {
  return (
    <WebSocketContext.Provider value={makeWSCtx(ws)}>
      <SessionContext.Provider value={makeSessionCtx(session)}>
        <ChatProvider>{children}</ChatProvider>
      </SessionContext.Provider>
    </WebSocketContext.Provider>
  );
}

function Consumer({ fn }: { fn: (ctx: ReturnType<typeof useChat>) => void }) {
  fn(useChat());
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("ChatContext — handleSubmit", () => {
  it("sends PROMPT and adds user message optimistically", () => {
    const wsSend = vi.fn().mockReturnValue(true);
    let ctx!: ReturnType<typeof useChat>;
    render(<Providers ws={{ wsSend }}><Consumer fn={(c) => { ctx = c; }} /></Providers>);

    act(() => ctx.handleSubmit("hello", []));
    expect(wsSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "prompt", text: "hello", sessionId: "sess-1" })
    );
    expect(ctx.messages[0].content).toBe("hello");
    expect(ctx.isProcessing).toBe(true);
  });

  it("sends STEER when already processing", () => {
    const wsSend = vi.fn().mockReturnValue(true);
    let ctx!: ReturnType<typeof useChat>;
    render(<Providers ws={{ wsSend }}><Consumer fn={(c) => { ctx = c; }} /></Providers>);

    act(() => ctx.handleSubmit("first", []));   // sets isProcessing true
    act(() => ctx.handleSubmit("steer me", [])); // should steer
    expect(wsSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "steer", text: "steer me" })
    );
  });

  it("rolls back on send failure", () => {
    const wsSend = vi.fn().mockReturnValue(false);
    let ctx!: ReturnType<typeof useChat>;
    render(<Providers ws={{ wsSend }}><Consumer fn={(c) => { ctx = c; }} /></Providers>);

    act(() => ctx.handleSubmit("fail", []));
    expect(ctx.messages).toHaveLength(0);
    expect(ctx.isProcessing).toBe(false);
    expect(ctx.chatError).toContain("Connection lost");
  });
});

describe("ChatContext — WS message streaming", () => {
  it("message_start creates streaming assistant message", () => {
    let msgStartSub: ((d: unknown) => void) | null = null;
    const subscribe = vi.fn().mockImplementation((type: string, handler: (d: unknown) => void) => {
      if (type === "message_start") msgStartSub = handler;
      return () => {};
    });

    let ctx!: ReturnType<typeof useChat>;
    render(
      <WebSocketContext.Provider value={makeWSCtx({ subscribe })}>
        <SessionContext.Provider value={makeSessionCtx()}>
          <ChatProvider><Consumer fn={(c) => { ctx = c; }} /></ChatProvider>
        </SessionContext.Provider>
      </WebSocketContext.Provider>,
    );

    act(() => msgStartSub?.({ type: "message_start", message: { id: "m1", role: "assistant" } }));
    expect(ctx.messages[0]).toMatchObject({ id: "m1", role: "assistant", isStreaming: true });
  });
});

describe("ChatContext — clearMessages", () => {
  it("clears messages and toolExecutions", () => {
    let msgStartSub: ((d: unknown) => void) | null = null;
    const subscribe = vi.fn().mockImplementation((type: string, handler: (d: unknown) => void) => {
      if (type === "message_start") msgStartSub = handler;
      return () => {};
    });

    let ctx!: ReturnType<typeof useChat>;
    render(
      <WebSocketContext.Provider value={makeWSCtx({ subscribe })}>
        <SessionContext.Provider value={makeSessionCtx()}>
          <ChatProvider><Consumer fn={(c) => { ctx = c; }} /></ChatProvider>
        </SessionContext.Provider>
      </WebSocketContext.Provider>,
    );

    act(() => msgStartSub?.({ type: "message_start", message: { id: "m1", role: "assistant" } }));
    expect(ctx.messages).toHaveLength(1);
    act(() => ctx.clearMessages());
    expect(ctx.messages).toHaveLength(0);
  });
});

describe("ChatContext — handleApprovalResponse", () => {
  it("sends SANDBOX_APPROVAL_RESPONSE and clears approvalRequest", () => {
    const wsSend = vi.fn().mockReturnValue(true);
    let sandboxSub: ((d: unknown) => void) | null = null;
    const subscribe = vi.fn().mockImplementation((type: string, handler: (d: unknown) => void) => {
      if (type === "sandbox_approval_request") sandboxSub = handler;
      return () => {};
    });

    let ctx!: ReturnType<typeof useChat>;
    render(
      <WebSocketContext.Provider value={makeWSCtx({ wsSend, subscribe })}>
        <SessionContext.Provider value={makeSessionCtx()}>
          <ChatProvider><Consumer fn={(c) => { ctx = c; }} /></ChatProvider>
        </SessionContext.Provider>
      </WebSocketContext.Provider>,
    );

    act(() => sandboxSub?.({
      type: "sandbox_approval_request",
      id: "req-1",
      operation_type: "bash_write",
      description: "Write file",
      details: null,
    }));
    expect(ctx.approvalRequest).not.toBeNull();

    act(() => ctx.handleApprovalResponse(true));
    expect(wsSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sandbox_approval_response", id: "req-1", approved: true })
    );
    expect(ctx.approvalRequest).toBeNull();
  });
});
