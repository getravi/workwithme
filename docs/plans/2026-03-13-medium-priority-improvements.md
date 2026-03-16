# Medium Priority Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix four medium-priority issues: wire the Maximize2 button, refactor initSession to use a discriminated options object, improve fire-and-forget error visibility in /api/project, and cap WebSocket connections.

**Architecture:** Task 1 is frontend-only (App.tsx). Tasks 2–4 are sidecar-only (server.ts). Tasks 3 and 4 depend on Task 2's refactored initSession, so run in order 1 → 2 → 3+4.

**Tech Stack:** React 19, TypeScript 5.8, Node.js ESM sidecar with tsx

---

### Task 1: Wire the Maximize2 button in the preview pane

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add `isPreviewMaximized` state**

After the existing `const [isPreviewOpen, setIsPreviewOpen] = useState(false);` line (currently around line 54), add:

```ts
const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);
```

**Step 2: Add `Minimize2` to the lucide-react import**

The current import line starts with:
```ts
import { Send, Terminal, Loader2, Bot, Sidebar as SidebarIcon, Plus, MessageSquare, PanelRightOpen, Paperclip, ChevronDown, FolderOpen, PanelRightClose, Settings, Maximize2, X, CircleStop, Zap } from "lucide-react";
```

Add `Minimize2` to the list.

**Step 3: Update the right sidebar `aside` width class**

Find:
```tsx
<aside className={`${isPreviewOpen ? 'w-1/3' : 'w-0'} flex-shrink-0 transition-all ...`}>
```

Replace the width expression so it uses `w-1/2` when maximized:
```tsx
<aside className={`${isPreviewOpen ? (isPreviewMaximized ? 'w-1/2' : 'w-1/3') : 'w-0'} flex-shrink-0 transition-all ...`}>
```

**Step 4: Wire the Maximize2 button**

Find the button with no `onClick`:
```tsx
<button className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-[#374151] transition-colors">
   <Maximize2 className="w-4 h-4" />
</button>
```

Replace with:
```tsx
<button
  onClick={() => {
    setIsPreviewMaximized(m => !m);
    setIsPreviewOpen(true);
  }}
  className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-[#374151] transition-colors"
  title={isPreviewMaximized ? "Restore" : "Maximize"}
>
  {isPreviewMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
</button>
```

**Step 5: Reset maximized state when preview is closed**

Find the close button in the preview header:
```tsx
<button onClick={() => setIsPreviewOpen(false)} ...>
```

Update to also reset maximized:
```tsx
<button onClick={() => { setIsPreviewOpen(false); setIsPreviewMaximized(false); }} ...>
```

Also update the toggle button in the main header (the `PanelRightClose`/`PanelRightOpen` button around line 644):
```tsx
onClick={() => setIsPreviewOpen(!isPreviewOpen)}
```
Replace with:
```tsx
onClick={() => { setIsPreviewOpen(o => !o); if (isPreviewOpen) setIsPreviewMaximized(false); }}
```

