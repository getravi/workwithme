import { useCallback, type MutableRefObject } from "react";
import { type Message, type ToolExecution, type ApprovalRequest, WS_EVENTS } from "../types";
import { useWebSocketMessage } from "../context/WebSocketContext";

type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>;
type SetToolExecutions = React.Dispatch<React.SetStateAction<ToolExecution[]>>;

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

export function useChatWebSocketSubscriptions({
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
}: {
  setMessages: SetMessages;
  setToolExecutions: SetToolExecutions;
  setIsProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSteering: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentToolStatus: React.Dispatch<React.SetStateAction<string | null>>;
  setApprovalRequest: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
  setChatError: React.Dispatch<React.SetStateAction<string | null>>;
  fetchSessions: () => Promise<void>;
  clearMessages: () => void;
  toolStatusClearRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
  useWebSocketMessage(
    WS_EVENTS.CHAT_CLEARED,
    useCallback(() => { clearMessages(); }, [clearMessages]),
  );

  useWebSocketMessage(
    WS_EVENTS.MESSAGE_START,
    useCallback((data: unknown) => {
      const d = data as { message?: { id?: string; role?: string } };
      const rawMsg = d.message;
      if (rawMsg?.role === "user") return;
      const newId = rawMsg?.id ?? "asst_" + Date.now();
      setMessages((prev) => {
        if (prev.some((m) => m.id === newId)) return prev;
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.isStreaming && !last.content) {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, id: newId } : m));
        }
        return [...prev, { id: newId, role: "assistant" as const, content: "", isStreaming: true, timestamp: Date.now() }];
      });
    }, [setMessages]),
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
    }, [setMessages]),
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
    }, [setMessages]),
  );

  useWebSocketMessage(
    WS_EVENTS.AGENT_END,
    useCallback(() => {
      setIsProcessing(false);
      setIsSteering(false);
      if (toolStatusClearRef.current) clearTimeout(toolStatusClearRef.current);
      setCurrentToolStatus(null);
      fetchSessions();
    }, [setIsProcessing, setIsSteering, setCurrentToolStatus, fetchSessions, toolStatusClearRef]),
  );

  useWebSocketMessage(
    WS_EVENTS.AGENT_STATUS,
    useCallback((data: unknown) => {
      const d = data as { message?: string };
      setMessages((prev) => updateLastStreamingMsg(prev, (m) => ({ ...m, statusMessage: d.message })));
    }, [setMessages]),
  );

  useWebSocketMessage(
    WS_EVENTS.PROMPT_COMPLETE,
    useCallback(() => { setIsProcessing(false); }, [setIsProcessing]),
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
    }, [setMessages, setToolExecutions, setCurrentToolStatus, toolStatusClearRef]),
  );

  useWebSocketMessage(
    WS_EVENTS.TOOL_EXECUTION_UPDATE,
    useCallback((data: unknown) => {
      const d = data as { toolCallId: string; args: Record<string, unknown>; partialResult?: unknown };
      const patch = (t: ToolExecution) =>
        t.id === d.toolCallId ? { ...t, args: d.args, result: d.partialResult } : t;
      setToolExecutions((prev) => prev.map(patch));
      setMessages((prev) => updateLastStreamingMsg(prev, (m) => ({ ...m, toolSteps: (m.toolSteps ?? []).map(patch) })));
    }, [setMessages, setToolExecutions]),
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
    }, [setMessages, setToolExecutions, setCurrentToolStatus, toolStatusClearRef]),
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
    }, [setChatError, setIsProcessing]),
  );

  useWebSocketMessage(
    WS_EVENTS.SANDBOX_APPROVAL_REQUEST,
    useCallback((data: unknown) => {
      const d = data as ApprovalRequest & { type: string };
      setApprovalRequest({ id: d.id, operation_type: d.operation_type, description: d.description, details: d.details });
    }, [setApprovalRequest]),
  );
}
