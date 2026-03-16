# High-Impact Improvements Design

**Date:** 2026-03-13

## Overview

Three improvements that address the most impactful gaps in code quality, developer experience, and user experience:

1. Markdown rendering with syntax highlighting
2. TypeScript conversion of the sidecar
3. Shared message type constants

---

## 1. Markdown Rendering

### Problem
Assistant messages render as plain `whitespace-pre-wrap` text. The agent returns markdown — code blocks, headers, bold, lists — all appearing as raw characters.

### Solution
Install `react-markdown`, `react-syntax-highlighter`, and `@types/react-syntax-highlighter`.

Create a `<MarkdownMessage>` component (`src/MarkdownMessage.tsx`) that:
- Renders assistant message content through `react-markdown`
- Overrides the `code` renderer to use `react-syntax-highlighter` with the `vscDarkPlus` theme
- Styles inline code with a subtle dark background
- Renders blockquotes (used for `> Thinking:` blocks) with a distinct left-border style
- Applies to assistant messages only — user messages stay plain text

### Libraries
- `react-markdown` — markdown → React elements
- `react-syntax-highlighter` — syntax-highlighted code blocks
- `@types/react-syntax-highlighter` — TypeScript types

---

## 2. TypeScript for Sidecar

### Problem
`sidecar/server.js` is plain JavaScript. Bugs at the client/server boundary (wrong field names, missing fields, type mismatches) are silent.

### Solution
- Rename `sidecar/server.js` → `sidecar/server.ts`
- Add `tsx` as a dev dependency — runs TypeScript directly without a compile step
- Add `tsconfig.sidecar.json` in the project root, extending the root config but targeting Node.js:
  - `"types": ["node"]`
  - `"module": "ESNext"`
  - `"include": ["sidecar/**/*", "src/types.ts"]`
- Update the sidecar start script in `package.json` to use `tsx sidecar/server.ts`
- Add proper types throughout `server.ts` (request/response types, session map types, client types)

---

## 3. Shared Message Types

### Problem
- 14+ WebSocket message type strings are raw literals scattered across both `App.tsx` and `sidecar/server.js` — a typo silently breaks the protocol
- Interfaces like `Message`, `Session`, `Model`, `ToolExecution` are defined in `App.tsx` but needed on both sides

### Solution
Create `src/types.ts` as the single source of truth:

```ts
// Shared interfaces
export interface Message { ... }
export interface Session { ... }
export interface Model { ... }
export interface ToolExecution { ... }
export interface AttachedFile { ... }
export interface PromptPayload { ... }

// WebSocket event type constants
export const WS_EVENTS = {
  // Client → Server
  PROMPT: 'prompt',
  STEER: 'steer',
  NEW_CHAT: 'new_chat',
  JOIN: 'join',
  // Server → Client
  CHAT_CLEARED: 'chat_cleared',
  MESSAGE_START: 'message_start',
  MESSAGE_UPDATE: 'message_update',
  MESSAGE_END: 'message_end',
  AGENT_END: 'agent_end',
  TOOL_EXECUTION_START: 'tool_execution_start',
  TOOL_EXECUTION_UPDATE: 'tool_execution_update',
  TOOL_EXECUTION_END: 'tool_execution_end',
  PROMPT_COMPLETE: 'prompt_complete',
  ERROR: 'error',
} as const;
```

Both `App.tsx` and `sidecar/server.ts` import from `src/types.ts`. Inline interface definitions in `App.tsx` are removed.

---

## Implementation Order

1. `src/types.ts` — shared types and constants (no dependencies)
2. `sidecar/server.ts` — TypeScript conversion using the new types
3. `src/MarkdownMessage.tsx` — markdown component
4. Wire `<MarkdownMessage>` into `App.tsx`
