# Sandbox Runtime Integration Design

**Date:** 2026-03-17
**Status:** Approved
**Scope:** Sidecar (`sidecar/`), frontend banner (`src/App.tsx`)

## Attribution

This integration is built on top of the [Anthropic Sandbox Runtime](https://github.com/anthropic-experimental/sandbox-runtime) (`@anthropic-ai/sandbox-runtime`), an open-source OS-level sandboxing tool developed by Anthropic for safer AI agent execution. It uses macOS Seatbelt and Linux bubblewrap under the hood.

---

## Overview

workwithme's AI agent executes shell commands and spawns MCP servers on the user's machine. Without restrictions, a compromised or misbehaving agent could read sensitive files (SSH keys, credentials), write outside the project, or exfiltrate data over the network.

This design adds two-layer sandboxing:

1. **Agent tool execution** — bash commands the agent runs are wrapped with filesystem and network restrictions.
2. **MCP servers** — third-party MCP servers loaded via `pi-mcp-adapter` are sandboxed more tightly than agent tools, since they are untrusted external code.

Both layers use OS-level primitives (no containers required) via the sandbox runtime library.

> **Why both layers?** Effective sandboxing requires filesystem _and_ network isolation together. Without network isolation, an agent can exfiltrate sensitive files even if filesystem writes are blocked. Without filesystem isolation, a compromised agent can backdoor system resources to regain network access.

---

## Architecture

```
sidecar/
  sandbox/
    SandboxService.ts      — core: platform detection, config loading, BashOperations factory, mcp.json generation
    profiles.ts            — default filesystem/network profiles for 'agent' and 'mcp' tiers
  extensions/
    sandbox-tools.ts       — Pi extension: wraps agent bash tool calls via user_bash + escape hatch
  server.ts                — modified: async bootstrap before server.listen(), /api/sandbox/status

workwithme.settings.json   — project-root config: sandbox rules (committed to git)
mcp.json                   — user's MCP server definitions (committed to git, standard pi-mcp-adapter format)
.pi/mcp.json               — generated at startup from mcp.json + sandbox rules (gitignored)

src/
  App.tsx                  — modified: sandbox status fetch + banner
  types.ts                 — modified: adds SANDBOX_APPROVAL_REQUEST / SANDBOX_APPROVAL_RESPONSE WS events
```

---

## Startup Sequence

`server.ts` requires a top-level async bootstrap that runs before `server.listen()`:

```typescript
async function bootstrap(): Promise<void> {
  await SandboxService.initialize();        // platform detection, load config, SandboxManager.initialize()
  await SandboxService.generateMcpConfig(); // write .pi/mcp.json
}

bootstrap()
  .catch(err => console.error('[bootstrap] Sandbox init failed (continuing without sandboxing):', err))
  .finally(() => {
    server.listen(PORT, () => console.log(`WorkWithMe Sidecar running on http://localhost:${PORT}`));
  });
