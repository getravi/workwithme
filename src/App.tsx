import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Send, Terminal, Loader2, Bot, Sidebar as SidebarIcon, Plus, MessageSquare, PanelRightOpen, Paperclip, ChevronDown, FolderOpen, PanelRightClose, Settings, Maximize2, Minimize2, X, CircleStop, Zap, Archive, ArchiveRestore, Network } from "lucide-react";
import { SettingsModal } from "./SettingsModal";
import { MarkdownMessage } from "./MarkdownMessage";
import { API_BASE } from "./config";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { Message, Model, Session, ToolExecution, AttachedFile, PromptPayload, WS_EVENTS } from "./types";
import { SkillsPage } from "./SkillsPage";
import { ConnectorsPage } from "./ConnectorsPage";

interface SandboxStatus {
  supported: boolean;
  srtAvailable: boolean;
  active: boolean;
  platform: string;
  warning: string | null;
}

// Convert Uint8Array to base64 string (chunked to avoid call-stack overflow on large files)
function arrayBufferToBase64(buffer: Uint8Array): string {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
  }
  return window.btoa(binary);
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function groupSessionsByProject(items: Session[]): Array<[string, Session[]]> {
  return Object.entries(
    items.reduce((acc, session) => {
      const project = session.cwd || "Recent";
      if (!acc[project]) acc[project] = [];
      acc[project].push(session);
      return acc;
    }, {} as Record<string, Session[]>)
  );
}

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Note: caller-supplied signal in init is overwritten by controller.signal.
    // All current call sites use the default; do not pass a signal via init.
    const resp = await fetch(input, { ...init, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    return resp;
  } finally {
    clearTimeout(id);
  }
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSteering, setIsSteering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // UI State
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [activeView, setActiveView] = useState<'chat' | 'skills' | 'connectors'>('chat');
  const [connectorsRefreshKey, setConnectorsRefreshKey] = useState(0);

  const activeSessions = useMemo(() => sessions.filter((session) => !session.archived), [sessions]);
  const archivedSessions = useMemo(() => sessions.filter((session) => session.archived), [sessions]);
  const groupedActiveSessions = useMemo(() => groupSessionsByProject(activeSessions), [activeSessions]);
  const groupedArchivedSessions = useMemo(() => groupSessionsByProject(archivedSessions), [archivedSessions]);

  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null);
  const [sandboxBannerDismissed, setSandboxBannerDismissed] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const reconnectAttemptsRef = useRef(0);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    const onMove = (ev: MouseEvent) => {
      if (!sidebarDragRef.current) return;
      const delta = ev.clientX - sidebarDragRef.current.startX;
      const next = Math.min(400, Math.max(160, sidebarDragRef.current.startWidth + delta));
      setSidebarWidth(next);
    };
    const onUp = () => {
      sidebarDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  const wsSend = useCallback((payload: object): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  // Auto scroll to bottom only when a new message is added/removed, not on every streaming delta
  const messageCount = messages.length;
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount]);

  const fetchSessions = useCallback(async () => {
    try {
      const resp = await fetchWithTimeout(`${API_BASE}/api/sessions?includeArchived=true`);
      const data = await resp.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch sessions", err);
    }
  }, []);

  const fetchProject = useCallback(async () => {
    if (!currentSessionId) return;
    try {
      const url = new URL(`${API_BASE}/api/project`);
      url.searchParams.append("sessionId", currentSessionId);
      const resp = await fetchWithTimeout(url.toString());
      const data = await resp.json();
      setProjectDir(data.cwd);
    } catch (err) {
      console.error("Failed to fetch project", err);
    }
  }, [currentSessionId]);

  const fetchModels = useCallback(async () => {
    try {
      const url = new URL(`${API_BASE}/api/models`);
      if (currentSessionId) url.searchParams.append("sessionId", currentSessionId);
      const res = await fetchWithTimeout(url.toString());
      const data = await res.json();
      setAvailableModels(data.models || []);
      if (data.currentModel) {
        setSelectedModel(data.currentModel);
      } else if (data.models && data.models.length > 0) {
        setSelectedModel(data.models[0]);
      }
    } catch(e) {
      console.error("Failed to fetch models", e);
    }
  }, [currentSessionId]);

  // Combined fetch for convenience — runs all three in parallel
  const refreshAll = useCallback(async () => {
    await Promise.all([fetchSessions(), fetchProject(), fetchModels()]);
  }, [fetchSessions, fetchProject, fetchModels]);

  useEffect(() => {
    // Connect to sidecar websocket
    const connectWs = () => {
      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      
      const ws = new WebSocket("ws://localhost:4242");
      
      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        setError(null);
        // Refresh when connection established
        refreshAll();
        // Fetch sandbox status to show warning banner if sandboxing is unavailable
        fetchWithTimeout(`${API_BASE}/api/sandbox/status`)
          .then(r => r.json())
          .then((status: SandboxStatus) => setSandboxStatus(status))
          .catch(() => {}); // non-critical
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === WS_EVENTS.CHAT_CLEARED) {
            setCurrentSessionId(data.sessionId);
            setMessages([]);
            setToolExecutions([]);
            fetchSessions();
          }
          else if (data.type === WS_EVENTS.MESSAGE_START) {
            const rawMsg = data.message;
            // Ignore user messages from server because we add them locally
            if (rawMsg?.role === "user") return;

            const newId = rawMsg?.id || ("asst_" + Date.now().toString());
            
            setMessages((prev) => {
              // If we already have this message, don't re-add
              if (prev.some(m => m.id === newId)) return prev;
              
              // If the last message is an empty assistant streaming message, just give it this ID
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && last.isStreaming && (!last.content || last.content === "")) {
                 return prev.map((m, idx) => idx === prev.length - 1 ? { ...m, id: newId } : m);
              }

              return [...prev, { id: newId, role: "assistant" as const, content: "", isStreaming: true, timestamp: Date.now() }];
            });
          }
          else if (data.type === WS_EVENTS.MESSAGE_UPDATE) {
             const asstEvent = data.assistantMessageEvent;
             // Some updates only contain message structure without deltas
             if (asstEvent && (asstEvent.type === "text_delta" || asstEvent.type === "thinking_delta" || data.message)) {
                // Extract full text idempotently from the backend message structure
                let fullText = "";
                if (data.message && Array.isArray(data.message.content)) {
                   fullText = data.message.content
                     .map((c: any) => {
                       if (c.type === 'text') return c.text;
                       if (c.type === 'thinking') {
                          // Format thinking blocks for the custom Markdown renderer
                          const t = (c.thinking ?? "").trim();
                          return t ? `\`\`\`thinking\n${t}\n\`\`\`\n\n` : "";
                       }
                       return "";
                     })
                     .join("");
                } else if (data.message && typeof data.message.content === 'string') {
                   fullText = data.message.content;
                }

                if (fullText) {
                  setMessages((prev) => {
                    const msgId = data.message?.id;
                    // Try to find by ID first
                    if (msgId && prev.some(m => m.id === msgId)) {
                       return prev.map(m => m.id === msgId ? { ...m, content: fullText, isStreaming: true } : m);
                    }
                    // Fallback to updating the last streaming assistant message
                    return prev.map((msg, idx) => {
                      if (msg.role === "assistant" && msg.isStreaming && idx === prev.length - 1) {
                        return { ...msg, content: fullText };
                      }
                      return msg;
                    });
                  });
                }
             }
          }
          else if (data.type === WS_EVENTS.MESSAGE_END) {
             setMessages((prev) => {
               const msgId = data.message?.id;
               return prev.reduce<Message[]>((acc, msg) => {
                 const updated = ((msgId && msg.id === msgId) || (msg.role === "assistant" && msg.isStreaming))
                   ? { ...msg, isStreaming: false }
                   : msg;
                 // Clean up empty non-streaming bubbles
                 if (updated.role === 'user' || updated.isStreaming || updated.content.trim() !== '') {
                   acc.push(updated);
                 }
                 return acc;
               }, []);
             });
          }
          else if (data.type === WS_EVENTS.AGENT_END) {
             setIsProcessing(false);
             setIsSteering(false);
             fetchSessions(); // Refresh list to get smart session names
          }
          else if (data.type === WS_EVENTS.TOOL_EXECUTION_START) {
             if (activeView === 'chat') setIsPreviewOpen(true);
             setToolExecutions(prev => [
                ...prev, 
                { id: data.toolCallId, name: data.toolName, args: data.args, status: "running" }
             ]);
          }
          else if (data.type === WS_EVENTS.TOOL_EXECUTION_UPDATE) {
             setToolExecutions(prev => prev.map(t => {
                if (t.id === data.toolCallId) {
                   return { ...t, args: data.args, result: data.partialResult };
                }
                return t;
             }));
          }
          else if (data.type === WS_EVENTS.TOOL_EXECUTION_END) {
             setToolExecutions(prev => prev.map(t => {
                if (t.id === data.toolCallId) {
                   return { ...t, status: data.isError ? "error" : "done", result: data.result };
                }
                return t;
             }));
          }
          else if (data.type === WS_EVENTS.PROMPT_COMPLETE) {
             setIsProcessing(false);
          }
          else if (data.type === WS_EVENTS.ERROR) {
             setError(data.message);
             setIsProcessing(false);
          }

        } catch(e) {
          console.error("Error parsing websocket message", e);
        }
      };

      ws.onerror = () => {
        setIsConnected(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(connectWs, delay);
      };

      wsRef.current = ws;
    };

    connectWs(); // Essential!

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  // Sync session and fetch metadata when session changes
  useEffect(() => {
    if (isConnected) {
      fetchSessions();
      if (currentSessionId) {
        fetchProject();
        fetchModels();
        // Inform sidecar about active session to receive relevant events
        wsSend({ type: WS_EVENTS.JOIN, sessionId: currentSessionId });
      }
    }
  }, [isConnected, currentSessionId, fetchSessions, fetchProject, fetchModels]);

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const model = availableModels.find(m => `${m.provider}:${m.id}` === val);
    if (!model) return;
    
    try {
       await fetchWithTimeout(`${API_BASE}/api/model`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: model.provider,
            modelId: model.id,
            sessionId: currentSessionId
          })
       });
       setSelectedModel(model);
    } catch(err) {
       console.error("Failed to set model", err);
       setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAttachFile = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpeg', 'jpg', 'webp', 'gif']
        }]
      });
      
      if (!selected) return;
      
      const files = Array.isArray(selected) ? selected : [selected];
      
      const newAttachments: AttachedFile[] = [];
      for (const file of files) {
        const data = await readFile(file);
        // Extract filename from path
        const name = file.split(/[\\/]/).pop() || file;
        newAttachments.push({ path: file, name, data });
      }
      
      setAttachments(prev => [...prev, ...newAttachments]);
    } catch (err) {
      console.error("Failed to attach file(s)", err);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || wsRef.current?.readyState !== WebSocket.OPEN) return;

    if (isProcessing) {
      // Send as steering message instead of new prompt
      setIsSteering(true);
      wsSend({ type: WS_EVENTS.STEER, text: input, sessionId: currentSessionId });
      // Add steering message to local UI so user sees it
      const steerId = "steer_" + Date.now().toString();
      setMessages(prev => [...prev, {
        id: steerId,
        role: "user",
        content: `(Steering) ${input}`,
        timestamp: Date.now()
      }]);
      setInput("");
      return;
    }

    const userMessage = input.trim();
    
    // Create UI representation
    let displayContent = userMessage;
    if (attachments.length > 0) {
      displayContent += `\n[Attached ${attachments.length} file(s)]`;
    }
    
    const newId = "user_" + Date.now().toString();
    setMessages((prev) => {
       if (prev.some(m => m.id === newId)) return prev;
       return [...prev, { id: newId, role: "user" as const, content: displayContent, timestamp: Date.now() }];
    });
    
    setInput("");
    setIsProcessing(true);
    setError(null);

    const payload: PromptPayload = {
      type: WS_EVENTS.PROMPT,
      text: userMessage,
      sessionId: currentSessionId
    };

    if (attachments.length > 0) {
      payload.images = attachments.map(att => {
        const ext = att.name.split('.').pop()?.toLowerCase() || '';
        return {
          type: "image",
          mimeType: MIME_BY_EXT[ext] ?? 'image/jpeg',
          data: arrayBufferToBase64(att.data)
        };
      });
    }

    const sent = wsSend(payload);
    if (sent) {
      setAttachments([]); // Clear attachments after sending
    } else {
      // Socket closed between guard and send — roll back
      setIsProcessing(false);
      setInput(userMessage);
      setError("Connection lost — please retry.");
      setMessages(prev => prev.filter(m => m.id !== newId));
    }
  };

  const handleNewChat = () => {
    setActiveView('chat');
    setMessages([]);
    setToolExecutions([]);
    setIsPreviewOpen(false);
    setIsPreviewMaximized(false);
    wsSend({ type: WS_EVENTS.NEW_CHAT, cwd: projectDir });
  };

  const handleStop = async () => {
    try {
      await fetchWithTimeout(`${API_BASE}/api/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: currentSessionId })
      });
      setIsProcessing(false);
      setIsSteering(false);
      setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false, content: m.content + "\n\n*(Stopped)*" } : m));
    } catch (err) {
      console.error("Failed to stop agent", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadSession = async (session: Session) => {
    setActiveView('chat');
    try {
      setIsProcessing(true);
      const resp = await fetchWithTimeout(`${API_BASE}/api/sessions/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: session.path })
      });
      const data = await resp.json();
        if (data.success) {
          setCurrentSessionId(data.sessionId);
          setMessages((data.messages as Message[]) || []);
          setToolExecutions(data.toolExecutions || []);
          if (data.toolExecutions && data.toolExecutions.length > 0) {
            setIsPreviewOpen(true);
          } else {
            setIsPreviewOpen(false);
          }
          setIsPreviewMaximized(false);
          if (data.cwd) setProjectDir(data.cwd);
          
          fetchSessions(); // Refresh list to ensure it's in sync
          
          // Join the session via WebSocket
          wsSend({ type: WS_EVENTS.JOIN, sessionId: data.sessionId });
        }
    } catch (err) {
      console.error("Failed to load session", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleArchiveSession = async (session: Session, archived: boolean) => {
    try {
      await fetchWithTimeout(`${API_BASE}/api/sessions/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: session.path, archived })
      });
      await fetchSessions();
    } catch (err) {
      console.error("Failed to update archived state", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const renderSessionRow = (session: Session) => {
    const label = session.name || session.firstMessage || "New Session";
    const isCurrent = session.id === currentSessionId;
    const archiveActionLabel = session.archived ? "Restore chat" : "Archive chat";

    return (
      <div
        key={session.id}
        onClick={() => loadSession(session)}
        className={`group flex items-center gap-2.5 px-2 py-1 rounded-lg cursor-pointer transition-all ${
          isCurrent
            ? "bg-[#1f2937] text-white"
            : "text-gray-400 hover:bg-[#1f2937] hover:text-white"
        } ${session.archived ? "opacity-75" : ""}`}
      >
        <MessageSquare className="w-3 h-3 opacity-30 group-hover:opacity-100 group-hover:text-[#c5f016]" />
        <span className="text-[13px] truncate flex-1">{label}</span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void handleArchiveSession(session, !session.archived);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-white hover:bg-[#374151] transition-all"
          title={archiveActionLabel}
          aria-label={archiveActionLabel}
        >
          {session.archived ? <ArchiveRestore className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
        </button>
      </div>
    );
  };

  const handleSelectProject = async () => {
    try {
       const selected = await open({
         directory: true,
         multiple: false,
         title: "Select Project Folder"
       });
       
       if (selected && typeof selected === 'string') {
          const resp = await fetchWithTimeout(`${API_BASE}/api/project`, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ path: selected, sessionId: currentSessionId })
          });
          const data = await resp.json();
          if (data.success) {
             setProjectDir(selected);
             setCurrentSessionId(data.sessionId);
             setMessages([]);
             setToolExecutions([]);
             fetchSessions(); // Refresh list to see the newly created session
             
             wsSend({ type: WS_EVENTS.JOIN, sessionId: data.sessionId });
          }
       }
    } catch (err) {
       console.error("Folder picker error", err);
       setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#111827] text-white overflow-hidden">

      {/* Unified sidebar — 52px collapsed (icon rail), sidebarWidth expanded */}
      <aside
        className="flex-shrink-0 border-r border-[#1f2937] bg-[#141d2e] flex flex-col overflow-hidden relative transition-all duration-300 rounded-tr-2xl rounded-br-2xl"
        style={{ width: isLeftSidebarOpen ? sidebarWidth : 52 }}
      >
        {/* macOS traffic lights zone — drag region, toggle button sits at bottom-right */}
        <div className="h-[52px] flex-shrink-0 flex items-end justify-end px-2 pb-1" data-tauri-drag-region>
          <button
            onClick={() => setIsLeftSidebarOpen(o => !o)}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[#1f2937] transition-colors"
            title={isLeftSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <SidebarIcon className="w-4 h-4" />
          </button>
        </div>

        {/* App name — expanded only, sits below traffic lights */}
        {isLeftSidebarOpen && (
          <div className="px-3 pb-2.5 flex items-center gap-2 border-b border-[#1f2937]/50">
            <Bot className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <h2 className="text-[13px] font-semibold text-gray-200 truncate">Work with <span className="text-[#c5f016]">Me</span></h2>
          </div>
        )}

        {/* New Chat */}
        <div className={isLeftSidebarOpen ? "p-2.5" : "flex justify-center py-2"}>
          {isLeftSidebarOpen ? (
            <button
              onClick={handleNewChat}
              className="w-full flex items-center gap-2 bg-[#1f2937] hover:bg-[#374151] rounded-lg px-2.5 py-1.5 text-[13px] text-[#f3f4f6] font-medium transition-colors border border-transparent hover:border-[#4b5563]"
            >
              <Plus className="w-3.5 h-3.5 text-[#c5f016]" />
              New Chat
            </button>
          ) : (
            <button
              onClick={handleNewChat}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[#1f2937] transition-colors"
              title="New Chat"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Nav items — icon+label when expanded, icon-only when collapsed */}
        <div className={`flex flex-col ${isLeftSidebarOpen ? 'px-2.5 gap-0.5 pb-1' : 'items-center gap-1 px-1 pb-1'}`}>
          {([
            { view: 'chat' as const, Icon: MessageSquare, label: 'Chat' },
            { view: 'skills' as const, Icon: Zap, label: 'Skills' },
            { view: 'connectors' as const, Icon: Network, label: 'Connectors' },
          ]).map(({ view, Icon, label }) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              title={label}
              className={`rounded-lg transition-colors ${isLeftSidebarOpen
                ? `w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] font-medium ${activeView === view ? 'bg-[#1f2937] text-[#c5f016]' : 'text-gray-400 hover:bg-[#1f2937] hover:text-gray-200'}`
                : `p-2 ${activeView === view ? 'text-[#c5f016] bg-[#1f2937]' : 'text-gray-500 hover:text-gray-200 hover:bg-[#1f2937]'}`
              }`}
            >
              <Icon className={isLeftSidebarOpen ? "w-3.5 h-3.5 flex-shrink-0" : "w-4 h-4"} />
              {isLeftSidebarOpen && label}
            </button>
          ))}
        </div>

        {/* Divider + session list — expanded only */}
        {isLeftSidebarOpen && (
          <>
            <div className="mx-2.5 my-1.5 border-t border-[#1f2937]/60" />
            <div className="flex-1 overflow-y-auto px-2.5 py-2 scrollbar-thin scrollbar-thumb-gray-800">
              <div className="mb-4">
                <div className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1 flex items-center justify-between">
                  <span>Project</span>
                  <button
                    onClick={handleSelectProject}
                    className="p-1 hover:bg-[#1f2937] rounded text-gray-400 hover:text-gray-200 transition-colors"
                    title="Open Folder"
                  >
                    <FolderOpen className="w-3 h-3" />
                  </button>
                </div>
                {projectDir && (
                  <div className="px-2 py-1.5 rounded-lg bg-[#1f2937] border border-[#374151]">
                    <div className="flex items-center gap-2 text-[13px] text-gray-300">
                      <Terminal className="w-3.5 h-3.5" />
                      <span className="truncate font-medium">{projectDir.split('/').pop() || projectDir}</span>
                    </div>
                    <div className="text-[12px] text-gray-500 mt-1 truncate px-6 opacity-60">
                       {projectDir}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {groupedActiveSessions.map(([project, projectSessions]) => (
                  <div key={project} className="space-y-1">
                    <div className="text-[12px] font-bold text-gray-500 uppercase tracking-tighter mb-1 px-1 flex items-center gap-2 opacity-50">
                      <FolderOpen className="w-2.5 h-2.5" />
                      <span className="truncate">{project.split('/').pop() || project}</span>
                    </div>
                    {projectSessions.map(renderSessionRow)}
                  </div>
                ))}
                {activeSessions.length === 0 && archivedSessions.length === 0 && (
                  <div className="text-[12px] text-gray-600 px-2 italic">No history yet</div>
                )}
                {archivedSessions.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-[#1f2937]/60">
                    <button
                      type="button"
                      onClick={() => setShowArchived((value) => !value)}
                      className="w-full flex items-center justify-between px-1 text-[12px] font-bold text-gray-500 uppercase tracking-[0.2em] hover:text-gray-300 transition-colors"
                    >
                      <span>Archived</span>
                      <span>{showArchived ? "Hide" : `${archivedSessions.length}`}</span>
                    </button>
                    {showArchived && (
                      <div className="space-y-4">
                        {groupedArchivedSessions.map(([project, projectSessions]) => (
                          <div key={project} className="space-y-1">
                            <div className="text-[12px] font-bold text-gray-500 uppercase tracking-tighter mb-1 px-1 flex items-center gap-2 opacity-40">
                              <FolderOpen className="w-2.5 h-2.5" />
                              <span className="truncate">{project.split('/').pop() || project}</span>
                            </div>
                            {projectSessions.map(renderSessionRow)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Spacer pushes footer to bottom when collapsed */}
        {!isLeftSidebarOpen && <div className="flex-1" />}

        {/* Footer */}
        <div className={`border-t border-[#1f2937]/50 ${isLeftSidebarOpen ? 'px-3 py-2.5 flex items-center justify-between' : 'py-2.5 flex flex-col items-center gap-2'}`}>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="text-gray-400 hover:text-white transition-colors"
            title="Open Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          {isLeftSidebarOpen ? (
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-[12px] text-gray-400">{isConnected ? "Connected" : "Disconnected"}</span>
            </div>
          ) : (
            <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
          )}
        </div>

        {/* Resize handle — expanded only */}
        {isLeftSidebarOpen && (
          <div
            onMouseDown={handleSidebarResizeStart}
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-white/10 active:bg-white/20 transition-colors z-50"
          />
        )}
      </aside>

      {activeView === 'skills' ? (
        <SkillsPage />
      ) : activeView === 'connectors' ? (
        <ConnectorsPage onOpenSettings={() => setIsSettingsOpen(true)} refreshKey={connectorsRefreshKey} />
      ) : (
      <main className="flex-1 flex flex-col bg-[#111827] relative min-w-0">
        
        {/* Header Overlay */}
        <header className="absolute top-0 left-0 right-0 p-3 flex items-center justify-between z-10" data-tauri-drag-region>
          <div className="flex items-center gap-2">
            {projectDir && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#182234] border border-[#374151] text-gray-300 text-[12px] font-medium transition-all shadow-sm animate-in fade-in slide-in-from-left-2 duration-300">
                <FolderOpen className="w-3 h-3 opacity-70" />
                <span className="opacity-80">Working on:</span>
                <span className="font-semibold truncate max-w-[150px]">{projectDir.split('/').pop() || projectDir}</span>
              </div>
            )}
            
            {/* Model Selector */}
            <div className="relative flex items-center bg-[#182234] border border-[#1f2937] rounded-lg shadow-sm hover:border-[#374151] transition-colors focus-within:border-[#c5f016]/50">
               <select 
                 value={selectedModel ? `${selectedModel.provider}:${selectedModel.id}` : ""}
                 onChange={handleModelChange}
                 className="appearance-none bg-transparent py-1.5 pl-2.5 pr-7 text-[13px] font-medium text-gray-300 focus:outline-none focus:text-white cursor-pointer w-full z-10"
               >
                 {availableModels.map(m => (
                    <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`} className="bg-[#182234] text-gray-200">
                       {m.name || `${m.provider}/${m.id}`}
                    </option>
                 ))}
               </select>
               <ChevronDown className="w-3.5 h-3.5 opacity-50 absolute right-2 pointer-events-none text-gray-400" />
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => { if (isPreviewOpen) setIsPreviewMaximized(false); setIsPreviewOpen(o => !o); }}
              className="p-1.5 rounded-lg bg-[#182234] border border-[#1f2937] text-gray-400 hover:text-white transition-colors shadow-sm"
              title="Toggle Artifacts/Preview Pane"
            >
              {isPreviewOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Sandbox warning banner — shown when sandboxing is unavailable */}
        {sandboxStatus && !sandboxStatus.active && !sandboxBannerDismissed && (
          <div className="absolute top-14 left-0 right-0 z-20 mx-3">
            <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[12px]">
              <span className="flex-shrink-0 mt-0.5" aria-hidden="true">⚠</span>
              <span className="flex-1">
                {sandboxStatus.warning ?? 'Sandboxing is inactive.'}{' '}
                <a
                  href="https://github.com/anthropic-experimental/sandbox-runtime"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-amber-300"
                >
                  Learn more
                </a>
              </span>
              <button
                type="button"
                onClick={() => setSandboxBannerDismissed(true)}
                className="flex-shrink-0 p-0.5 hover:text-white transition-colors"
                aria-label="Dismiss sandbox warning"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Chat Feed */}
        <div className={`flex-1 overflow-y-auto px-3 scroll-smooth ${
          sandboxStatus && !sandboxStatus.active && !sandboxBannerDismissed ? 'pt-28' : 'pt-16'
        } pb-4`}>
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-3 max-w-md mx-auto text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#182234] border border-[#1f2937] flex items-center justify-center shadow-lg">
                 <Bot className="w-8 h-8 text-gray-400" />
              </div>
              <h2 className="text-xl font-bold text-gray-200">Hello, I'm your productivity agent.</h2>
              <p className="text-[13px] text-gray-400">Attach files, ask me to write code, or open the preview pane to see artifacts render in real-time.</p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-5">
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={`flex gap-3 ${
                    msg.role === "assistant" 
                    ? "fade-in" 
                    : "flex-row-reverse"
                  }`}
                >
                  <div className="flex-shrink-0 mt-1">
                    {msg.role === "assistant" ? (
                      <div className="w-7 h-7 rounded-lg bg-[#182234] border border-[#1f2937] flex items-center justify-center flex-shrink-0">
                         <Bot className="w-4 h-4 text-gray-400" />
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-[#fde047] flex items-center justify-center flex-shrink-0 text-[#111827] text-[12px] font-bold shadow-md">
                         U
                      </div>
                    )}
                  </div>
                  
                  <div className={`flex-1 text-[13px] leading-6 relative ${msg.role === "user" ? "max-w-[78%]" : ""}`}>
                     {msg.role === "assistant" ? (
                       <MarkdownMessage content={msg.content} isStreaming={msg.isStreaming} />
                     ) : (
                       <div className="bg-[#1f2937] px-4 py-2.5 rounded-xl rounded-tr-sm text-[#f3f4f6] whitespace-pre-wrap inline-block shadow-sm w-full text-right">
                         {msg.content}
                       </div>
                     )}
                  </div>
                </div>
              ))}
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-xl text-red-400 text-[13px] flex items-center justify-center">
                   {error}
                </div>
              )}
              <div ref={chatEndRef} className="h-3" />
            </div>
          )}
        </div>

        {/* Input Footer Area */}
        <div className="p-3 mx-auto w-full max-w-4xl relative z-20 bg-gradient-to-t from-[#111827] via-[#111827] to-transparent pt-6">
          <form 
            onSubmit={handleSubmit}
            className="relative flex flex-col bg-[#182234] rounded-xl border border-[#374151] shadow-xl focus-within:border-[#c5f016]/50 transition-all duration-200"
          >
            <div className="px-3 pt-3 pb-1.5">
              {/* Attachments Display */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {attachments.map((att, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 bg-[#1f2937] px-2 py-1 rounded-lg border border-[#374151]">
                       <Paperclip className="w-3 h-3 text-gray-400" />
                       <span className="text-[12px] text-gray-300 max-w-[150px] truncate">{att.name}</span>
                       <button 
                         type="button" 
                         onClick={() => removeAttachment(idx)}
                         className="p-0.5 hover:bg-[#4b5563] rounded-full text-gray-400 hover:text-white transition-colors"
                       >
                         <X className="w-3.5 h-3.5" />
                       </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                className="w-full max-h-44 min-h-[38px] bg-transparent resize-none text-[#f3f4f6] placeholder-gray-500 focus:outline-none text-[13px]"
                placeholder={isProcessing ? "Steer the agent... (sends a mid-task correction)" : "Message Agent..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                rows={Math.min(Math.max(input.split('\n').length, 1), 8)}
              />
            </div>
            
            {/* Input Toolbar */}
            <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
              <div className="flex items-center gap-1">
                 <button type="button" onClick={handleAttachFile} className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-[#374151] transition-colors" title="Attach Files">
                   <Paperclip className="w-4 h-4" />
                 </button>
                 <button 
                   type="button" 
                   onClick={handleSelectProject}
                   className="p-1.5 text-gray-400 hover:text-[#c5f016] rounded-lg hover:bg-[#374151] transition-colors" 
                   title="Select Project Folder"
                 >
                   <FolderOpen className="w-4 h-4" />
                 </button>
              </div>
              
               <div className="flex items-center gap-2">
                 {isProcessing && (
                   <button
                     type="button"
                     onClick={handleStop}
                     className="p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 transition-all shadow-sm flex items-center gap-2 px-3 text-[13px] font-medium"
                   >
                     <CircleStop className="w-3.5 h-3.5" />
                     <span className="hidden sm:inline">Stop</span>
                   </button>
                 )}

                 <button
                   type="submit"
                   disabled={(!input.trim() && attachments.length === 0) || !isConnected}
                   className={`p-1.5 rounded-lg transition-all shadow-sm flex items-center gap-2 px-3 text-[13px] font-medium ${
                     isProcessing 
                      ? "bg-[#374151] text-gray-300 hover:bg-[#4b5563]" 
                      : "bg-[#c5f016] text-[#111827] hover:bg-[#d6f733]"
                   }`}
                 >
                   {isProcessing ? (
                      isSteering ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#c5f016]" /> : <Zap className="w-3.5 h-3.5 text-[#c5f016]" />
                   ) : (
                      <Send className="w-3.5 h-3.5" />
                   )}
                   <span>{isProcessing ? (isSteering ? "Steering..." : "Steer") : "Send"}</span>
                 </button>
               </div>
            </div>
          </form>
        </div>
      </main>
      )}

      {/* Right Sidebar (Artifacts/Preview) */}
      <aside className={`${activeView === 'chat' && isPreviewOpen ? (isPreviewMaximized ? 'w-1/2' : 'w-1/3') : 'w-0'} flex-shrink-0 transition-all duration-300 border-l border-[#1f2937] bg-[#182234] flex flex-col overflow-hidden shadow-2xl z-30`}>
         <div className="px-3 py-2.5 border-b border-[#1f2937] flex items-center justify-between bg-[#141d2e]">
            <h3 className="text-[13px] font-semibold text-gray-300 flex items-center gap-2">
               <Terminal className="w-3.5 h-3.5 text-[#9df0c0]" /> 
               Artifact Preview
            </h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setIsPreviewMaximized(m => !m);
                }}
                className="p-1 text-gray-400 hover:text-white rounded hover:bg-[#374151] transition-colors"
                title={isPreviewMaximized ? "Restore" : "Maximize"}
              >
                {isPreviewMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => { setIsPreviewOpen(false); setIsPreviewMaximized(false); }} className="p-1 text-gray-400 hover:text-white rounded hover:bg-[#374151] transition-colors">
                 <PanelRightClose className="w-3.5 h-3.5" />
              </button>
            </div>
         </div>
         
         <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
            {toolExecutions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-2.5">
                 <Terminal className="w-10 h-10 mx-auto opacity-20" />
                 <p className="text-[13px]">No artifacts rendered yet.</p>
                 <p className="text-[12px] text-gray-600 px-4 text-center">Generated code or tool executions will appear here.</p>
              </div>
            ) : (
              <div className="space-y-3 pb-8">
                 {toolExecutions.map(tool => (
                   <div key={tool.id} className="bg-[#111827] border border-[#374151] rounded-lg overflow-hidden shadow-sm flex flex-col">
                      <div className="px-3 py-1.5 border-b border-[#1f2937] bg-[#182234] flex items-center justify-between">
                         <div className="flex items-center gap-2">
                            {tool.status === "running" ? (
                              <Loader2 className="w-3.5 h-3.5 text-[#c5f016] animate-spin" />
                            ) : tool.status === "error" ? (
                              <div className="w-2 h-2 rounded-full bg-red-500" />
                            ) : (
                              <div className="w-2 h-2 rounded-full bg-[#9df0c0]" />
                            )}
                            <span className="text-[12px] font-medium text-gray-300 font-mono">
                               {tool.name}
                            </span>
                         </div>
                         <span className="text-[12px] uppercase text-gray-500 font-bold bg-[#111827] px-2 py-0.5 rounded">
                            {tool.status}
                         </span>
                      </div>
                      <div className="p-2.5 text-[12px] font-mono text-gray-400 overflow-x-auto whitespace-pre-wrap max-h-44 overflow-y-auto">
                         {tool.args && (
                           <div className="mb-2">
                             <span className="text-gray-500 block mb-1">Args:</span>
                             <span className="text-blue-300">{JSON.stringify(tool.args, null, 2)}</span>
                           </div>
                         )}
                         {tool.result != null && (
                           <div className="mt-2 pt-2 border-t border-[#1f2937]">
                             <span className="text-gray-500 block mb-1">Output:</span>
                             <span className="text-green-300">{typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}</span>
                           </div>
                         )}
                      </div>
                   </div>
                 ))}
              </div>
            )}
         </div>
      </aside>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false);
          if (activeView === 'connectors') setConnectorsRefreshKey(k => k + 1);
        }}
        isConnected={isConnected}
      />

    </div>
  );
}

export default App;
