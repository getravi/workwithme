/**
 * Integration tests for the sidecar Express + WebSocket server.
 *
 * All heavy external dependencies (pi-coding-agent SDK, OAuth providers, sandbox,
 * skills, connectors) are mocked so the tests run without real credentials or a
 * running Anthropic API. The Express app itself is exercised end-to-end via
 * supertest (REST) and the ws library (WebSocket).
 *
 * Run with:
 *   pnpm exec vitest run --config vitest.integration.config.ts
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';

// ── Hoisted mock factories ────────────────────────────────────────────────────
// Variables referenced inside vi.mock() factory functions must be declared via
// vi.hoisted() so they are initialized before the factory closures execute.

const mocks = vi.hoisted(() => {
  // os/path are not yet available (vi.hoisted runs before imports), so require() inline.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { homedir, join: pathJoin } = { homedir: () => require('os').homedir(), join: require('path').join };

  const authStorage = {
    list: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  };

  const sessionManagerInstance = {
    getSessionId: vi.fn().mockReturnValue('sid-1'),
    getCwd: vi.fn().mockReturnValue(homedir()),
    getEntries: vi.fn().mockReturnValue([]),
    appendCustomEntry: vi.fn(),
  };

  const agentSession = {
    sessionManager: sessionManagerInstance,
    agent: {
      state: { model: null, messages: [] as unknown[], isStreaming: false },
      abort: vi.fn(),
      setModel: vi.fn(),
    },
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    prompt: vi.fn().mockResolvedValue(undefined),
    isStreaming: false,
  };

  return {
    authStorage,
    sessionManagerInstance,
    agentSession,
    // @mariozechner/pi-coding-agent
    createAgentSession: vi.fn().mockResolvedValue({ session: agentSession }),
    SessionManagerListAll: vi.fn().mockResolvedValue([]),
    SessionManagerContinueRecent: vi.fn().mockReturnValue(sessionManagerInstance),
    SessionManagerCreate: vi.fn().mockReturnValue(sessionManagerInstance),
    SessionManagerOpen: vi.fn().mockReturnValue(sessionManagerInstance),
    ModelRegistryGetAll: vi.fn().mockReturnValue([]),
    ModelRegistryFind: vi.fn().mockReturnValue(null),
    // @mariozechner/pi-ai
    getProviders: vi.fn().mockReturnValue(['anthropic']),
    // @mariozechner/pi-ai/oauth
    getOAuthProviders: vi.fn().mockReturnValue([{ id: 'google', name: 'Google' }]),
    getOAuthProvider: vi.fn().mockReturnValue(null),
    // skills
    listSkills: vi.fn().mockReturnValue({ user: [], example: [] }),
    writeUserSkill: vi.fn().mockReturnValue(pathJoin(homedir(), '.pi', 'skills', 'test.md')),
    getSkillContent: vi.fn().mockReturnValue(null),
    // connectors
    listConnectors: vi.fn().mockResolvedValue({ connectors: [] }),
    addRemoteMcpConnector: vi.fn().mockResolvedValue({
      entry: { id: 'r1', name: 'R1', url: 'https://example.com' },
    }),
    removeRemoteMcpConnector: vi.fn().mockResolvedValue({}),
    // misc
    auditLog: vi.fn(),
    setSendToClient: vi.fn(),
    grantApproval: vi.fn(),
    SandboxService: {
      isSupported: false,
      srtAvailable: false,
      warning: null,
      initialize: vi.fn().mockResolvedValue(undefined),
      generateMcpConfig: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// ── Module mocks (hoisted above imports by vitest) ────────────────────────────

vi.mock('@mariozechner/pi-coding-agent', () => ({
  AuthStorage: { create: () => mocks.authStorage },
  // Must be a class (not an arrow fn) because server.ts calls `new ModelRegistry(...)`.
  ModelRegistry: class {
    getAll() { return mocks.ModelRegistryGetAll(); }
    find(provider: string, modelId: string) { return mocks.ModelRegistryFind(provider, modelId); }
  },
  SessionManager: {
    listAll: mocks.SessionManagerListAll,
    continueRecent: mocks.SessionManagerContinueRecent,
    create: mocks.SessionManagerCreate,
    open: mocks.SessionManagerOpen,
  },
  createAgentSession: mocks.createAgentSession,
}));

vi.mock('@mariozechner/pi-ai', () => ({
  getProviders: mocks.getProviders,
}));

vi.mock('@mariozechner/pi-ai/oauth', () => ({
  getOAuthProviders: mocks.getOAuthProviders,
  getOAuthProvider: mocks.getOAuthProvider,
}));

vi.mock('pi-mcp-adapter', () => ({ default: {} }));
vi.mock('pi-subagents', () => ({ default: {} }));
vi.mock('./extensions/claude-tool.ts', () => ({ default: {} }));
vi.mock('./extensions/ai-labelling.ts', () => ({ default: {} }));
vi.mock('./extensions/sandbox-tools.js', () => ({
  default: {},
  setSendToClient: mocks.setSendToClient,
  grantApproval: mocks.grantApproval,
}));
vi.mock('./node_modules/glimpseui/pi-extension/index.ts', () => ({ default: {} }));
vi.mock('./node_modules/pi-smart-sessions/extensions/smart-sessions.ts', () => ({ default: {} }));
vi.mock('./node_modules/pi-parallel/extension/index.ts', () => ({ default: {} }));
vi.mock('./sandbox/SandboxService.js', () => ({ SandboxService: mocks.SandboxService }));
vi.mock('./skills.js', () => ({
  listSkills: mocks.listSkills,
  writeUserSkill: mocks.writeUserSkill,
  getSkillContent: mocks.getSkillContent,
}));
vi.mock('./connectors.js', () => ({
  listConnectors: mocks.listConnectors,
  addRemoteMcpConnector: mocks.addRemoteMcpConnector,
  removeRemoteMcpConnector: mocks.removeRemoteMcpConnector,
}));
vi.mock('./audit.js', () => ({ auditLog: mocks.auditLog }));

// ── Import the server after mocks are registered ──────────────────────────────

import { app, server } from './server.js';

const api = supertest(app);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns a path inside ~/.pi (valid for session path validation). */
const piPath = (...parts: string[]) => path.join(os.homedir(), '.pi', ...parts);