```

Both functions use `process.cwd()` (fixed for the sidecar lifetime), consistent with how `pi-mcp-adapter` resolves `.pi/mcp.json`. MCP sandbox config is **process-scoped** — changing the project via `POST /api/project` does not re-generate MCP config.

> **Singleton note:** `SandboxManager.initialize()` must be called only once per process. `sandbox-tools.ts` must not be used alongside the standalone pi sandbox extension, which also calls `SandboxManager.initialize()`.

---

## Configuration

### `workwithme.settings.json`

Single settings file at `process.cwd()`. Committed to git.

```json
{
  "sandbox": {
    "agent": {
      "filesystem": {
        "denyRead": ["~/.ssh", "~/.aws", "~/.gnupg"],
        "allowWrite": [".", "/tmp"],
        "denyWrite": [".env", ".env.*", "*.pem", "*.key"]
      },
      "network": {
        "allowedDomains": [
          "api.anthropic.com",
          "github.com",
          "api.github.com",
          "raw.githubusercontent.com",
          "registry.npmjs.org",
          "pypi.org",
          "files.pythonhosted.org"
        ],
        "deniedDomains": []
      }
    },
    "mcp": {
      "defaults": {
        "filesystem": {
          "denyRead": ["~/.ssh", "~/.aws", "~/.gnupg", "~/.config"],
          "allowWrite": ["."],
          "denyWrite": [".env", ".env.*", "*.pem", "*.key"]
        },
        "network": {
          "allowedDomains": [],
          "deniedDomains": []
        }
      },
      "perServer": {
        "github": {
          "network": { "allowedDomains": ["api.github.com", "raw.githubusercontent.com"] }
        }
      }
    }
  }
}
```

**`perServer` merge semantics:** A `perServer` entry is object-spread merged with `defaults` at the section level (`network`, `filesystem`). This means specifying `network` in a `perServer` entry replaces the entire `defaults.network` object — `allowedDomains` arrays are **not** unioned. To extend the defaults, repeat any needed values explicitly.

**Path prefix conventions** (validate against installed version at implementation time):

| Prefix | Meaning | Example |
|--------|---------|---------|
| `~/` | Home directory relative | `~/.ssh` → `$HOME/.ssh` |
| `.` | Relative to cwd | `.` → project cwd |
| `/tmp` | Absolute path | `/tmp` |

---

## SandboxService

`sidecar/sandbox/SandboxService.ts`:

```typescript
/**
 * SandboxService coordinates OS-level sandboxing for agent tool execution
 * and MCP server spawning. Built on @anthropic-ai/sandbox-runtime.
 *
 * Supported: macOS (sandbox-exec/Seatbelt), Linux (bubblewrap)
 * Unsupported: Windows — all methods are no-ops, isSupported returns false
 *
 * Must be initialized once before server.listen(). Do NOT combine with the
 * standalone pi sandbox extension — both call SandboxManager.initialize()
 * and only one can be active per process.
 */
class SandboxService {
  /**
   * Detect platform, load workwithme.settings.json from process.cwd(),
   * call SandboxManager.initialize(). Sets isSupported = false on failure.
   * Never throws.
   */
  static async initialize(): Promise<void>

  /**
   * Create a BashOperations object that wraps commands via SandboxManager.wrapWithSandbox().
   * Used as the `operations` value in the user_bash return.
   * Returns null on unsupported platforms (caller should return undefined from user_bash).
   *
   * @param profile - 'agent' for loose profile, 'mcp' for tight profile
   * @param serverName - When profile is 'mcp', selects per-server config overrides
   */
  static createSandboxedBashOps(
    profile: 'agent' | 'mcp',
    serverName?: string
  ): BashOperations | null

  /**
   * Generate .pi/mcp.json from mcp.json + sandbox MCP rules.
   * Always overwrites any existing .pi/mcp.json.
   * Stdio servers get srt-wrapped commands; HTTP servers pass through unchanged.
   */
  static async generateMcpConfig(): Promise<void>

  /** True if SandboxManager.initialize() succeeded (macOS/Linux with bubblewrap). */
  static get isSupported(): boolean

