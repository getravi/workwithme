# High-Impact Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add markdown+syntax-highlighting rendering, convert the sidecar to TypeScript, and introduce shared message type constants eliminating raw string literals across the protocol boundary.

**Architecture:** Extract shared types/constants to `src/types.ts` (used by both frontend and sidecar), convert `sidecar/server.js` → `sidecar/server.ts` using `tsx` for zero-build-step execution, and add a `<MarkdownMessage>` component that renders assistant output through `react-markdown` with `react-syntax-highlighter`.

**Tech Stack:** React 19, TypeScript 5.8, Vite 7, `react-markdown`, `react-syntax-highlighter`, `tsx` (Node.js TypeScript runner)

---

### Task 1: Create `src/types.ts` — shared interfaces and WS event constants

**Files:**
- Create: `src/types.ts`
- Modify: `src/App.tsx` (remove inline interfaces, import from types.ts, replace string literals)

**Step 1: Create `src/types.ts`**

```ts
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

// WebSocket message type constants — single source of truth for both frontend and sidecar
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
} as const;

export type WsEventType = typeof WS_EVENTS[keyof typeof WS_EVENTS];
```

**Step 2: Update `src/App.tsx` — remove inline interfaces, import from types.ts**

At the top of `App.tsx`, replace the five inline interface definitions (lines 8–51) and add the import:

```ts
// Remove these interfaces from App.tsx:
//   interface Message { ... }
//   interface Model { ... }
//   interface Session { ... }
//   interface ToolExecution { ... }
//   interface AttachedFile { ... }
//   interface PromptPayload { ... }

// Add this import after the existing imports:
import { Message, Model, Session, ToolExecution, AttachedFile, PromptPayload, WS_EVENTS } from "./types";
```

**Step 3: Replace WS event string literals in `App.tsx`**

Find every raw string used as a WebSocket message type in `App.tsx` and replace with the constant. The occurrences are in the `ws.onmessage` handler and in `wsSend` calls:

| Raw string | Replace with |
|---|---|
| `"chat_cleared"` | `WS_EVENTS.CHAT_CLEARED` |
| `"message_start"` | `WS_EVENTS.MESSAGE_START` |
| `"message_update"` | `WS_EVENTS.MESSAGE_UPDATE` |
| `"message_end"` | `WS_EVENTS.MESSAGE_END` |
| `"agent_end"` | `WS_EVENTS.AGENT_END` |
| `"tool_execution_start"` | `WS_EVENTS.TOOL_EXECUTION_START` |
| `"tool_execution_update"` | `WS_EVENTS.TOOL_EXECUTION_UPDATE` |
| `"tool_execution_end"` | `WS_EVENTS.TOOL_EXECUTION_END` |
| `"prompt_complete"` | `WS_EVENTS.PROMPT_COMPLETE` |
| `"error"` | `WS_EVENTS.ERROR` |
| `"join"` | `WS_EVENTS.JOIN` |
| `"steer"` | `WS_EVENTS.STEER` |
| `"new_chat"` | `WS_EVENTS.NEW_CHAT` |
| `type: "prompt"` in PromptPayload | `type: WS_EVENTS.PROMPT` |

**Step 4: Verify TypeScript is clean**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme
npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/types.ts src/App.tsx
git commit -m "feat: extract shared WS event constants and interfaces to src/types.ts"
```

---

### Task 2: Convert sidecar to TypeScript

**Files:**
- Create: `tsconfig.sidecar.json` (project root)
- Create: `sidecar/vendor.d.ts` (SDK type stubs)
- Rename: `sidecar/server.js` → `sidecar/server.ts`
- Modify: `sidecar/package.json` (add tsx + type deps, update start script)

**Step 1: Install type packages in the sidecar**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme/sidecar
npm install --save-dev tsx @types/node @types/express @types/cors @types/ws
```

