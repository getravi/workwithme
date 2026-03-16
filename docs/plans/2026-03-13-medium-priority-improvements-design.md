# Medium Priority Improvements Design

**Date:** 2026-03-13

## Overview

Four focused improvements addressing UX polish, API clarity, error visibility, and resource safety.

---

## 1. Maximize Preview Pane

**Problem:** The Maximize2 button in the preview pane header has no `onClick` handler and does nothing.

**Solution:** Add `isPreviewMaximized: boolean` state (default `false`) to `App.tsx`. The Maximize2 button toggles it; clicking it also opens the pane if closed. When maximized, the sidebar uses `w-1/2` instead of `w-1/3`. The icon swaps to `Minimize2` when maximized.

**Files:** `src/App.tsx` only.

---

## 2. `initSession` Options Object

**Problem:** `initSession(cwd, sessionPath, forceNew)` has 3 params creating 3 implicit modes via null placeholders (e.g. `initSession(path, null, true)`). Self-documenting call sites are impossible.

**Solution:** Replace with a discriminated union options object:

```ts
type InitSessionOptions =
  | { mode: 'continue'; cwd?: string }
  | { mode: 'new';      cwd?: string }
  | { mode: 'open';     sessionPath: string }

async function initSession(opts: InitSessionOptions): Promise<AgentSession>
```

All 5 call sites updated. Example: `initSession(path, null, true)` → `initSession({ mode: 'new', cwd: path })`.

**Files:** `sidecar/server.ts` only.

---

## 3. Fire-and-Forget Prompt Error Handling

**Problem:** The auto-prompt in `POST /api/project` runs with `.catch(console.error)` — failures are silent to the user. Also, if a new project is selected while a prompt is in-flight, there's no cancellation.

**Solution:**
- Call `session.agent.abort()` before firing the new prompt (cancels any in-flight work on the session)
- On prompt failure, broadcast a `WS_EVENTS.ERROR` message to all clients subscribed to that session so the user sees it in the UI

**Files:** `sidecar/server.ts` only.

---

## 4. WebSocket Connection Limit

**Problem:** Every inbound WebSocket is added to `clients` unconditionally — no cap.

**Solution:** Add `const MAX_WS_CONNECTIONS = 50` at the top of `server.ts`. In `wss.on('connection')`, check `clients.size >= MAX_WS_CONNECTIONS` before adding — if exceeded, call `ws.close(1013, 'Too many connections')` and return early.

**Files:** `sidecar/server.ts` only.

---

## Implementation Order

1. Maximize preview pane (`App.tsx`) — independent, frontend only
2. `initSession` refactor — prerequisite for fix 3 (cleaner call sites)
3. Fire-and-forget error handling — builds on refactored `initSession`
4. WebSocket connection limit — independent, can be done in same pass as 3
