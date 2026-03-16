# Low Priority & Suggestion Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 15 remaining LOW priority issues and code review suggestions across SettingsModal.tsx, App.tsx, and sidecar/server.js.

**Architecture:** Pure cleanup pass — no new abstractions beyond what the design doc specifies. All changes are in-place edits to the 3 existing files.

**Tech Stack:** React 18, TypeScript, Node.js/Express. No new dependencies.

---

## Task 1: Type Safety (SettingsModal.tsx + App.tsx)

**Files:**
- Modify: `src/SettingsModal.tsx:15,23,26`
- Modify: `src/App.tsx:31-37,160,179,406-421,485`

**Step 1: Extract AuthStatus type alias in SettingsModal.tsx**

Add before the `SettingsModalProps` interface (before line 4):

```typescript
type AuthStatus = "idle" | "saving" | "success" | "error" | "oauth_loading";
```

Then replace the three inline union occurrences:
- Line 15: `useState<"idle" | "saving" | "success" | "error" | "oauth_loading">("idle")` → `useState<AuthStatus>("idle")`
- Line 23: `useRef<"idle" | "saving" | "success" | "error" | "oauth_loading">("idle")` → `useRef<AuthStatus>("idle")`
- Line 26: `(s: "idle" | "saving" | "success" | "error" | "oauth_loading")` → `(s: AuthStatus)`

**Step 2: Fix ToolExecution any types in App.tsx**

Replace lines 34-36:
```typescript
interface ToolExecution {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: unknown;
}
```

**Step 3: Fix payload: any in handleSubmit (App.tsx line 417)**

Replace:
```typescript
const payload: any = {
  type: "prompt",
  text: userMessage,
  sessionId: currentSessionId
};
```
With:
```typescript
interface PromptPayload {
  type: "prompt";
  text: string;
  sessionId: string | null;
  images?: { type: string; mimeType: string; data: string }[];
}
const payload: PromptPayload = {
  type: "prompt",
  text: userMessage,
  sessionId: currentSessionId
};
```

Place the `PromptPayload` interface before the `App` function (near other interfaces at top of file).

**Step 4: Add as Message[] cast in loadSession (App.tsx line 485)**

Replace:
```typescript
setMessages(data.messages || []);
```
With:
```typescript
setMessages((data.messages as Message[]) || []);
```

**Step 5: Add timestamp to remaining Message creation sites**

Site 1 — assistant placeholder (line 179):
```typescript
return [...prev, { id: newId, role: "assistant" as const, content: "", isStreaming: true, timestamp: Date.now() }];
```

Site 2 — normal user message (line 409):
```typescript
return [...prev, { id: newId, role: "user" as const, content: displayContent, timestamp: Date.now() }];
```

(Steering message at line 387 already has `timestamp: Date.now()`)

