import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager
} from "@mariozechner/pi-coding-agent";
import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { getProviders } from "@mariozechner/pi-ai";
import { getOAuthProviders, getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import path from 'path';
import os from 'os';
import { statSync } from 'fs';
import { randomUUID } from 'crypto';
import { WS_EVENTS } from '../src/types.js';

import piMcpAdapter from "pi-mcp-adapter";
import piSubagents from "pi-subagents";
// @ts-ignore - no types published for glimpseui
import glimpse from "./node_modules/glimpseui/pi-extension/index.ts";
// @ts-ignore
import piSmartSessions from "./node_modules/pi-smart-sessions/extensions/smart-sessions.ts";
// @ts-ignore
import piParallel from "./node_modules/pi-parallel/extension/index.ts";
// @ts-ignore
import aiLabelling from "./extensions/ai-labelling.ts";
// @ts-ignore
import claudeTool from "./extensions/claude-tool.ts";
import sandboxToolsExtension, { setSendToClient, grantApproval } from "./extensions/sandbox-tools.js";
import { SandboxService } from "./sandbox/SandboxService.js";
import { listSkills, writeUserSkill, getSkillContent } from './skills.js';
import { listConnectors, addRemoteMcpConnector, removeRemoteMcpConnector } from './connectors.js';
import { auditLog } from './audit.js';
import { Type } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { rateLimit } from 'express-rate-limit';


// Basic express setup
const app = express();
app.use(cors({
  origin: ['http://localhost:1420', 'http://127.0.0.1:1420'],
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json({ limit: '1mb' }));

// Security headers — defense-in-depth for a localhost API server
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Rate limiting — prevents DoS / runaway callers from a compromised local process.
// Localhost-only server so IP is always 127.0.0.1; limits are per sliding window.
const authKeyLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: false,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const oauthLoginLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: false,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const generalApiLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: false,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

app.use('/api/', generalApiLimiter);
app.post('/api/auth/key', authKeyLimiter);
app.get('/api/auth/login', oauthLoginLimiter);

/**
 * Returns a safe error string suitable for client consumption.
 * Logs the full error internally; returns a generic message that avoids
 * exposing stack traces, file paths, or internal state.
 */
function safeError(err: unknown, fallback = 'An internal error occurred'): string {
  // For known, user-facing error strings (e.g. from SDK validation) return as-is.
  // For Error objects with a short, non-stack message, return the message.
  // Anything else (stack traces, paths) → generic fallback.
  if (err instanceof Error) {
    const msg = err.message;
    // Reject messages that look like stack traces or contain file paths
    if (msg.includes('\n') || msg.includes('    at ') || msg.includes('/') || msg.includes('\\')) {
      return fallback;
    }
    return msg.length < 200 ? msg : fallback;
  }
  const s = String(err);
  return s.length < 200 && !s.includes('\n') ? s : fallback;
}

const server = createServer(app);
const wss = new WebSocketServer({ server });

interface ClientRecord {
  ws: WebSocket;
  subscriber: (() => void) | null;
  sessionId?: string;
}

const sessionMap = new Map<string, AgentSession>();
const clients = new Set<ClientRecord>();
// A local desktop app legitimately needs at most 2-3 WS connections (e.g. app + devtools).
// 50 was far too high and invited resource exhaustion.
const MAX_WS_CONNECTIONS = 5;
const ARCHIVE_CUSTOM_TYPE = 'workwithme.archive';

type ArchiveEntryData = {
  archived?: boolean;
  archivedAt?: string;
};

type SessionListItem = Awaited<ReturnType<typeof SessionManager.listAll>>[number] & {
  archived: boolean;
  archivedAt?: string;
};

function getArchiveState(sessionPath: string): ArchiveEntryData {
  try {
    const manager = SessionManager.open(sessionPath);
    const entries = manager.getEntries();

    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry.type !== 'custom' || entry.customType !== ARCHIVE_CUSTOM_TYPE) continue;

      const data = (entry.data ?? {}) as ArchiveEntryData;
      return {
        archived: Boolean(data.archived),
        archivedAt: data.archivedAt
      };
    }
  } catch (err) {
    console.warn(`[sessions] Failed to read archive state for ${sessionPath}:`, err);
  }

  return { archived: false };
}

async function listSessions(includeArchived = false): Promise<SessionListItem[]> {
  const sessions = await SessionManager.listAll();
  const withArchiveState = sessions.map((session) => {
    const archiveState = getArchiveState(session.path);
    return {
      ...session,
      archived: Boolean(archiveState.archived),
      archivedAt: archiveState.archivedAt
    };
  });

  return withArchiveState.filter((session) => includeArchived || !session.archived);
}

function broadcastSubscription(sessionId: string): void {
  const session = sessionMap.get(sessionId);
  if (!session) return;

  for (const client of clients) {
    if (client.sessionId === sessionId) {
      if (client.subscriber) {
        client.subscriber(); // unsubscribe old
      }
      client.subscriber = session.subscribe((event) => {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify(event));
        }
      });
    }
  }
}