beforeEach(() => {
  // Reset call history between tests but keep default implementations
  vi.clearAllMocks();
  // Restore default return values that tests may have overridden
  mocks.authStorage.list.mockReturnValue([]);
  mocks.authStorage.set.mockReturnValue(undefined);
  mocks.getProviders.mockReturnValue(['anthropic']);
  mocks.getOAuthProviders.mockReturnValue([{ id: 'google', name: 'Google' }]);
  mocks.getOAuthProvider.mockReturnValue(null);
  mocks.SessionManagerListAll.mockResolvedValue([]);
  mocks.SessionManagerOpen.mockReturnValue(mocks.sessionManagerInstance);
  mocks.ModelRegistryGetAll.mockReturnValue([]);
  mocks.ModelRegistryFind.mockReturnValue(null);
  mocks.listSkills.mockReturnValue({ user: [], example: [] });
  mocks.writeUserSkill.mockReturnValue(path.join(os.homedir(), '.pi', 'skills', 'test.md'));
  mocks.getSkillContent.mockReturnValue(null);
  mocks.listConnectors.mockResolvedValue({ connectors: [] });
  mocks.addRemoteMcpConnector.mockResolvedValue({
    entry: { id: 'r1', name: 'R1', url: 'https://example.com' },
  });
  mocks.removeRemoteMcpConnector.mockResolvedValue({});
  mocks.createAgentSession.mockResolvedValue({ session: mocks.agentSession });
  mocks.agentSession.agent.state = { model: null, messages: [], isStreaming: false };
});

