# Sandbox Runtime Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two-layer OS-level sandboxing to workwithme — wrapping agent bash tool execution and MCP server processes — using `@anthropic-ai/sandbox-runtime`.

**Architecture:** `SandboxService` (sidecar) reads `workwithme.settings.json`, initializes `SandboxManager` at process startup, and provides `BashOperations` to the `sandbox-tools` Pi extension (which hooks `user_bash`) and `srt`-wrapped commands for MCP servers via a generated `.pi/mcp.json`. A WebSocket escape hatch lets users approve unsandboxed execution per-command.

**Tech Stack:** `@anthropic-ai/sandbox-runtime@^0.0.26`, `@mariozechner/pi-coding-agent` (BashOperations, ExtensionAPI), vitest (testing), Node.js fs/child_process, React (UI banner).

**Spec:** `docs/architecture/sandbox-runtime.md`

**Reference implementation** (authoritative for SDK API shapes): `pi-mono-ref/packages/coding-agent/examples/extensions/sandbox/index.ts`

---

## Chunk 1: Foundation — test setup, package, types, profiles

### Task 1: Add vitest to sidecar

**Files:**
- Modify: `sidecar/package.json`
- Create: `sidecar/vitest.config.ts`

- [ ] **Step 1.1: Add vitest to devDependencies**

```bash
cd sidecar && npm install --save-dev vitest @vitest/coverage-v8
```

- [ ] **Step 1.2: Add test script to `sidecar/package.json`**

In `sidecar/package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 1.3: Create `sidecar/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
```

- [ ] **Step 1.4: Verify vitest runs**

```bash
cd sidecar && npm test
```
Expected: exits 0 with "No test files found" or similar (no tests yet).

---

### Task 2: Install `@anthropic-ai/sandbox-runtime`

**Files:**
- Modify: `sidecar/package.json`

- [ ] **Step 2.1: Install the package**

```bash
cd sidecar && npm install @anthropic-ai/sandbox-runtime@^0.0.26
```

- [ ] **Step 2.2: Verify the import resolves**

```bash
cd sidecar && node -e "import('@anthropic-ai/sandbox-runtime').then(m => console.log('OK', Object.keys(m)))"
```
Expected: prints `OK` with exported names including `SandboxManager`.

---

### Task 3: Add WS event constants to `src/types.ts`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 3.1: Add the two new events to `WS_EVENTS`**

In `src/types.ts`, add inside the `WS_EVENTS` object after the `ERROR` line:

```typescript
  // Server → Client: sidecar requests user approval to run a command outside the sandbox
  SANDBOX_APPROVAL_REQUEST: 'sandbox_approval_request',
  // Client → Server: user's response to a sandbox approval request
  SANDBOX_APPROVAL_RESPONSE: 'sandbox_approval_response',
```

- [ ] **Step 3.2: Verify TypeScript compiles**

```bash
cd workwithme && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3.3: Commit**

```bash
git add src/types.ts sidecar/package.json sidecar/package-lock.json sidecar/vitest.config.ts
git commit -m "feat: add vitest, sandbox-runtime dep, and sandbox WS event types"
```

---

### Task 4: Create `sidecar/sandbox/profiles.ts`

Default sandbox profiles used as fallbacks when `workwithme.settings.json` is absent or incomplete.

**Files:**
- Create: `sidecar/sandbox/profiles.ts`
- Create: `sidecar/sandbox/profiles.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `sidecar/sandbox/profiles.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { getAgentProfile, getMcpDefaultProfile, mergeWithProfile } from './profiles.js';

describe('getAgentProfile', () => {
  it('returns expected filesystem and network shape', () => {
    const p = getAgentProfile();
    expect(p.filesystem.denyRead).toContain('~/.ssh');
    expect(p.filesystem.allowWrite).toContain('.');
    expect(p.network.allowedDomains).toContain('api.anthropic.com');
  });
});

describe('getMcpDefaultProfile', () => {
  it('is tighter than agent — denies ~/.config', () => {
    const p = getMcpDefaultProfile();
    expect(p.filesystem.denyRead).toContain('~/.config');
    expect(p.network.allowedDomains).toHaveLength(0);
  });
});

describe('mergeWithProfile', () => {
  it('overrides network section when perServer entry provided', () => {
    const base = getMcpDefaultProfile();
    const result = mergeWithProfile(base, {
      network: { allowedDomains: ['api.example.com'], deniedDomains: [] }
    });
    expect(result.network.allowedDomains).toEqual(['api.example.com']);
    // filesystem is inherited from base
    expect(result.filesystem.denyRead).toContain('~/.config');
  });

  it('returns base unchanged when no overrides', () => {
    const base = getMcpDefaultProfile();
    const result = mergeWithProfile(base, {});
    expect(result).toEqual(base);
  });
});
```

- [ ] **Step 4.2: Run test — expect FAIL**

```bash
cd sidecar && npm test sandbox/profiles
```
Expected: FAIL — `Cannot find module './profiles.js'`

- [ ] **Step 4.3: Create `sidecar/sandbox/profiles.ts`**

```typescript
/**
 * Default sandbox profiles for agent tool execution and MCP servers.
 *
 * These are used as fallbacks when workwithme.settings.json is absent or
 * missing a section. The agent profile is intentionally loose (CWD writes,
 * broad reads, common dev network). The MCP profile is tight (CWD-only
 * writes, restricted reads, no network by default).
 *
 * Both filesystem and network restrictions are always applied together.
 * See: docs/architecture/sandbox-runtime.md
 */

import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';

export interface SandboxProfile {
  filesystem: NonNullable<SandboxRuntimeConfig['filesystem']>;
  network: NonNullable<SandboxRuntimeConfig['network']>;
}

/** Loose profile for agent bash tool execution */
export function getAgentProfile(): SandboxProfile {
  return {
    filesystem: {
      denyRead: ['~/.ssh', '~/.aws', '~/.gnupg'],
      allowWrite: ['.', '/tmp'],
      denyWrite: ['.env', '.env.*', '*.pem', '*.key'],
    },
    network: {
      allowedDomains: [
        'api.anthropic.com',
        'github.com',
        'api.github.com',
        'raw.githubusercontent.com',
        'registry.npmjs.org',
        'pypi.org',
        'files.pythonhosted.org',
      ],
      deniedDomains: [],
    },
  };
}