// Make authStorage and modelRegistry accessible globally for API endpoints
const globalAuthStorage = AuthStorage.create();
const globalModelRegistry = new ModelRegistry(globalAuthStorage);

function getSession(sessionId: string | undefined): AgentSession | undefined {
  return sessionId ? sessionMap.get(sessionId) : sessionMap.values().next().value;
}

// Initialize Agent
type InitSessionOptions =
  | { mode: 'continue'; cwd?: string }
  | { mode: 'new';      cwd?: string }
  | { mode: 'open';     sessionPath: string };

async function initSession(opts: InitSessionOptions = { mode: 'continue' }): Promise<AgentSession> {
    try {
      const cwd = opts.mode !== 'open' ? (opts.cwd ?? process.cwd()) : process.cwd();
      const config: {
        authStorage: AuthStorage;
        modelRegistry: ModelRegistry;
        cwd: string;
        sessionManager?: SessionManager;
      } = {
        authStorage: globalAuthStorage,
        modelRegistry: globalModelRegistry,
        cwd
      };

      if (opts.mode === 'open') {
        const { sessionPath } = opts;
        if (sessionPath.endsWith('/') || path.extname(sessionPath) === '') {
          console.warn(`[initSession] sessionPath looks like a directory: ${sessionPath}`);
        }
        config.sessionManager = SessionManager.open(sessionPath);
      } else if (opts.mode === 'new') {
        config.sessionManager = SessionManager.create(cwd);
      } else {
        config.sessionManager = SessionManager.continueRecent(cwd);
      }

      // Add desktop-class extensions.
      // sandboxToolsExtension must be first so its user_bash hook wraps execution
      // before any other extension can observe or modify the bash event.
      const extensions: any[] = [
        sandboxToolsExtension,
        piSubagents,
        claudeTool,
        glimpse,
        piSmartSessions,
        piParallel,
        aiLabelling,
      ];
      
      // Load pi-mcp-adapter but softly catch errors if the user doesn't have an mcp.json yet
      try {
        extensions.push(piMcpAdapter);
      } catch (e) {
        console.warn("[initSession] Could not load pi-mcp-adapter (maybe missing mcp.json):", e);
      }

      // @ts-ignore - The types for createAgentSession in this version might not explicitly list extensions yet
      const { session } = await createAgentSession({
        ...config,
        extensions
      } as any);
      const sessionId = session.sessionManager.getSessionId();
      sessionMap.set(sessionId, session);

      broadcastSubscription(sessionId);
      return session;
  } catch (error) {
    console.error("Failed to initialize Agent Session:", error);
    throw error;
  }
}

// REST Endpoint to fetch auth status
app.get('/api/auth', (_req: Request, res: Response) => {
   // Determine which providers are configured
   const configured = globalAuthStorage.list();

   // Fetch all available providers supported by the SDK
   const availableProviders = getProviders();

   res.json({
      configured,
      availableProviders
   });
});

// REST Endpoint to save an API Key
app.post('/api/auth/key', (req: Request, res: Response) => {
    const { provider, key } = req.body as { provider?: string; key?: string };
    if (!provider || !key) {
        res.status(400).json({ error: "Missing provider or key" });
        return;
    }
    // Provider must be a known identifier (alphanumeric + dashes)
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(provider)) {
        res.status(400).json({ error: 'Invalid provider identifier' });
        return;
    }
    // API keys are typically 20-512 printable ASCII characters
    if (key.length < 8 || key.length > 512 || !/^[\x20-\x7E]+$/.test(key)) {
        res.status(400).json({ error: 'Invalid API key format' });
        return;
    }

    try {
       globalAuthStorage.set(provider, { type: "api_key", key: key });
       auditLog('api_key_saved', { provider });
       res.json({ success: true });
    } catch(err) {
       console.error('[api/auth/key]', err);
       res.status(500).json({ error: safeError(err) });
    }
});