  /** True if `srt` CLI binary is available in PATH. Required for MCP wrapping. */
  static get srtAvailable(): boolean
}
```

`sidecar/sandbox/profiles.ts` exports default agent and MCP profiles as fallbacks when `workwithme.settings.json` is absent or incomplete.

---

## Pi Extension: `sandbox-tools.ts`

Registered in `initSession()` alongside the existing extensions.

### `user_bash` — command wrapping

The `user_bash` event intercepts bash execution. Returning `{ operations: BashOperations }` replaces default execution with the sandboxed version. `BashOperations` is an object with an `exec(command, cwd, { onData, signal, timeout })` method that calls `SandboxManager.wrapWithSandbox(command)` internally.

```typescript
pi.on('user_bash', (event) => {
  // On approved bypass: skip sandboxing for this one execution
  if (approvedBypasses.has(/* pending bypass id for this session */)) {
    approvedBypasses.delete(/* id */);
    return; // undefined → SDK uses default bash execution
  }

  if (!SandboxService.isSupported) return; // Windows / uninitialized → default execution

  const ops = SandboxService.createSandboxedBashOps('agent');
  if (!ops) return;
  return { operations: ops };
});
```

Inside `createSandboxedBashOps`, the `exec` method:
1. Checks that cwd exists
2. Calls `SandboxManager.wrapWithSandbox(command)` to get the sandboxed command string
3. Spawns `bash -c <wrappedCommand>` with piped stdio, respecting `signal` and `timeout`
4. Returns `{ exitCode }` on completion

This pattern mirrors the reference implementation at `pi-mono-ref/packages/coding-agent/examples/extensions/sandbox/index.ts`.

### `tool_result` — sandbox violation detection

Detects sandbox blocks in tool output using platform-specific patterns:

**macOS (Seatbelt / sandbox-exec):**
- `Operation not permitted` in stderr
- `Sandbox: deny` in stderr
- `sandbox-exec:` prefix in stderr

**Linux (bubblewrap):**
- `bwrap: Can't` prefix in stderr
- `Permission denied` with non-zero exit code from a bubblewrap-spawned process

> **Implementation note:** Check whether `@anthropic-ai/sandbox-runtime` exposes structured violation signals (specific exit code or JSON output on stderr). Prefer structured detection over string matching if available.

When a violation is detected, the extension appends to the tool result (so the agent sees it):

```
[SANDBOX] This command was blocked by the sandbox.
To run it outside the sandbox, use /sandbox-allow <your reason>.
You will need to confirm this in the workwithme UI before it executes.
```

### Escape hatch: `/sandbox-allow` + WebSocket approval

`ctx.ui.confirm()` is a no-op in sidecar (headless/RPC) mode. The escape hatch routes through the existing WebSocket channel instead.

**State in `sandbox-tools.ts` module scope:**

```typescript
interface PendingApproval {
  command: string;   // original (unwrapped) command
  reason: string;    // agent-provided justification
  sessionId: string;
  timer: NodeJS.Timeout;
}
// Keyed by approvalId (UUID); represents waiting-for-UI approvals
const pendingApprovals = new Map<string, PendingApproval>();

// Single-use approvalIds that have been approved by the user.
// Checked at the top of the user_bash handler; cleared after use.
const approvedBypasses = new Set<string>();
```

**Flow:**

1. Violation detected in `tool_result` → generate `approvalId` (UUID), store in `pendingApprovals`, start 30s timer
2. Agent calls `/sandbox-allow <reason>` (slash command registered by the extension)
3. Extension looks up the most recent pending approval for this session, sends:
   ```
   WS_EVENTS.SANDBOX_APPROVAL_REQUEST (Server → Client)
   { "approvalId": "...", "command": "...", "reason": "..." }
   ```
4. Frontend shows a confirmation modal with the command and reason
5. User responds:
   ```
   WS_EVENTS.SANDBOX_APPROVAL_RESPONSE (Client → Server)
   { "approvalId": "...", "approved": true | false }
   ```
6. **If approved:** Add `approvalId` to `approvedBypasses`. Tell the agent to retry the command — the follow-up message reads: `"Approved. Please retry the command now."` On the agent's next bash call, the `user_bash` handler finds the `approvalId` in `approvedBypasses`, clears it, and returns `undefined` (default unsandboxed execution).
7. **If denied or 30s timeout:** Remove from `pendingApprovals`, send the agent: `"Sandbox bypass denied. The command will not run."`

**Bypass lifecycle:** Each `approvalId` is consumed on use. The same command blocked again in a later turn generates a new `approvalId` and requires fresh approval.

---

## MCP Server Wrapping

