import { useState, useEffect, useRef, useCallback } from "react";
import { Key, Save, AlertCircle, CheckCircle2, Keyboard, Zap, Network, Link2 } from "lucide-react";
import { API_BASE } from "./config";

export type SettingsTab = "connections" | "shortcuts" | "skills" | "connectors";
type AuthStatus = "idle" | "saving" | "success" | "error" | "oauth_loading";

interface OAuthProvider {
  id: string;
  name: string;
  category: string;
  available: boolean;
}

interface PendingOAuthFlow {
  pendingId: string;
  provider: string;
  kind: "oauth" | "device";
}

// ── Tab Bar (exported so App.tsx can render it at the top of main) ─────────────

interface SettingsTabBarProps {
  tab: SettingsTab;
  onChange: (tab: SettingsTab) => void;
}

export function SettingsTabBar({ tab, onChange }: SettingsTabBarProps) {
  return (
    <div className="flex items-center gap-1 px-4 pt-4 pb-0 border-b border-[#1f2937] flex-shrink-0">
      {([
        { id: "connections" as SettingsTab, label: "Providers", icon: Link2 },
        { id: "shortcuts" as SettingsTab, label: "Shortcuts", icon: Keyboard },
        { id: "skills" as SettingsTab, label: "Skills", icon: Zap },
        { id: "connectors" as SettingsTab, label: "Connectors", icon: Network },
      ] as { id: SettingsTab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-t-lg border-b-2 transition-colors -mb-px ${
            tab === id
              ? "text-[#c5f016] border-[#c5f016] bg-[#1f2937]/40"
              : "text-gray-400 border-transparent hover:text-gray-200 hover:bg-[#1f2937]/30"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Connections + Shortcuts content (rendered inline by App.tsx) ──────────────

interface SettingsContentProps {
  tab: SettingsTab;
  isConnected: boolean;
}

export function SettingsContent({ tab, isConnected }: SettingsContentProps) {
  if (tab === "connections") return <div className="flex-1 overflow-y-auto"><ConnectionsTab isConnected={isConnected} /></div>;
  if (tab === "shortcuts") return <div className="flex-1 overflow-y-auto"><ShortcutsTab /></div>;
  return null; // skills + connectors rendered as top-level components in App.tsx
}

// ── Connections Tab ───────────────────────────────────────────────────────────

function ConnectionsTab({ isConnected }: { isConnected: boolean }) {
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [authenticatedProviders, setAuthenticatedProviders] = useState<string[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [oauthInstructions, setOauthInstructions] = useState<{ url: string; instructions?: string } | null>(null);
  const [oauthProgress, setOauthProgress] = useState("");
  const [oauthCodeInput, setOauthCodeInput] = useState("");
  const [pendingOAuthFlow, setPendingOAuthFlow] = useState<PendingOAuthFlow | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const listenersRef = useRef<Record<string, EventListener> | null>(null);
  const statusRef = useRef<AuthStatus>("idle");
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateStatus = useCallback((s: AuthStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const cleanupOAuth = useCallback(() => {
    const es = eventSourceRef.current;
    if (es && listenersRef.current) {
      for (const [evt, fn] of Object.entries(listenersRef.current)) es.removeEventListener(evt, fn);
      listenersRef.current = null;
    }
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (successTimerRef.current) { clearTimeout(successTimerRef.current); successTimerRef.current = null; }
  }, []);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const [authRes, oauthRes, oauthStatusRes] = await Promise.all([
        fetch(`${API_BASE}/api/auth`),
        fetch(`${API_BASE}/api/auth/oauth-providers`),
        fetch(`${API_BASE}/api/auth/status`),
      ]);
      if (authRes.ok) {
        const data = await authRes.json();
        const providers = data.availableProviders || [];
        setAvailableProviders(providers);
        setConfiguredProviders(data.configured || []);
        if (providers.length > 0 && !selectedProvider) setSelectedProvider(providers[0]);
      }
      if (oauthRes.ok) {
        const data = await oauthRes.json();
        setOauthProviders(data.providers || []);
      }
      if (oauthStatusRes.ok) {
        const data = await oauthStatusRes.json();
        setAuthenticatedProviders(data.authenticated_providers || []);
      }
    } catch {/* non-critical */}
  }, [selectedProvider]);

  useEffect(() => {
    if (isConnected) fetchAuthStatus();
  }, [isConnected, fetchAuthStatus]);

  useEffect(() => () => cleanupOAuth(), [cleanupOAuth]);

  const handleSaveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    updateStatus("saving");
    try {
      const res = await fetch(`${API_BASE}/api/auth/key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selectedProvider, key: apiKey.trim() }),
      });
      if (res.ok) {
        updateStatus("success");
        setApiKey("");
        fetchAuthStatus();
        successTimerRef.current = setTimeout(() => updateStatus("idle"), 3000);
      } else {
        const d = await res.json();
        throw new Error(d.error || "Failed to save key");
      }
    } catch (e: any) {
      updateStatus("error");
      setErrorMessage(e.message);
    }
  };

  const handleOAuthLogin = (providerId: string) => {
    void (async () => {
      if (status === "oauth_loading") return;
      cleanupOAuth();
      updateStatus("oauth_loading");
      setOauthInstructions(null);
      setOauthProgress("Initiating login...");
      setErrorMessage("");
      setOauthCodeInput("");
      setPendingOAuthFlow(null);

      try {
        const loginUrl = new URL(`${API_BASE}/api/auth/login`);
        loginUrl.searchParams.set("provider", providerId);
        const res = await fetch(loginUrl.toString());
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "OAuth login failed");

        setOauthInstructions({ url: data.url, instructions: data.instructions });
        setOauthProgress(data.message || "Open the browser flow to continue.");
        setPendingOAuthFlow({
          pendingId: data.pendingId,
          provider: data.provider,
          kind: data.kind,
        });
        updateStatus("idle");
      } catch (e: any) {
        setErrorMessage(e.message || "OAuth failed.");
        setOauthInstructions(null);
        setOauthProgress("");
        setPendingOAuthFlow(null);
        updateStatus("error");
      }
    })();
  };

  const handleOAuthComplete = () => {
    void (async () => {
      if (!pendingOAuthFlow) return;
      updateStatus("oauth_loading");
      setErrorMessage("");

      try {
        const res = await fetch(`${API_BASE}/api/auth/login/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pendingId: pendingOAuthFlow.pendingId,
            codeInput: pendingOAuthFlow.kind === "oauth" ? oauthCodeInput : "",
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "OAuth completion failed");

        updateStatus("success");
        setOauthInstructions(null);
        setOauthProgress("");
        setOauthCodeInput("");
        setPendingOAuthFlow(null);
        fetchAuthStatus();
        successTimerRef.current = setTimeout(() => updateStatus("idle"), 3000);
      } catch (e: any) {
        setErrorMessage(e.message || "OAuth completion failed.");
        updateStatus("error");
      }
    })();
  };

  // Group OAuth providers by category
  const visibleOauthProviders = oauthProviders;

  const oauthByCategory = visibleOauthProviders.reduce<Record<string, OAuthProvider[]>>((acc, p) => {
    (acc[p.category] = acc[p.category] || []).push(p);
    return acc;
  }, {});

  return (
    <div className="p-4 space-y-6 max-w-2xl">

      {!isConnected && (
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#111827] border border-[#374151] text-gray-400 text-[12px]">
          <span className="w-3.5 h-3.5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          Starting up… settings will load automatically.
        </div>
      )}

      {/* API Keys */}
      <section>
        <h3 className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Key className="w-3.5 h-3.5" /> API Keys
        </h3>
        <form onSubmit={handleSaveKey} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-gray-400">Provider</label>
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                disabled={!isConnected}
                className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-[#c5f016] transition-colors appearance-none disabled:opacity-50"
              >
                {availableProviders.length === 0
                  ? <option value="">—</option>
                  : availableProviders.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-gray-400">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                disabled={!isConnected}
                className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-[#c5f016] transition-all font-mono text-[13px] disabled:opacity-50"
              />
            </div>
          </div>

          {status === "error" && (
            <div className="flex items-center gap-2 text-red-400 text-[13px] bg-red-400/10 p-2.5 rounded-lg border border-red-400/20">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {errorMessage}
            </div>
          )}
          {status === "success" && (
            <div className="flex items-center gap-2 text-[#9df0c0] text-[13px] bg-[#9df0c0]/10 p-2.5 rounded-lg border border-[#9df0c0]/20">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> Key saved!
            </div>
          )}

          <div className="flex items-center justify-between">
            {configuredProviders.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {configuredProviders.map((id) => (
                  <span key={id} className="flex items-center gap-1.5 text-[12px] text-gray-300 bg-[#111827] px-2.5 py-1 rounded-full border border-[#374151]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#c5f016]" />
                    {id.charAt(0).toUpperCase() + id.slice(1)}
                  </span>
                ))}
              </div>
            )}
            <button
              type="submit"
              disabled={!isConnected || !apiKey.trim() || status === "saving"}
              className="ml-auto flex items-center gap-2 px-4 py-2 bg-[#c5f016] text-[#111827] text-[13px] font-medium rounded-lg hover:bg-[#d6f733] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === "saving" ? <span className="w-4 h-4 border-2 border-[#111827] border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
              Save Key
            </button>
          </div>
        </form>
      </section>

      {/* OAuth */}
      <section>
        <h3 className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-3">OAuth Providers</h3>

        {status === "oauth_loading" && (
          <div className="mb-4 p-3 bg-[#111827] border border-[#c5f016]/30 rounded-lg space-y-2">
            <div className="flex items-center gap-3 text-[#c5f016]">
              <span className="w-4 h-4 border-2 border-[#c5f016] border-t-transparent rounded-full animate-spin" />
              <span className="text-[13px] font-medium">{oauthProgress}</span>
            </div>
            {oauthInstructions && (
              <div className="text-[13px] text-gray-300 pl-7 space-y-1.5">
                {oauthInstructions.instructions && <p>{oauthInstructions.instructions}</p>}
                <a href={oauthInstructions.url} target="_blank" rel="noreferrer" className="inline-block text-[#c5f016] hover:underline break-all">
                  {oauthInstructions.url}
                </a>
              </div>
            )}
          </div>
        )}

        {pendingOAuthFlow && status !== "success" && (
          <div className="mb-4 p-3 bg-[#111827] border border-[#374151] rounded-lg space-y-3">
            {pendingOAuthFlow.kind === "oauth" ? (
              <div className="space-y-2">
                <label className="block text-[12px] font-medium text-gray-300">
                  Paste callback URL or authorization code
                </label>
                <input
                  value={oauthCodeInput}
                  onChange={(e) => setOauthCodeInput(e.target.value)}
                  placeholder="Paste callback URL or code"
                  className="w-full bg-[#0f1724] border border-[#374151] rounded-lg px-3 py-2 text-[13px] text-gray-100 focus:outline-none focus:border-[#c5f016]"
                />
              </div>
            ) : (
              <p className="text-[13px] text-gray-300">
                After approving access in your browser, click below to finish setup.
              </p>
            )}
            <div className="flex justify-end">
              <button
                onClick={handleOAuthComplete}
                disabled={status === "oauth_loading" || (pendingOAuthFlow.kind === "oauth" && !oauthCodeInput.trim())}
                className="px-4 py-2 rounded-lg bg-[#c5f016] text-[#111827] text-[13px] font-medium disabled:opacity-50"
              >
                Complete setup
              </button>
            </div>
          </div>
        )}

        {!isConnected ? (
          <p className="text-[13px] text-gray-600 italic">Starting up…</p>
        ) : visibleOauthProviders.length === 0 ? (
          <p className="text-[13px] text-gray-600 italic">No OAuth providers available.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(oauthByCategory).map(([category, providers]) => (
              <div key={category}>
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">{category}</div>
                <div className="grid grid-cols-2 gap-2">
                  {providers.map((provider) => {
                    const connected = authenticatedProviders.includes(provider.id);
                    const canConfigure = !connected;
                    return (
                      <button
                        key={provider.id}
                        onClick={() => handleOAuthLogin(provider.id)}
                        disabled={status === "oauth_loading" || connected}
                        className={`relative flex items-center justify-between px-3 py-2 rounded-lg border text-[13px] font-medium transition-all disabled:opacity-50 ${
                          connected
                            ? "bg-[#c5f016]/10 border-[#c5f016]/45 text-[#e8ff9a] hover:bg-[#c5f016]/15"
                            : canConfigure
                              ? "bg-[#172235] border-[#566a1f] text-gray-100 shadow-[inset_0_1px_0_rgba(197,240,22,0.08)] hover:border-[#c5f016] hover:bg-[#1b2940]"
                              : "bg-[#111827] border-[#2b3544] text-gray-500"
                        }`}
                      >
                        <span className="truncate">{provider.name}</span>
                        {(connected || canConfigure) && (
                          <span className="ml-2 flex items-center gap-2 flex-shrink-0">
                            <span className={`w-2.5 h-2.5 rounded-full ${
                              connected
                                ? "bg-[#c5f016] shadow-[0_0_12px_rgba(197,240,22,0.95)]"
                                : canConfigure
                                  ? "bg-[#c5f016]/75"
                                  : "bg-gray-600"
                            }`} />
                            <span className={`text-[11px] font-semibold uppercase tracking-wide ${
                              connected
                                ? "text-[#dfff7a]"
                                : canConfigure
                                  ? "text-[#d8f46a]"
                                  : "text-gray-500"
                            }`}>
                              {connected ? "Active" : "Set up"}
                            </span>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Shortcuts Tab ─────────────────────────────────────────────────────────────

const SHORTCUTS: { keys: string[]; description: string; category: string }[] = [
  { category: "Chat", keys: ["Enter"], description: "Send message" },
  { category: "Chat", keys: ["Shift", "Enter"], description: "New line in message" },
  { category: "Chat", keys: ["⌘", "N"], description: "New chat" },
  { category: "Navigation", keys: ["⌘", ","], description: "Open settings" },
  { category: "Navigation", keys: ["⌘", "\\"], description: "Toggle sidebar" },
  { category: "Input", keys: ["⌘", "V"], description: "Paste image or text from clipboard" },
];

function ShortcutsTab() {
  const categories = [...new Set(SHORTCUTS.map((s) => s.category))];
  return (
    <div className="p-4 max-w-lg">
      <p className="text-[13px] text-gray-500 mb-4">Keyboard shortcuts for Work With Me.</p>
      <div className="space-y-5">
        {categories.map((cat) => (
          <section key={cat}>
            <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">{cat}</h3>
            <div className="space-y-1">
              {SHORTCUTS.filter((s) => s.category === cat).map((s, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-[#1f2937]/50">
                  <span className="text-[13px] text-gray-300">{s.description}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((k, ki) => (
                      <kbd key={ki} className="px-1.5 py-0.5 bg-[#111827] border border-[#374151] rounded text-[11px] text-gray-300 font-mono">
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