// REST Endpoint to fetch available OAuth subscriptions
app.get('/api/auth/oauth-providers', (_req: Request, res: Response) => {
    try {
        const providers = getOAuthProviders().map(p => ({
            id: p.id,
            name: p.name
        }));
        res.json({ providers });
    } catch(err) {
        console.error('[api/auth/oauth-providers]', err);
        res.status(500).json({ error: safeError(err) });
    }
});

// SSE Endpoint to trigger an OAuth login flow
app.get('/api/auth/login', async (req: Request, res: Response) => {
    const providerId = req.query.provider as string | undefined;
    if (!providerId) {
        res.status(400).json({ error: "Missing provider query parameter" });
        return;
    }

    const provider = getOAuthProvider(providerId);
    if (!provider) {
        res.status(404).json({ error: `Provider ${providerId} not found` });
        return;
    }

    // Set headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (type: string, data: unknown): void => {
        res.write(`event: ${type}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const credentials = await provider.login({
            onAuth: (info) => {
                sendEvent('auth_instructions', { url: info.url, instructions: info.instructions });
            },
            onPrompt: async (prompt) => {
                throw new Error(`OAuth provider requires manual prompt input: "${prompt}". Please complete authentication in a browser and retry.`);
            },
            onProgress: (message) => {
                sendEvent('progress', { message });
            }
        });

        // Store the returned credentials
        globalAuthStorage.set(providerId, { type: "oauth", ...credentials });
        sendEvent('success', { success: true });
    } catch (err) {
        if (!res.destroyed) {
            sendEvent(WS_EVENTS.ERROR, { error: safeError(err) });
        }
    } finally {
        res.end();
    }
});

// REST Endpoint to fetch ALL available models from all providers
app.get('/api/models', (req: Request, res: Response) => {
    const models = globalModelRegistry.getAll();
    const allModels: Array<{ id: string; provider: string; name: string }> = [];

    for (const model of models) {
         // Optionally you could filter out by 'available' models with getAvailable(),
         // but showing all models lets the user select and be prompted to login
         // on the first prompt attempt.
         allModels.push({
             id: model.id,
             provider: model.provider,
             name: `${model.provider} / ${model.name || model.id}`
         });
    }

    // Add current active model
    let currentModel: { id: string; provider: string } | null = null;
    const sessionId = req.query.sessionId as string | undefined;
    const session = getSession(sessionId);

    if (session && session.agent.state.model) {
        const m = session.agent.state.model;
        currentModel = { id: m.id, provider: m.provider };
    }

    res.json({ models: allModels, currentModel });
});

// REST Endpoint to switch the active model
app.post('/api/model', (req: Request, res: Response) => {
    const { provider, modelId, sessionId } = req.body as {
      provider?: string;
      modelId?: string;
      sessionId?: string;
    };
    const session = getSession(sessionId);

    if (!session) {
        res.status(503).json({ error: "Session not found" });
        return;
    }

    if (!provider || !modelId) {
        res.status(400).json({ error: "Missing provider or modelId" });
        return;
    }

    try {
        const targetModel = globalModelRegistry.find(provider, modelId);
        if (!targetModel) {
             res.status(404).json({ error: "Model not found" });
             return;
        }

        session.agent.setModel(targetModel);
        res.json({ success: true, currentModel: { id: targetModel.id, provider: targetModel.provider } });
    } catch(err) {
        console.error('[api/model]', err);
        res.status(500).json({ error: safeError(err) });
    }
});

app.post('/api/stop', (req: Request, res: Response) => {
    const { sessionId } = req.body as { sessionId?: string };
    const session = getSession(sessionId);

    if (session) {
        session.agent.abort();
        res.json({ success: true });
    } else {
        res.status(503).json({ error: "Session not found" });
    }
});

// History endpoints
app.get('/api/sessions', async (req: Request, res: Response) => {
    try {
        const includeArchived = req.query.includeArchived === 'true';
        const sessions = await listSessions(includeArchived);
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ error: safeError(err) });
    }
});

app.post('/api/sessions/archive', async (req: Request, res: Response) => {
    const { path: sessionPath, archived } = req.body as { path?: string; archived?: boolean };
    if (!sessionPath || typeof archived !== 'boolean') {
        res.status(400).json({ error: "Missing session path or archived flag" });
        return;
    }

    const pathError = validateSessionPath(sessionPath);
    if (pathError) {
        res.status(400).json({ error: pathError });
        return;
    }

    try {
        const manager = SessionManager.open(sessionPath);
        manager.appendCustomEntry(ARCHIVE_CUSTOM_TYPE, {
            archived,
            archivedAt: archived ? new Date().toISOString() : undefined
        });

        auditLog('session_archived', { sessionPath, archived });
        const archiveState = getArchiveState(sessionPath);
        res.json({
            success: true,
            archived: Boolean(archiveState.archived),
            archivedAt: archiveState.archivedAt
        });
    } catch (err) {
        console.error("Session archive error:", err);
        res.status(500).json({ error: safeError(err) });
    }
});

app.post('/api/sessions/load', async (req: Request, res: Response) => {
    const { path: sessionPath } = req.body as { path?: string };
    if (!sessionPath) {
        res.status(400).json({ error: "Missing session path" });
        return;
    }

    const pathError = validateSessionPath(sessionPath);
    if (pathError) {
        res.status(400).json({ error: pathError });
        return;
    }

    try {
        const session = await initSession({ mode: 'open', sessionPath });
        const sessionId = session.sessionManager.getSessionId();
        const sessionCwd = session.sessionManager.getCwd();

        // Return existing messages to UI, filtering out tool results which should be in artifacts
        const apiMessages = session.agent.state.messages;
        const messages = apiMessages
            .filter((m: any) => m.role !== 'toolResult')
            .map((m: any) => ({
                id: m.id || randomUUID(),
                role: m.role,
                content: Array.isArray(m.content)
                    ? m.content.map((c: any) => c.type === 'text' ? c.text : (c.type === 'thinking' ? `\`\`\`thinking\n${c.thinking}\n\`\`\`\n\n` : "")).join("")
                    : (m.content || ""),
                isStreaming: false
            }));

        // Extract tool executions for artifacts preview
        const toolExecutions: any[] = [];
        for (const m of apiMessages) {
            if (m.role === 'assistant' && Array.isArray(m.content)) {
                for (const chunk of m.content) {
                    if (chunk.type === 'toolCall') {
                        const call = chunk;
                        // Find corresponding result
                        const resultMsg = apiMessages.find((rm: any) => rm.role === 'toolResult' && rm.toolCallId === call.id) as any;
                        
                        toolExecutions.push({
                            id: call.id,
                            toolName: call.name,
                            arguments: call.arguments,
                            status: resultMsg ? 'success' : 'running',
                            result: resultMsg ? (Array.isArray(resultMsg.content) ? resultMsg.content.map((c: any) => c.text).join("\n") : resultMsg.content) : undefined,
                            isError: resultMsg ? resultMsg.isError : false
                        });
                    }
                }
            }
        }

        auditLog('session_loaded', { sessionPath });
        res.json({ success: true, sessionId, messages, toolExecutions, cwd: sessionCwd });
    } catch (err) {
        console.error("Session load error:", err);
        res.status(500).json({ error: safeError(err) });
    }
});

