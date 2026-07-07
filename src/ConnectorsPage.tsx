import { useState } from "react";
import { Network, Search, Plus, X, ChevronDown } from "lucide-react";
import { CATEGORIES } from "./connectors/types";
import type { FilterTab } from "./connectors/types";
import { useConnectors } from "./connectors/useConnectors";
import { ConnectorCard } from "./connectors/ConnectorCard";
import { CustomConnectorPanel } from "./connectors/CustomConnectorPanel";

// ── Main ConnectorsPage ──────────────────────────────────────────────────────

interface ConnectorsPageProps {
  onOpenSettings?: () => void;
  refreshKey?: number;
}

export function ConnectorsPage({ onOpenSettings = () => {}, refreshKey = 0 }: ConnectorsPageProps) {
  const {
    connectors,
    setConnectors,
    warning,
    loading,
    error,
    dismissedWarning,
    setDismissedWarning,
    fetchConnectors,
  } = useConnectors(refreshKey);

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [category, setCategory] = useState<string>("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCustomPanel, setShowCustomPanel] = useState(false);

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

  function handleCardClick(connector: (typeof connectors)[number]) {
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
