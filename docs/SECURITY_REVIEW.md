# Security Review & VAPT Findings
### WorkWithMe Desktop Application
**Review Date:** 2026-03-20
**Scope:** SOC Type 2 readiness, code security review, vulnerability assessment
**Application:** WorkWithMe v0.1.x — Tauri v2 + React 19 + Node.js sidecar

---

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| HIGH | 4 |
| MEDIUM | 5 |
| LOW | 4 |
| **Total** | **16** |

**Overall Posture:** Medium-High for single-user local deployment. The application has strong foundations (OS keychain credential storage, sandbox runtime for agent execution) but has critical gaps in network binding and input validation that must be addressed before any broader distribution.

---

## Threat Model

WorkWithMe is a **single-user local desktop application**. The trust model assumes:
- The OS user running the app is the sole authorized user
- The local machine is not shared with hostile users
- Network access to localhost is not available to untrusted parties

Several findings below violate these assumptions and must be fixed to preserve the threat model.

---

## Findings

---

### [CRIT-01] Sidecar Server Binds to All Network Interfaces

**Severity:** CRITICAL
**Category:** CWE-923: Improper Restriction of Communication Channel
**File:** `sidecar/server.ts`
**OWASP:** A05:2021 – Security Misconfiguration

**Description:**
The sidecar Express server calls `server.listen(PORT)` without specifying a hostname. Node.js/Express defaults to `0.0.0.0` (all interfaces), making the server accessible from any machine on the same network — not just localhost.

**Impact:**
- Any machine on the local network can call all API endpoints
- No authentication exists on any endpoint
- Credentials, sessions, agent execution, and working directory are all exposed
- An attacker on the same Wi-Fi can: read/save API keys, run agent commands, change the working directory

**Evidence:**
```typescript
// sidecar/server.ts
server.listen(PORT, () => {
  console.log(`WorkWithMe Sidecar running on port ${PORT}`);
});
// Missing: second argument '127.0.0.1'
```

**Remediation:**
```typescript
server.listen(PORT, '127.0.0.1', () => {
  console.log(`WorkWithMe Sidecar running on http://localhost:${PORT}`);
});
```

Also update `src-tauri/src/lib.rs` to check `127.0.0.1:4242` in `is_port_bound()`.

---

### [CRIT-02] No Path Validation on Working Directory Change

**Severity:** CRITICAL
**Category:** CWE-22: Path Traversal
**File:** `sidecar/server.ts` — `POST /api/project`
**OWASP:** A03:2021 – Injection

**Description:**
The `POST /api/project` endpoint accepts an arbitrary filesystem path and uses it directly as the agent's working directory. There is no validation that the path is within the user's home directory, that it exists, or that it is a directory.

**Impact:**
- Agent can be pointed at `/`, `/etc`, `/root`, or any sensitive system directory
- Combined with agent bash execution, this enables reading/modifying system files
- Bypasses sandbox filesystem restrictions (sandbox policies are relative to the project path)

**Evidence:**
```typescript
app.post('/api/project', async (req: Request, res: Response) => {
  const { path: projectPath } = req.body as { path?: string; sessionId?: string };
  if (!projectPath) { res.status(400).json({ error: "Missing path" }); return; }
  // No further validation — projectPath used directly
  await session.setProjectPath(projectPath);
});
```

**Remediation:**
```typescript
import path from 'path';
import os from 'os';
import fs from 'fs';

