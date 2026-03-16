# Low Priority & Suggestion Fixes Design
**Date:** 2026-03-13

## Scope
Fix 15 remaining LOW priority issues and code review suggestions, grouped into 4 concern areas.

---

## Group 1: Type Safety

### SettingsModal.tsx — AuthStatus type alias
- Extract `"idle" | "saving" | "success" | "error" | "oauth_loading"` to a named `type AuthStatus` at module top
- Replace all 3 inline occurrences with `AuthStatus`

### App.tsx — ToolExecution any types
- Replace `args: any` with `args: Record<string, unknown>`
- Replace `result?: any` with `result?: unknown`

### App.tsx — payload: any in handleSubmit
- Replace `const payload: any` with a typed inline interface or explicit type

### App.tsx — data.messages cast in loadSession
- Add `as Message[]` cast when assigning `data.messages` to make intent visible

### App.tsx — timestamp consistency
- Add `timestamp: Date.now()` to all 3 Message creation sites:
  1. Normal user message push (~line 397)
  2. Assistant placeholder creation (~line 160)
  3. Steering message (already has it)

---

## Group 2: Error Handling

### SettingsModal.tsx — JSON.parse guards
- Wrap each `JSON.parse(msgEvent.data)` call in try/catch
- On parse failure, set a generic error message (e.g. "Received malformed response from server")

### App.tsx — HTTP errors surfaced to UI
- In all catch blocks for HTTP calls (`fetchSessions`, `fetchProject`, `fetchModels`, `handleModelChange`, `loadSession`, `handleStop`, `handleSelectProject`), call `setError(err instanceof Error ? err.message : String(err))` in addition to (or instead of) `console.error`
- Note: `fetchSessions`, `fetchProject`, `fetchModels` are background refreshes — use console.error only (not setError) to avoid spamming UI on silent background failures
- `handleModelChange`, `loadSession`, `handleStop`, `handleSelectProject` are user-initiated — surface to `setError`

### server.js — session.prompt() unhandled rejection
- Add `.catch(console.error)` to the fire-and-forget `session.prompt()` call in `POST /api/project`

---

## Group 3: Code Quality

### App.tsx — Remove console.log calls
- Remove all `console.log(...)` calls
- Keep `console.error(...)` calls

### server.js — Remove console.log calls
- Remove non-essential `console.log(...)` calls
- Keep `console.error(...)` and `console.warn(...)` calls
- Keep the startup `console.log` that shows the server port (useful for operators)

### server.js — Typo fix
- `"sessionPath look like a directory"` → `"sessionPath looks like a directory"`

### server.js — sessionPath validation
- Replace `!sessionPath.includes('.')` with `path.extname(sessionPath) === ''`
- Import `path` at top of file if not already imported

### App.tsx — WebSocket reconnect backoff
- Replace fixed `setTimeout(connectWs, 3000)` with exponential backoff
- Start at 1000ms, double each attempt, cap at 30000ms
- Store attempt count in a ref (`reconnectAttemptsRef`)
- Reset attempt count to 0 on successful connection

### App.tsx — Streaming message filter
- Change the `.filter()` in `message_end` handler from:
  ```typescript
  .filter(m => m.role === 'user' || m.content.trim() !== "")
  ```
  to only filter messages where `isStreaming` is false (so in-progress empty messages aren't dropped):
  ```typescript
  .filter(m => m.role === 'user' || m.isStreaming || m.content.trim() !== "")
  ```

---

## Group 4: Infrastructure

### App.tsx — Extract API_BASE constant
- Add `const API_BASE = "http://localhost:4242";` before the `App` component
- Replace all hardcoded `"http://localhost:4242"` strings in `App.tsx`

### SettingsModal.tsx — Extract API_BASE constant
- Add `const API_BASE = "http://localhost:4242";` at top of `SettingsModal.tsx`
- Replace all hardcoded `"http://localhost:4242"` strings in `SettingsModal.tsx`

### App.tsx — arrayBufferToBase64 fix
- Replace the O(n) string concatenation loop with a chunked approach:
  ```typescript
  const arrayBufferToBase64 = (buffer: Uint8Array): string => {
    const CHUNK = 8192;
    let binary = '';
    for (let i = 0; i < buffer.length; i += CHUNK) {
      binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
    }
    return window.btoa(binary);
  };
  ```
  This avoids both quadratic string allocation and call-stack overflow for large files.

---

## Out of Scope
- Making API_BASE configurable via environment variable (larger change, separate task)
- Removing all remaining `any` types (ToolExecution is the main one; others are in JSX event handlers)
