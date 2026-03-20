import { useState, useEffect, useCallback } from "react";
import DOMPurify from "dompurify";
import { Network, Search, Plus, X, ChevronDown } from "lucide-react";
import { API_BASE } from "./config";
import { openUrl } from "@tauri-apps/plugin-opener";

// ── Types ────────────────────────────────────────────────────────────────────

interface ConnectorEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  type: "oauth" | "mcp" | "remote-mcp";
  status: "connected" | "available";
  logoSvg?: string;
  url?: string;
  docsUrl?: string;
  requiresToken: boolean;
}

interface GetConnectorsResponse {
  connectors: ConnectorEntry[];
  warning?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "Productivity",
  "Google",
  "Microsoft",
  "Communication",
  "CRM & Sales",
  "Finance",
  "Developer Tools",
  "Database",
  "E-commerce & Content",
  "AI/ML",
] as const;

const ICON_COLORS: Record<string, string> = {
  anthropic: "bg-[#cc5500]",
  google: "bg-[#4285f4]",
  github: "bg-[#24292e]",
  openai: "bg-[#10a37f]",
};

const FETCH_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

// ── ConnectorLogo ────────────────────────────────────────────────────────────

const LOGO_CONTAINER = "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0";

function ConnectorLogo({ entry }: { entry: ConnectorEntry }) {
  if (entry.logoSvg) {
    return (
      <div
        className={`${LOGO_CONTAINER} bg-white/5 p-1.5 [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full`}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(entry.logoSvg, { USE_PROFILES: { svg: true } }) }}
      />
    );
  }
  const bg = ICON_COLORS[entry.name.toLowerCase()] ?? "bg-[#374151]";
  return (
    <div className={`${LOGO_CONTAINER} ${bg} text-white font-bold text-[14px]`}>
      {entry.name.charAt(0).toUpperCase()}
    </div>
  );
}

// ── StatusDot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: "connected" | "available" }) {
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${status === "connected" ? "bg-green-500" : "bg-gray-600"}`} />
      <span className={`text-[12px] font-medium ${status === "connected" ? "text-green-400" : "text-gray-500"}`}>
        {status === "connected" ? "Connected" : "Available"}
      </span>
    </div>
  );
}

// ── Main ConnectorsPage ──────────────────────────────────────────────────────

type FilterTab = "all" | "connected" | "available";

interface ConnectorsPageProps {
  onOpenSettings: () => void;
  refreshKey?: number;
}

function generateSlug(name: string, existingIds: Set<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "custom";

  if (!existingIds.has(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`.slice(0, 63);
    if (!existingIds.has(candidate)) return candidate;
  }
  return "";
}

