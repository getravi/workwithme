// sidecar/vendor.d.ts

declare module '@mariozechner/pi-coding-agent' {
  export interface AgentState {
    model: { id: string; provider: string } | null;
    messages: Array<{
      id?: string;
      role: string;
      content: string | Array<{ type: string; text?: string; thinking?: string }>;
    }>;
    isStreaming: boolean;
  }

  export interface Agent {
    state: AgentState;
    setModel(model: unknown): void;
    abort(): void;
  }

  export interface SessionManagerInstance {
    getSessionId(): string;
    getCwd(): string;
  }

  export interface AgentSession {
    agent: Agent;
    sessionManager: SessionManagerInstance;
    isStreaming: boolean;
    subscribe(handler: (event: unknown) => void): () => void;
    prompt(text: string, options?: Record<string, unknown>): Promise<void>;
  }

  export class AuthStorage {
    static create(): AuthStorage;
    list(): string[];
    set(provider: string, credentials: Record<string, unknown>): void;
  }

  export class ModelRegistry {
    constructor(auth: AuthStorage);
    getAll(): Array<{ id: string; provider: string; name?: string }>;
    find(provider: string, modelId: string): unknown;
  }

  export class SessionManager {
    static open(path: string): SessionManager;
    static create(cwd: string): SessionManager;
    static continueRecent(cwd: string): SessionManager;
    static listAll(): Promise<unknown[]>;
  }

  export function createAgentSession(config: {
    authStorage: AuthStorage;
    modelRegistry: ModelRegistry;
    cwd: string;
    sessionManager?: SessionManager;
  }): Promise<{ session: AgentSession }>;
}

declare module '@mariozechner/pi-ai' {
  export function getProviders(): string[];
  export function getModels(): unknown[];
  export function getModel(): unknown;
}

declare module '@mariozechner/pi-ai/oauth' {
  export function getOAuthProviders(): Array<{ id: string; name: string }>;
  export function getOAuthProvider(id: string): {
    login(callbacks: {
      onAuth(info: { url: string; instructions?: string }): void;
      onPrompt(prompt: string): Promise<string>;
      onProgress(message: string): void;
    }): Promise<Record<string, unknown>>;
  } | undefined;
}
