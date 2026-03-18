import { describe, it, expect, vi } from 'vitest';
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