**Step 6: Verify build passes**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme && npm run build 2>&1 | tail -10
```
Expected: `✓ built in X.XXs` with no TypeScript errors.

---

## Task 2: Error Handling

**Files:**
- Modify: `src/SettingsModal.tsx:123-140`
- Modify: `src/App.tsx:327-329,469-471,496-498,530-532`
- Modify: `sidecar/server.js:292`

**Step 1: Guard JSON.parse calls in SettingsModal.tsx SSE event handlers**

Each of the 3 `addEventListener` handlers with `JSON.parse(msgEvent.data)` (lines 123-140) needs a try/catch. Replace each block:

`auth_instructions` handler (lines 123-128):
```typescript
eventSource.addEventListener("auth_instructions", ((e: Event) => {
  const msgEvent = e as MessageEvent;
  try {
    const data = JSON.parse(msgEvent.data);
    setOauthInstructions({ url: data.url, instructions: data.instructions });
    setOauthProgress("Waiting for browser authentication...");
  } catch {
    setErrorMessage("Received malformed response from server.");
    updateStatus("error");
  }
}) as EventListener);
```

`progress` handler (lines 130-134):
```typescript
eventSource.addEventListener("progress", ((e: Event) => {
  const msgEvent = e as MessageEvent;
  try {
    const data = JSON.parse(msgEvent.data);
    setOauthProgress(data.message);
  } catch {
    // Ignore malformed progress updates
  }
}) as EventListener);
```

`prompt` handler (lines 136-140):
```typescript
eventSource.addEventListener("prompt", ((e: Event) => {
  const msgEvent = e as MessageEvent;
  try {
    const data = JSON.parse(msgEvent.data);
    setOauthProgress(data.message || "Manual input required");
  } catch {
    setOauthProgress("Manual input required");
  }
}) as EventListener);
```

**Step 2: Surface user-initiated HTTP errors to setError in App.tsx**

Background fetches (`fetchSessions`, `fetchProject`, `fetchModels`) — keep console.error only, do NOT call setError (these run silently in background).

User-initiated functions — add `setError(err instanceof Error ? err.message : String(err))`:

`handleModelChange` catch (lines 327-329):
```typescript
} catch(err) {
  console.error("Failed to set model", err);
  setError(err instanceof Error ? err.message : String(err));
}
```

`handleStop` catch (lines 469-471):
```typescript
} catch (err) {
  console.error("Failed to stop agent", err);
  setError(err instanceof Error ? err.message : String(err));
}
```

`loadSession` catch (lines 496-498):
```typescript
} catch (err) {
  console.error("Failed to load session", err);
  setError(err instanceof Error ? err.message : String(err));
}
```

`handleSelectProject` catch (lines 530-532):
```typescript
} catch (err) {
  console.error("Folder picker error", err);
  setError(err instanceof Error ? err.message : String(err));
}
```

**Step 3: Add .catch to fire-and-forget session.prompt in server.js (line 292)**

Replace:
```javascript
session.prompt(`I have selected the folder "${path}" as my project root. Please use this as my context.`);
```
With:
```javascript
session.prompt(`I have selected the folder "${path}" as my project root. Please use this as my context.`).catch(console.error);
```

**Step 4: Verify build**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme && npm run build 2>&1 | tail -10
```
Expected: `✓ built in X.XXs`

---

## Task 3: Code Quality

**Files:**
- Modify: `src/App.tsx:140,144,160,279`
- Modify: `sidecar/server.js:1,59,63,73,252,267,287,303,336,381,384,414`
- Modify: `src/App.tsx:230,279`

**Step 1: Remove console.log calls from App.tsx**

Remove these lines entirely (they are pure debug noise):
- Line 140: `console.log("Connecting to sidecar WebSocket...");`
- Line 144: `console.log("WebSocket connected");`
- Line 160: `console.log("Chat cleared, new session:", data.sessionId);`

Keep all `console.error(...)` calls.

**Step 2: Remove non-essential console.log from server.js**

Remove these lines:
- Line 63: `console.log(\`[initSession] Creating brand new session for CWD: ${cwd}\`);`
- Line 73: `console.log(sessionPath ? ... : ...);` — the session initialized log
- Line 252: `console.log(\`Loading session from ${path}...\`);`
- Line 267: `console.log(\`Session loaded with ${messages.length} messages...\`);`
- Line 287: `console.log(\`Setting active project to ${path}...\`);`
- Line 303: `console.log('Client connected to sidecar WebSocket');`
- Line 336: `console.log(\`Creating brand new session for CWD: ${data.cwd || 'default'}...\`);`
- Lines 381,384: The two `console.log` lines inside the prompt handler (streaming state logs)
- Line 414: `console.log('Client disconnected');`

Keep:
- Line 425: `console.log(\`WorkWithMe Sidecar running on http://localhost:${PORT}\`);` — startup info
- All `console.error(...)` and `console.warn(...)` calls

**Step 3: Fix typo in server.js (line 59)**

Replace:
```javascript
console.warn(`[initSession] sessionPath look like a directory: ${sessionPath}`);
```
With:
```javascript
console.warn(`[initSession] sessionPath looks like a directory: ${sessionPath}`);
```

**Step 4: Fix sessionPath validation in server.js (line 58)**

First, check if `path` is already imported at top of server.js (line 1). It is not — add import:
```javascript
import path from 'path';
```

Then replace the validation condition (line 58):
```javascript
if (typeof sessionPath !== 'string' || sessionPath.endsWith('/') || !sessionPath.includes('.')) {
```
With:
```javascript
if (typeof sessionPath !== 'string' || sessionPath.endsWith('/') || path.extname(sessionPath) === '') {
```

