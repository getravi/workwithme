import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { UIProvider, useUI } from "../../context/UIContext";
import { WebSocketContext } from "../../context/WebSocketContext";
import { SessionContext } from "../../context/SessionContext";
import type { WebSocketContextValue } from "../../context/WebSocketContext";
import type { SessionContextValue } from "../../context/SessionContext";

function makeWSCtx(): WebSocketContextValue {
  return { wsSend: vi.fn(), isConnected: true, error: null, subscribe: vi.fn().mockReturnValue(() => {}) };
}
function makeSessionCtx(): SessionContextValue {
  return {
    sessions: [], currentSessionId: "s1", projectDir: null,
    fetchSessions: vi.fn(), createSession: vi.fn(), archiveSession: vi.fn(),
    setCurrentSessionId: vi.fn(), setLocalProjectDir: vi.fn(), changeProjectDir: vi.fn(),
  };
}

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WebSocketContext.Provider value={makeWSCtx()}>
      <SessionContext.Provider value={makeSessionCtx()}>
        <UIProvider>{children}</UIProvider>
      </SessionContext.Provider>
    </WebSocketContext.Provider>
  );
}
function Consumer({ fn }: { fn: (ctx: ReturnType<typeof useUI>) => void }) {
  fn(useUI()); return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => vi.unstubAllGlobals());

describe("UIContext", () => {
  it("activeView defaults to 'chat'", () => {
    let ctx!: ReturnType<typeof useUI>;
    render(<Providers><Consumer fn={(c) => { ctx = c; }} /></Providers>);
    expect(ctx.activeView).toBe("chat");
  });

  it("setActiveView updates activeView", () => {
    let ctx!: ReturnType<typeof useUI>;
    render(<Providers><Consumer fn={(c) => { ctx = c; }} /></Providers>);
    act(() => ctx.setActiveView("inbox"));
    expect(ctx.activeView).toBe("inbox");
  });

  it("isLeftSidebarOpen defaults to true", () => {
    let ctx!: ReturnType<typeof useUI>;
    render(<Providers><Consumer fn={(c) => { ctx = c; }} /></Providers>);
    expect(ctx.isLeftSidebarOpen).toBe(true);
  });

  it("fetchModels on mount populates availableModels", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ id: "claude-3", provider: "anthropic", name: "Claude 3" }],
        currentModel: null,
      }),
    });
    let ctx!: ReturnType<typeof useUI>;
    render(<Providers><Consumer fn={(c) => { ctx = c; }} /></Providers>);
    await waitFor(() => expect(ctx.availableModels).toHaveLength(1));
    expect(ctx.availableModels[0].id).toBe("claude-3");
  });
});