**Step 2: Create `tsconfig.sidecar.json` at the project root**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": [
    "sidecar/**/*",
    "src/types.ts"
  ]
}
```

Note: `"moduleResolution": "node"` (not `"bundler"`) because the sidecar runs directly in Node, not through Vite.

**Step 3: Create `sidecar/vendor.d.ts` — type stubs for the SDK**

The pi-coding-agent SDK doesn't ship TypeScript declarations. Add minimal stubs for what `server.ts` uses:

```ts
// sidecar/vendor.d.ts

declare module '@mariozechner/pi-coding-agent' {
  export interface AgentState {
    model: { id: string; provider: string } | null;
    messages: Array<{
      id?: string;
      role: string;
      content: string | Array<{ type: string; text?: string; thinking?: string }>;
    }>;
    isStreaming: boolean;
  }

  export interface Agent {
    state: AgentState;
    setModel(model: unknown): void;
    abort(): void;
  }

  export interface SessionManagerInstance {
    getSessionId(): string;
    getCwd(): string;
  }

  export interface AgentSession {
    agent: Agent;
    sessionManager: SessionManagerInstance;
    isStreaming: boolean;
    subscribe(handler: (event: unknown) => void): () => void;
    prompt(text: string, options?: Record<string, unknown>): Promise<void>;
  }

  export class AuthStorage {
    static create(): AuthStorage;
    list(): string[];
    set(provider: string, credentials: Record<string, unknown>): void;
  }

  export class ModelRegistry {
    constructor(auth: AuthStorage);
    getAll(): Array<{ id: string; provider: string; name?: string }>;
    find(provider: string, modelId: string): unknown;
  }

  export class SessionManager {
    static open(path: string): SessionManager;
    static create(cwd: string): SessionManager;
    static continueRecent(cwd: string): SessionManager;
    static listAll(): Promise<unknown[]>;
  }

  export function createAgentSession(config: {
    authStorage: AuthStorage;
    modelRegistry: ModelRegistry;
    cwd: string;
    sessionManager?: SessionManager;
  }): Promise<{ session: AgentSession }>;
}

declare module '@mariozechner/pi-ai' {
  export function getProviders(): string[];
  export function getModels(): unknown[];
  export function getModel(): unknown;
}

declare module '@mariozechner/pi-ai/oauth' {
  export function getOAuthProviders(): Array<{ id: string; name: string }>;
  export function getOAuthProvider(id: string): {
    login(callbacks: {
      onAuth(info: { url: string; instructions?: string }): void;
      onPrompt(prompt: string): Promise<string>;
      onProgress(message: string): void;
    }): Promise<Record<string, unknown>>;
  } | undefined;
}
```

**Step 4: Rename server.js → server.ts and add types**

Rename the file:
```bash
mv sidecar/server.js sidecar/server.ts
```

Then add types throughout `server.ts`. Key changes:

a) **Import WS_EVENTS from shared types** (path is relative since tsconfig includes src/types.ts):
```ts
import { WS_EVENTS } from '../src/types.js';
```
Note: `.js` extension required for ESM Node imports even for `.ts` source files — this is how tsx resolves them.

b) **Type the sessionMap and clients set:**
```ts
import type { AgentSession } from '@mariozechner/pi-coding-agent';

interface ClientRecord {
  ws: WebSocket;
  subscriber: (() => void) | null;
  sessionId?: string;
}