/** Tight profile for MCP server processes (default, no network) */
export function getMcpDefaultProfile(): SandboxProfile {
  return {
    filesystem: {
      denyRead: ['~/.ssh', '~/.aws', '~/.gnupg', '~/.config'],
      allowWrite: ['.'],
      denyWrite: ['.env', '.env.*', '*.pem', '*.key'],
    },
    network: {
      allowedDomains: [],
      deniedDomains: [],
    },
  };
}

/**
 * Object-spread merge a base profile with per-server overrides.
 * Arrays within a section are REPLACED (not merged/unioned) by the override.
 * Only top-level keys present in `overrides` replace their counterpart in `base`.
 */
export function mergeWithProfile(
  base: SandboxProfile,
  overrides: Partial<SandboxProfile>
): SandboxProfile {
  return {
    filesystem: overrides.filesystem
      ? { ...base.filesystem, ...overrides.filesystem }
      : base.filesystem,
    network: overrides.network
      ? { ...base.network, ...overrides.network }
      : base.network,
  };
}
```

- [ ] **Step 4.4: Run test — expect PASS**

```bash
cd sidecar && npm test sandbox/profiles
```
Expected: all 4 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add sidecar/sandbox/profiles.ts sidecar/sandbox/profiles.test.ts
git commit -m "feat: add sandbox default profiles with tests"
```

---

## Chunk 2: SandboxService

### Task 5: SandboxService — initialize, isSupported, srtAvailable

**Files:**
- Create: `sidecar/sandbox/SandboxService.ts`
- Create: `sidecar/sandbox/SandboxService.test.ts`

- [ ] **Step 5.1: Write failing tests for initialization**

Create `sidecar/sandbox/SandboxService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock @anthropic-ai/sandbox-runtime before importing SandboxService
vi.mock('@anthropic-ai/sandbox-runtime', () => ({
  SandboxManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    wrapWithSandbox: vi.fn().mockImplementation((cmd: string) => Promise.resolve(`srt ${cmd}`)),
    reset: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock 'which' for srtAvailable check
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `sandbox-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  vi.resetAllMocks();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  // Reset module state between tests by re-importing
  vi.resetModules();
});

describe('SandboxService.initialize', () => {
  it('calls SandboxManager.initialize with agent profile when settings file missing', async () => {
    const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime');
    const { SandboxService } = await import('./SandboxService.js');

    await SandboxService.initialize(testDir);

    expect(SandboxManager.initialize).toHaveBeenCalledOnce();
    const callArg = (SandboxManager.initialize as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.filesystem.denyRead).toContain('~/.ssh');
  });

  it('merges settings from workwithme.settings.json when present', async () => {
    writeFileSync(join(testDir, 'workwithme.settings.json'), JSON.stringify({
      sandbox: {
        agent: {
          network: { allowedDomains: ['custom.example.com'], deniedDomains: [] }
        }
      }
    }));

    const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime');
    const { SandboxService } = await import('./SandboxService.js');

    await SandboxService.initialize(testDir);

    const callArg = (SandboxManager.initialize as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.network.allowedDomains).toContain('custom.example.com');
  });

  it('sets isSupported to false when SandboxManager.initialize throws', async () => {
    const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime');
    (SandboxManager.initialize as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bubblewrap not found'));

    const { SandboxService } = await import('./SandboxService.js');
    await SandboxService.initialize(testDir); // must not throw

    expect(SandboxService.isSupported).toBe(false);
    expect(SandboxService.warning).toMatch(/bubblewrap/i);
  });

  it('sets isSupported to false on Windows', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const { SandboxService } = await import('./SandboxService.js');
    await SandboxService.initialize(testDir);

    expect(SandboxService.isSupported).toBe(false);

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });
});
```

- [ ] **Step 5.2: Run test — expect FAIL**

```bash
cd sidecar && npm test sandbox/SandboxService
```
Expected: FAIL — `Cannot find module './SandboxService.js'`

- [ ] **Step 5.3: Create `sidecar/sandbox/SandboxService.ts` (initialize + isSupported only)**

```typescript
/**
 * SandboxService — central coordinator for OS-level sandboxing.
 *
 * Wraps @anthropic-ai/sandbox-runtime to provide:
 * - Sandbox initialization at process startup (process.cwd() scoped)
 * - BashOperations factory for Pi extension user_bash hooks
 * - MCP server config generation with srt-wrapped commands
 *
 * Platform support: macOS (Seatbelt), Linux (bubblewrap)
 * Windows: all operations are no-ops; isSupported = false
 *
 * IMPORTANT: SandboxManager.initialize() must only be called once per process.
 * Do not use this alongside the standalone pi sandbox extension.
 *
 * See: docs/architecture/sandbox-runtime.md
 */

import { existsSync, readFileSync, execSync } from 'node:fs';
import { join } from 'node:path';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { getAgentProfile, getMcpDefaultProfile, mergeWithProfile, type SandboxProfile } from './profiles.js';

interface WorkwithmeSettings {
  sandbox?: {
    agent?: Partial<SandboxProfile>;
    mcp?: {
      defaults?: Partial<SandboxProfile>;
      perServer?: Record<string, Partial<SandboxProfile>>;
    };
  };
}

let _isSupported = false;
let _srtAvailable = false;
let _warning: string | null = null;
let _settings: WorkwithmeSettings = {};

function loadSettings(cwd: string): WorkwithmeSettings {
  const settingsPath = join(cwd, 'workwithme.settings.json');
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf-8')) as WorkwithmeSettings;
  } catch (err) {
    console.warn('[SandboxService] Failed to parse workwithme.settings.json:', err);
    return {};
  }
}

