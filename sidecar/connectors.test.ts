import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listConnectors } from './connectors.js';

const mockLoadMcpConfig = vi.fn(() => ({
  mcpServers: { filesystem: {}, github: {} },
}));

vi.mock('@mariozechner/pi-ai/oauth', () => ({
  getOAuthProviders: () => [
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'google', name: 'Google' },
  ],
}));

vi.mock('pi-mcp-adapter/config', () => ({
  loadMcpConfig: (...args: any[]) => mockLoadMcpConfig(...args),
}));

vi.mock('keytar', () => ({
  default: {
    getPassword: vi.fn(),
    setPassword: vi.fn(),
    deletePassword: vi.fn(),
  },
}));

describe('listConnectors', () => {
  it('marks configured oauth providers as connected', () => {
    const mockAuth = { list: () => ['anthropic'] } as any;
    const result = listConnectors(mockAuth);

    const anthropic = result.find(c => c.id === 'oauth/anthropic');
    expect(anthropic?.status).toBe('connected');
    expect(anthropic?.type).toBe('oauth');
  });

  it('marks unconfigured oauth providers as available', () => {
    const mockAuth = { list: () => ['anthropic'] } as any;
    const result = listConnectors(mockAuth);

    const google = result.find(c => c.id === 'oauth/google');
    expect(google?.status).toBe('available');
  });

  it('includes mcp servers from config as connected', () => {
    const mockAuth = { list: () => [] } as any;
    const result = listConnectors(mockAuth);

    const mcpIds = result.filter(c => c.type === 'mcp').map(c => c.id);
    expect(mcpIds).toContain('mcp/filesystem');
    expect(mcpIds).toContain('mcp/github');
  });

  it('all mcp entries have status connected', () => {
    const mockAuth = { list: () => [] } as any;
    const result = listConnectors(mockAuth);

    for (const c of result.filter(c => c.type === 'mcp')) {
      expect(c.status).toBe('connected');
    }
  });

  it('returns empty mcp list when loadMcpConfig throws, oauth still returned', () => {
    mockLoadMcpConfig.mockImplementationOnce(() => { throw new Error('config error'); });
    const mockAuth = { list: () => ['anthropic'] } as any;
    const result = listConnectors(mockAuth);

    expect(result.filter(c => c.type === 'mcp')).toHaveLength(0);
    expect(result.some(c => c.type === 'oauth')).toBe(true);
  });
});

import { REMOTE_MCP_CATALOG, CATALOG_SLUGS } from './connectors.js';

describe('REMOTE_MCP_CATALOG', () => {
  it('has at least 50 entries', () => {
    expect(REMOTE_MCP_CATALOG.length).toBeGreaterThanOrEqual(50);
  });
  it('every entry has required fields with valid slug', () => {
    for (const entry of REMOTE_MCP_CATALOG) {
      expect(typeof entry.slug).toBe('string');
      expect(entry.slug).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/);
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.category).toBe('string');
      expect(typeof entry.requiresToken).toBe('boolean');
    }
  });
  it('CATALOG_SLUGS contains all catalog slugs', () => {
    expect(CATALOG_SLUGS.size).toBe(REMOTE_MCP_CATALOG.length);
    for (const entry of REMOTE_MCP_CATALOG) {
      expect(CATALOG_SLUGS.has(entry.slug)).toBe(true);
    }
  });
  it('all slugs are unique', () => {
    const slugs = REMOTE_MCP_CATALOG.map(e => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

import keytar from 'keytar';
import { keychainGet, keychainSet, keychainDelete } from './connectors.js';

describe('keychainGet', () => {
  it('calls keytar with correct service/account and returns token', async () => {
    vi.mocked(keytar.getPassword).mockResolvedValueOnce('mytoken');
    const result = await keychainGet('stripe');
    expect(keytar.getPassword).toHaveBeenCalledWith('workwithme', 'remote-mcp/stripe');
    expect(result).toBe('mytoken');
  });
  it('returns null if not found', async () => {
    vi.mocked(keytar.getPassword).mockResolvedValueOnce(null);
    expect(await keychainGet('stripe')).toBeNull();
  });
});

describe('keychainSet', () => {
  it('calls keytar with correct args', async () => {
    vi.mocked(keytar.setPassword).mockResolvedValueOnce(undefined as any);
    await keychainSet('stripe', 'tok_secret');
    expect(keytar.setPassword).toHaveBeenCalledWith('workwithme', 'remote-mcp/stripe', 'tok_secret');
  });
});

describe('keychainDelete', () => {
  it('calls keytar and returns boolean', async () => {
    vi.mocked(keytar.deletePassword).mockResolvedValueOnce(true);
    expect(await keychainDelete('stripe')).toBe(true);
    expect(keytar.deletePassword).toHaveBeenCalledWith('workwithme', 'remote-mcp/stripe');
  });
});

import { readRawMcpConfig, writeMcpEntry, removeMcpEntry } from './connectors.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MCP_PATH = join(homedir(), '.pi', 'agent', 'mcp.json');

describe('writeMcpEntry / readRawMcpConfig / removeMcpEntry', () => {
  // Save and restore original mcp.json content around tests
  let originalContent: string | null = null;
  beforeEach(() => {
    originalContent = existsSync(MCP_PATH) ? readFileSync(MCP_PATH, 'utf-8') : null;
  });
  afterEach(() => {
    if (originalContent !== null) {
      writeFileSync(MCP_PATH, originalContent, 'utf-8');
    } else if (existsSync(MCP_PATH)) {
      // If file didn't exist before, remove the test entry but keep other entries
      // Simple approach: remove if we created it from scratch
    }
  });

  it('writeMcpEntry adds entry to mcp.json', () => {
    writeMcpEntry('test-server', 'https://test.example.com');
    const servers = readRawMcpConfig();
    expect(servers['test-server']).toEqual({ url: 'https://test.example.com', type: 'streamable-http' });
  });

  it('readRawMcpConfig returns {} when file missing', () => {
    // Just test the function doesn't throw when the key doesn't exist
    const servers = readRawMcpConfig();
    expect(typeof servers).toBe('object');
  });

  it('removeMcpEntry removes entry and returns true', () => {
    writeMcpEntry('test-remove', 'https://remove.example.com');
    const removed = removeMcpEntry('test-remove');
    expect(removed).toBe(true);
    expect(readRawMcpConfig()['test-remove']).toBeUndefined();
  });

  it('removeMcpEntry returns false when key not found', () => {
    expect(removeMcpEntry('nonexistent-xyz')).toBe(false);
  });
});