const sessionMap = new Map<string, AgentSession>();
const clients = new Set<ClientRecord>();
```

c) **Type the initSession parameters:**
```ts
async function initSession(
  cwd = process.cwd(),
  sessionPath: string | null = null,
  forceNew = false
): Promise<AgentSession>
```

d) **Replace all raw WS event string literals** in server.ts with `WS_EVENTS.*` constants (same mapping table as Task 1 Step 3).

e) **Type the WebSocket message handler data:**
```ts
ws.on('message', async (message: Buffer) => {
  try {
    const data = JSON.parse(message.toString()) as {
      type: string;
      sessionId?: string;
      text?: string;
      cwd?: string;
      images?: unknown[];
      streamingBehavior?: string;
    };
    // ...
  }
```

**Step 5: Update `sidecar/package.json` start script**

```json
{
  "scripts": {
    "start": "tsx server.ts"
  }
}
```

**Step 6: Type-check the sidecar**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme
npx tsc -p tsconfig.sidecar.json --noEmit
```

Expected: no errors (or only expected SDK-boundary `any` usages).

**Step 7: Smoke-test the sidecar starts**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme/sidecar
npm start
```

Expected: `WorkWithMe Sidecar running on http://localhost:4242`
Kill with Ctrl+C.

**Step 8: Commit**

```bash
git add tsconfig.sidecar.json sidecar/vendor.d.ts sidecar/server.ts sidecar/package.json sidecar/package-lock.json
git commit -m "feat: convert sidecar to TypeScript using tsx, add vendor type stubs"
```

---

### Task 3: Markdown rendering with syntax highlighting

**Files:**
- Create: `src/MarkdownMessage.tsx`
- Modify: `src/App.tsx` (swap plain text div for `<MarkdownMessage>`)
- Modify: `package.json` (add markdown deps)

**Step 1: Install packages**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme
npm install react-markdown react-syntax-highlighter
npm install --save-dev @types/react-syntax-highlighter
```

**Step 2: Create `src/MarkdownMessage.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface MarkdownMessageProps {
  content: string;
  isStreaming?: boolean;
}

export function MarkdownMessage({ content, isStreaming }: MarkdownMessageProps) {
  return (
    <div className="text-[#e5e7eb] markdown-content">
      <ReactMarkdown
        components={{
          code({ className, children }) {
            const match = /language-(\w+)/.exec(className || "");
            if (match) {
              return (
                <SyntaxHighlighter
                  style={vscDarkPlus}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: "0.75rem 0",
                    borderRadius: "0.5rem",
                    fontSize: "13px",
                  }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              );
            }
            return (
              <code className="bg-[#111827] px-1.5 py-0.5 rounded text-[#c5f016] text-[13px] font-mono">
                {children}
              </code>
            );
          },
          pre({ children }) {
            // Prevent double-wrapping — SyntaxHighlighter renders its own pre
            return <>{children}</>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-[#c5f016]/40 pl-3 my-2 text-gray-400 italic">
                {children}
              </blockquote>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-[#c5f016] hover:underline"
              >
                {children}
              </a>
            );
          },
          ul({ children }) {
            return <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>;
          },
          h1({ children }) {
            return <h1 className="text-xl font-bold mt-4 mb-2 text-gray-100">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-lg font-semibold mt-3 mb-1 text-gray-100">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-base font-semibold mt-2 mb-1 text-gray-200">{children}</h3>;
          },
          p({ children }) {
            return <p className="my-2 leading-relaxed">{children}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-2.5 h-4 ml-1 bg-[#c5f016] animate-pulse rounded-sm align-middle" />
      )}
    </div>
  );
}
```

**Step 3: Wire `<MarkdownMessage>` into `App.tsx`**

Add the import at the top of `App.tsx`:
```ts
import { MarkdownMessage } from "./MarkdownMessage";
```

Find the assistant message rendering block (currently around line 726 after all edits):
```tsx
{msg.role === "assistant" ? (
  <div className="bg-transparent text-[#e5e7eb] whitespace-pre-wrap">
    {msg.content}
    {msg.isStreaming && <span className="inline-block w-2.5 h-4 ml-1 bg-[#c5f016] animate-pulse rounded-sm align-middle" />}
  </div>
```

Replace with:
```tsx
{msg.role === "assistant" ? (
  <MarkdownMessage content={msg.content} isStreaming={msg.isStreaming} />
```

**Step 4: Type-check**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme
npx tsc --noEmit
```

Expected: no errors.

**Step 5: Visual smoke test**

Run the app (`npm run dev`) and send a message that triggers a code response, e.g. "Write a TypeScript function that adds two numbers." Verify:
- Code block renders with syntax highlighting (not raw backticks)
- Inline code renders with yellow monospace style
- Streaming cursor still appears while the agent types
- User messages are unaffected (plain text, right-aligned)

**Step 6: Commit**

```bash
git add src/MarkdownMessage.tsx src/App.tsx package.json package-lock.json
git commit -m "feat: render assistant messages as markdown with syntax highlighting"
```