function checkSrtAvailable(): boolean {
  try {
    execSync('srt --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export class SandboxService {
  /**
   * Initialize sandboxing for this process. Uses process.cwd() to find
   * workwithme.settings.json. Must be called before server.listen().
   * Never throws — sets isSupported = false on any failure.
   */
  static async initialize(cwd = process.cwd()): Promise<void> {
    const platform = process.platform;

    if (platform === 'win32') {
      _isSupported = false;
      _srtAvailable = false;
      _warning = 'Sandboxing is not supported on Windows. The agent and MCP servers run without restrictions.';
      return;
    }

    _settings = loadSettings(cwd);
    _srtAvailable = checkSrtAvailable();

    if (!_srtAvailable) {
      _isSupported = false;
      _warning = 'srt is not installed. Sandboxing is disabled. Install: npm install -g @anthropic-ai/sandbox-runtime';
      return;
    }

    // Merge default agent profile with settings overrides
    const defaultAgent = getAgentProfile();
    const agentOverrides = _settings.sandbox?.agent ?? {};
    const agentProfile = mergeWithProfile(defaultAgent, agentOverrides);

    try {
      await SandboxManager.initialize({
        filesystem: agentProfile.filesystem,
        network: agentProfile.network,
      });
      _isSupported = true;
      _warning = null;
    } catch (err) {
      _isSupported = false;
      _warning = `Sandbox initialization failed: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[SandboxService] SandboxManager.initialize failed:', err);
    }
  }

  /** True if SandboxManager initialized successfully on this platform */
  static get isSupported(): boolean {
    return _isSupported;
  }

  /** True if `srt` CLI binary is available in PATH */
  static get srtAvailable(): boolean {
    return _srtAvailable;
  }

  /** Warning string when sandboxing is unavailable; null when active */
  static get warning(): string | null {
    return _warning;
  }

  /** Current loaded settings (exposed for generateMcpConfig) */
  static get settings(): WorkwithmeSettings {
    return _settings;
  }
}
```

- [ ] **Step 5.4: Run test — expect PASS**

```bash
cd sidecar && npm test sandbox/SandboxService
```
Expected: all 4 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add sidecar/sandbox/SandboxService.ts sidecar/sandbox/SandboxService.test.ts
git commit -m "feat: add SandboxService initialize, isSupported, srtAvailable"
```

---

### Task 6: SandboxService — createSandboxedBashOps

**Files:**
- Modify: `sidecar/sandbox/SandboxService.ts`
- Modify: `sidecar/sandbox/SandboxService.test.ts`

- [ ] **Step 6.1: Add failing tests for createSandboxedBashOps**

Append to `sidecar/sandbox/SandboxService.test.ts`:

```typescript
describe('SandboxService.createSandboxedBashOps', () => {
  it('returns null when isSupported is false', async () => {
    const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime');
    (SandboxManager.initialize as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));

    const { SandboxService } = await import('./SandboxService.js');
    await SandboxService.initialize(testDir);

    expect(SandboxService.createSandboxedBashOps('agent')).toBeNull();
  });

  it('returns BashOperations with exec function when supported', async () => {
    const { SandboxService } = await import('./SandboxService.js');
    await SandboxService.initialize(testDir);

    // Force isSupported for test
    (SandboxService as any)._forceSupported(true);

    const ops = SandboxService.createSandboxedBashOps('agent');
    expect(ops).not.toBeNull();
    expect(typeof ops!.exec).toBe('function');
  });

  it('exec wraps command with SandboxManager.wrapWithSandbox', async () => {
    const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime');
    const { spawn } = await import('node:child_process');

    // Mock spawn to simulate a quick exit
    (spawn as ReturnType<typeof vi.fn>).mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn().mockImplementation((event: string, cb: Function) => {
        if (event === 'close') cb(0);
      }),
    });

    const { SandboxService } = await import('./SandboxService.js');
    await SandboxService.initialize(testDir);
    (SandboxService as any)._forceSupported(true);

    const ops = SandboxService.createSandboxedBashOps('agent')!;
    const onData = vi.fn();
    const signal = new AbortController().signal;
    const result = await ops.exec('echo hello', testDir, { onData, signal });

    expect(SandboxManager.wrapWithSandbox).toHaveBeenCalledWith('echo hello');
    expect(result.exitCode).toBe(0);
  });
});
```

- [ ] **Step 6.2: Run test — expect FAIL**

```bash
cd sidecar && npm test sandbox/SandboxService
```
Expected: new tests FAIL — `createSandboxedBashOps is not a function`

- [ ] **Step 6.3: Add `createSandboxedBashOps` and `_forceSupported` to `SandboxService.ts`**

Add these imports at the top of `SandboxService.ts`:
```typescript
import { spawn } from 'node:child_process';
import type { BashOperations } from '@mariozechner/pi-coding-agent';
```

Add these methods to the `SandboxService` class:

```typescript
  /**
   * Create a BashOperations object that wraps commands via SandboxManager.wrapWithSandbox().
   * Pass this as the `operations` field in the user_bash event return value.
   * Returns null on unsupported platforms — caller should return undefined from user_bash.
   *
   * Pattern from: pi-mono-ref/packages/coding-agent/examples/extensions/sandbox/index.ts
   */
  static createSandboxedBashOps(
    _profile: 'agent' | 'mcp',
    _serverName?: string
  ): BashOperations | null {
    if (!_isSupported) return null;

    return {
      async exec(command: string, cwd: string, { onData, signal, timeout }: {
        onData: (data: Buffer) => void;
        signal: AbortSignal;
        timeout?: number;
      }): Promise<{ exitCode: number | null }> {
        if (!existsSync(cwd)) {
          throw new Error(`Working directory does not exist: ${cwd}`);
        }

        const wrappedCommand = await SandboxManager.wrapWithSandbox(command);

        return new Promise((resolve, reject) => {
          const child = spawn('bash', ['-c', wrappedCommand], {
            cwd,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          });

          let timedOut = false;
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

          if (timeout !== undefined && timeout > 0) {
            timeoutHandle = setTimeout(() => {
              timedOut = true;
              try {
                if (child.pid) process.kill(-child.pid, 'SIGKILL');
              } catch {
                child.kill('SIGKILL');
              }
            }, timeout * 1000);
          }

          child.stdout?.on('data', onData);
          child.stderr?.on('data', onData);
          child.on('error', (err) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            reject(err);
          });

          const onAbort = () => {
            try {
              if (child.pid) process.kill(-child.pid, 'SIGKILL');
            } catch {
              child.kill('SIGKILL');
            }
          };
          signal?.addEventListener('abort', onAbort, { once: true });

          child.on('close', (code) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            signal?.removeEventListener('abort', onAbort);
            if (signal?.aborted) {
              reject(new Error('aborted'));
            } else if (timedOut) {
              reject(new Error(`timeout:${timeout}`));
            } else {
              resolve({ exitCode: code });
            }
          });
        });
      },
    };
  }

  /** Test helper — force isSupported state without going through initialize() */
  static _forceSupported(value: boolean): void {
    _isSupported = value;
  }
