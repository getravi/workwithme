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

    const generated = JSON.parse(readFileSync(join(testDir, '.pi', 'mcp.json'), 'utf-8'));
    const settingsPath = generated.mcpServers.github.args[1];
    const serverSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(serverSettings.network.allowedDomains).toContain('api.github.com');
  });

  it('skips generation when srt is not available', async () => {
    writeFileSync(join(testDir, 'mcp.json'), JSON.stringify({
      mcpServers: { 'my-server': { command: 'npx', args: ['-y', 'some-server'] } }
    }));

    const { SandboxService } = await import('./SandboxService.js');
    await SandboxService.initialize(testDir);
    (SandboxService as any)._forceSupported(false);
    (SandboxService as any)._forceSrtAvailable(false);

    await SandboxService.generateMcpConfig(testDir);

    expect(existsSync(join(testDir, '.pi', 'mcp.json'))).toBe(false);
  });
});