export function ConnectorsPage({ onOpenSettings, refreshKey = 0 }: ConnectorsPageProps) {
  const [connectors, setConnectors] = useState<ConnectorEntry[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [category, setCategory] = useState<string>("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCustomPanel, setShowCustomPanel] = useState(false);
  const [dismissedWarning, setDismissedWarning] = useState(false);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDismissedWarning(false);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}/api/connectors`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GetConnectorsResponse = await res.json();
      setConnectors(data.connectors);
      setWarning(data.warning ?? null);
    } catch {
      setError("Could not load connectors.");
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConnectors(); }, [fetchConnectors, refreshKey]);

  const filtered = connectors.filter((c) => {
    if (tab === "connected" && c.status !== "connected") return false;
    if (tab === "available" && c.status !== "available") return false;
    if (category !== "All" && c.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
    }
    return true;
  });

  const customCount = connectors.filter(c => c.type === "remote-mcp" && c.category === "Custom").length;
  const atCustomLimit = customCount >= 200;

  function handleCardClick(connector: ConnectorEntry) {
    if (connector.type === "oauth") { onOpenSettings(); return; }
    if (connector.type === "mcp") return;
    if (connector.type === "remote-mcp" && connector.status === "available") {
      if (showCustomPanel) setShowCustomPanel(false);
      setExpandedId(prev => prev === connector.id ? null : connector.id);
    }
  }

  function handleOpenCustomPanel() {
    setExpandedId(null);
    setShowCustomPanel(true);
  }

  return (
    <div className="flex-1 flex flex-col bg-[#111827] overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[#1f2937]">
        <h1 className="text-[18px] font-semibold text-gray-100 flex items-center gap-2">
          <Network className="w-5 h-5 text-gray-400" />
          Connectors
        </h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="bg-[#1f2937] border border-[#374151] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[#c5f016]/50 w-52"
              placeholder="Search connectors"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={handleOpenCustomPanel}
            disabled={atCustomLimit}
            title={atCustomLimit ? "Maximum number of custom connectors reached" : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#c5f016] text-black text-[12px] font-semibold hover:bg-[#d4f518] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            Custom connector
          </button>
        </div>
      </div>

      {/* Tagline */}
      <div className="px-6 py-3 text-[13px] text-gray-400">
        Connect your apps and services so the agent can access and act on your data.
      </div>

      {/* Filter row */}
      <div className="px-6 pb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {(["all", "connected", "available"] as FilterTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors border ${
                tab === t
                  ? "bg-[#374151] text-gray-100 border-[#4b5563]"
                  : "border-[#374151] text-gray-500 hover:text-gray-300"
              }`}
            >
              {t === "all" ? "All" : t === "connected" ? "Connected" : "Available"}
            </button>
          ))}
        </div>
        <div className="relative">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="appearance-none bg-[#1f2937] border border-[#374151] rounded-lg pl-3 pr-7 py-1 text-[12px] text-gray-300 focus:outline-none focus:border-[#c5f016]/50 cursor-pointer"
          >
            <option value="All">All categories</option>
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        </div>
      </div>

      {/* Warning banner */}
      {warning && !dismissedWarning && (
        <div className="mx-6 mb-3 flex items-center justify-between gap-2 bg-yellow-900/30 border border-yellow-700/40 rounded-lg px-4 py-2.5 text-[12px] text-yellow-300">
          <span>{warning}</span>
          <button onClick={() => setDismissedWarning(true)} className="ml-2 text-yellow-400 hover:text-yellow-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* Custom connector panel */}
        {showCustomPanel && (
          <CustomConnectorPanel
            existingIds={new Set(connectors.map(c => {
              const parts = c.id.split('/');
              return parts[parts.length - 1];
            }))}
            onCancel={() => setShowCustomPanel(false)}
            onSuccess={(entry) => {
              setConnectors(prev => [entry, ...prev]);
              setShowCustomPanel(false);
            }}
          />
        )}

        {loading && (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-[88px] rounded-xl bg-[#1a2640] animate-pulse border border-[#1f2937]" />
            ))}
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <p className="text-red-400 text-[13px]">{error}</p>
            <button
              onClick={fetchConnectors}
              className="px-4 py-1.5 rounded-lg bg-[#1f2937] border border-[#374151] text-[12px] text-gray-300 hover:text-gray-100 transition-colors"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex items-center justify-center h-40 text-gray-500 text-[13px]">
            No connectors found.
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {filtered.map((connector) => (
              <ConnectorCard
                key={connector.id}
                connector={connector}
                expanded={expandedId === connector.id}
                onCardClick={() => handleCardClick(connector)}
                onConnected={(updated) => {
                  setConnectors(prev => prev.map(c => c.id === updated.id ? updated : c));
                  setExpandedId(null);
                }}
                onDisconnected={(id) => {
                  setConnectors(prev => prev.map(c => c.id === id ? { ...c, status: "available" } : c));
                }}
                onDisconnectError={(id) => {
                  setConnectors(prev => prev.map(c => c.id === id ? { ...c, status: "connected" } : c));
                }}
                onOpenSettings={onOpenSettings}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ConnectorCard ────────────────────────────────────────────────────────────

interface ConnectorCardProps {
  connector: ConnectorEntry;
  expanded: boolean;
  onCardClick: () => void;
  onConnected: (entry: ConnectorEntry) => void;
  onDisconnected: (id: string) => void;
  onDisconnectError: (id: string) => void;
  onOpenSettings: () => void;
}

function ConnectorCard({ connector, expanded, onCardClick, onConnected, onDisconnected, onDisconnectError }: ConnectorCardProps) {
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  async function handleDisconnect(e: React.MouseEvent) {
    e.stopPropagation();
    setDisconnectError(null);
    onDisconnected(connector.id);
    const slug = connector.id.replace('remote-mcp/', '');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${API_BASE}/api/connectors/remote-mcp/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    } catch {
      onDisconnectError(connector.id);
      setDisconnectError('Disconnect failed. Please try again.');
    }
  }

  const isOAuth = connector.type === "oauth";
  const isRemote = connector.type === "remote-mcp";
  const isConnected = connector.status === "connected";
  const isAvailable = connector.status === "available";
  const isClickable = isOAuth || (isRemote && isAvailable);

  return (
    <div className="flex flex-col">
      <div
        onClick={isClickable ? onCardClick : undefined}
        className={`bg-[#141d2e] border rounded-xl p-4 flex items-center gap-3 transition-colors relative ${
          expanded ? "border-[#c5f016]/40" : "border-[#1f2937]"
        } ${
          isClickable ? "cursor-pointer hover:border-[#374151]" : "cursor-default"
        }`}
      >
        <ConnectorLogo entry={connector} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-gray-100 truncate">{connector.name}</p>
          <p className="text-[12px] text-gray-500 mt-0.5 truncate">{connector.description}</p>
          <StatusDot status={connector.status} />
        </div>
        {isRemote && isConnected && (
          <button
            onClick={handleDisconnect}
            className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded text-[12px] font-medium text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors border border-transparent hover:border-red-500/20"
            title="Disconnect this connector"
          >
            Disconnect
          </button>
        )}
      </div>

      {disconnectError && (
        <p className="text-[12px] text-red-400 mt-1 px-1">{disconnectError}</p>
      )}

      {expanded && isRemote && isAvailable && (
        <ConnectForm
          connector={connector}
          onCancel={onCardClick}
          onConnected={onConnected}
        />
      )}
    </div>
  );
}

// ── ConnectForm ───────────────────────────────────────────────────────────────

interface ConnectFormProps {
  connector: ConnectorEntry;
  onCancel: () => void;
  onConnected: (entry: ConnectorEntry) => void;
}

function ConnectForm({ connector, onCancel, onConnected }: ConnectFormProps) {
  const slug = connector.id.replace('remote-mcp/', '');
  const [url, setUrl] = useState(connector.url ?? '');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function clearFieldError(field: string) {
    setErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
  }

  async function handleConnect() {
    setErrors({});
    const errs: Record<string, string> = {};
    if (!url.trim()) errs.url = 'Server URL is required';
    else if (!url.trim().toLowerCase().startsWith('https://')) errs.url = 'Must be a valid https:// URL';
    else if (url.trim().length > 2048) errs.url = 'URL is too long';
    if (connector.requiresToken && !token) errs.token = 'Auth token is required';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setSubmitting(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${API_BASE}/api/connectors/remote-mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: slug, name: connector.name, url: url.trim(), token: token || undefined }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (!res.ok) {
        const field = data.field ?? '_form';
        setErrors({ [field]: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      onConnected(data as ConnectorEntry);
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError'
        ? 'Request timed out. Please try again.'
        : 'Something went wrong. Please try again.';
      setErrors({ _form: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-[#141d2e] border border-t-0 border-[#c5f016]/40 rounded-b-xl px-4 pb-4 pt-3 flex flex-col gap-3">
      <div className="h-px bg-[#1f2937]" />

      <div className="flex flex-col gap-1">
        <label className="text-[12px] text-gray-400">Server URL</label>
        <input
          className={`w-full bg-[#1f2937] border rounded-lg px-3 py-2 text-[12px] text-gray-100 focus:outline-none ${
            errors.url ? 'border-red-500/60' : 'border-[#374151] focus:border-[#c5f016]/50'
          }`}
          value={url}
          onChange={(e) => { setUrl(e.target.value); clearFieldError('url'); }}
          placeholder="https://mcp.example.com"
        />
        {errors.url && <p className="text-[12px] text-red-400">{errors.url}</p>}
      </div>

      {connector.requiresToken && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-[12px] text-gray-400">Auth token</label>
            {connector.docsUrl && (
              <button
                onClick={() => openUrl(connector.docsUrl!)}
                className="text-[12px] text-[#c5f016]/80 hover:text-[#c5f016] transition-colors"
              >
                Get token ↗
              </button>
            )}
          </div>
          <input
            type="password"
            className={`w-full bg-[#1f2937] border rounded-lg px-3 py-2 text-[12px] text-gray-100 focus:outline-none ${
              errors.token ? 'border-red-500/60' : 'border-[#374151] focus:border-[#c5f016]/50'
            }`}
            value={token}
            onChange={(e) => { setToken(e.target.value); clearFieldError('token'); }}
            placeholder="Paste your token here"
          />
          {errors.token && <p className="text-[12px] text-red-400">{errors.token}</p>}
        </div>
      )}

      {errors._form && <p className="text-[12px] text-red-400">{errors._form}</p>}

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-[12px] text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConnect}
          disabled={submitting}
          className="px-3 py-1.5 rounded-lg bg-[#c5f016] text-black text-[12px] font-semibold disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {submitting ? (
            <><span className="w-3 h-3 border border-black/40 border-t-black rounded-full animate-spin" /> Connecting…</>
          ) : 'Connect'}
        </button>
      </div>
    </div>
  );
}

// ── CustomConnectorPanel ──────────────────────────────────────────────────────

interface CustomConnectorPanelProps {
  existingIds: Set<string>;
  onCancel: () => void;
  onSuccess: (entry: ConnectorEntry) => void;
}

function CustomConnectorPanel({ existingIds, onCancel, onSuccess }: CustomConnectorPanelProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function clearFieldError(field: string) {
    setErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
  }

  async function handleAdd() {
    setErrors({});
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required';
    else if (name.trim().length > 64) errs.name = 'Name must be 64 characters or fewer';
    if (!url.trim()) errs.url = 'Server URL is required';
    else if (!url.trim().toLowerCase().startsWith('https://')) errs.url = 'Must be a valid https:// URL';
    else if (url.trim().length > 2048) errs.url = 'URL is too long';
    if (!token) errs.token = 'Auth token is required';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    const slug = generateSlug(name.trim(), existingIds);
    if (!slug) { setErrors({ name: 'Too many connectors with similar names' }); return; }

    setSubmitting(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${API_BASE}/api/connectors/remote-mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: slug, name: name.trim(), url: url.trim(), token }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (!res.ok) {
        const field = data.field ?? '_form';
        setErrors({ [field]: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      onSuccess(data as ConnectorEntry);
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError'
        ? 'Request timed out. Please try again.'
        : 'Something went wrong. Please try again.';
      setErrors({ _form: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-4 bg-[#141d2e] border border-[#c5f016]/30 rounded-xl p-4 flex flex-col gap-3">
      <p className="text-[13px] font-semibold text-gray-100">Add custom connector</p>

      <div className="flex flex-col gap-1">
        <label className="text-[12px] text-gray-400">Name</label>
        <input
          className={`w-full bg-[#1f2937] border rounded-lg px-3 py-2 text-[12px] text-gray-100 focus:outline-none ${
            errors.name ? 'border-red-500/60' : 'border-[#374151] focus:border-[#c5f016]/50'
          }`}
          placeholder="My MCP server"
          maxLength={64}
          value={name}
          onChange={(e) => { setName(e.target.value); clearFieldError('name'); }}
        />
        {errors.name && <p className="text-[12px] text-red-400">{errors.name}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[12px] text-gray-400">Server URL</label>
        <input
          className={`w-full bg-[#1f2937] border rounded-lg px-3 py-2 text-[12px] text-gray-100 focus:outline-none ${
            errors.url ? 'border-red-500/60' : 'border-[#374151] focus:border-[#c5f016]/50'
          }`}
          placeholder="https://mcp.example.com"
          value={url}
          onChange={(e) => { setUrl(e.target.value); clearFieldError('url'); }}
        />
        {errors.url && <p className="text-[12px] text-red-400">{errors.url}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[12px] text-gray-400">Auth token</label>
        <input
          type="password"
          className={`w-full bg-[#1f2937] border rounded-lg px-3 py-2 text-[12px] text-gray-100 focus:outline-none ${
            errors.token ? 'border-red-500/60' : 'border-[#374151] focus:border-[#c5f016]/50'
          }`}
          placeholder="Paste your token here"
          value={token}
          onChange={(e) => { setToken(e.target.value); clearFieldError('token'); }}
        />
        {errors.token && <p className="text-[12px] text-red-400">{errors.token}</p>}
      </div>

      {errors._form && <p className="text-[12px] text-red-400">{errors._form}</p>}

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-[12px] text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleAdd}
          disabled={submitting}
          className="px-3 py-1.5 rounded-lg bg-[#c5f016] text-black text-[12px] font-semibold disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {submitting ? (
            <><span className="w-3 h-3 border border-black/40 border-t-black rounded-full animate-spin" /> Adding…</>
          ) : 'Add connector'}
        </button>
      </div>
    </div>
  );
}