```

- [ ] **Step 6.4: Run tests — expect PASS**

```bash
cd sidecar && npm test sandbox/SandboxService
```
Expected: all tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add sidecar/sandbox/SandboxService.ts sidecar/sandbox/SandboxService.test.ts
git commit -m "feat: add SandboxService.createSandboxedBashOps"
```

---

### Task 7: SandboxService — generateMcpConfig

**Files:**
- Modify: `sidecar/sandbox/SandboxService.ts`
- Create: `sidecar/sandbox/generateMcpConfig.test.ts`

- [ ] **Step 7.1: Write failing tests for generateMcpConfig**

Create `sidecar/sandbox/generateMcpConfig.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@anthropic-ai/sandbox-runtime', () => ({
  SandboxManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    wrapWithSandbox: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
  spawn: vi.fn(),
}));

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `mcp-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  mkdirSync(join(testDir, '.pi'), { recursive: true });
  vi.resetModules();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('SandboxService.generateMcpConfig', () => {
  it('skips generation and logs warning when mcp.json is missing', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { SandboxService } = await import('./SandboxService.js');
    await SandboxService.initialize(testDir);
    (SandboxService as any)._forceSupported(true);
    (SandboxService as any)._forceSrtAvailable(true);

    await SandboxService.generateMcpConfig(testDir);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('mcp.json not found'));
    expect(existsSync(join(testDir, '.pi', 'mcp.json'))).toBe(false);
    consoleSpy.mockRestore();
  });

  it('wraps stdio server commands with srt and writes .pi/mcp.json', async () => {
    writeFileSync(join(testDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        'my-server': { command: 'npx', args: ['-y', 'some-mcp-server'] }
      }
    }));

    const { SandboxService } = await import('./SandboxService.js');
    await SandboxService.initialize(testDir);
    (SandboxService as any)._forceSupported(true);
    (SandboxService as any)._forceSrtAvailable(true);

    await SandboxService.generateMcpConfig(testDir);

    const generated = JSON.parse(readFileSync(join(testDir, '.pi', 'mcp.json'), 'utf-8'));
    const server = generated.mcpServers['my-server'];
    expect(server.command).toBe('srt');
    expect(server.args[0]).toBe('--settings');
    expect(server.args[2]).toBe('npx');
    expect(server.args[3]).toBe('-y');
    expect(server.args[4]).toBe('some-mcp-server');
  });

  it('passes HTTP servers through unchanged', async () => {
    writeFileSync(join(testDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        'http-server': { url: 'http://localhost:3000' }
      }
    }));

    const { SandboxService } = await import('./SandboxService.js');
    await SandboxService.initialize(testDir);
    (SandboxService as any)._forceSupported(true);
    (SandboxService as any)._forceSrtAvailable(true);

    await SandboxService.generateMcpConfig(testDir);

    const generated = JSON.parse(readFileSync(join(testDir, '.pi', 'mcp.json'), 'utf-8'));
    const server = generated.mcpServers['http-server'];
    expect(server.url).toBe('http://localhost:3000');
    expect(server.command).toBeUndefined();
  });

  it('applies perServer overrides from settings', async () => {
    writeFileSync(join(testDir, 'mcp.json'), JSON.stringify({
      mcpServers: { github: { command: 'npx', args: ['-y', '@github/mcp'] } }
    }));
    writeFileSync(join(testDir, 'workwithme.settings.json'), JSON.stringify({
      sandbox: {
        mcp: {
          perServer: {
            github: { network: { allowedDomains: ['api.github.com'], deniedDomains: [] } }
          }
        }
      }
    }));

    const { SandboxService } = await import('./SandboxService.js');
    await SandboxService.initialize(testDir);
    (SandboxService as any)._forceSupported(true);
    (SandboxService as any)._forceSrtAvailable(true);

    await SandboxService.generateMcpConfig(testDir);

    // The per-server settings file should contain the github domain
    const generated = JSON.parse(readFileSync(join(testDir, '.pi', 'mcp.json'), 'utf-8'));
    const settingsPath = generated.mcpServers.github.args[1];
    const serverSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(serverSettings.network.allowedDomains).toContain('api.github.com');
  });
});
```

- [ ] **Step 7.2: Run test — expect FAIL**

```bash
cd sidecar && npm test sandbox/generateMcpConfig
```
Expected: FAIL — `generateMcpConfig is not a function`

- [ ] **Step 7.3: Add `generateMcpConfig` and `_forceSrtAvailable` to `SandboxService.ts`**

Extend the existing `node:fs` import in `SandboxService.ts` (do NOT add a second import line — merge with the existing `existsSync, readFileSync` import):
```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
```

And add the `dirname` to the existing `node:path` import:
```typescript
import { join, dirname } from 'node:path';
```

Add these methods to the `SandboxService` class:

```typescript
  /** Test helper — force srtAvailable state */
  static _forceSrtAvailable(value: boolean): void {
    _srtAvailable = value;
  }

  /**
   * Generate .pi/mcp.json from mcp.json + sandbox MCP rules.
   *
   * - Reads mcp.json from cwd
   * - Stdio servers get srt-wrapped commands with per-server settings files
   * - HTTP servers pass through unchanged
   * - Always overwrites .pi/mcp.json
   * - Registers SIGTERM/SIGINT/exit cleanup for tmp settings files
   * - Cleans stale tmp files from previous runs on startup
   */
  static async generateMcpConfig(cwd = process.cwd()): Promise<void> {
    const mcpJsonPath = join(cwd, 'mcp.json');
    if (!existsSync(mcpJsonPath)) {
      console.warn('[SandboxService] mcp.json not found at', mcpJsonPath, '— MCP servers unavailable');
      return;
    }

    let mcpConfig: { mcpServers?: Record<string, McpServerEntry> };
    try {
      mcpConfig = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
    } catch (err) {
      console.error('[SandboxService] Failed to parse mcp.json:', err);
      return;
    }

    const servers = mcpConfig.mcpServers ?? {};
    const mcpSettings = _settings.sandbox?.mcp ?? {};
    const defaults = mcpSettings.defaults ? mergeWithProfile(getMcpDefaultProfile(), mcpSettings.defaults) : getMcpDefaultProfile();

    // Clean stale tmp files from previous runs (same server names, any pid)
    for (const serverName of Object.keys(servers)) {
      try {
        // List /tmp and filter by name pattern (no glob dependency needed)
        const tmpFiles = readdirSync(tmpdir())
          .filter(f => f.startsWith(`workwithme-mcp-${serverName}-`) && f.endsWith('.json'))
          .map(f => join(tmpdir(), f));
        for (const f of tmpFiles) {
          try { unlinkSync(f); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }

    const tmpFilesCreated: string[] = [];
    const outputServers: Record<string, McpServerEntry> = {};

    for (const [name, def] of Object.entries(servers)) {
      if (def.url) {
        // HTTP server — pass through unchanged
        outputServers[name] = def;
        continue;
      }

      if (!def.command) {
        outputServers[name] = def;
        continue;
      }

      // Merge per-server overrides
      const perServerOverrides = mcpSettings.perServer?.[name] ?? {};
      const profile = mergeWithProfile(defaults, perServerOverrides);

      // Write per-server settings file
      const tmpPath = join(tmpdir(), `workwithme-mcp-${name}-${process.pid}.json`);
      writeFileSync(tmpPath, JSON.stringify({
        network: profile.network,
        filesystem: profile.filesystem,
      }, null, 2));
      tmpFilesCreated.push(tmpPath);

      // Rewrite entry with srt wrapper
      outputServers[name] = {
        ...def,
        command: 'srt',
        args: ['--settings', tmpPath, def.command, ...(def.args ?? [])],
      };
    }

    // Write .pi/mcp.json
    const piDir = join(cwd, '.pi');
    mkdirSync(piDir, { recursive: true });
    writeFileSync(
      join(piDir, 'mcp.json'),
      JSON.stringify({ mcpServers: outputServers }, null, 2)
    );

    // Register cleanup
    const cleanup = () => {
      for (const f of tmpFilesCreated) {
        try { unlinkSync(f); } catch { /* ignore */ }
      }
    };
    process.on('exit', cleanup);
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });
    process.on('SIGINT',  () => { cleanup(); process.exit(0); });
  }
```

Also add the `McpServerEntry` interface near the top of the file (after imports):
```typescript
interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  cwd?: string;
  [key: string]: unknown;
}
```

And add `tmpdir` import:
```typescript
import { tmpdir } from 'node:os';
```

- [ ] **Step 7.4: Run tests — expect PASS**

```bash
cd sidecar && npm test sandbox/
```
Expected: all tests in the sandbox/ directory pass.

- [ ] **Step 7.5: Commit**

```bash
git add sidecar/sandbox/SandboxService.ts sidecar/sandbox/generateMcpConfig.test.ts
git commit -m "feat: add SandboxService.generateMcpConfig with tests"
```

---

## Chunk 3: Pi Extension — sandbox-tools.ts

### Task 8: user_bash hook and session lifecycle

**Files:**
- Create: `sidecar/extensions/sandbox-tools.ts`
- Create: `sidecar/extensions/sandbox-tools.test.ts`

- [ ] **Step 8.1: Write failing tests**

Create `sidecar/extensions/sandbox-tools.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../sandbox/SandboxService.js', () => ({
  SandboxService: {
    isSupported: true,
    srtAvailable: true,
    createSandboxedBashOps: vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue({ exitCode: 0 })
    }),
  }
}));

