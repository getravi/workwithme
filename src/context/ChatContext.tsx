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
import { useWebSocket, useWebSocketMessage } from "./WebSocketContext";
import { useSession } from "./SessionContext";

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

/** Find the last streaming assistant message and apply an update to it. */
function updateLastStreamingMsg(
  msgs: Message[],
  update: (m: Message) => Message,
): Message[] {
  let idx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant" && msgs[i].isStreaming) { idx = i; break; }
  }
  if (idx === -1) return msgs;
  return msgs.map((m, i) => (i === idx ? update(m) : m));
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ChatContextValue {
  messages: Message[];
  toolExecutions: ToolExecution[];
  isProcessing: boolean;
  isSteering: boolean;
  currentToolStatus: string | null;
  approvalRequest: ApprovalRequest | null;
  isApprovingLoading: boolean;
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
  const [isSteering, setIsSteering] = useState(false);
  const [currentToolStatus, setCurrentToolStatus] = useState<string | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [isApprovingLoading, setIsApprovingLoading] = useState(false);
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
      setIsApprovingLoading(true);
      try {
        wsSend({
          type: WS_EVENTS.SANDBOX_APPROVAL_RESPONSE,
          id: approvalRequest.id,
          approved,
          sessionId: sessionIdRef.current,
        });
        setApprovalRequest(null);
      } finally {
        setIsApprovingLoading(false);
      }
    },
    [approvalRequest, wsSend],
  );

  /**
   * loadSession — lives here (not SessionContext) because it sets chat state
   * (messages, toolExecutions, isProcessing) AND session state (currentSessionId).
   * ChatContext is nested inside SessionProvider so useSession() works here.
   */
  const loadSession = useCallback(
    async (session: Session) => {
      setIsProcessing(true);
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
        setIsProcessing(false);
      }
    },
    [setCurrentSessionId, setLocalProjectDir, fetchSessions, wsSend],
  );

  // -------------------------------------------------------------------------
  // WS subscriptions
  // -------------------------------------------------------------------------

  useWebSocketMessage(
    WS_EVENTS.CHAT_CLEARED,
    useCallback(() => { clearMessages(); }, [clearMessages]),
  );

  useWebSocketMessage(
    WS_EVENTS.MESSAGE_START,
    useCallback((data: unknown) => {
      const d = data as { message?: { id?: string; role?: string } };
      const rawMsg = d.message;
      if (rawMsg?.role === "user") return; // We add user messages locally
      const newId = rawMsg?.id ?? "asst_" + Date.now();
      setMessages((prev) => {
        if (prev.some((m) => m.id === newId)) return prev;
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.isStreaming && !last.content) {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, id: newId } : m));
        }
        return [...prev, { id: newId, role: "assistant" as const, content: "", isStreaming: true, timestamp: Date.now() }];
      });
    }, []),
  );

  useWebSocketMessage(
    WS_EVENTS.MESSAGE_UPDATE,
    useCallback((data: unknown) => {
      const d = data as { eventType?: string; delta?: { text?: string; thinking?: string } };
      if (!d.delta) return;
      if (d.eventType === "text_delta" && typeof d.delta.text === "string") {
        setMessages((prev) => updateLastStreamingMsg(prev, (m) => ({ ...m, content: m.content + d.delta!.text! })));
      } else if (d.eventType === "thinking_delta" && typeof d.delta.thinking === "string") {
        setMessages((prev) => updateLastStreamingMsg(prev, (m) => ({ ...m, thinkingContent: (m.thinkingContent ?? "") + d.delta!.thinking! })));
      }
    }, []),
  );

  useWebSocketMessage(
    WS_EVENTS.MESSAGE_END,
    useCallback((data: unknown) => {
      const d = data as { message?: { id?: string } };
      const msgId = d.message?.id;
      setMessages((prev) =>
        prev.reduce<Message[]>((acc, msg) => {
          const updated =
            (msgId && msg.id === msgId) || (msg.role === "assistant" && msg.isStreaming)
              ? { ...msg, isStreaming: false }
              : msg;
          if (updated.role === "user" || updated.isStreaming || updated.content.trim() !== "" || !!updated.thinkingContent) {
            acc.push(updated);
          }
          return acc;
        }, []),
      );
    }, []),
  );

  useWebSocketMessage(
    WS_EVENTS.AGENT_END,
    useCallback(() => {
      setIsProcessing(false);
      setIsSteering(false);
      if (toolStatusClearRef.current) clearTimeout(toolStatusClearRef.current);
      setCurrentToolStatus(null);
      fetchSessions();
    }, [fetchSessions]),
  );

  useWebSocketMessage(
    WS_EVENTS.AGENT_STATUS,
    useCallback((data: unknown) => {
      const d = data as { message?: string };
      setMessages((prev) => updateLastStreamingMsg(prev, (m) => ({ ...m, statusMessage: d.message })));
    }, []),
  );

  useWebSocketMessage(
    WS_EVENTS.PROMPT_COMPLETE,
    useCallback(() => { setIsProcessing(false); }, []),
  );

  useWebSocketMessage(
    WS_EVENTS.TOOL_EXECUTION_START,
    useCallback((data: unknown) => {
      const d = data as { toolCallId: string; toolName: string; args: Record<string, unknown>; status?: string };
      const step: ToolExecution = { id: d.toolCallId, name: d.toolName, args: d.args, status: "running" };
      setToolExecutions((prev) => [...prev, step]);
      setMessages((prev) => updateLastStreamingMsg(prev, (m) => ({ ...m, toolSteps: [...(m.toolSteps ?? []), step] })));
      if (toolStatusClearRef.current) clearTimeout(toolStatusClearRef.current);
      setCurrentToolStatus(d.status ?? d.toolName);
    }, []),
  );

  useWebSocketMessage(
    WS_EVENTS.TOOL_EXECUTION_UPDATE,
    useCallback((data: unknown) => {
      const d = data as { toolCallId: string; args: Record<string, unknown>; partialResult?: unknown };
      const patch = (t: ToolExecution) =>
        t.id === d.toolCallId ? { ...t, args: d.args, result: d.partialResult } : t;
      setToolExecutions((prev) => prev.map(patch));
      setMessages((prev) => updateLastStreamingMsg(prev, (m) => ({ ...m, toolSteps: (m.toolSteps ?? []).map(patch) })));
    }, []),
  );

  useWebSocketMessage(
    WS_EVENTS.TOOL_EXECUTION_END,
    useCallback((data: unknown) => {
      const d = data as { toolCallId: string; isError?: boolean; result?: unknown };
      const patch = (t: ToolExecution) =>
        t.id === d.toolCallId
          ? { ...t, status: (d.isError ? "error" : "done") as ToolExecution["status"], result: d.result }
          : t;
      setToolExecutions((prev) => prev.map(patch));
      setMessages((prev) => updateLastStreamingMsg(prev, (m) => ({ ...m, toolSteps: (m.toolSteps ?? []).map(patch) })));
      toolStatusClearRef.current = setTimeout(() => setCurrentToolStatus(null), 1000);
    }, []),
  );

  useWebSocketMessage(
    WS_EVENTS.ERROR,
    useCallback((data: unknown) => {
      const raw = (data as { message?: string }).message ?? "";
      const isAuthError = /token_expired|401|unauthorized|authentication/i.test(raw);
      const providerMatch = raw.match(/Provider error:\s*([\w-]+)/i);
      const providerName = providerMatch ? providerMatch[1] : null;
      setChatError(
        isAuthError
          ? `Your ${providerName ?? "provider"} session has expired. Go to Settings → Connections to reconnect.`
          : raw,
      );
      setIsProcessing(false);
    }, []),
  );

  useWebSocketMessage(
    WS_EVENTS.SANDBOX_APPROVAL_REQUEST,
    useCallback((data: unknown) => {
      const d = data as ApprovalRequest & { type: string };
      setApprovalRequest({ id: d.id, operation_type: d.operation_type, description: d.description, details: d.details });
    }, []),
  );

  return (
    <ChatContext.Provider
      value={{
        messages, toolExecutions, isProcessing, isSteering,
        currentToolStatus, approvalRequest, isApprovingLoading, chatError,
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
