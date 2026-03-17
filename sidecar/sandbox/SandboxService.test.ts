import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@anthropic-ai/sandbox-runtime', () => ({
  SandboxManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    wrapWithSandbox: vi.fn().mockImplementation((cmd: string) => Promise.resolve(`srt ${cmd}`)),
    reset: vi.fn().mockResolvedValue(undefined),
  },
}));

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

    (SandboxService as any)._forceSupported(true);

    const ops = SandboxService.createSandboxedBashOps('agent');
    expect(ops).not.toBeNull();
    expect(typeof ops!.exec).toBe('function');
  });

  it('exec wraps command with SandboxManager.wrapWithSandbox', async () => {
    const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime');
    const { spawn } = await import('node:child_process');

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