vi.mock('@anthropic-ai/sandbox-runtime', () => ({
  SandboxManager: { reset: vi.fn().mockResolvedValue(undefined) }
}));

describe('sandbox-tools extension', () => {
  let pi: any;
  let handlers: Record<string, Function>;
  let commands: Record<string, { handler: Function }>;
  let mod: typeof import('./sandbox-tools.js');

  beforeEach(async () => {
    vi.resetModules();
    handlers = {};
    commands = {};
    pi = {
      on: vi.fn().mockImplementation((event: string, handler: Function) => {
        handlers[event] = handler;
      }),
      registerCommand: vi.fn().mockImplementation((name: string, def: { handler: Function }) => {
        commands[name] = def;
      }),
    };

    mod = await import('./sandbox-tools.js');
    mod.default(pi);
  });

  it('registers user_bash, tool_result, and session_shutdown handlers', () => {
    expect(handlers['user_bash']).toBeDefined();
    expect(handlers['tool_result']).toBeDefined();
    expect(handlers['session_shutdown']).toBeDefined();
  });

  it('user_bash returns operations when isSupported is true', async () => {
    const { SandboxService } = await import('../sandbox/SandboxService.js');
    (SandboxService as any).isSupported = true;

    const result = await handlers['user_bash']({});
    expect(result).toHaveProperty('operations');
    expect(SandboxService.createSandboxedBashOps).toHaveBeenCalledWith('agent');
  });

  it('user_bash returns undefined when isSupported is false', async () => {
    const { SandboxService } = await import('../sandbox/SandboxService.js');
    (SandboxService as any).isSupported = false;

    const result = await handlers['user_bash']({});
    expect(result).toBeUndefined();
  });

  it('user_bash returns undefined (bypasses sandbox) after grantApproval is called', async () => {
    const { SandboxService } = await import('../sandbox/SandboxService.js');
    (SandboxService as any).isSupported = true;

    // Simulate a violation being detected and approval granted
    mod.grantApproval('test-approval-id');

    // Next user_bash call should be unsandboxed (bypass consumed)
    const result = await handlers['user_bash']({});
    expect(result).toBeUndefined();

    // Bypass is single-use — subsequent calls are sandboxed again
    const result2 = await handlers['user_bash']({});
    expect(result2).toHaveProperty('operations');
  });

  it('tool_result: isSandboxViolation returns false for exit code 0', async () => {
    const event = { toolName: 'bash', output: 'Sandbox: deny', exitCode: 0, result: 'output' };
    await handlers['tool_result'](event);
    // No violation — result should not be modified
    expect(event.result).toBe('output');
  });

  it('tool_result: detects violation and appends escape hatch message', async () => {
    const event = {
      toolName: 'bash',
      output: 'Operation not permitted',
      exitCode: 1,
      result: 'original output',
    };
    await handlers['tool_result'](event);
    expect(event.result).toContain('[SANDBOX]');
    expect(event.result).toContain('/sandbox-allow');
  });

  it('tool_result: non-bash tool is ignored', async () => {
    const event = { toolName: 'read_file', output: 'Operation not permitted', exitCode: 1, result: 'x' };
    await handlers['tool_result'](event);
    expect(event.result).toBe('x');
  });

  it('/sandbox-allow: calls sendToClient when pending approval exists', async () => {
    const sendToClient = vi.fn();
    mod.setSendToClient(sendToClient);

    // Simulate a violation to create a pending approval
    const event = {
      toolName: 'bash',
      output: 'Sandbox: deny file read',
      exitCode: 1,
      result: 'Sandbox: deny',
    };
    await handlers['tool_result'](event);

    const returnMsg = await commands['sandbox-allow'].handler('need network access');
    expect(sendToClient).toHaveBeenCalledOnce();
    const call = sendToClient.mock.calls[0][0];
    expect(call.type).toBe('sandbox_approval_request');
    expect(call.approvalId).toBeTruthy();
    expect(call.reason).toBe('need network access');
    expect(returnMsg).toContain('Approval request sent');
  });

  it('/sandbox-allow: returns "no pending" message when no violations', async () => {
    const sendToClient = vi.fn();
    mod.setSendToClient(sendToClient);

    const returnMsg = await commands['sandbox-allow'].handler('reason');
    expect(sendToClient).not.toHaveBeenCalled();
    expect(returnMsg).toContain('No pending');
  });
});
```

- [ ] **Step 8.2: Run test — expect FAIL**

```bash
cd sidecar && npm test extensions/sandbox-tools
```
Expected: FAIL — `Cannot find module './sandbox-tools.js'`

- [ ] **Step 8.3: Create `sidecar/extensions/sandbox-tools.ts`**

```typescript
/**
 * sandbox-tools — Pi extension for agent bash tool sandboxing.
 *
 * Hooks:
 * - user_bash: wraps command execution with SandboxService.createSandboxedBashOps()
 * - tool_result: detects sandbox violations, surfaces escape hatch message to agent
 * - session_shutdown: calls SandboxManager.reset() for cleanup
 *
 * Escape hatch flow:
 * 1. Violation detected in tool_result → store PendingApproval, append /sandbox-allow prompt to result
 * 2. Agent calls /sandbox-allow <reason> → calls _sendToClient with SANDBOX_APPROVAL_REQUEST
 * 3. User approves in UI → server.ts receives SANDBOX_APPROVAL_RESPONSE, calls grantApproval()
 * 4. grantApproval() sets bypassNextCall = true
 * 5. Next user_bash call sees bypassNextCall, clears it, returns undefined (unsandboxed)
 *
 * server.ts is responsible for:
 * - Calling setSendToClient() with the active ws.send function after a WS connection opens
 * - Calling grantApproval() when SANDBOX_APPROVAL_RESPONSE arrives
 *
 * See: docs/architecture/sandbox-runtime.md
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { SandboxService } from '../sandbox/SandboxService.js';
import { WS_EVENTS } from '../../src/types.js';

interface PendingApproval {
  approvalId: string;
  violationContext: string; // first 200 chars of blocked output, for WS payload
  createdAt: number;
  timer: ReturnType<typeof setTimeout>;
}

// Keyed by approvalId (UUID). Entries expire after 5 minutes.
const pendingApprovals = new Map<string, PendingApproval>();

// When true, the next user_bash call runs unsandboxed (single-use flag).
// Set by grantApproval(); cleared by the user_bash handler.
let bypassNextCall = false;

// Injected by server.ts after a WS connection is established.
let _sendToClient: ((msg: object) => void) | null = null;

/** Violation patterns for macOS (Seatbelt) and Linux (bubblewrap) */
const VIOLATION_PATTERNS = [
  /Operation not permitted/i,
  /Permission denied/i,   // Linux bubblewrap non-zero exit
  /Sandbox: deny/i,
  /sandbox-exec:/i,
  /bwrap: Can't/i,
];

