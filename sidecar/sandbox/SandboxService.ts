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

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawn } from 'node:child_process';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import type { BashOperations } from '@mariozechner/pi-coding-agent';
import { getAgentProfile, getMcpDefaultProfile, mergeWithProfile, type SandboxProfile } from './profiles.js';

interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  cwd?: string;
  [key: string]: unknown;
}

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
let _initialized = false;

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
    if (_initialized) {
      console.warn('[SandboxService] initialize() called more than once — ignoring duplicate call');
      return;
    }
    _initialized = true;
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
      async exec(command: string, cwd: string, { onData, signal, timeout, env }: {
        onData: (data: Buffer) => void;
        signal?: AbortSignal;
        timeout?: number;
        env?: NodeJS.ProcessEnv;
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
            ...(env ? { env } : {}),
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
   *
   * See: docs/architecture/sandbox-runtime.md
   */
  static async generateMcpConfig(cwd = process.cwd()): Promise<void> {
    if (!_srtAvailable) {
      console.warn('[SandboxService] srt not available — skipping MCP config generation');
      return;
    }
    const mcpJsonPath = join(cwd, 'mcp.json');
    if (!existsSync(mcpJsonPath)) {
      console.warn(`[SandboxService] mcp.json not found at ${mcpJsonPath} — MCP servers unavailable`);
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
    const defaults = mcpSettings.defaults
      ? mergeWithProfile(getMcpDefaultProfile(), mcpSettings.defaults)
      : getMcpDefaultProfile();

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

      // Write per-server settings file to /tmp
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

    // Register cleanup for tmp settings files — called once per generateMcpConfig invocation
    const cleanup = () => {
      for (const f of tmpFilesCreated) {
        try { unlinkSync(f); } catch { /* ignore */ }
      }
    };
    process.on('exit', cleanup);
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });
    process.on('SIGINT',  () => { cleanup(); process.exit(0); });
  }
}
