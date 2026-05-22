import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  type Message,
  type ToolExecution,
  type AttachedFile,
  type PromptPayload,
  type ApprovalRequest,
  WS_EVENTS,
} from "../types";
import type { Session } from "../types";
import { API_BASE } from "../config";
import { fetchWithTimeout } from "../utils/fetch";
import { arrayBufferToBase64, MIME_BY_EXT } from "../utils/files";
import { useWebSocket } from "./WebSocketContext";
import { useSession } from "./SessionContext";
import { useChatWebSocketSubscriptions } from "../hooks/useChatWebSocketSubscriptions";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ChatContextValue {
  messages: Message[];
  toolExecutions: ToolExecution[];
  isProcessing: boolean;
  isLoadingSession: boolean;
  isSteering: boolean;
  currentToolStatus: string | null;
  approvalRequest: ApprovalRequest | null;
  chatError: string | null;
  handleSubmit: (input: string, attachments: AttachedFile[]) => void;
  handleStop: () => Promise<void>;
  handleApprovalResponse: (approved: boolean) => void;
  clearMessages: () => void;
  /** Load a session: replaces messages/toolExecutions + updates session state. */
  loadSession: (session: Session) => Promise<void>;
  setChatError: (err: string | null) => void;
}

export const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { wsSend } = useWebSocket();
  const { currentSessionId, setCurrentSessionId, setLocalProjectDir, fetchSessions } =
    useSession();

  const [messages, setMessages] = useState<Message[]>([]);
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isSteering, setIsSteering] = useState(false);
  const [currentToolStatus, setCurrentToolStatus] = useState<string | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  // Stable ref so callbacks always see current sessionId without stale closures
  const sessionIdRef = useRef(currentSessionId);
  useEffect(() => { sessionIdRef.current = currentSessionId; }, [currentSessionId]);

  // Stable ref for isProcessing (used inside handleSubmit callback)
  const isProcessingRef = useRef(isProcessing);
  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);

  // Timer ref for clearing tool status after tool_execution_end
  const toolStatusClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setToolExecutions([]);
  }, []);

  const handleSubmit = useCallback(
    (input: string, attachments: AttachedFile[]) => {
      if (!input.trim() && attachments.length === 0) return;
      const sessionId = sessionIdRef.current;

      if (isProcessingRef.current) {
        setIsSteering(true);
        wsSend({ type: WS_EVENTS.STEER, text: input, sessionId });
        setMessages((prev) => [
          ...prev,
          { id: "steer_" + Date.now(), role: "user" as const, content: `(Steering) ${input}`, timestamp: Date.now() },
        ]);
        return;
      }

      const newId = "user_" + Date.now();
      const displayContent =
        input.trim() + (attachments.length > 0 ? `\n[Attached ${attachments.length} file(s)]` : "");

      setMessages((prev) => {
        if (prev.some((m) => m.id === newId)) return prev;
        return [...prev, { id: newId, role: "user" as const, content: displayContent, timestamp: Date.now() }];
      });
      setIsProcessing(true);
      setChatError(null);

      const payload: PromptPayload = { type: WS_EVENTS.PROMPT, text: input.trim(), sessionId };
      if (attachments.length > 0) {
        payload.images = attachments.map((att) => {
          const ext = att.name.split(".").pop()?.toLowerCase() ?? "";
          return { type: "image", mimeType: MIME_BY_EXT[ext] ?? "image/jpeg", data: arrayBufferToBase64(att.data) };
        });
      }

      const sent = wsSend(payload);
      if (!sent) {
        setIsProcessing(false);
        setChatError("Connection lost — please retry.");
        setMessages((prev) => prev.filter((m) => m.id !== newId));
      }
    },
    [wsSend],
  );

  const handleStop = useCallback(async () => {
    try {
      await fetchWithTimeout(`${API_BASE}/api/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      });
      setIsProcessing(false);
      setIsSteering(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.isStreaming ? { ...m, isStreaming: false, content: m.content + "\n\n*(Stopped)*" } : m,
        ),
      );
    } catch (err) {
      console.error("[Chat] handleStop failed", err);
      setChatError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleApprovalResponse = useCallback(
    (approved: boolean) => {
      if (!approvalRequest) return;
      wsSend({
        type: WS_EVENTS.SANDBOX_APPROVAL_RESPONSE,
        id: approvalRequest.id,
        approved,
        sessionId: sessionIdRef.current,
      });
      setApprovalRequest(null);
    },
    [approvalRequest, wsSend],
  );

  /**
   * loadSession — lives here (not SessionContext) because it sets chat state
   * (messages, toolExecutions, isLoadingSession) AND session state (currentSessionId).
   * ChatContext is nested inside SessionProvider so useSession() works here.
   */
  const loadSession = useCallback(
    async (session: Session) => {
      setIsLoadingSession(true);
      try {
        const resp = await fetchWithTimeout(`${API_BASE}/api/sessions/load`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: session.path }),
        });
        const data = await resp.json() as { success?: boolean; sessionId?: string; messages?: Message[]; toolExecutions?: ToolExecution[]; cwd?: string };
        if (data.success) {
          setCurrentSessionId(data.sessionId ?? null);
          setMessages(data.messages ?? []);
          setToolExecutions(data.toolExecutions ?? []);
          if (data.cwd) setLocalProjectDir(data.cwd);
          fetchSessions();
          if (data.sessionId) wsSend({ type: WS_EVENTS.JOIN, sessionId: data.sessionId });
        }
      } catch (err) {
        console.error("[Chat] loadSession failed", err);
        setChatError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoadingSession(false);
      }
    },
    [setCurrentSessionId, setLocalProjectDir, fetchSessions, wsSend],
  );

  // -------------------------------------------------------------------------
  // WS subscriptions
  // -------------------------------------------------------------------------

  useChatWebSocketSubscriptions({
    setMessages,
    setToolExecutions,
    setIsProcessing,
    setIsSteering,
    setCurrentToolStatus,
    setApprovalRequest,
    setChatError,
    fetchSessions,
    clearMessages,
    toolStatusClearRef,
  });

  return (
    <ChatContext.Provider
      value={{
        messages, toolExecutions, isProcessing, isLoadingSession, isSteering,
        currentToolStatus, approvalRequest, chatError,
        handleSubmit, handleStop, handleApprovalResponse,
        clearMessages, loadSession, setChatError,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