// ── Path validation helpers ───────────────────────────────────────────────────

/**
 * Validates that a path is within the user's home directory and is an existing directory.
 * Returns an error message, or null if valid.
 */
function validateProjectPath(rawPath: string): string | null {
  const resolved = path.resolve(rawPath);
  const homeDir = os.homedir();
  if (!resolved.startsWith(homeDir + path.sep) && resolved !== homeDir) {
    return 'Path must be within your home directory';
  }
  try {
    if (!statSync(resolved).isDirectory()) return 'Path is not a directory';
  } catch {
    return 'Path does not exist';
  }
  return null;
}

/**
 * Validates that a session path is within ~/.pi (the pi-coding-agent data directory).
 * Returns an error message, or null if valid.
 */
function validateSessionPath(rawPath: string): string | null {
  const resolved = path.resolve(rawPath);
  const sessionDir = path.join(os.homedir(), '.pi');
  if (!resolved.startsWith(sessionDir + path.sep) && resolved !== sessionDir) {
    return 'Invalid session path';
  }
  return null;
}

// Project / CWD endpoints
app.get('/api/project', (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    const session = getSession(sessionId);
    res.json({ cwd: session ? session.sessionManager.getCwd() : null });
});

app.post('/api/project', async (req: Request, res: Response) => {
    const { path: projectPath } = req.body as { path?: string; sessionId?: string };
    if (!projectPath) {
        res.status(400).json({ error: "Missing path" });
        return;
    }

    const pathError = validateProjectPath(projectPath);
    if (pathError) {
        res.status(400).json({ error: pathError });
        return;
    }

    try {
        const resolved = path.resolve(projectPath);
        const session = await initSession({ mode: 'new', cwd: resolved });
        const newSessionId = session.sessionManager.getSessionId();

        // Abort any in-flight work on the new session
        session.agent.abort();

        auditLog('project_changed', { path: resolved });
        res.json({ success: true, cwd: resolved, sessionId: newSessionId });
    } catch (err) {
        res.status(500).json({ error: safeError(err) });
    }
});


