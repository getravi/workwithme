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
import sandboxToolsExtension, { setSendToClient, grantApproval } from "./extensions/sandbox-tools.js";
import { SandboxService } from "./sandbox/SandboxService.js";


// Basic express setup
const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server });

interface ClientRecord {
  ws: WebSocket;
  subscriber: (() => void) | null;
  sessionId?: string;
}

const sessionMap = new Map<string, AgentSession>();
const clients = new Set<ClientRecord>();
const MAX_WS_CONNECTIONS = 50;
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

    try {
       globalAuthStorage.set(provider, { type: "api_key", key: key });
       res.json({ success: true });
    } catch(err) {
       res.status(500).json({ error: String(err) });
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
        res.status(500).json({ error: String(err) });
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
        sendEvent(WS_EVENTS.ERROR, { error: err instanceof Error ? err.message : String(err) });
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
        res.status(500).json({ error: String(err) });
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
        res.status(500).json({ error: String(err) });
    }
});

app.post('/api/sessions/archive', async (req: Request, res: Response) => {
    const { path: sessionPath, archived } = req.body as { path?: string; archived?: boolean };
    if (!sessionPath || typeof archived !== 'boolean') {
        res.status(400).json({ error: "Missing session path or archived flag" });
        return;
    }

    try {
        const manager = SessionManager.open(sessionPath);
        manager.appendCustomEntry(ARCHIVE_CUSTOM_TYPE, {
            archived,
            archivedAt: archived ? new Date().toISOString() : undefined
        });

        const archiveState = getArchiveState(sessionPath);
        res.json({
            success: true,
            archived: Boolean(archiveState.archived),
            archivedAt: archiveState.archivedAt
        });
    } catch (err) {
        console.error("Session archive error:", err);
        res.status(500).json({ error: String(err) });
    }
});

app.post('/api/sessions/load', async (req: Request, res: Response) => {
    const { path: sessionPath } = req.body as { path?: string };
    if (!sessionPath) {
        res.status(400).json({ error: "Missing session path" });
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

        res.json({ success: true, sessionId, messages, toolExecutions, cwd: sessionCwd });
    } catch (err) {
        console.error("Session load error:", err);
        res.status(500).json({ error: String(err) });
    }
});

// Project / CWD endpoints
app.get('/api/project', (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    const session = getSession(sessionId);
    res.json({ cwd: session ? session.sessionManager.getCwd() : process.cwd() });
});

app.post('/api/project', async (req: Request, res: Response) => {
    const { path: projectPath } = req.body as { path?: string; sessionId?: string };
    if (!projectPath) {
        res.status(400).json({ error: "Missing path" });
        return;
    }

    try {
        const session = await initSession({ mode: 'new', cwd: projectPath }); // Force new session on project root change
        const newSessionId = session.sessionManager.getSessionId();

        // Abort any in-flight work on the new session
        session.agent.abort();

        res.json({ success: true, cwd: projectPath, sessionId: newSessionId });
    } catch (err) {
        res.status(500).json({ error: String(err) });
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
    try {
      const data = JSON.parse(message.toString()) as {
        type: string;
        sessionId?: string;
        text?: string;
        cwd?: string;
        images?: unknown[];
        streamingBehavior?: string;
        approvalId?: string;
      };

      // Handle sandbox approval responses from the frontend
      if (data.type === WS_EVENTS.SANDBOX_APPROVAL_RESPONSE) {
        if (typeof data.approvalId === 'string' && data.approvalId.length > 0) {
          grantApproval(data.approvalId);
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
           let newSession: AgentSession;
           try {
             newSession = await initSession({ mode: 'new', cwd: data.cwd ?? process.cwd() });
           } catch (initErr) {
             ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: "Failed to create session: " + (initErr instanceof Error ? initErr.message : String(initErr)) }));
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
               ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: "Failed to initialize session: " + (initErr instanceof Error ? initErr.message : String(initErr)) }));
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
              ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: String(promptErr), sessionId: sId }));
           }
        } else if (data.type === WS_EVENTS.STEER) {
           try {
             await session.prompt(data.text ?? '', { streamingBehavior: 'steer' });
           } catch (steerErr) {
             console.error("Steer error:", steerErr);
             ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, message: String(steerErr) }));
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

// Start the server after async bootstrap completes
const PORT = process.env.PORT || 4242;
bootstrap()
  .catch((err) => {
    console.error('[bootstrap] Sandbox init failed (continuing without sandboxing):', err);
  })
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`WorkWithMe Sidecar running on http://localhost:${PORT}`);
    });
  });