### Source of truth

| File | Purpose | Committed? |
|------|---------|------------|
| `mcp.json` | User-maintained server definitions (standard pi-mcp-adapter format) | Yes |
| `workwithme.settings.json` | Sandbox rules per server | Yes |
| `.pi/mcp.json` | Generated at startup — do not edit manually | No (gitignored) |

**`.gitignore`:** Add `.pi/mcp.json` to the project `.gitignore` as part of this implementation (not deferred to README). The file contains process-scoped paths (`/tmp/workwithme-mcp-<name>-<pid>.json`) that are meaningless across machines.

**Migration note:** If `.pi/mcp.json` already exists (from prior direct use of `pi-mcp-adapter`), it will be overwritten at sidecar startup. Move any custom server definitions to `mcp.json` before enabling this integration.

### `generateMcpConfig()` logic

1. Read `mcp.json` from `process.cwd()`
2. At startup: glob `/tmp/workwithme-mcp-*.json` and remove any whose PID (extracted from filename) does not correspond to a running process — handles stale files from crashed or renamed-server runs
3. For each server with a `command` (stdio transport):
   - Object-spread merge `sandbox.mcp.defaults` with `sandbox.mcp.perServer[name]` overrides (arrays replaced, not merged)
   - Write per-server settings file to `/tmp/workwithme-mcp-<serverName>-<pid>.json`
   - Rewrite the entry: `command: "srt"`, `args: ["--settings", "<tmpfile>", originalCommand, ...originalArgs]`
4. HTTP servers (`url`-based) pass through unchanged
5. Always overwrite `.pi/mcp.json`
6. Register cleanup:
   ```typescript
   const tmpFiles: string[] = [...]; // tracked at generation time
   const cleanup = () => { tmpFiles.forEach(f => { try { fs.unlinkSync(f) } catch {} }); };
   process.on('exit', cleanup);
   process.on('SIGTERM', () => { cleanup(); process.exit(0); });
   process.on('SIGINT',  () => { cleanup(); process.exit(0); });
   ```

**When `srt` unavailable:** Skip config generation. `.pi/mcp.json` is not written. `pi-mcp-adapter` finds no project-local config → MCP servers are unavailable. Warning logged and surfaced in `/api/sandbox/status`.

**`SandboxManager.reset()`:** Called from a `session_shutdown` hook in `sandbox-tools.ts` to clean up the sandbox runtime after each session. This mirrors the reference implementation.

---

## Status API + UI Banner

### `GET /api/sandbox/status`

New endpoint in `server.ts`. Unauthenticated (consistent with rest of sidecar; localhost-only).

```typescript
interface SandboxStatus {
  supported: boolean;    // SandboxManager.initialize() succeeded
  srtAvailable: boolean; // srt CLI found in PATH (needed for MCP + command wrapping)
  active: boolean;       // supported && srtAvailable
  platform: string;      // process.platform
  warning: string | null;
}
```

> **Note on `srtAvailable` and agent sandboxing:** `SandboxManager.wrapWithSandbox()` calls `srt` internally. If `srt` is not in PATH, `isSupported` may be true (the runtime initialized) but command wrapping will fail at execution time. When `srtAvailable` is false, both agent tool sandboxing and MCP sandboxing are disabled. `active` captures both conditions.

Example — fully active:
```json
{ "supported": true, "srtAvailable": true, "active": true, "platform": "darwin", "warning": null }
```

Example — `srt` not installed:
```json
{
  "supported": true, "srtAvailable": false, "active": false, "platform": "linux",
  "warning": "srt is not installed. Sandboxing is disabled. Install: npm install -g @anthropic-ai/sandbox-runtime"
}
```

Example — Windows:
```json
{
  "supported": false, "srtAvailable": false, "active": false, "platform": "win32",
  "warning": "Sandboxing is not supported on Windows. The agent and MCP servers run without restrictions."
}
```