/**
 * GET /api/sandbox/status
 * Returns the current sandbox runtime status for the frontend banner.
 */
app.get('/api/sandbox/status', (_req: Request, res: Response) => {
  res.json({
    supported: SandboxService.isSupported,
    srtAvailable: SandboxService.srtAvailable,
    active: SandboxService.isSupported && SandboxService.srtAvailable,
    platform: process.platform,
    warning: SandboxService.warning,
  });
});

// REST Endpoint to list all skills (bundled examples + user skills)
app.get('/api/skills', (_req: Request, res: Response) => {
  try {
    res.json(listSkills());
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// REST Endpoint to get a single skill's content
app.get('/api/skills/:source/:slug', (req: Request, res: Response) => {
  const { source, slug } = req.params;
  if (!['user', 'example'].includes(source)) {
    res.status(400).json({ error: 'Invalid source' });
    return;
  }
  // Prevent path traversal
  if (/[^a-z0-9_-]/i.test(slug)) {
    res.status(400).json({ error: 'Invalid slug' });
    return;
  }
  const content = getSkillContent(source, slug);
  if (content === null) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }
  res.json({ content });
});

const MAX_SKILL_CONTENT_BYTES = 100_000;

// REST Endpoint to create a new user skill
app.post('/api/skills', (req: Request, res: Response) => {
  const { name, content } = req.body as { name?: string; content?: string };
  if (!name || !content) {
    res.status(400).json({ error: 'Missing name or content' });
    return;
  }
  if (content.length > MAX_SKILL_CONTENT_BYTES) {
    res.status(400).json({ error: `Content exceeds maximum size of ${MAX_SKILL_CONTENT_BYTES} bytes` });
    return;
  }
  try {
    const filePath = writeUserSkill(name, content);
    res.json({ success: true, path: filePath });
  } catch (err) {
    const message = safeError(err);
    if (message.includes('already exists')) {
      res.status(409).json({ error: message });
    } else {
      res.status(400).json({ error: message });
    }
  }
});

// REST Endpoint to list all connectors (OAuth providers + remote-MCP catalog + local MCP)
app.get('/api/connectors', async (_req: Request, res: Response) => {
  try {
    const result = await listConnectors(globalAuthStorage);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// POST /api/connectors/remote-mcp — connect a catalog or custom remote MCP server
app.post('/api/connectors/remote-mcp', async (req: Request, res: Response) => {
  const { id, name, url, token } = req.body as {
    id?: string;
    name?: string;
    url?: string;
    token?: string;
  };

  if (!id || !name || !url) {
    res.status(400).json({ error: 'Missing required fields: id, name, url' });
    return;
  }

  const result = await addRemoteMcpConnector({ id, name, url, token });

  if (result.error) {
    res.status(result.error.status).json({ error: result.error.message, field: result.error.field });
    return;
  }

  res.json(result.entry);
});

// DELETE /api/connectors/remote-mcp/:id — disconnect a remote MCP server
app.delete('/api/connectors/remote-mcp/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await removeRemoteMcpConnector(id);

  if (result.error) {
    res.status(result.error.status).json({ error: result.error.message });
    return;
  }

  // 404 treated as success (already disconnected)
  res.status(204).send();
});

// ── WebSocket security ────────────────────────────────────────────────────────

const WsMessageSchema = TypeCompiler.Compile(Type.Object({
  type: Type.String({ maxLength: 64 }),
  sessionId: Type.Optional(Type.String({ maxLength: 128 })),
  text: Type.Optional(Type.String({ maxLength: 100_000 })),
  cwd: Type.Optional(Type.String({ maxLength: 4096 })),
  images: Type.Optional(Type.Array(Type.Unknown(), { maxItems: 20 })),
  streamingBehavior: Type.Optional(Type.String({ maxLength: 32 })),
  approvalId: Type.Optional(Type.String({ maxLength: 128 })),
  approved: Type.Optional(Type.Boolean()),
}));

const MAX_WS_MESSAGE_BYTES = 10_485_760; // 10 MB
const WS_RATE_LIMIT_PER_SECOND = 10;

interface WsRateLimit { count: number; resetAt: number; }
const wsRateLimits = new Map<WebSocket, WsRateLimit>();

// Websocket handling for streaming
wss.on('connection', async (ws: WebSocket) => {
  if (clients.size >= MAX_WS_CONNECTIONS) {
    console.warn('[WS] Connection rejected: limit reached, clients:', clients.size);
    ws.close(1013, 'Too many connections');
    return;
  }

  const client: ClientRecord = { ws, subscriber: null };
  clients.add(client);

  // Wire sandbox-tools extension to send events to this client
  setSendToClient((msg: object) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  });

  try {
    if (sessionMap.size === 0) {
      await initSession({ mode: 'continue' });
    }
  } catch(e) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: "Failed to initialize session"}));
    }
    clients.delete(client);
    ws.close();
    return;
  }

  ws.on('message', async (message: Buffer) => {
    // Size guard first — reject oversized frames before touching rate-limit state
    if (message.length > MAX_WS_MESSAGE_BYTES) {
      ws.close(1009, 'Message too large');
      return;
    }

    // Rate limiting
    const now = Date.now();
    let rl = wsRateLimits.get(ws) ?? { count: 0, resetAt: now + 1000 };
    if (now > rl.resetAt) rl = { count: 0, resetAt: now + 1000 };
    rl.count += 1;
    wsRateLimits.set(ws, rl);
    if (rl.count > WS_RATE_LIMIT_PER_SECOND) {
      ws.close(1008, 'Rate limit exceeded');
      return;
    }

    try {
      const data = JSON.parse(message.toString()) as {
        type: string;
        sessionId?: string;
        text?: string;
        cwd?: string;
        images?: unknown[];
        streamingBehavior?: string;
        approvalId?: string;
        approved?: boolean;
      };

      // Schema validation
      if (!WsMessageSchema.Check(data)) {
        ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: 'Invalid message format' }));
        return;
      }

      // Handle sandbox approval responses from the frontend.
      // The frontend sends { approvalId, approved: true | false }.
      // Only grant the bypass when the user explicitly approved — denial is a no-op
      // (the agent's next command will run sandboxed again, prompting another violation).
      if (data.type === WS_EVENTS.SANDBOX_APPROVAL_RESPONSE) {
        if (typeof data.approvalId === 'string' && data.approvalId.length > 0 && data.approved === true) {
          grantApproval(data.approvalId);
          auditLog('sandbox_approval_granted', { approvalId: data.approvalId });
        } else if (!data.approved) {
          console.debug('[sandbox] Approval denied by user for approvalId:', data.approvalId);
          auditLog('sandbox_approval_denied', { approvalId: data.approvalId });
        } else {
          console.warn('[WS] SANDBOX_APPROVAL_RESPONSE missing valid approvalId');
        }
        return;
      }

      if (data.type === WS_EVENTS.JOIN || data.type === WS_EVENTS.PROMPT || data.type === WS_EVENTS.STEER || data.type === WS_EVENTS.NEW_CHAT) {
        let sessionId = data.sessionId;
        let session = sessionId ? sessionMap.get(sessionId) : undefined;

        if (data.type === WS_EVENTS.JOIN) {
           client.sessionId = sessionId;
           if (sessionId) broadcastSubscription(sessionId);
           return;
        }

        if (data.type === WS_EVENTS.NEW_CHAT) {
           // Validate working directory if provided — same rule as POST /api/project
           if (data.cwd) {
             const cwdError = validateProjectPath(data.cwd);
             if (cwdError) {
               ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: cwdError }));
               return;
             }
           }
           let newSession: AgentSession;
           try {
             newSession = await initSession({ mode: 'new', cwd: data.cwd ?? process.cwd() });
           } catch (initErr) {
             ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: "Failed to create session" }));
             return;
           }
           const newSessionId = newSession.sessionManager.getSessionId();
           client.sessionId = newSessionId;
           ws.send(JSON.stringify({ type: WS_EVENTS.CHAT_CLEARED, sessionId: newSessionId }));
           return;
        }

        if (!session && !sessionId) {
           // Fallback to most recent/default if not specified
           session = sessionMap.values().next().value;
           if (!session) {
             try {
               session = await initSession({ mode: 'continue' });
             } catch (initErr) {
               console.error('[WS] Failed to initialize session:', initErr);
               ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: "Failed to initialize session" }));
               return;
             }
           }
        }

        if (!session) {
           ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: "Session not found" }));
           return;
        }

        const currentSId = session.sessionManager.getSessionId();
        client.sessionId = currentSId;

        if (data.type === WS_EVENTS.PROMPT) {
          try {
             const promptOptions: Record<string, unknown> = {
                streamingBehavior: data.streamingBehavior
             };

             // SDK check: uses agent.state.isStreaming internally for the error we're seeing.
             const isActuallyStreaming = session.isStreaming || session.agent.state.isStreaming;

              const sId = session.sessionManager.getSessionId();

              if (isActuallyStreaming && !promptOptions.streamingBehavior) {
                 promptOptions.streamingBehavior = 'steer';
              }

              if (data.images && data.images.length > 0) {
                 promptOptions.images = data.images;
              }

              await session.prompt(data.text ?? '', promptOptions);
              ws.send(JSON.stringify({ type: WS_EVENTS.PROMPT_COMPLETE, sessionId: sId }));
           } catch (promptErr) {
              const sId = session ? session.sessionManager.getSessionId() : "unknown";
              console.error(`[Session ${sId}] Prompt error:`, promptErr);
              ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: safeError(promptErr, 'Prompt failed'), sessionId: sId }));
           }
        } else if (data.type === WS_EVENTS.STEER) {
           try {
             await session.prompt(data.text ?? '', { streamingBehavior: 'steer' });
           } catch (steerErr) {
             console.error("Steer error:", steerErr);
             ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: safeError(steerErr, 'Steer failed') }));
           }
        }
      }
    } catch (err) {
      console.error("Error processing websocket message:", err);
    }
  });

  ws.on('close', () => {
    if (client.subscriber) {
      client.subscriber();
    }
    clients.delete(client);
    wsRateLimits.delete(ws);
  });
});

/**
 * Initialize the sandbox runtime before the server accepts connections.
 * Calls SandboxService.initialize() to set up Seatbelt/bubblewrap profiles,
 * then generateMcpConfig() to write .pi/mcp.json with srt-wrapped MCP commands.
 *
 * @throws never — SandboxService methods are non-throwing; failures set isSupported=false.
 */
async function bootstrap(): Promise<void> {
  await SandboxService.initialize(process.cwd());
  await SandboxService.generateMcpConfig(process.cwd());
}

export { app, server, wss };

// Start the server after async bootstrap completes.
// Skipped when SIDECAR_TEST=1 so integration tests can import the Express app
// without binding to a port or triggering sandbox initialization.
if (process.env.SIDECAR_TEST !== '1') {
  const PORT = process.env.PORT || 4242;
  bootstrap()
    .catch((err) => {
      console.error('[bootstrap] Sandbox init failed (continuing without sandboxing):', err);
    })
    .finally(() => {
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[sidecar] Port ${PORT} is already in use. Is another instance running?`);
          process.exit(1);
        }
        throw err;
      });
      server.listen(PORT, '127.0.0.1', () => {
        console.log(`WorkWithMe Sidecar running on http://localhost:${PORT}`);
      });
    });
}