**Step 6: Type-check**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme && npx tsc --noEmit
```

Expected: zero errors.

---

### Task 2: Refactor `initSession` to use a discriminated options object

**Files:**
- Modify: `sidecar/server.ts`

**Step 1: Replace the `initSession` signature**

Find the current function (lines 62–101):
```ts
async function initSession(
  cwd = process.cwd(),
  sessionPath: string | null = null,
  forceNew = false
): Promise<AgentSession> {
```

Replace the signature and body with:
```ts
type InitSessionOptions =
  | { mode: 'continue'; cwd?: string }
  | { mode: 'new';      cwd?: string }
  | { mode: 'open';     sessionPath: string };

async function initSession(opts: InitSessionOptions = { mode: 'continue' }): Promise<AgentSession> {
    try {
      const cwd = opts.mode !== 'open' ? (opts.cwd ?? process.cwd()) : process.cwd();
      const config: {
        authStorage: AuthStorage;
        modelRegistry: ModelRegistry;
        cwd: string;
        sessionManager?: SessionManager;
      } = {
        authStorage: globalAuthStorage,
        modelRegistry: globalModelRegistry,
        cwd
      };

      if (opts.mode === 'open') {
        const { sessionPath } = opts;
        if (!sessionPath.endsWith('/') && path.extname(sessionPath) !== '') {
          // looks like a file — good
        } else {
          console.warn(`[initSession] sessionPath looks like a directory: ${sessionPath}`);
        }
        config.sessionManager = SessionManager.open(sessionPath);
      } else if (opts.mode === 'new') {
        config.sessionManager = SessionManager.create(cwd);
      } else {
        config.sessionManager = SessionManager.continueRecent(cwd);
      }

      const { session } = await createAgentSession(config);
      const sessionId = session.sessionManager.getSessionId();
      sessionMap.set(sessionId, session);

      broadcastSubscription(sessionId);
      return session;
  } catch (error) {
    console.error("Failed to initialize Pi Agent Session:", error);
    throw error;
  }
}
```

**Step 2: Update all 5 call sites**

| Location | Old call | New call |
|---|---|---|
| `/api/sessions/load` line ~286 | `initSession(process.cwd(), sessionPath)` | `initSession({ mode: 'open', sessionPath })` |
| `/api/project POST` line ~322 | `initSession(projectPath, null, true)` | `initSession({ mode: 'new', cwd: projectPath })` |
| `wss.on('connection')` line ~342 | `initSession()` | `initSession({ mode: 'continue' })` |
| `NEW_CHAT` handler line ~377 | `initSession(data.cwd \|\| process.cwd(), null, true)` | `initSession({ mode: 'new', cwd: data.cwd ?? process.cwd() })` |
| fallback line ~393 | `initSession()` | `initSession({ mode: 'continue' })` |

**Step 3: Type-check**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme && npx tsc -p tsconfig.sidecar.json --noEmit
```

Expected: zero errors.

---

### Task 3: Improve fire-and-forget error handling in `/api/project` + add WS connection limit

**Files:**
- Modify: `sidecar/server.ts`

**Step 1: Add WS connection limit constant**

Near the top of `server.ts`, after the `clients` set declaration, add:

```ts
const MAX_WS_CONNECTIONS = 50;
```

**Step 2: Enforce the limit in the connection handler**

Find `wss.on('connection', async (ws: WebSocket) => {` and add a guard at the very top of the handler, before `clients.add(client)`:

```ts
wss.on('connection', async (ws: WebSocket) => {
  if (clients.size >= MAX_WS_CONNECTIONS) {
    ws.close(1013, 'Too many connections');
    return;
  }
  const client: ClientRecord = { ws, subscriber: null };
  clients.add(client);
  // ... rest unchanged
```

**Step 3: Improve `/api/project` fire-and-forget error handling**

Find the `/api/project POST` handler (around line 314). The current fire-and-forget line is:
```ts
session.prompt(`I have selected the folder "${projectPath}" as my project root. Please use this as my context.`).catch(console.error);
```

Replace with a helper that broadcasts errors to subscribed WS clients:
```ts
// Abort any in-flight work on the new session before firing the auto-prompt
session.agent.abort();

const autoPromptSessionId = newSessionId;
session.prompt(
  `I have selected the folder "${projectPath}" as my project root. Please use this as my context.`
).catch((err: unknown) => {
  console.error('[auto-prompt] failed:', err);
  const errMsg = err instanceof Error ? err.message : String(err);
  for (const client of clients) {
    if (client.sessionId === autoPromptSessionId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: `Auto-prompt failed: ${errMsg}` }));
    }
  }
});
```

Note: `session.agent.abort()` before the prompt cancels any SDK-level in-flight work on this freshly-created session (which is a no-op if nothing is running, but is safe to call).

**Step 4: Type-check**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme && npx tsc -p tsconfig.sidecar.json --noEmit
```

Expected: zero errors.

**Step 5: Smoke-test the sidecar starts**

```bash
cd /Users/ravi/Documents/Dev/workwithme/workwithme/sidecar && npm start
```

Expected: `WorkWithMe Sidecar running on http://localhost:4242`
Kill with Ctrl+C.