function isSandboxViolation(output: string, exitCode: number | null): boolean {
  if (exitCode === 0) return false;
  return VIOLATION_PATTERNS.some(p => p.test(output));
}

/**
 * Provide a WebSocket send function so this extension can relay
 * SANDBOX_APPROVAL_REQUEST messages to the client.
 * Called by server.ts when a WS connection opens.
 */
export function setSendToClient(fn: (msg: object) => void): void {
  _sendToClient = fn;
}

/**
 * Mark the next user_bash call as bypassed (unsandboxed).
 * Called by server.ts when SANDBOX_APPROVAL_RESPONSE is received.
 */
export function grantApproval(approvalId: string): void {
  const approval = pendingApprovals.get(approvalId);
  if (approval) {
    clearTimeout(approval.timer);
    pendingApprovals.delete(approvalId);
    bypassNextCall = true;
  }
}

export default function sandboxToolsExtension(pi: ExtensionAPI) {
  /**
   * user_bash — intercept bash execution.
   * Returns BashOperations to replace default execution with sandboxed version.
   * Returns undefined to use default execution (Windows, unsupported, approved bypass).
   */
  pi.on('user_bash', () => {
    // Single-use bypass granted by grantApproval() after user approval in UI
    if (bypassNextCall) {
      bypassNextCall = false;
      return; // undefined → default (unsandboxed) execution
    }

    if (!SandboxService.isSupported) return;

    const ops = SandboxService.createSandboxedBashOps('agent');
    if (!ops) return;
    return { operations: ops };
  });

  /**
   * tool_result — detect sandbox violations and offer escape hatch.
   * Stores a PendingApproval and appends a structured message to the result
   * so the agent knows to call /sandbox-allow.
   */
  pi.on('tool_result', (event: { toolName?: string; output?: string; exitCode?: number | null; result?: string }) => {
    if (event.toolName !== 'bash') return;

    const output = event.output ?? event.result ?? '';
    const exitCode = event.exitCode ?? null;

    if (!isSandboxViolation(output, exitCode)) return;

    const approvalId = crypto.randomUUID();
    const timer = setTimeout(() => pendingApprovals.delete(approvalId), 5 * 60 * 1000);
    pendingApprovals.set(approvalId, {
      approvalId,
      violationContext: output.slice(0, 200),
      createdAt: Date.now(),
      timer,
    });

    console.log('[sandbox-tools] Sandbox violation detected. approvalId:', approvalId);

    const escapeHatchMsg = [
      '',
      '[SANDBOX] This command was blocked by the sandbox.',
      'To request unsandboxed execution, use: /sandbox-allow <your reason>',
      'You will need to confirm this in the workwithme UI before it executes.',
    ].join('\n');

    if (event.result !== undefined) {
      (event as any).result = event.result + escapeHatchMsg;
    }
  });

  /** session_shutdown — clean up SandboxManager state */
  pi.on('session_shutdown', async () => {
    try {
      await SandboxManager.reset();
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * /sandbox-allow — agent slash command to request sandbox escape.
   * Looks up the most recent pending approval, sends SANDBOX_APPROVAL_REQUEST
   * over the active WS connection (wired via setSendToClient in server.ts).
   */
  pi.registerCommand('sandbox-allow', {
    description: 'Request approval to run a blocked command outside the sandbox',
    handler: async (args: string): Promise<string> => {
      const reason = args?.trim() || 'No reason provided';

      // Pick the most recent pending approval
      const approvals = [...pendingApprovals.values()].sort((a, b) => b.createdAt - a.createdAt);
      const approval = approvals[0];

      if (!approval) {
        return 'No pending sandbox violation to approve. Run the command first to trigger a violation.';
      }

      if (_sendToClient) {
        _sendToClient({
          type: WS_EVENTS.SANDBOX_APPROVAL_REQUEST,
          approvalId: approval.approvalId,
          violationContext: approval.violationContext,
          reason,
        });
        return 'Approval request sent. Please confirm in the workwithme UI. Once approved, retry the command.';
      }

      return 'Unable to send approval request — no active session connection.';
    },
  });
}
```

- [ ] **Step 8.4: Run tests — expect PASS**

```bash
cd sidecar && npm test extensions/sandbox-tools
```
Expected: all tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add sidecar/extensions/sandbox-tools.ts sidecar/extensions/sandbox-tools.test.ts
git commit -m "feat: add sandbox-tools Pi extension with user_bash hook and escape hatch"
```

---

## Chunk 4: Server changes

### Task 9: Async bootstrap and register sandbox-tools extension

**Files:**
- Modify: `sidecar/server.ts`

- [ ] **Step 9.1: Add async bootstrap before `server.listen()`**

In `sidecar/server.ts`:

1. Add imports at the top (after existing imports):
```typescript
import { SandboxService } from './sandbox/SandboxService.js';
import sandboxTools, { setSendToClient, grantApproval } from './extensions/sandbox-tools.js';
```

2. Add `sandboxTools` to the extensions array in `initSession()`:
```typescript
const extensions: any[] = [
  sandboxTools,      // ← add first so sandbox wraps before other extensions see bash
  piSubagents,
  glimpse,
  piSmartSessions,
  piParallel,
  aiLabelling
];
```

3. In the WebSocket connection handler (`wss.on('connection', (ws, req) => { ... })`), after the connection is established, wire `setSendToClient` so the extension can relay `SANDBOX_APPROVAL_REQUEST` messages:

```typescript
// Wire sandbox escape-hatch relay. Called each new WS connection so the
// extension always has the active socket. server.ts owns the WS; the
// extension owns the pending-approval state.
setSendToClient((msg: object) => {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
});
```

4. In the `ws.on('message', ...)` handler, add handling for `SANDBOX_APPROVAL_RESPONSE` before the existing `switch`/`if` block:

```typescript
if (parsed.type === WS_EVENTS.SANDBOX_APPROVAL_RESPONSE) {
  // Route to sandbox-tools; grantApproval handles both approved and denied outcomes.
  // Do NOT add a separate approved/denied branch here — the extension owns that logic.
  grantApproval(parsed.approvalId as string);
  return;
}
```

5. Replace the final `server.listen(...)` block at the bottom of the file:

Before (current):
```typescript
// Start the server
const PORT = process.env.PORT || 4242;
server.listen(PORT, () => {
  console.log(`WorkWithMe Sidecar running on http://localhost:${PORT}`);
});
```

After:
```typescript
// Async bootstrap: initialize sandbox before accepting connections.
// Both functions use process.cwd() — sandbox config is process-scoped.
// initSession() is called lazily later (first WS connection), which is
// after bootstrap completes, so .pi/mcp.json is always ready when pi-mcp-adapter loads.
async function bootstrap(): Promise<void> {
  await SandboxService.initialize();
  await SandboxService.generateMcpConfig();
}

const PORT = process.env.PORT || 4242;
bootstrap()
  .catch(err => console.error('[bootstrap] Sandbox init failed (continuing without sandboxing):', err))
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`WorkWithMe Sidecar running on http://localhost:${PORT}`);
    });
  });
