// src/types.ts

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  timestamp?: number;
}

export interface Model {
  id: string;
  provider: string;
  name?: string;
}

export interface Session {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  firstMessage?: string;
  created: string;
  modified: string;
  archived?: boolean;
  archivedAt?: string;
}

export interface ToolExecution {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: unknown;
}

export interface AttachedFile {
  name: string;
  path: string;
  data: Uint8Array;
}

export interface PromptPayload {
  type: "prompt";
  text: string;
  sessionId: string | null;
  images?: { type: string; mimeType: string; data: string }[];
}

// WebSocket message type constants — single source of truth for both frontend and Rust backend
export const WS_EVENTS = {
  // Client → Server
  PROMPT: "prompt",
  STEER: "steer",
  NEW_CHAT: "new_chat",
  JOIN: "join",
  // Server → Client
  CHAT_CLEARED: "chat_cleared",
  MESSAGE_START: "message_start",
  MESSAGE_UPDATE: "message_update",
  MESSAGE_END: "message_end",
  AGENT_END: "agent_end",
  TOOL_EXECUTION_START: "tool_execution_start",
  TOOL_EXECUTION_UPDATE: "tool_execution_update",
  TOOL_EXECUTION_END: "tool_execution_end",
  PROMPT_COMPLETE: "prompt_complete",
  ERROR: "error",
  // Server → Client: backend requests user approval to run a command outside the sandbox
  SANDBOX_APPROVAL_REQUEST: "sandbox_approval_request",
  // Client → Server: user's response to a sandbox approval request
  SANDBOX_APPROVAL_RESPONSE: "sandbox_approval_response",
} as const;

export type WsEventType = typeof WS_EVENTS[keyof typeof WS_EVENTS];
