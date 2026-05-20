import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import {
  WebSocketProvider,
  useWebSocket,
  useWebSocketMessage,
} from "../../context/WebSocketContext";

// ---------------------------------------------------------------------------
// MockWebSocket
// ---------------------------------------------------------------------------
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  readyState = 0; // CONNECTING

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  simulateOpen() { this.readyState = 1; this.onopen?.(new Event("open")); }
  simulateMessage(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
  simulateClose() { this.readyState = 3; this.onclose?.(); }
}
const MockWS = Object.assign(MockWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWS);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function CtxConsumer({ fn }: { fn: (ctx: ReturnType<typeof useWebSocket>) => void }) {
  fn(useWebSocket());
  return null;
}

describe("WebSocketContext", () => {
  it("connects to ws://localhost:4242 on mount", () => {
    render(<WebSocketProvider><div /></WebSocketProvider>);
    expect(MockWebSocket.instances[0].url).toBe("ws://localhost:4242");
  });

  it("sends new_chat on open", () => {
    render(<WebSocketProvider><div /></WebSocketProvider>);
    act(() => MockWebSocket.instances[0].simulateOpen());
    expect(MockWebSocket.instances[0].sent).toContainEqual(
      JSON.stringify({ type: "new_chat", cwd: null }),
    );
  });

  it("isConnected: true on open, false on close", () => {
    let ctx!: ReturnType<typeof useWebSocket>;
    render(<WebSocketProvider><CtxConsumer fn={(c) => { ctx = c; }} /></WebSocketProvider>);
    act(() => MockWebSocket.instances[0].simulateOpen());
    expect(ctx.isConnected).toBe(true);
    act(() => MockWebSocket.instances[0].simulateClose());
    expect(ctx.isConnected).toBe(false);
  });

  it("wsSend returns false when disconnected", () => {
    let ctx!: ReturnType<typeof useWebSocket>;
    render(<WebSocketProvider><CtxConsumer fn={(c) => { ctx = c; }} /></WebSocketProvider>);
    expect(ctx.wsSend({ type: "test" })).toBe(false);
  });

  it("wsSend sends JSON and returns true when connected", () => {
    let ctx!: ReturnType<typeof useWebSocket>;
    render(<WebSocketProvider><CtxConsumer fn={(c) => { ctx = c; }} /></WebSocketProvider>);
    act(() => MockWebSocket.instances[0].simulateOpen());
    expect(ctx.wsSend({ type: "ping" })).toBe(true);
    expect(MockWebSocket.instances[0].sent).toContainEqual(JSON.stringify({ type: "ping" }));
  });

  it("useWebSocketMessage dispatches typed messages to subscriber", () => {
    const handler = vi.fn();
    function Sub() { useWebSocketMessage("msg_start", handler); return null; }
    render(<WebSocketProvider><Sub /></WebSocketProvider>);
    act(() => MockWebSocket.instances[0].simulateOpen());
    act(() => MockWebSocket.instances[0].simulateMessage({ type: "msg_start", id: "x" }));
    expect(handler).toHaveBeenCalledWith({ type: "msg_start", id: "x" });
  });

  it("useWebSocketMessage does NOT fire after unmount", () => {
    const handler = vi.fn();
    function Sub() { useWebSocketMessage("msg_start", handler); return null; }
    const { unmount } = render(<WebSocketProvider><Sub /></WebSocketProvider>);
    act(() => MockWebSocket.instances[0].simulateOpen());
    unmount();
    act(() => MockWebSocket.instances[0].simulateMessage({ type: "msg_start" }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("reconnects after close with 1s initial delay", () => {
    render(<WebSocketProvider><div /></WebSocketProvider>);
    act(() => MockWebSocket.instances[0].simulateOpen());
    act(() => MockWebSocket.instances[0].simulateClose());
    act(() => vi.advanceTimersByTime(1000));
    expect(MockWebSocket.instances).toHaveLength(2);
  });
});
