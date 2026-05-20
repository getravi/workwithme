import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";

const WS_URL = "ws://localhost:4242";
const MAX_RECONNECT_ATTEMPTS = 5;

type MessageHandler = (data: unknown) => void;

export interface WebSocketContextValue {
  wsSend: (payload: object) => boolean;
  isConnected: boolean;
  error: string | null;
  /** Subscribe to a WS message type. Returns unsubscribe fn. */
  subscribe: (type: string, handler: MessageHandler) => () => void;
}

export const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subscribe = useCallback(
    (type: string, handler: MessageHandler): (() => void) => {
      if (!handlersRef.current.has(type)) handlersRef.current.set(type, new Set());
      handlersRef.current.get(type)!.add(handler);
      return () => { handlersRef.current.get(type)?.delete(handler); };
    },
    [],
  );

  const wsSend = useCallback((payload: object): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    const connectWs = () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        setError(null);
        ws.send(JSON.stringify({ type: "new_chat", cwd: null }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { type: string };
          handlersRef.current.get(data.type)?.forEach((h) => h(data));
        } catch (e) {
          console.error("[WS] parse error", e);
        }
      };

      ws.onerror = () => setIsConnected(false);

      ws.onclose = () => {
        setIsConnected(false);
        const attempt = reconnectAttemptsRef.current;
        reconnectAttemptsRef.current += 1;
        if (attempt >= MAX_RECONNECT_ATTEMPTS) {
          setError(
            "Still trying to reach the backend server — port 4242 may be in use by another application. " +
            "Try quitting and restarting WorkWithMe if this persists.",
          );
        }
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        reconnectTimeoutRef.current = window.setTimeout(connectWs, delay);
      };

      wsRef.current = ws;
    };

    connectWs();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ wsSend, isConnected, error, subscribe }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWebSocket must be used within WebSocketProvider");
  return ctx;
}

/**
 * Subscribe to a typed WS message. Call unconditionally at component/hook top level.
 * Uses a ref so handler always sees latest closure values without re-subscribing.
 */
export function useWebSocketMessage(
  type: string,
  handler: (data: unknown) => void,
): void {
  const { subscribe } = useWebSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribe(type, (data) => handlerRef.current(data));
  }, [type, subscribe]);
}
