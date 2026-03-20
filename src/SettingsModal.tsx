import { useState, useEffect, useRef, useCallback } from "react";
import { X, Key, Save, AlertCircle, CheckCircle2 } from "lucide-react";
import { API_BASE } from "./config";

type AuthStatus = "idle" | "saving" | "success" | "error" | "oauth_loading";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isConnected: boolean;
}

export function SettingsModal({ isOpen, onClose, isConnected }: SettingsModalProps) {
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [oauthProviders, setOauthProviders] = useState<{id: string, name: string}[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  
  // OAuth Flow State
  const [oauthInstructions, setOauthInstructions] = useState<{url: string, instructions?: string} | null>(null);
  const [oauthProgress, setOauthProgress] = useState<string>("");

  const eventSourceRef = useRef<EventSource | null>(null);
  const listenersRef = useRef<{
    authInstructions: EventListener;
    progress: EventListener;
    prompt: EventListener;
    success: EventListener;
    appError: EventListener;
  } | null>(null);
  const statusRef = useRef<AuthStatus>("idle");
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateStatus = useCallback((s: AuthStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const cleanupOAuthFlow = useCallback(() => {
    const es = eventSourceRef.current;
    if (es && listenersRef.current) {
      const l = listenersRef.current;
      es.removeEventListener("auth_instructions", l.authInstructions);
      es.removeEventListener("progress", l.progress);
      es.removeEventListener("prompt", l.prompt);
      es.removeEventListener("success", l.success);
      es.removeEventListener("error", l.appError);
      listenersRef.current = null;
    }
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const [authRes, oauthRes] = await Promise.all([
        fetch(`${API_BASE}/api/auth`),
        fetch(`${API_BASE}/api/auth/oauth-providers`)
      ]);

      if (authRes.ok) {
        const data = await authRes.json();
        const providers = data.availableProviders || [];
        setAvailableProviders(providers);
        setConfiguredProviders(data.configured || []);
        
        // Auto-select first provider if empty
        if (providers.length > 0 && !selectedProvider) {
          setSelectedProvider(providers[0]);
        }
      }

      if (oauthRes.ok) {
        const data = await oauthRes.json();
        setOauthProviders(data.providers || []);
      }
    } catch (e) {
      console.error("Failed to fetch auth status", e);
    }
  }, [selectedProvider]);

  // Fetch when modal opens, and again whenever the connection is restored
  useEffect(() => {
    if (isOpen && isConnected) fetchAuthStatus();
  }, [isOpen, isConnected, fetchAuthStatus]);

  // Cleanup when modal closes or component unmounts
  useEffect(() => {
    if (!isOpen) cleanupOAuthFlow();
    return cleanupOAuthFlow;
  }, [isOpen, cleanupOAuthFlow]);

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
        const errData = await res.json();
        throw new Error(errData.error || "Failed to save key");
      }
    } catch (e: any) {
      updateStatus("error");
      setErrorMessage(e.message);
    }
  };

  const handleOAuthLogin = (providerId: string) => {
    // Belt-and-suspenders: buttons are disabled during oauth_loading, but guard here too
    if (status === "oauth_loading") return;

    cleanupOAuthFlow();

    updateStatus("oauth_loading");
    setOauthInstructions(null);
    setOauthProgress("Initiating login...");
    setErrorMessage("");

    // Use URL constructor so providerId is percent-encoded, preventing CRLF injection
    const loginUrl = new URL(`${API_BASE}/api/auth/login`);
    loginUrl.searchParams.set("provider", providerId);
    const eventSource = new EventSource(loginUrl.toString());
    eventSourceRef.current = eventSource;

    // Define named handlers so they can be removed by cleanupOAuthFlow
    const onAuthInstructions: EventListener = (e) => {
      const msgEvent = e as MessageEvent;
      try {
        const data = JSON.parse(msgEvent.data);
        setOauthInstructions({ url: data.url, instructions: data.instructions });
        setOauthProgress("Waiting for browser authentication...");
      } catch {
        setErrorMessage("Received malformed response from server.");
        updateStatus("error");
      }
    };

    const onProgress: EventListener = (e) => {
      const msgEvent = e as MessageEvent;
      try {
        const data = JSON.parse(msgEvent.data);
        setOauthProgress(data.message);
      } catch {
        // Ignore malformed progress updates
      }
    };

    const onPrompt: EventListener = (e) => {
      const msgEvent = e as MessageEvent;
      try {
        const data = JSON.parse(msgEvent.data);
        setOauthProgress(data.message || "Manual input required");
      } catch {
        setOauthProgress("Manual input required");
      }
    };

    const onSuccess: EventListener = () => {
      updateStatus("success");
      setOauthInstructions(null);
      setOauthProgress("");
      fetchAuthStatus();
      cleanupOAuthFlow();
      successTimerRef.current = setTimeout(() => updateStatus("idle"), 3000);
    };

    // Application-level errors (server sends event: error with data)
    const onAppError: EventListener = (e) => {
      const msgEvent = e as MessageEvent;
      if (msgEvent.data) {
        try {
          const data = JSON.parse(msgEvent.data);
          setErrorMessage(data.error || "OAuth failed");
        } catch {
          setErrorMessage("OAuth failed.");
        }
        updateStatus("error");
        setOauthInstructions(null);
        setOauthProgress("");
        cleanupOAuthFlow();
      }
    };

    listenersRef.current = {
      authInstructions: onAuthInstructions,
      progress: onProgress,
      prompt: onPrompt,
      success: onSuccess,
      appError: onAppError,
    };

    eventSource.addEventListener("auth_instructions", onAuthInstructions);
    eventSource.addEventListener("progress", onProgress);
    eventSource.addEventListener("prompt", onPrompt);
    eventSource.addEventListener("success", onSuccess);
    eventSource.addEventListener("error", onAppError);

    // Transport-level errors (network drop, CORS, etc.)
    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        if (statusRef.current === "oauth_loading") {
          updateStatus("error");
          setErrorMessage("Connection lost during login flow.");
          setOauthInstructions(null);
          setOauthProgress("");
          cleanupOAuthFlow();
        }
      }
    };
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#182234] border border-[#374151] rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="px-4 py-3 border-b border-[#374151] flex items-center justify-between bg-[#141d2e] flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-200 flex items-center gap-2">
            <Key className="w-4 h-4 text-[#c5f016]" />
            Engine Settings
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-[#374151] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto">

          {/* Loading banner — shown while the backend is still starting up */}
          {!isConnected && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#111827] border border-[#374151] text-gray-400 text-[12px]">
              <span className="w-3.5 h-3.5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span>Starting up… settings will load automatically.</span>
            </div>
          )}

          <div>
            <h3 className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Configure LLM Access</h3>
            <p className="text-[13px] text-gray-500 mb-3">
              Enter your API keys below. They are securely saved to <code className="bg-[#111827] px-1.5 py-0.5 rounded text-[#c5f016]">~/.pi/agent/auth.json</code> via the SDK backend.
            </p>

            <form onSubmit={handleSaveKey} className="space-y-3">

              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-gray-300">Provider</label>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  disabled={!isConnected}
                  className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-[#c5f016] transition-colors appearance-none disabled:opacity-50"
                >
                  {availableProviders.length === 0
                    ? <option value="">—</option>
                    : availableProviders.map((p) => (
                        <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                      ))
                  }
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-gray-300">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  disabled={!isConnected}
                  className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-[#c5f016] focus:shadow-[0_0_15px_rgba(197,240,22,0.1)] transition-all font-mono text-[13px] disabled:opacity-50"
                />
              </div>

              {status === "error" && (
                <div className="flex items-center gap-2 text-red-400 text-[13px] bg-red-400/10 p-2.5 rounded-lg border border-red-400/20">
                  <AlertCircle className="w-4 h-4" />
                  {errorMessage}
                </div>
              )}

              {status === "success" && (
                <div className="flex items-center gap-2 text-[#9df0c0] text-[13px] bg-[#9df0c0]/10 p-2.5 rounded-lg border border-[#9df0c0]/20">
                  <CheckCircle2 className="w-4 h-4" />
                  Key securely saved!
                </div>
              )}

              <div className="pt-1 flex justify-end">
                <button
                  type="submit"
                  disabled={!isConnected || !apiKey.trim() || status === "saving"}
                  className="flex items-center gap-2 px-4 py-2 bg-[#c5f016] text-[#111827] text-[13px] font-medium rounded-lg hover:bg-[#d6f733] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {status === "saving" ? (
                    <span className="w-4 h-4 border-2 border-[#111827] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Key
                </button>
              </div>
            </form>
          </div>

          <div className="pt-4 border-t border-[#374151]">
            <h3 className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Subscriptions (OAuth)</h3>
            <p className="text-[13px] text-gray-500 mb-3">
              Login to your existing subscriptions directly via the browser.
            </p>
            {!isConnected ? (
              <p className="text-[13px] text-gray-600 italic">Starting up…</p>
            ) : oauthProviders.length === 0 ? (
              <p className="text-[13px] text-gray-600 italic">No subscription providers available.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {oauthProviders.map(provider => (
                  <button
                    key={provider.id}
                    onClick={() => handleOAuthLogin(provider.id)}
                    disabled={status === "oauth_loading"}
                    className="bg-[#111827] border border-[#374151] hover:border-[#c5f016] text-gray-300 text-[13px] font-medium py-2 px-3 rounded-lg transition-all disabled:opacity-50 text-left truncate"
                  >
                    {provider.name}
                  </button>
                ))}
              </div>
            )}

            {/* OAuth Status Indicator */}
            {status === "oauth_loading" && (
              <div className="mt-3 p-3 bg-[#111827] border border-[#c5f016]/30 rounded-lg space-y-2">
                <div className="flex items-center gap-3 text-[#c5f016]">
                  <span className="w-4 h-4 border-2 border-[#c5f016] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[13px] font-medium">{oauthProgress}</span>
                </div>
                {oauthInstructions && (
                  <div className="text-[13px] text-gray-300 pl-7 space-y-1.5">
                    {oauthInstructions.instructions && <p>{oauthInstructions.instructions}</p>}
                    <a 
                      href={oauthInstructions.url} 
                      target="_blank" 
                      rel="noreferrer"
                      className="inline-block text-[#c5f016] hover:underline break-all"
                    >
                      {oauthInstructions.url}
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-[#374151]">
            <h3 className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Configured Providers</h3>
            {configuredProviders.length === 0 ? (
              <p className="text-[13px] text-gray-500 italic">No keys configured yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {configuredProviders.map((id) => (
                  <li key={id} className="flex items-center gap-2 text-[13px] text-gray-300 bg-[#111827] px-3 py-1.5 rounded-lg border border-[#374151]">
                    <div className="w-2 h-2 rounded-full bg-[#c5f016]" />
                    {id.charAt(0).toUpperCase() + id.slice(1)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
}