```

- [ ] **Step 9.2: Run TypeScript check**

```bash
cd sidecar && npx tsc --noEmit
```
Expected: no errors.

---

### Task 10: `/api/sandbox/status` endpoint

**Files:**
- Modify: `sidecar/server.ts`

- [ ] **Step 10.1: Add the status endpoint**

In `sidecar/server.ts`, add after the existing `/api/stop` endpoint:

```typescript
// Sandbox status — used by the frontend to show a warning banner when sandboxing is unavailable.
// Unauthenticated: consistent with rest of sidecar API (localhost-only).
app.get('/api/sandbox/status', (_req: Request, res: Response) => {
  const active = SandboxService.isSupported && SandboxService.srtAvailable;
  res.json({
    supported: SandboxService.isSupported,
    srtAvailable: SandboxService.srtAvailable,
    active,
    platform: process.platform,
    warning: SandboxService.warning,
  });
});
```

- [ ] **Step 10.2: Manually test the endpoint**

Start the sidecar and hit the endpoint:
```bash
cd sidecar && npm run start &
sleep 2
curl -s http://localhost:4242/api/sandbox/status | jq .
```
Expected: JSON object with `supported`, `srtAvailable`, `active`, `platform`, `warning` fields.

Kill the test process after verifying.

- [ ] **Step 10.3: Commit**

```bash
git add sidecar/server.ts
git commit -m "feat: add sandbox bootstrap, register sandbox-tools extension, add /api/sandbox/status"
```

---

## Chunk 5: Config files and UI

### Task 11: Config files — workwithme.settings.json, mcp.json, .gitignore

**Files:**
- Create: `workwithme.settings.json`
- Create: `mcp.json`
- Modify: `.gitignore`

- [ ] **Step 11.1: Create `workwithme.settings.json`**

At the project root (`/Users/ravi/Documents/Dev/workwithme/workwithme.settings.json`):

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
      "perServer": {}
    }
  }
}
```