**Step 5: Add WebSocket reconnect exponential backoff in App.tsx**

Add a ref for attempt count after the existing refs (after line 81):
```typescript
const reconnectAttemptsRef = useRef(0);
```

In the `ws.onopen` handler (after `setIsConnected(true)`), reset the counter:
```typescript
reconnectAttemptsRef.current = 0;
```

Replace the fixed reconnect timeout in `ws.onclose` (line 279):
```typescript
ws.onclose = () => {
  setIsConnected(false);
  const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
  reconnectAttemptsRef.current += 1;
  reconnectTimeoutRef.current = setTimeout(connectWs, delay);
};
```

**Step 6: Fix streaming message filter in message_end handler (App.tsx line 230)**

Replace:
```typescript
}).filter(m => m.role === 'user' || m.content.trim() !== ""); // Clean up any empty "ghost" bubbles
```
With:
```typescript
}).filter(m => m.role === 'user' || m.isStreaming || m.content.trim() !== ""); // Clean up empty non-streaming bubbles
```

**Step 7: Verify build**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme && npm run build 2>&1 | tail -10
```
Expected: `✓ built in X.XXs`

---

## Task 4: Infrastructure

**Files:**
- Modify: `src/App.tsx:45,90,100,112,317,461,477,512`
- Modify: `src/SettingsModal.tsx:56,57,87,120`

**Step 1: Add API_BASE constant to App.tsx**

Add immediately before the `fetchWithTimeout` function (before line 45):
```typescript
const API_BASE = "http://localhost:4242";
```

Then replace all `"http://localhost:4242"` strings in App.tsx:
- Line 90: `fetchWithTimeout("http://localhost:4242/api/sessions")` → `fetchWithTimeout(\`${API_BASE}/api/sessions\`)`
- Line 100: `new URL("http://localhost:4242/api/project")` → `new URL(\`${API_BASE}/api/project\`)`
- Line 112: `new URL("http://localhost:4242/api/models")` → `new URL(\`${API_BASE}/api/models\`)`
- Line 317: `fetchWithTimeout("http://localhost:4242/api/model", {` → `fetchWithTimeout(\`${API_BASE}/api/model\`, {`
- Line 461: `fetchWithTimeout("http://localhost:4242/api/stop", {` → `fetchWithTimeout(\`${API_BASE}/api/stop\`, {`
- Line 477: `fetchWithTimeout("http://localhost:4242/api/sessions/load", {` → `fetchWithTimeout(\`${API_BASE}/api/sessions/load\`, {`
- Line 512: `fetchWithTimeout("http://localhost:4242/api/project", {` → `fetchWithTimeout(\`${API_BASE}/api/project\`, {`

**Step 2: Add API_BASE constant to SettingsModal.tsx**

Add immediately before the `SettingsModalProps` interface (before line 4, after the new `AuthStatus` type from Task 1):
```typescript
const API_BASE = "http://localhost:4242";
```

Then replace all `"http://localhost:4242"` strings in SettingsModal.tsx:
- Line 56: `fetch("http://localhost:4242/api/auth")` → `fetch(\`${API_BASE}/api/auth\`)`
- Line 57: `fetch("http://localhost:4242/api/auth/oauth-providers")` → `fetch(\`${API_BASE}/api/auth/oauth-providers\`)`
- Line 87: `fetch("http://localhost:4242/api/auth/key", {` → `fetch(\`${API_BASE}/api/auth/key\`, {`
- Line 120: `` new EventSource(`http://localhost:4242/api/auth/login?provider=${providerId}`) `` → `` new EventSource(`${API_BASE}/api/auth/login?provider=${providerId}`) ``

**Step 3: Fix arrayBufferToBase64 in App.tsx (lines 364-373)**

Replace the entire function:
```typescript
// Convert Uint8Array to base64 string (chunked to avoid call-stack overflow on large files)
const arrayBufferToBase64 = (buffer: Uint8Array): string => {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
  }
  return window.btoa(binary);
};
```

**Step 4: Verify final build**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme && npm run build 2>&1 | tail -10
```
Expected: `✓ built in X.XXs` with zero TypeScript errors.
