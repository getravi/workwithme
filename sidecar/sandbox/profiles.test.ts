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
