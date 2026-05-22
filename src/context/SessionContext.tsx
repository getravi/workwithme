import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { Session } from "../types";
import { API_BASE } from "../config";
import { fetchWithTimeout } from "../utils/fetch";
import { useWebSocket, useWebSocketMessage } from "./WebSocketContext";
import { WS_EVENTS } from "../types";

export interface SessionContextValue {
  sessions: Session[];
  currentSessionId: string | null;
  projectDir: string | null;
  fetchSessions: () => Promise<void>;
  createSession: (cwd?: string) => void;
  archiveSession: (session: Session, archived: boolean) => Promise<void>;
  setCurrentSessionId: (id: string | null) => void;
  /** Sets local projectDir state only — no API call. Use for loading session data. */
  setLocalProjectDir: React.Dispatch<React.SetStateAction<string | null>>;
  /** POSTs to /api/project then sends NEW_CHAT. Use for user-initiated project change. */
  changeProjectDir: (path: string) => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { wsSend, isConnected } = useWebSocket();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [projectDir, setProjectDir] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const resp = await fetchWithTimeout(`${API_BASE}/api/sessions?includeArchived=true`);
      const data = await resp.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("[Session] fetchSessions failed", err);
    }
  }, []);

  const createSession = useCallback(
    (cwd?: string) => {
      wsSend({ type: WS_EVENTS.NEW_CHAT, cwd: cwd ?? projectDir ?? null });
    },
    [wsSend, projectDir],
  );

  const archiveSession = useCallback(
    async (session: Session, archived: boolean) => {
      try {
        await fetchWithTimeout(`${API_BASE}/api/sessions/archive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: session.path, archived }),
        });
        await fetchSessions();
      } catch (err) {
        console.error("[Session] archiveSession failed", err);
      }
    },
    [fetchSessions],
  );

  const changeProjectDir = useCallback(
    async (path: string) => {
      try {
        const resp = await fetchWithTimeout(`${API_BASE}/api/project`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, sessionId: currentSessionId }),
        });
        const data = await resp.json() as { success?: boolean };
        if (data.success) {
          setProjectDir(path);
          wsSend({ type: WS_EVENTS.NEW_CHAT, cwd: path });
        }
      } catch (err) {
        console.error("[Session] changeProjectDir failed", err);
      }
    },
    [currentSessionId, wsSend],
  );

  // Fetch sessions when WS connects
  useEffect(() => {
    if (isConnected) fetchSessions();
  }, [isConnected, fetchSessions]);

  // When session changes: fetch project dir + send JOIN
  useEffect(() => {
    if (!isConnected || !currentSessionId) return;
    wsSend({ type: WS_EVENTS.JOIN, sessionId: currentSessionId });
    const url = new URL(`${API_BASE}/api/project`);
    url.searchParams.append("sessionId", currentSessionId);
    fetchWithTimeout(url.toString())
      .then((r) => r.json())
      .then((data: { cwd?: string }) => { if (data.cwd) setProjectDir(data.cwd); })
      .catch((err) => console.error("[Session] fetchProject failed", err));
  }, [isConnected, currentSessionId, wsSend]);

  // WS: chat_cleared → update session id + refresh list
  useWebSocketMessage(
    WS_EVENTS.CHAT_CLEARED,
    useCallback(
      (data: unknown) => {
        const d = data as { sessionId: string };
        setCurrentSessionId(d.sessionId);
        fetchSessions();
      },
      [fetchSessions],
    ),
  );

  // WS: session_label_updated → refresh sessions
  useWebSocketMessage(
    "session_label_updated",
    useCallback(() => { fetchSessions(); }, [fetchSessions]),
  );

  return (
    <SessionContext.Provider
      value={{
        sessions,
        currentSessionId,
        projectDir,
        fetchSessions,
        createSession,
        archiveSession,
        setCurrentSessionId,
        setLocalProjectDir: setProjectDir,
        changeProjectDir,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