app.post('/api/project', async (req: Request, res: Response) => {
  const { path: projectPath } = req.body as { path?: string; sessionId?: string };
  if (!projectPath) { res.status(400).json({ error: "Missing path" }); return; }

  const resolved = path.resolve(projectPath);
  const homeDir = os.homedir();

  if (!resolved.startsWith(homeDir)) {
    res.status(400).json({ error: "Path must be within home directory" });
    return;
  }

  try {
    if (!fs.statSync(resolved).isDirectory()) {
      res.status(400).json({ error: "Path is not a directory" });
      return;
    }
  } catch {
    res.status(400).json({ error: "Path does not exist" });
    return;
  }

  await session.setProjectPath(resolved);
  // ...
});
```

---

### [CRIT-03] No Path Validation on Session Loading

**Severity:** CRITICAL
**Category:** CWE-22: Path Traversal
**File:** `sidecar/server.ts` — `POST /api/sessions/load`
**OWASP:** A03:2021 – Injection

**Description:**
The `POST /api/sessions/load` endpoint accepts a `path` parameter and passes it directly to `SessionManager.open()`. There is no validation that the path is within the expected sessions directory.

**Impact:**
- Could load arbitrary files from the filesystem as sessions
- Could be used to probe filesystem structure
- May leak contents of sensitive files that are parseable as session format

**Evidence:**
```typescript
app.post('/api/sessions/load', async (req: Request, res: Response) => {
  const { path: sessionPath } = req.body as { path?: string };
  if (!sessionPath) { res.status(400).json({ error: "Missing session path" }); return; }
  // No validation — used directly
  await SessionManager.open(sessionPath);
});
```

**Remediation:**
```typescript
app.post('/api/sessions/load', async (req: Request, res: Response) => {
  const { path: sessionPath } = req.body as { path?: string };
  if (!sessionPath) { res.status(400).json({ error: "Missing session path" }); return; }

  const sessionDir = path.join(os.homedir(), '.pi', 'sessions');
  const resolved = path.resolve(sessionPath);

  if (!resolved.startsWith(sessionDir)) {
    res.status(400).json({ error: "Invalid session path" });
    return;
  }

  await SessionManager.open(resolved);
  // ...
});
```

---

### [HIGH-01] CORS Configured to Allow All Origins

**Severity:** HIGH
**Category:** CWE-942: Permissive CORS Policy
**File:** `sidecar/server.ts`
**OWASP:** A05:2021 – Security Misconfiguration

**Description:**
The Express server uses `app.use(cors())` with no configuration, which allows cross-origin requests from any origin. While the server is localhost-only (once CRIT-01 is fixed), this still enables a malicious web page open in the user's browser to call all API endpoints.

**Impact:**
- Browser-based CSRF: a malicious site visited while WorkWithMe is running can call any API
- Can read/modify API keys, trigger agent execution, change working directory
- Can intercept session data via cross-origin requests

**Evidence:**
```typescript
app.use(cors()); // No origin restriction
```

**Remediation:**
```typescript
app.use(cors({
  origin: ['http://localhost:1420', 'http://127.0.0.1:1420'],
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type'],
  credentials: false
}));
```

The Tauri frontend origin is `http://localhost:1420`.

---

### [HIGH-02] No Rate Limiting on WebSocket

**Severity:** HIGH
**Category:** CWE-770: Allocation Without Limits
**File:** `sidecar/server.ts` — WebSocket handler
**OWASP:** A04:2021 – Insecure Design

**Description:**
The WebSocket server accepts messages from connected clients without any rate limiting. This allows a connected client (or malicious page via CSRF) to flood the server with messages, causing resource exhaustion or triggering expensive LLM API calls at the user's expense.

**Impact:**
- Denial of Service: server resource exhaustion
- Financial abuse: repeated LLM API calls charged to user's API key
- Agent loop flooding: repeated prompt injection attempts

**Remediation:**
```typescript
interface ClientRateLimit { count: number; resetAt: number; }
const clientLimits = new Map<WebSocket, ClientRateLimit>();
const MAX_MESSAGES_PER_SECOND = 10;

ws.on('message', (message: Buffer) => {
  const now = Date.now();
  let limit = clientLimits.get(ws) ?? { count: 0, resetAt: now + 1000 };
  if (now > limit.resetAt) limit = { count: 0, resetAt: now + 1000 };

  if (++limit.count > MAX_MESSAGES_PER_SECOND) {
    ws.close(1008, 'Rate limit exceeded');
    return;
  }

  clientLimits.set(ws, limit);
  // handle message...
});

ws.on('close', () => clientLimits.delete(ws));
```

---

### [HIGH-03] No Agent Sandboxing on Windows

**Severity:** HIGH  **Status: ✅ RESOLVED**
**Category:** CWE-269: Improper Privilege Management
**File:** `sidecar/sandbox/SandboxService.ts`
**OWASP:** A04:2021 – Insecure Design

**Description:**
The sandbox runtime (which prevents the agent from reading SSH keys, AWS credentials, .env files, etc.) is only implemented for macOS (Seatbelt) and Linux (bubblewrap). Windows users have no sandbox protection — the agent can execute any bash command without restriction.

**Resolution:**
`SandboxService.ts` already sets `_warning = 'Sandboxing is not supported on Windows. The agent and MCP servers run without restrictions.'` when `platform === 'win32'` and `isSupported = false`. This warning is surfaced via the `/api/sandbox/status` endpoint and displayed as a dismissible banner in `App.tsx` whenever `sandboxStatus.active` is false. The warning is prominent and accurate.