// ── Security headers ──────────────────────────────────────────────────────────

describe('Security headers', () => {
  it('X-Content-Type-Options: nosniff is set', async () => {
    const res = await api.get('/api/auth');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('X-Frame-Options: DENY is set', async () => {
    const res = await api.get('/api/auth');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('Referrer-Policy: no-referrer is set', async () => {
    const res = await api.get('/api/auth');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('Cache-Control: no-store is set', async () => {
    const res = await api.get('/api/auth');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// ── GET /api/auth ─────────────────────────────────────────────────────────────

describe('GET /api/auth', () => {
  it('returns empty configured list and available providers', async () => {
    const res = await api.get('/api/auth');
    expect(res.status).toBe(200);
    expect(res.body.configured).toEqual([]);
    expect(res.body.availableProviders).toEqual(['anthropic']);
  });

  it('reflects configured providers from AuthStorage', async () => {
    mocks.authStorage.list.mockReturnValue(['anthropic', 'google']);
    mocks.getProviders.mockReturnValue(['anthropic', 'google', 'openai']);
    const res = await api.get('/api/auth');
    expect(res.body.configured).toEqual(['anthropic', 'google']);
    expect(res.body.availableProviders).toHaveLength(3);
  });
});

// ── POST /api/auth/key ────────────────────────────────────────────────────────

describe('POST /api/auth/key', () => {
  it('400 when provider is missing', async () => {
    const res = await api.post('/api/auth/key').send({ key: 'sk-test-12345678' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing/i);
  });

  it('400 when key is missing', async () => {
    const res = await api.post('/api/auth/key').send({ provider: 'anthropic' });
    expect(res.status).toBe(400);
  });

  it('400 for invalid provider identifier (contains spaces)', async () => {
    const res = await api.post('/api/auth/key').send({ provider: 'bad provider', key: 'sk-test-12345678' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid provider/i);
  });

  it('400 for invalid provider identifier (special chars)', async () => {
    const res = await api.post('/api/auth/key').send({ provider: 'a!b', key: 'sk-test-12345678' });
    expect(res.status).toBe(400);
  });

  it('400 when key is shorter than 8 characters', async () => {
    const res = await api.post('/api/auth/key').send({ provider: 'anthropic', key: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid api key/i);
  });

  it('400 when key contains non-ASCII characters', async () => {
    const res = await api.post('/api/auth/key').send({ provider: 'anthropic', key: 'sk-tëst-key-12345678' });
    expect(res.status).toBe(400);
  });

  it('400 when key exceeds 512 characters', async () => {
    const res = await api.post('/api/auth/key').send({ provider: 'anthropic', key: 'x'.repeat(513) });
    expect(res.status).toBe(400);
  });

  it('200 on valid provider and key — stores in AuthStorage', async () => {
    const res = await api.post('/api/auth/key').send({ provider: 'anthropic', key: 'sk-test-valid-api-key-12345' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mocks.authStorage.set).toHaveBeenCalledWith(
      'anthropic',
      { type: 'api_key', key: 'sk-test-valid-api-key-12345' },
    );
  });

  it('200 accepts hyphenated provider id', async () => {
    const res = await api.post('/api/auth/key').send({ provider: 'my-provider-123', key: 'sk-test-valid-api-key' });
    expect(res.status).toBe(200);
  });
});

// ── GET /api/auth/oauth-providers ─────────────────────────────────────────────

describe('GET /api/auth/oauth-providers', () => {
  it('returns the list of OAuth providers', async () => {
    mocks.getOAuthProviders.mockReturnValue([
      { id: 'google', name: 'Google' },
      { id: 'github', name: 'GitHub' },
    ]);
    const res = await api.get('/api/auth/oauth-providers');
    expect(res.status).toBe(200);
    expect(res.body.providers).toHaveLength(2);
    expect(res.body.providers[0]).toMatchObject({ id: 'google', name: 'Google' });
  });

  it('returns only id and name (no internal fields)', async () => {
    mocks.getOAuthProviders.mockReturnValue([{ id: 'g', name: 'G', secret: 'do-not-leak' }]);
    const res = await api.get('/api/auth/oauth-providers');
    expect(res.body.providers[0]).toEqual({ id: 'g', name: 'G' });
    expect(res.body.providers[0].secret).toBeUndefined();
  });
});

// ── GET /api/auth/login (SSE) ─────────────────────────────────────────────────

describe('GET /api/auth/login', () => {
  it('400 when provider query param is missing', async () => {
    const res = await api.get('/api/auth/login');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing provider/i);
  });

  it('404 when provider is not registered', async () => {
    mocks.getOAuthProvider.mockReturnValue(null);
    const res = await api.get('/api/auth/login?provider=unknown');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('streams SSE events for a known provider that errors', async () => {
    mocks.getOAuthProvider.mockReturnValue({
      login: vi.fn().mockRejectedValue(new Error('Auth cancelled')),
    });
    const res = await api.get('/api/auth/login?provider=google');
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('Auth cancelled');
  });
});

// ── GET /api/models ───────────────────────────────────────────────────────────

describe('GET /api/models', () => {
  it('returns all models and null currentModel when no session matches', async () => {
    mocks.ModelRegistryGetAll.mockReturnValue([
      { id: 'claude-3', provider: 'anthropic', name: 'Claude 3' },
    ]);
    const res = await api.get('/api/models?sessionId=nonexistent');
    expect(res.status).toBe(200);
    expect(res.body.models).toHaveLength(1);
    expect(res.body.models[0]).toMatchObject({ id: 'claude-3', provider: 'anthropic' });
    expect(res.body.currentModel).toBeNull();
  });

  it('includes provider in model name', async () => {
    mocks.ModelRegistryGetAll.mockReturnValue([
      { id: 'claude-3-opus', provider: 'anthropic', name: 'Claude 3 Opus' },
    ]);
    const res = await api.get('/api/models');
    expect(res.body.models[0].name).toBe('anthropic / Claude 3 Opus');
  });
});

// ── POST /api/model ───────────────────────────────────────────────────────────

describe('POST /api/model', () => {
  // The handler validates session existence *before* body fields, so these
  // validation tests first create a session via POST /api/project.
  it('400 when provider is missing (session exists)', async () => {
    const setup = await api.post('/api/project').send({ path: os.homedir() });
    const { sessionId } = setup.body;
    const res = await api.post('/api/model').send({ modelId: 'claude-3', sessionId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing/i);
  });

  it('400 when modelId is missing (session exists)', async () => {
    const setup = await api.post('/api/project').send({ path: os.homedir() });
    const { sessionId } = setup.body;
    const res = await api.post('/api/model').send({ provider: 'anthropic', sessionId });
    expect(res.status).toBe(400);
  });

  it('503 when sessionId does not exist in sessionMap', async () => {
    const res = await api.post('/api/model').send({
      provider: 'anthropic',
      modelId: 'claude-3',
      sessionId: 'no-such-session',
    });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/session not found/i);
  });

  it('404 when model is not found in registry', async () => {
    const setup = await api.post('/api/project').send({ path: os.homedir() });
    const { sessionId } = setup.body;
    mocks.ModelRegistryFind.mockReturnValue(null);
    const res = await api.post('/api/model').send({ provider: 'anthropic', modelId: 'nonexistent', sessionId });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ── POST /api/stop ────────────────────────────────────────────────────────────

describe('POST /api/stop', () => {
  it('503 when sessionId does not exist', async () => {
    const res = await api.post('/api/stop').send({ sessionId: 'no-such-session' });
    expect(res.status).toBe(503);
  });
});

// ── GET /api/sessions ─────────────────────────────────────────────────────────

describe('GET /api/sessions', () => {
  it('returns empty array when no sessions exist', async () => {
    mocks.SessionManagerListAll.mockResolvedValue([]);
    const res = await api.get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns sessions with archive state from session entries', async () => {
    const fakePath = piPath('sessions', 'abc123');
    mocks.SessionManagerListAll.mockResolvedValue([
      { id: 'abc123', path: fakePath, title: 'Test session' },
    ]);
    mocks.SessionManagerOpen.mockReturnValue({
      getSessionId: vi.fn().mockReturnValue('abc123'),
      getEntries: vi.fn().mockReturnValue([]),
      appendCustomEntry: vi.fn(),
    });

    const res = await api.get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 'abc123', archived: false });
  });

  it('filters archived sessions by default', async () => {
    const fakePath = piPath('sessions', 'archived-session');
    mocks.SessionManagerListAll.mockResolvedValue([
      { id: 'archived-session', path: fakePath, title: 'Old' },
    ]);
    mocks.SessionManagerOpen.mockReturnValue({
      getSessionId: vi.fn(),
      getEntries: vi.fn().mockReturnValue([
        {
          type: 'custom',
          customType: 'workwithme.archive',
          data: { archived: true, archivedAt: '2025-01-01T00:00:00Z' },
        },
      ]),
      appendCustomEntry: vi.fn(),
    });

    const res = await api.get('/api/sessions');
    expect(res.body).toHaveLength(0);

    const resWithArchived = await api.get('/api/sessions?includeArchived=true');
    expect(resWithArchived.body).toHaveLength(1);
    expect(resWithArchived.body[0].archived).toBe(true);
  });
});

// ── POST /api/sessions/archive ────────────────────────────────────────────────

describe('POST /api/sessions/archive', () => {
  it('400 when path is missing', async () => {
    const res = await api.post('/api/sessions/archive').send({ archived: true });
    expect(res.status).toBe(400);
  });

  it('400 when archived flag is missing', async () => {
    const res = await api.post('/api/sessions/archive').send({ path: piPath('sessions', 'x') });
    expect(res.status).toBe(400);
  });

  it('400 for path traversal outside ~/.pi', async () => {
    const res = await api.post('/api/sessions/archive').send({ path: '/etc/passwd', archived: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid session path/i);
  });

  it('400 when path escapes ~/.pi via traversal', async () => {
    const res = await api.post('/api/sessions/archive').send({
      path: piPath('..', 'escape'),
      archived: true,
    });
    expect(res.status).toBe(400);
  });

  it('200 for a valid ~/.pi session path', async () => {
    const sessionPath = piPath('sessions', 'test-session-001');
    const archivedAt = '2025-06-01T12:00:00.000Z';
    mocks.SessionManagerOpen.mockReturnValue({
      getSessionId: vi.fn().mockReturnValue('test-session-001'),
      getEntries: vi.fn().mockReturnValue([
        {
          type: 'custom',
          customType: 'workwithme.archive',
          data: { archived: true, archivedAt },
        },
      ]),
      appendCustomEntry: vi.fn(),
    });

    const res = await api.post('/api/sessions/archive').send({ path: sessionPath, archived: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.archived).toBe(true);
    expect(res.body.archivedAt).toBe(archivedAt);
  });
});

// ── POST /api/sessions/load ───────────────────────────────────────────────────

describe('POST /api/sessions/load', () => {
  it('400 when path is missing', async () => {
    const res = await api.post('/api/sessions/load').send({});
    expect(res.status).toBe(400);
  });

  it('400 for path outside ~/.pi', async () => {
    const res = await api.post('/api/sessions/load').send({ path: '/tmp/evil' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid session path/i);
  });

  it('400 for a ~/.pi-adjacent path (no traversal allowed)', async () => {
    const res = await api.post('/api/sessions/load').send({ path: piPath('..', 'other') });
    expect(res.status).toBe(400);
  });

  it('200 for a valid ~/.pi session path — returns sessionId and messages', async () => {
    const sessionPath = piPath('sessions', 'restore-me');
    mocks.agentSession.sessionManager.getCwd.mockReturnValue('/home/test/project');
    mocks.agentSession.agent.state = { model: null, messages: [], isStreaming: false };

    const res = await api.post('/api/sessions/load').send({ path: sessionPath });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sessionId).toBe('sid-1');
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(Array.isArray(res.body.toolExecutions)).toBe(true);
  });
});

// ── GET /api/project ──────────────────────────────────────────────────────────

describe('GET /api/project', () => {
  it('returns null cwd when sessionId does not exist in sessionMap', async () => {
    const res = await api.get('/api/project?sessionId=nonexistent');
    expect(res.status).toBe(200);
    expect(res.body.cwd).toBeNull();
  });
});

// ── POST /api/project ─────────────────────────────────────────────────────────

describe('POST /api/project', () => {
  it('400 when path is missing', async () => {
    const res = await api.post('/api/project').send({});
    expect(res.status).toBe(400);
  });

  it('400 for path outside home directory (/etc)', async () => {
    const res = await api.post('/api/project').send({ path: '/etc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/home directory/i);
  });

  it('400 for absolute path that does not exist', async () => {
    const res = await api.post('/api/project').send({
      path: path.join(os.homedir(), 'definitely-does-not-exist-xyz-abc'),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not exist/i);
  });

  it('200 for home directory — creates new session and returns cwd', async () => {
    mocks.agentSession.sessionManager.getCwd.mockReturnValue(os.homedir());
    const res = await api.post('/api/project').send({ path: os.homedir() });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cwd).toBe(os.homedir());
    expect(res.body.sessionId).toBe('sid-1');
    expect(mocks.createAgentSession).toHaveBeenCalled();
  });
});

// ── GET /api/sandbox/status ───────────────────────────────────────────────────

describe('GET /api/sandbox/status', () => {
  it('returns sandbox availability info from SandboxService', async () => {
    const res = await api.get('/api/sandbox/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      supported: false,
      srtAvailable: false,
      active: false,
      platform: process.platform,
    });
  });
});

// ── GET /api/skills ───────────────────────────────────────────────────────────

describe('GET /api/skills', () => {
  it('returns the skill list from listSkills', async () => {
    mocks.listSkills.mockReturnValue({ user: [{ slug: 'my-skill', name: 'My Skill' }], example: [] });
    const res = await api.get('/api/skills');
    expect(res.status).toBe(200);
    expect(res.body.user).toHaveLength(1);
    expect(res.body.user[0].slug).toBe('my-skill');
  });
});

// ── GET /api/skills/:source/:slug ─────────────────────────────────────────────

describe('GET /api/skills/:source/:slug', () => {
  it('400 for invalid source', async () => {
    const res = await api.get('/api/skills/admin/my-skill');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid source/i);
  });

  it('400 for slug containing path traversal characters', async () => {
    // Express decodes %2F so the router won't match, but test with dots
    const res = await api.get('/api/skills/user/bad..slug');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid slug/i);
  });

  it('400 for slug with uppercase and special chars', async () => {
    const res = await api.get('/api/skills/user/Bad_Slug!');
    expect(res.status).toBe(400);
  });

  it('404 when skill not found', async () => {
    mocks.getSkillContent.mockReturnValue(null);
    const res = await api.get('/api/skills/user/missing-skill');
    expect(res.status).toBe(404);
  });

  it('200 with skill content', async () => {
    mocks.getSkillContent.mockReturnValue('# My Skill\nContent here');
    const res = await api.get('/api/skills/example/my-skill');
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('# My Skill\nContent here');
  });

  it('accepts alphanumeric slugs with hyphens', async () => {
    mocks.getSkillContent.mockReturnValue('body');
    const res = await api.get('/api/skills/user/my-skill-123');
    expect(res.status).toBe(200);
  });
});

// ── POST /api/skills ──────────────────────────────────────────────────────────

describe('POST /api/skills', () => {
  it('400 when name is missing', async () => {
    const res = await api.post('/api/skills').send({ content: 'Some content' });
    expect(res.status).toBe(400);
  });

  it('400 when content is missing', async () => {
    const res = await api.post('/api/skills').send({ name: 'my-skill' });
    expect(res.status).toBe(400);
  });

  it('400 when content exceeds 100KB', async () => {
    const res = await api.post('/api/skills').send({
      name: 'big-skill',
      content: 'x'.repeat(100_001),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds maximum/i);
  });

  it('200 on valid skill creation', async () => {
    mocks.writeUserSkill.mockReturnValue(path.join(os.homedir(), '.pi', 'skills', 'new-skill.md'));
    const res = await api.post('/api/skills').send({ name: 'new-skill', content: '# New Skill' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('409 when skill name already exists', async () => {
    mocks.writeUserSkill.mockImplementation(() => { throw new Error('Skill already exists'); });
    const res = await api.post('/api/skills').send({ name: 'dupe', content: '# Dupe' });
    expect(res.status).toBe(409);
  });
});

// ── GET /api/connectors ───────────────────────────────────────────────────────

describe('GET /api/connectors', () => {
  it('returns connector list from listConnectors', async () => {
    mocks.listConnectors.mockResolvedValue({
      connectors: [{ id: 'c1', name: 'Stripe', type: 'remote-mcp', status: 'available' }],
    });
    const res = await api.get('/api/connectors');
    expect(res.status).toBe(200);
    expect(res.body.connectors).toHaveLength(1);
    expect(res.body.connectors[0].name).toBe('Stripe');
  });

  it('500 when listConnectors throws', async () => {
    mocks.listConnectors.mockRejectedValue(new Error('disk error'));
    const res = await api.get('/api/connectors');
    expect(res.status).toBe(500);
    // safeError should not leak internal path info
    expect(res.body.error).toBeTruthy();
  });
});

// ── POST /api/connectors/remote-mcp ──────────────────────────────────────────

describe('POST /api/connectors/remote-mcp', () => {
  it('400 when required fields are missing', async () => {
    const res = await api.post('/api/connectors/remote-mcp').send({ id: 'r1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing required fields/i);
  });

  it('200 returns the new connector entry', async () => {
    mocks.addRemoteMcpConnector.mockResolvedValue({
      entry: { id: 'remote-mcp/stripe', name: 'Stripe', url: 'https://mcp.stripe.com' },
    });
    const res = await api.post('/api/connectors/remote-mcp').send({
      id: 'remote-mcp/stripe',
      name: 'Stripe',
      url: 'https://mcp.stripe.com',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('remote-mcp/stripe');
  });

  it('forwards error status from addRemoteMcpConnector (SSRF block)', async () => {
    mocks.addRemoteMcpConnector.mockResolvedValue({
      error: { status: 422, message: 'SSRF: private address blocked', field: 'url' },
    });
    const res = await api.post('/api/connectors/remote-mcp').send({
      id: 'r1',
      name: 'R1',
      url: 'http://10.0.0.1/mcp',
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('SSRF: private address blocked');
    expect(res.body.field).toBe('url');
  });
});

// ── DELETE /api/connectors/remote-mcp/:id ────────────────────────────────────

describe('DELETE /api/connectors/remote-mcp/:id', () => {
  it('204 on successful removal', async () => {
    mocks.removeRemoteMcpConnector.mockResolvedValue({});
    const res = await api.delete('/api/connectors/remote-mcp/remote-mcp%2Fstripe');
    expect(res.status).toBe(204);
  });

  it('forwards error status from removeRemoteMcpConnector', async () => {
    mocks.removeRemoteMcpConnector.mockResolvedValue({
      error: { status: 500, message: 'Keychain failure' },
    });
    const res = await api.delete('/api/connectors/remote-mcp/remote-mcp%2Fstripe');
    expect(res.status).toBe(500);
  });
});

// ── safeError (indirectly via endpoint errors) ────────────────────────────────

describe('safeError sanitisation', () => {
  it('does not expose stack traces or file paths in 500 responses', async () => {
    mocks.listConnectors.mockRejectedValue(
      Object.assign(new Error('fail at /home/user/node_modules/pkg/index.js:42'), {
        stack: 'Error: fail\n    at /home/user/node_modules/pkg/index.js:42\n    at ...',
      }),
    );
    const res = await api.get('/api/connectors');
    expect(res.status).toBe(500);
    // The path and stack should be replaced by the generic fallback
    expect(res.body.error).not.toContain('/home/user');
    expect(res.body.error).not.toContain('node_modules');
    expect(res.body.error).not.toContain('    at ');
  });
});

// ── WebSocket tests ───────────────────────────────────────────────────────────
// These tests require the HTTP server to be actively listening so that ws
// connections can be established. We start on port 0 (OS-assigned) in
// beforeAll and shut down in afterAll.

describe('WebSocket', () => {
  let wsPort: number;

  const connect = (port: number) =>
    new Promise<WsClient>((resolve, reject) => {
      const ws = new WsClient(`ws://127.0.0.1:${port}`);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });

  const nextMessage = (ws: WsClient) =>
    new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    });

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          wsPort = (server.address() as AddressInfo).port;
          resolve();
        });
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );

  it('rejects the 6th connection (MAX_WS_CONNECTIONS = 5)', async () => {
    // Establish 5 legitimate connections
    const clients: WsClient[] = [];
    for (let i = 0; i < 5; i++) {
      clients.push(await connect(wsPort));
    }

    // The 6th should be closed with code 1013
    const sixth = new WsClient(`ws://127.0.0.1:${wsPort}`);
    const closeCode = await new Promise<number>((resolve) => {
      sixth.once('close', (code) => resolve(code));
    });
    expect(closeCode).toBe(1013);

    // Await server-side close for each connection so the next test starts clean.
    await Promise.all(
      clients.map(
        (c) =>
          new Promise<void>((resolve) => {
            c.once('close', resolve);
            c.close();
          }),
      ),
    );
  });

  it('connection survives invalid JSON — subsequent valid messages still processed', async () => {
    const ws = await connect(wsPort);
    ws.send('not-json');
    // Server swallows bare parse errors; verify the connection is still alive by
    // sending a schema-invalid message (type > 64 chars) and receiving an error response.
    const msg = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'x'.repeat(65) }));
    const response = await msg;
    expect((response as { type: string }).type).toBe('error');
    ws.close();
  });

  it('sends error for schema-invalid messages (type too long)', async () => {
    const ws = await connect(wsPort);
    const msg = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'x'.repeat(65) }));
    const response = await msg;
    expect((response as { type: string }).type).toBe('error');
    ws.close();
  });

  it('closes connection with 1009 when message exceeds 10 MB', async () => {
    const ws = await connect(wsPort);
    const closeCode = await new Promise<number>((resolve) => {
      ws.once('close', (code) => resolve(code));
      // Send a Buffer larger than MAX_WS_MESSAGE_BYTES (10 MB)
      ws.send(Buffer.alloc(10_485_761));
    });
    expect(closeCode).toBe(1009);
  });

  it('closes connection with 1008 after exceeding rate limit (>10 msg/sec)', async () => {
    const ws = await connect(wsPort);
    const closeCode = await new Promise<number>((resolve) => {
      ws.once('close', (code) => resolve(code));
      // Send 11 messages synchronously to trip the 10 msg/sec limit
      for (let i = 0; i < 11; i++) {
        ws.send(JSON.stringify({ type: 'join' }));
      }
    });
    expect(closeCode).toBe(1008);
  });
});