- [ ] **Step 11.2: Create `mcp.json`**

At the project root (`/Users/ravi/Documents/Dev/workwithme/mcp.json`):

```json
{
  "mcpServers": {}
}
```

(Empty — users add their MCP servers here. This is the source of truth for `generateMcpConfig`.)

- [ ] **Step 11.3: Add `.pi/mcp.json` to `.gitignore`**

Add to `/Users/ravi/Documents/Dev/workwithme/.gitignore`:
```
# Generated by workwithme sidecar — do not commit (contains process-scoped srt paths)
.pi/mcp.json
```

- [ ] **Step 11.4: Commit**

```bash
git add workwithme.settings.json mcp.json .gitignore
git commit -m "feat: add workwithme.settings.json, mcp.json, and gitignore .pi/mcp.json"
```

---

### Task 12: UI sandbox warning banner

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 12.1: Add `sandboxStatus` state and fetch**

In `src/App.tsx`:

1. Add the interface (after the imports, before the `App` function):
```typescript
interface SandboxStatus {
  supported: boolean;
  srtAvailable: boolean;
  active: boolean;
  platform: string;
  warning: string | null;
}
```

2. Add state inside the `App` function (after the existing state declarations):
```typescript
const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null);
const [sandboxBannerDismissed, setSandboxBannerDismissed] = useState(false);
```

3. Add a fetch for sandbox status inside the `ws.onopen` handler (after the `refreshAll()` call):
```typescript
// Fetch sandbox status to show warning banner if sandboxing is unavailable
fetch(`${API_BASE}/api/sandbox/status`)
  .then(r => r.json())
  .then((status: SandboxStatus) => setSandboxStatus(status))
  .catch(() => {}); // non-critical
```

- [ ] **Step 12.2: Add the banner to the JSX**

In `App.tsx`, inside the `<main>` element, add the banner just below `<header ...>` and before `{/* Chat Feed */}`:

```tsx
{/* Sandbox warning banner — shown when sandboxing is unavailable */}
{sandboxStatus && !sandboxStatus.active && !sandboxBannerDismissed && (
  <div className="absolute top-14 left-0 right-0 z-20 mx-3">
    <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[12px]">
      <span className="flex-shrink-0 mt-0.5">⚠</span>
      <span className="flex-1">
        {sandboxStatus.warning ?? 'Sandboxing is inactive.'}{' '}
        <a
          href="https://github.com/anthropic-experimental/sandbox-runtime"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-amber-300"
        >
          Learn more
        </a>
      </span>
      <button
        type="button"
        onClick={() => setSandboxBannerDismissed(true)}
        className="flex-shrink-0 p-0.5 hover:text-white transition-colors"
        aria-label="Dismiss sandbox warning"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 12.3: Adjust chat feed top padding when banner is visible**

The chat feed has `pt-16`. When the banner is shown, it needs a little more space. Update the chat feed div's padding class:

```tsx
<div className={`flex-1 overflow-y-auto px-3 scroll-smooth ${
  sandboxStatus && !sandboxStatus.active && !sandboxBannerDismissed ? 'pt-28' : 'pt-16'
} pb-4`}>
```

- [ ] **Step 12.4: TypeScript check**

```bash
cd workwithme && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 12.5: Verify banner renders**

On Windows (or by temporarily returning `{ active: false }` from the status endpoint), the banner should appear below the header.

- [ ] **Step 12.6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add sandbox status banner to App.tsx"
```

---

## Final Verification

- [ ] **Run all sidecar tests**

```bash
cd sidecar && npm test
```
Expected: all tests pass.

- [ ] **Run frontend TypeScript check**

```bash
cd workwithme && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Start sidecar and verify sandbox initializes**

```bash
cd sidecar && npm run start
```
Expected log output includes:
- No `[bootstrap] Sandbox init failed` errors on macOS/Linux
- `WorkWithMe Sidecar running on http://localhost:4242`

- [ ] **Check status endpoint**

```bash
curl -s http://localhost:4242/api/sandbox/status | jq .
```
Expected on macOS with srt installed:
```json
{ "supported": true, "srtAvailable": true, "active": true, "platform": "darwin", "warning": null }
```

- [ ] **Final commit tag (optional)**

```bash
git tag sandbox-runtime-v1
```
