import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listConnectors,
  REMOTE_MCP_CATALOG,
  CATALOG_SLUGS,
  keychainGet,
  keychainSet,
  keychainDelete,
  readRawMcpConfig,
  writeMcpEntry,
  removeMcpEntry,
  addRemoteMcpConnector,
  removeRemoteMcpConnector,
} from './connectors.js';
import keytar from 'keytar';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

const MCP_PATH = join(homedir(), '.pi', 'agent', 'mcp.json');

// ── listConnectors ──────────────────────────────────────────────────────────

describe('listConnectors', () => {
  beforeEach(() => {
    vi.mocked(keytar.getPassword).mockResolvedValue(null);
    mockLoadMcpConfig.mockReturnValue({ mcpServers: {} });
  });

  it('returns { connectors, warning? } shape', async () => {
    const mockAuth = { list: () => [] } as any;
    const result = await listConnectors(mockAuth);
    expect(result).toHaveProperty('connectors');
    expect(Array.isArray(result.connectors)).toBe(true);
  });

  it('includes all catalog entries as type remote-mcp', async () => {
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const remoteMcp = connectors.filter(c => c.type === 'remote-mcp');
    expect(remoteMcp.length).toBe(REMOTE_MCP_CATALOG.length);
  });

  it('catalog entry is available when not in mcp.json', async () => {
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const stripe = connectors.find(c => c.id === 'remote-mcp/stripe');
    expect(stripe?.status).toBe('available');
  });

  it('catalog entry is available and stale keychain entry is deleted when keychain-only', async () => {
    vi.mocked(keytar.getPassword).mockImplementation(async (_svc, account) =>
      account === 'remote-mcp/stripe' ? 'stale_token' : null
    );
    vi.mocked(keytar.deletePassword).mockResolvedValue(true);
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const stripe = connectors.find(c => c.id === 'remote-mcp/stripe');
    expect(stripe?.status).toBe('available');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(keytar.deletePassword).toHaveBeenCalledWith('workwithme', 'remote-mcp/stripe');
  });

  it('catalog entry is connected when in mcp.json AND keychain has token', async () => {
    mockLoadMcpConfig.mockReturnValue({ mcpServers: { stripe: { url: 'https://mcp.stripe.com', type: 'streamable-http' } } });
    vi.mocked(keytar.getPassword).mockImplementation(async (_svc, account) =>
      account === 'remote-mcp/stripe' ? 'tok_123' : null
    );
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const stripe = connectors.find(c => c.id === 'remote-mcp/stripe');
    expect(stripe?.status).toBe('connected');
  });

  it('catalog entry is available when in mcp.json but no keychain token', async () => {
    mockLoadMcpConfig.mockReturnValue({ mcpServers: { stripe: { url: 'https://mcp.stripe.com', type: 'streamable-http' } } });
    vi.mocked(keytar.getPassword).mockResolvedValue(null);
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const stripe = connectors.find(c => c.id === 'remote-mcp/stripe');
    expect(stripe?.status).toBe('available');
  });

  it('response order: oauth first, then remote-mcp, then local mcp', async () => {
    mockLoadMcpConfig.mockReturnValue({ mcpServers: { mylocal: { command: 'node', args: ['server.js'] } } });
    const mockAuth = { list: () => ['anthropic'] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const types = connectors.map(c => c.type);
    const firstOAuth = types.indexOf('oauth');
    const firstRemote = types.indexOf('remote-mcp');
    const firstLocal = types.indexOf('mcp');
    expect(firstOAuth).toBeLessThan(firstRemote);
    expect(firstRemote).toBeLessThan(firstLocal);
  });

  it('local mcp entry matching catalog slug is not duplicated as type mcp', async () => {
    mockLoadMcpConfig.mockReturnValue({ mcpServers: { stripe: { url: 'https://mcp.stripe.com', type: 'streamable-http' } } });
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const localStripe = connectors.find(c => c.type === 'mcp' && c.id === 'mcp/stripe');
    expect(localStripe).toBeUndefined();
  });

  it('returns warning field when keychain read fails', async () => {
    vi.mocked(keytar.getPassword).mockRejectedValue(new Error('keychain locked'));
    const mockAuth = { list: () => [] } as any;
    const { connectors, warning } = await listConnectors(mockAuth);
    expect(warning).toBeTruthy();
    expect(connectors.every(c => c.type !== 'remote-mcp' || c.status === 'available')).toBe(true);
  });

  it('local mcp entries have category Local', async () => {
    mockLoadMcpConfig.mockReturnValue({ mcpServers: { mylocal: { command: 'node', args: ['server.js'] } } });
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const local = connectors.find(c => c.id === 'mcp/mylocal');
    expect(local?.category).toBe('Local');
  });

  it('marks configured oauth providers as connected', async () => {
    const mockAuth = { list: () => ['anthropic'] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const anthropic = connectors.find(c => c.id === 'oauth/anthropic');
    expect(anthropic?.status).toBe('connected');
    expect(anthropic?.type).toBe('oauth');
  });

  it('marks unconfigured oauth providers as available', async () => {
    const mockAuth = { list: () => ['anthropic'] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const google = connectors.find(c => c.id === 'oauth/google');
    expect(google?.status).toBe('available');
  });

  it('returns empty mcp list when loadMcpConfig throws, oauth and catalog still returned', async () => {
    mockLoadMcpConfig.mockImplementationOnce(() => { throw new Error('config error'); });
    const mockAuth = { list: () => ['anthropic'] } as any;
    const { connectors } = await listConnectors(mockAuth);
    expect(connectors.filter(c => c.type === 'mcp')).toHaveLength(0);
    expect(connectors.some(c => c.type === 'oauth')).toBe(true);
  });
});

// ── REMOTE_MCP_CATALOG ──────────────────────────────────────────────────────

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

// ── Keychain helpers ──────────────────────────────────────────────────────────

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

// ── mcp.json helpers ──────────────────────────────────────────────────────────

describe('writeMcpEntry / readRawMcpConfig / removeMcpEntry', () => {
  let originalContent: string | null = null;
  beforeEach(() => {
    originalContent = existsSync(MCP_PATH) ? readFileSync(MCP_PATH, 'utf-8') : null;
  });
  afterEach(() => {
    if (originalContent !== null) {
      writeFileSync(MCP_PATH, originalContent, 'utf-8');
    } else if (existsSync(MCP_PATH)) {
      unlinkSync(MCP_PATH);
    }
  });

  it('writeMcpEntry adds entry to mcp.json', () => {
    writeMcpEntry('test-server', 'https://test.example.com');
    const servers = readRawMcpConfig();
    expect(servers['test-server']).toEqual({ url: 'https://test.example.com', type: 'streamable-http' });
  });

  it('readRawMcpConfig returns {} when file missing', () => {
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

// ── addRemoteMcpConnector ─────────────────────────────────────────────────────

describe('addRemoteMcpConnector', () => {
  let originalContent: string | null = null;
  beforeEach(() => {
    originalContent = existsSync(MCP_PATH) ? readFileSync(MCP_PATH, 'utf-8') : null;
    vi.mocked(keytar.setPassword).mockResolvedValue(undefined as any);
    vi.mocked(keytar.getPassword).mockResolvedValue(null);
  });
  afterEach(() => {
    if (originalContent !== null) {
      writeFileSync(MCP_PATH, originalContent, 'utf-8');
    } else if (existsSync(MCP_PATH)) {
      unlinkSync(MCP_PATH);
    }
  });

  it('rejects id with invalid chars', async () => {
    const result = await addRemoteMcpConnector({ id: 'UPPER', name: 'Test', url: 'https://example.com', token: 'tok' });
    expect(result.error?.field).toBe('id');
  });

  it('rejects catalog slug as custom connector', async () => {
    const result = await addRemoteMcpConnector({ id: 'stripe', name: 'Stripe', url: 'https://example.com', token: 'tok' });
    expect(result.error?.message).toMatch(/reserved/i);
  });

  it('rejects url not starting with https://', async () => {
    const result = await addRemoteMcpConnector({ id: 'my-server', name: 'My', url: 'http://example.com', token: 'tok' });
    expect(result.error?.field).toBe('url');
  });

  it('rejects missing token when requiresToken is true (custom)', async () => {
    const result = await addRemoteMcpConnector({ id: 'my-server', name: 'My', url: 'https://example.com' });
    expect(result.error?.field).toBe('token');
  });

  it('returns connected entry on success', async () => {
    const result = await addRemoteMcpConnector({ id: 'my-server', name: 'My Server', url: 'https://example.com', token: 'tok' });
    expect(result.entry?.status).toBe('connected');
    expect(result.entry?.id).toBe('remote-mcp/my-server');
  });

  it('409 on duplicate id already in mcp.json', async () => {
    writeMcpEntry('my-server', 'https://existing.example.com');
    const result = await addRemoteMcpConnector({ id: 'my-server', name: 'My', url: 'https://new.example.com', token: 'tok' });
    expect(result.error?.status).toBe(409);
    expect(result.error?.message).toMatch(/already exists/i);
  });

  it('409 on duplicate URL already in mcp.json', async () => {
    writeMcpEntry('other-server', 'https://duplicate.example.com');
    const result = await addRemoteMcpConnector({ id: 'new-server', name: 'New', url: 'https://duplicate.example.com', token: 'tok' });
    expect(result.error?.status).toBe(409);
    expect(result.error?.message).toMatch(/url already exists/i);
  });

  it('id duplicate check runs before url duplicate check', async () => {
    writeMcpEntry('same-id', 'https://same-url.example.com');
    const result = await addRemoteMcpConnector({ id: 'same-id', name: 'X', url: 'https://same-url.example.com', token: 'tok' });
    expect(result.error?.message).toMatch(/name already exists/i);
  });
});

// ── removeRemoteMcpConnector ──────────────────────────────────────────────────

describe('removeRemoteMcpConnector', () => {
  it('returns notFound if not in mcp.json and not in keychain', async () => {
    vi.mocked(keytar.deletePassword).mockResolvedValue(false);
    const result = await removeRemoteMcpConnector('nonexistent-xyz');
    expect(result.notFound).toBe(true);
  });

  it('returns success when removed from keychain', async () => {
    vi.mocked(keytar.deletePassword).mockResolvedValue(true);
    const result = await removeRemoteMcpConnector('my-server');
    expect(result.success).toBe(true);
  });

  it('rejects invalid slug', async () => {
    const result = await removeRemoteMcpConnector('INVALID!');
    expect(result.error).toBeTruthy();
  });
});