---

### [HIGH-04] No WebSocket Message Schema Validation

**Severity:** HIGH
**Category:** CWE-20: Improper Input Validation
**File:** `sidecar/server.ts` — WebSocket message handler
**OWASP:** A03:2021 – Injection

**Description:**
WebSocket messages are parsed as JSON and dispatched based on `type`, but message payloads are not validated against a schema. Unexpected fields, oversized payloads, or malformed data can reach the agent execution layer without validation.

**Impact:**
- Unexpected data could cause unhandled exceptions in agent execution
- No size limits on message content (a large prompt could be injected)
- Type confusion attacks possible if downstream code assumes field types

**Remediation:**
```typescript
import { Type, Static } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';

const PromptMessage = Type.Object({
  type: Type.Literal('prompt'),
  sessionId: Type.Optional(Type.String({ maxLength: 64 })),
  text: Type.String({ maxLength: 50000 }),
});

const PromptMessageChecker = TypeCompiler.Compile(PromptMessage);

ws.on('message', (message: Buffer) => {
  if (message.length > 100_000) {
    ws.close(1009, 'Message too large');
    return;
  }

  let data: unknown;
  try { data = JSON.parse(message.toString()); }
  catch { ws.send(JSON.stringify({ error: 'Invalid JSON' })); return; }

  if (data.type === 'prompt' && !PromptMessageChecker.Check(data)) {
    ws.send(JSON.stringify({ error: 'Invalid message format' }));
    return;
  }
  // handle...
});
```

---

### [MED-01] Shell Injection Risk in Windows Keychain via PowerShell String Interpolation

**Severity:** MEDIUM
**Category:** CWE-78: OS Command Injection
**File:** `sidecar/keychain.ts` — Windows implementation
**OWASP:** A03:2021 – Injection

**Description:**
On Windows, the keychain module constructs PowerShell scripts by interpolating account strings directly into the script body using template literals. If the `account` string contains single quotes or PowerShell metacharacters, it could inject additional commands.

**Evidence:**
```typescript
const script = `
  Add-Type -AssemblyName System.Security;
  $vault = New-Object Windows.Security.Credentials.PasswordVault;
  try { $cred = $vault.Retrieve('${SERVICE}', '${account}'); ... }
`;
```

**Current Mitigations:**
The API validates slug names before calling keychain functions (`/[^a-z0-9_-]/i` regex), which currently prevents exploitation. This is fragile — any new caller that skips validation could introduce injection.

**Remediation:**
```typescript
function escapePSString(s: string): string {
  return s.replace(/'/g, "''");
}

// Use escaped values:
const script = `... $vault.Retrieve('${SERVICE}', '${escapePSString(account)}') ...`;
```

Or, preferably, use PowerShell parameter passing via `-EncodedCommand` to avoid interpolation entirely.

---

### [MED-02] No Request Size Limits on REST Endpoints

**Severity:** MEDIUM
**Category:** CWE-770: Allocation Without Limits
**File:** `sidecar/server.ts`
**OWASP:** A04:2021 – Insecure Design

**Description:**
The Express JSON body parser is configured without an explicit size limit. Express's default is 100kb, but this is not enforced explicitly and may change across versions. Large payloads can cause memory pressure.

**Remediation:**
```typescript
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
```

---

### [MED-03] CSP Disabled in Tauri Configuration

**Severity:** MEDIUM
**Category:** CWE-79: Cross-Site Scripting
**File:** `src-tauri/tauri.conf.json`
**OWASP:** A03:2021 – Injection

**Description:**
The Tauri app sets `"csp": null`, disabling Content Security Policy entirely. While Tauri's WebView provides some isolation, disabling CSP removes a defense-in-depth layer against XSS.

**Evidence:**
```json
"security": {
  "csp": null
}
```

**Remediation:**
```json
"security": {
  "csp": "default-src 'self'; connect-src 'self' ws://localhost:4242 http://localhost:4242; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:"
}
```

Note: `'unsafe-inline'` for styles may be needed for Tailwind CSS. Audit inline script usage before enabling strict CSP.

---

### [MED-04] No Dependency Vulnerability Scanning in CI

