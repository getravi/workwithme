# Bug Fix Design: HIGH + MEDIUM Severity Issues
**Date:** 2026-03-13

## Scope
Fix 14 HIGH and MEDIUM severity issues identified in the codebase audit, grouped into 4 concern areas.

---

## Group 1: Memory Leaks

### SettingsModal.tsx — EventSource leak
- Store the `EventSource` instance in a `useRef`
- Close it on modal dismiss and on component unmount via `useEffect` cleanup
- Guard `handleOAuthLogin` to prevent creating multiple instances if already in progress

### sidecar/server.js — WebSocket client leak
- In the WebSocket `message` handler's `initSession()` try-catch, remove the `client` from the `clients` Set on failure
- Close the WebSocket on failure so the client doesn't hang

---

## Group 2: Type Safety

### App.tsx — Message interface
- Add `timestamp?: number` to the `Message` interface

### App.tsx — Model types
- Define a `Model` interface with fields: `id: string`, `provider: string`, `name: string` (and any others used)
- Replace `useState<any>` / `useState<any[]>` with `useState<Model | null>` / `useState<Model[]>`

---

## Group 3: Server Reliability

### sidecar/server.js — Global state initialization
- Remove lazy `if (!globalAuthStorage)` pattern
- Initialize `AuthStorage` and `ModelRegistry` at module startup (top-level or in a single `init()` called before the server starts listening)

### sidecar/server.js — Session fallback error handling
- Wrap `initSession()` in the session fallback path with try-catch
- On failure, send a structured error message to the client and return early

### sidecar/server.js — OAuth onPrompt
- Replace the silent `return ""` with a thrown error that clearly explains OAuth requires browser-based completion and cannot accept programmatic input
- This converts a silent failure into a loud, debuggable one

---

## Group 4: Fetch / WebSocket Safety

### App.tsx — Null check on c.thinking
- Change `c.thinking.trim()` to `(c.thinking ?? "").trim()`

### App.tsx — fetch resp.ok checks
- Add `if (!resp.ok) throw new Error(...)` after every `fetch()` call before calling `.json()`

### App.tsx — Stale isConnected guard
- Replace `isConnected` state checks before WebSocket sends with direct `ws.current?.readyState === WebSocket.OPEN` checks

### App.tsx — fetch timeouts
- Wrap all `fetch()` calls with an `AbortController` and a 10-second timeout
- Clean up the controller after each request

### SettingsModal.tsx — Stale closure in onerror
- Store the `status` value in a `useRef` that is kept in sync with state
- Read from the ref (not the closure variable) inside `onerror`

---

## Out of Scope (deferred)
- Low severity issues: console logs, hardcoded URLs, reconnect backoff, CSS class generation
- Architectural changes: state management library, E2E tests