### UI banner

`App.tsx` fetches `/api/sandbox/status` on mount. If `active` is `false`, shows a dismissible amber banner with the `warning` string and a link to the sandbox-runtime repo. App remains fully functional.

---

## New WebSocket Events (`src/types.ts`)

Added to the `WS_EVENTS` constant:

```typescript
// Server → Client: sidecar requests user approval to run a command outside the sandbox
SANDBOX_APPROVAL_REQUEST: 'sandbox_approval_request',

// Client → Server: user's response to a sandbox approval request
SANDBOX_APPROVAL_RESPONSE: 'sandbox_approval_response',
```

---

## Platform Support

| Platform | Sandbox runtime | `srt` CLI | Notes |
|----------|----------------|-----------|-------|
| macOS | Supported | Supported | Works out of the box |
| Linux | Supported | Supported | Requires `bubblewrap socat` (`apt-get install bubblewrap socat`) |
| Windows | Not supported | Not supported | UI warning; app fully functional |

On Linux, if bubblewrap is missing, `SandboxManager.initialize()` throws. `SandboxService` catches this, sets `isSupported = false`, and continues.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `workwithme.settings.json` missing | Use default profiles from `profiles.ts`; log info |
| `mcp.json` missing | Skip MCP generation; MCP servers unavailable; log warning |
| `SandboxManager.initialize()` throws | `isSupported = false`; continue without sandboxing |
| `srt` not in PATH | `srtAvailable = false`; skip MCP generation; agent sandboxing disabled |
| `.pi/mcp.json` write fails | Log error; MCP servers unavailable (pi-mcp-adapter finds no project config) |
| Sandbox blocks agent command | Escape hatch offered; agent instructed to retry after UI approval |
| WS approval times out (30s) | Cancel pending approval; agent receives denial message |
| Sidecar exits (SIGTERM/SIGINT) | Synchronous `fs.unlinkSync` removes tmp MCP settings files |
| SIGKILL / crash | Stale files cleaned up at next startup by PID-validity check |

---

## Security Notes

- **Both layers required together.** Filesystem restrictions alone allow network exfiltration. Network restrictions alone allow filesystem backdooring.
- **Arrays in `perServer` overrides replace defaults** (not merge). Explicitly repeat any needed domains from defaults if combining with per-server additions.
- **Do not allowlist unix sockets** — `/var/run/docker.sock` and similar bypass the sandbox.
- **Escape hatch is always explicit.** Every unsandboxed execution requires a visible UI confirmation. There is no silent bypass path.
- **Bypass is single-use.** Each `approvalId` is consumed on use; re-blocking the same command requires fresh approval.
- **MCP config is process-scoped.** Changing the project directory in the UI does not change MCP sandbox rules.

---

## Open Source Credit

The sandboxing primitives in this integration are provided by:

**[@anthropic-ai/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)**
An open-source sandbox runtime developed by Anthropic for safer AI agent execution. Licensed under MIT.

---

## Files Changed

| File | Change |
|------|--------|
| `sidecar/sandbox/SandboxService.ts` | New |
| `sidecar/sandbox/profiles.ts` | New |
| `sidecar/extensions/sandbox-tools.ts` | New |
| `sidecar/server.ts` | Modified: async bootstrap before `server.listen()`, `/api/sandbox/status` endpoint |
| `sidecar/package.json` | Modified: add `@anthropic-ai/sandbox-runtime@^0.0.26` |
| `workwithme.settings.json` | New (project root) |
| `mcp.json` | New (project root, user-maintained) |
| `.gitignore` | Modified: add `.pi/mcp.json` |
| `src/types.ts` | Modified: add `SANDBOX_APPROVAL_REQUEST`, `SANDBOX_APPROVAL_RESPONSE` to `WS_EVENTS` |
| `src/App.tsx` | Modified: fetch `/api/sandbox/status` on mount, render sandbox warning banner |
