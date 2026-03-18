import { getOAuthProviders } from '@mariozechner/pi-ai/oauth';
import { loadMcpConfig } from 'pi-mcp-adapter/config';
import type { AuthStorage } from '@mariozechner/pi-coding-agent';

export interface ConnectorEntry {
  id: string;
  name: string;
  description: string;
  type: 'oauth' | 'mcp';
  status: 'connected' | 'available';
}

const OAUTH_DESCRIPTIONS: Record<string, string> = {
  anthropic: 'Sign in with your Anthropic account',
  google: 'Access Google services',
  github: 'Access your GitHub repositories',
  openai: 'Connect with OpenAI',
};

export function listConnectors(authStorage: AuthStorage): ConnectorEntry[] {
  const configured = new Set(authStorage.list());

  const oauthConnectors: ConnectorEntry[] = getOAuthProviders().map((p) => ({
    id: `oauth/${p.id}`,
    name: p.name,
    description: OAUTH_DESCRIPTIONS[p.id] ?? `Connect with ${p.name}`,
    type: 'oauth',
    status: configured.has(p.id) ? 'connected' : 'available',
  }));

  let mcpConnectors: ConnectorEntry[] = [];
  try {
    const config = loadMcpConfig();
    mcpConnectors = Object.keys(config.mcpServers).map((name) => ({
      id: `mcp/${name}`,
      name,
      description: 'MCP server',
      type: 'mcp',
      status: 'connected',
    }));
  } catch {
    // loadMcpConfig logs warnings internally; return empty list on failure
  }

  return [...oauthConnectors, ...mcpConnectors];
}
