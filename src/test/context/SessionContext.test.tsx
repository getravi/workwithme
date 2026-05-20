import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { SessionProvider, useSession } from "../../context/SessionContext";
import { WebSocketContext } from "../../context/WebSocketContext";
import type { WebSocketContextValue } from "../../context/WebSocketContext";
import type { Session } from "../../types";

// Minimal mock WS context — connected by default
function MockWSProvider({
  children,
  isConnected = true,
  wsSend = vi.fn().mockReturnValue(true),
}: {
  children: React.ReactNode;
  isConnected?: boolean;
  wsSend?: ReturnType<typeof vi.fn>;
}) {
  const subscribe = vi.fn().mockReturnValue(() => {});
  const value: WebSocketContextValue = { wsSend, isConnected, error: null, subscribe };
  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

const mockSession: Session = {
  id: "s1", path: "/sessions/s1.json", cwd: "/projects/foo",
  name: "Test session", firstMessage: "Hello", created: "2026-01-01", modified: "2026-01-02",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); });

function Consumer({ fn }: { fn: (ctx: ReturnType<typeof useSession>) => void }) {
  fn(useSession());
  return null;
}

describe("SessionContext", () => {
  it("fetchSessions on connect: populates sessions list", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [mockSession],
    });

    let ctx!: ReturnType<typeof useSession>;
    render(
      <MockWSProvider isConnected={true}>
        <SessionProvider>
          <Consumer fn={(c) => { ctx = c; }} />
        </SessionProvider>
      </MockWSProvider>,
    );

    await waitFor(() => expect(ctx.sessions).toHaveLength(1));
    expect(ctx.sessions[0].id).toBe("s1");
  });

  it("createSession sends NEW_CHAT via wsSend", () => {
    const wsSend = vi.fn().mockReturnValue(true);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [] });

    let ctx!: ReturnType<typeof useSession>;
    render(
      <MockWSProvider wsSend={wsSend}>
        <SessionProvider>
          <Consumer fn={(c) => { ctx = c; }} />
        </SessionProvider>
      </MockWSProvider>,
    );

    act(() => ctx.createSession("/projects/bar"));
    expect(wsSend).toHaveBeenCalledWith({ type: "new_chat", cwd: "/projects/bar" });
  });

  it("archiveSession POSTs and refetches", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => [mockSession] }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })           // archive POST
      .mockResolvedValueOnce({ ok: true, json: async () => [] });            // refetch

    let ctx!: ReturnType<typeof useSession>;
    render(
      <MockWSProvider>
        <SessionProvider>
          <Consumer fn={(c) => { ctx = c; }} />
        </SessionProvider>
      </MockWSProvider>,
    );

    await waitFor(() => expect(ctx.sessions).toHaveLength(1));
    await act(() => ctx.archiveSession(mockSession, true));
    await waitFor(() => expect(ctx.sessions).toHaveLength(0));
  });

  it("chat_cleared WS event: updates currentSessionId", async () => {
    let chatClearedHandler: ((data: unknown) => void) | null = null;
    const subscribe = vi.fn().mockImplementation((type: string, handler: (d: unknown) => void) => {
      if (type === "chat_cleared") chatClearedHandler = handler;
      return () => {};
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [] });

    let ctx!: ReturnType<typeof useSession>;
    render(
      <WebSocketContext.Provider value={{ wsSend: vi.fn(), isConnected: true, error: null, subscribe }}>
        <SessionProvider>
          <Consumer fn={(c) => { ctx = c; }} />
        </SessionProvider>
      </WebSocketContext.Provider>,
    );

    act(() => chatClearedHandler?.({ type: "chat_cleared", sessionId: "new-session-id" }));
    await waitFor(() => expect(ctx.currentSessionId).toBe("new-session-id"));
  });
});