**Severity:** MEDIUM
**Category:** CWE-1035: OWASP A6 – Vulnerable and Outdated Components
**File:** `.github/workflows/ci.yml`
**OWASP:** A06:2021 – Vulnerable and Outdated Components

**Description:**
The CI pipeline runs type checks and builds but does not run `pnpm audit` to check for known vulnerabilities in dependencies. A compromised or vulnerable dependency (especially in the agent execution chain) could be exploited without detection.

**Remediation:**
```yaml
# Add to ci.yml before build steps:
- name: Audit dependencies
  run: pnpm audit --audit-level=moderate
  working-directory: sidecar
```

---

### [MED-05] No Audit Logging for Sensitive Operations

**Severity:** MEDIUM
**Category:** CWE-778: Insufficient Logging
**SOC Type 2 Control:** CC7.2 – The entity monitors system components

**Description:**
No audit trail exists for sensitive operations: API key saves/deletions, session loads, sandbox approval/denial events, working directory changes, or OAuth flows. This prevents incident investigation and is a gap for SOC Type 2 CC7 (Monitoring) controls.

**Remediation:**
```typescript
// sidecar/audit.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

const AUDIT_LOG = path.join(os.homedir(), '.pi', 'audit.log');

export function auditLog(event: string, details: Record<string, unknown>): void {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...details,
  });
  fs.appendFileSync(AUDIT_LOG, entry + '\n');
}

// Usage examples:
auditLog('api_key_saved', { provider });
auditLog('session_loaded', { sessionPath });
auditLog('sandbox_approval', { approvalId, approved, reason });
auditLog('project_changed', { path: resolved });
```

---

### [LOW-01] XSS Risk in dangerouslySetInnerHTML (Future Risk)

**Severity:** LOW (currently)  **Status: ✅ RESOLVED**
**Category:** CWE-79: Cross-Site Scripting
**File:** `src/ConnectorsPage.tsx`
**OWASP:** A03:2021 – Injection

**Description:**
Connector logos are rendered using `dangerouslySetInnerHTML` with inline SVG content. Currently this is safe because all SVGs are hardcoded in `sidecar/connectors.ts`. If user-provided or remotely-fetched SVGs are ever introduced, this becomes a HIGH severity XSS vector.

**Resolution:**
Added `dompurify` (v3.3.3) to frontend dependencies. All SVG content is now sanitized with `DOMPurify.sanitize(entry.logoSvg, { USE_PROFILES: { svg: true } })` before rendering, preventing any SVG-based script injection regardless of SVG source.

---

### [LOW-02] OAuth Tokens Transmitted Without TLS

**Severity:** LOW
**Category:** CWE-319: Cleartext Transmission of Sensitive Information
**File:** `sidecar/server.ts` — `GET /api/auth/login`
**OWASP:** A02:2021 – Cryptographic Failures

**Description:**
The OAuth SSE stream returns authentication tokens over plain HTTP (`http://localhost:4242`). While localhost traffic is not normally network-accessible, this is plaintext and would be exposed if CRIT-01 is not fixed.

**Remediation:**
Fix CRIT-01 first (bind to 127.0.0.1). For defense-in-depth, consider whether localhost TLS is warranted for this application's threat model (typically not necessary for local-only apps).

---

### [LOW-03] No Signed Release Binaries

**Severity:** LOW  **Status: ⚠ PARTIAL**
**Category:** CWE-494: Download of Code Without Integrity Check
**File:** `.github/workflows/ci.yml`
**SOC Type 2 Control:** CC8.1 – Change management

**Description:**
GitHub Releases are published without code signing or SHA256 checksums. Users cannot verify the authenticity or integrity of downloaded binaries.

**Resolution:**
SHA256 checksum generation is now implemented in CI. After each platform's tag build, a `Generate and upload SHA256 checksums` step finds all installer artifacts (`.dmg`, `.AppImage`, `.deb`, `.msi`, `.exe`, `.app.tar.gz`), generates `SHA256SUMS-<OS>.txt`, and uploads it to the GitHub Release via `gh release upload --clobber`.

**Remaining:** Code signing (macOS Developer ID, Windows EV certificate) requires paid certificates and secrets configuration — deferred until pre-production release.

---

### [LOW-04] Hardcoded Port 4242 Without Collision Detection

**Severity:** LOW  **Status: ⚠ PARTIAL**
**Category:** CWE-605: Multiple Binds to the Same Port
**File:** `sidecar/server.ts`, `src-tauri/src/lib.rs`

