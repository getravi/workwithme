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
 * Within each section, keys present in `overrides` replace their base counterpart; absent keys are inherited. Arrays are replaced value-for-value (no union).
 * Section-level override: pass the full section object to replace all keys.
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