**Description:**
Port 4242 is hardcoded across both the sidecar and the Tauri app. While `lib.rs` checks if the port is already bound before starting a new sidecar, there is no mechanism to use an alternate port if 4242 is occupied by another application, causing silent startup failure.

**Resolution:**
The WebSocket reconnect handler in `App.tsx` now shows a diagnostic message after 5 failed connection attempts (~31 seconds): *"Unable to reach the sidecar after several attempts. Port 4242 may be in use by another application. Try quitting and restarting WorkWithMe."* This converts the silent hang into a visible, actionable error.

**Remaining:** Full dynamic port selection (try 4242, fall back to next available) would require coordinating port discovery between the sidecar, Tauri's Rust layer, the frontend, and the Content Security Policy. Deferred as an architectural improvement.

---

## SOC Type 2 Control Gap Analysis

| Control Domain | Control | Status | Gap | Priority |
|----------------|---------|--------|-----|----------|
| CC6.1 | Logical access controls | ⚠ Partial | No authentication on API endpoints (intentional for local app, but undocumented) | Document threat model |
| CC6.6 | Logical access restrictions | ⚠ Partial | No rate limiting; endpoints accessible from network (CRIT-01) | Fix CRIT-01, HIGH-02 |
| CC6.7 | Transmission encryption | ⚠ Partial | Localhost HTTP (acceptable if bound to 127.0.0.1) | Fix CRIT-01 |
| CC6.8 | Vulnerability detection | ❌ Missing | No dependency scanning in CI | Fix MED-04 |
| CC7.1 | Infrastructure monitoring | ❌ Missing | No audit logging | Fix MED-05 |
| CC7.2 | Monitoring of system components | ❌ Missing | No security event logging | Fix MED-05 |
| CC7.3 | Incident evaluation | ❌ Missing | No audit trail for incident response | Fix MED-05 |
| CC8.1 | Change management | ⚠ Partial | CI/CD exists but no signed releases | Fix LOW-03 |
| CC9.2 | Vendor risk management | ⚠ Partial | Dependencies pinned but not audited | Fix MED-04 |
| A1.1 | Capacity management | ❌ Missing | No rate limiting, no request size limits | Fix HIGH-02, MED-02 |

---

## Remediation Roadmap

### Phase 1 — Immediate (before next release)

| ID | Finding | Effort |
|----|---------|--------|
| CRIT-01 | Bind sidecar to 127.0.0.1 | 5 min |
| CRIT-02 | Validate working directory path | 30 min |
| CRIT-03 | Validate session load path | 15 min |
| HIGH-01 | Restrict CORS to Tauri origin | 10 min |

### Phase 2 — Short-term (next sprint)

| ID | Finding | Effort |
|----|---------|--------|
| HIGH-02 | WebSocket rate limiting | 2 hrs |
| HIGH-04 | WebSocket message schema validation | 3 hrs |
| MED-02 | Express request size limits | 10 min |
| MED-04 | Add `pnpm audit` to CI | 15 min |
| MED-05 | Audit logging for sensitive operations | 4 hrs |

### Phase 3 — Medium-term

| ID | Finding | Effort |
|----|---------|--------|
| HIGH-03 | Windows sandbox warning/documentation | 2 hrs |
| MED-01 | Escape PowerShell strings in keychain | 30 min |
| MED-03 | Enable CSP in Tauri config | 2 hrs |
| LOW-01 | Add DOMPurify as preventive measure | 1 hr |
| LOW-03 | Signed release binaries | 1 day |
| LOW-04 | Dynamic port selection | 3 hrs |

---

## Appendix: Files Reviewed

**Tauri / Rust:**
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

**Frontend:**
- `src/App.tsx`
- `src/ConnectorsPage.tsx`
- `src/SettingsModal.tsx`
- `src/types.ts`
- `src/config.ts`

**Sidecar Backend:**
- `sidecar/server.ts`
- `sidecar/keychain.ts`
- `sidecar/skills.ts`
- `sidecar/connectors.ts`
- `sidecar/extensions/sandbox-tools.ts`
- `sidecar/extensions/claude-tool.ts`
- `sidecar/sandbox/SandboxService.ts`
- `sidecar/sandbox/profiles.ts`

**Config & Build:**
- `package.json`
- `mcp.json`
- `workwithme.settings.json`
- `.gitignore`
- `.github/workflows/ci.yml`
- `docs/architecture/sandbox-runtime.md`
