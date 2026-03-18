import { useState, useEffect } from "react";
import { Network, Search } from "lucide-react";
import { API_BASE } from "./config";

interface ConnectorEntry {
  id: string;
  name: string;
  description: string;
  type: "oauth" | "mcp";
  status: "connected" | "available";
}

const ICON_COLORS: Record<string, string> = {
  anthropic: "bg-[#cc5500]",
  google: "bg-[#4285f4]",
  github: "bg-[#24292e]",
  openai: "bg-[#10a37f]",
};

function ConnectorIcon({ name }: { name: string }) {
  const bg = ICON_COLORS[name.toLowerCase()] ?? "bg-[#374151]";
  return (
    <div className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center text-white font-bold text-[14px] flex-shrink-0`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

type FilterTab = "all" | "connected" | "available";

interface ConnectorsPageProps {
  onOpenSettings: () => void;
}

export function ConnectorsPage({ onOpenSettings }: ConnectorsPageProps) {
  const [connectors, setConnectors] = useState<ConnectorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");

  useEffect(() => {
    async function fetchConnectors() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/connectors`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setConnectors(await res.json());
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }
    fetchConnectors();
  }, []);

  const filtered = connectors.filter((c) => {
    if (tab === "connected" && c.status !== "connected") return false;
    if (tab === "available" && c.status !== "available") return false;
    if (search) {
      const q = search.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="flex-1 flex flex-col bg-[#111827] overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[#1f2937]">
        <h1 className="text-[18px] font-semibold text-gray-100 flex items-center gap-2">
          <Network className="w-5 h-5 text-[#c5f016]" />
          Connectors
        </h1>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="bg-[#1f2937] border border-[#374151] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[#c5f016]/50 w-52"
            placeholder="Search connectors"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Tagline */}
      <div className="px-6 py-3 text-[13px] text-gray-400">
        Connect your apps and services so the agent can access and act on your data.
      </div>

      {/* Filter tabs */}
      <div className="px-6 pb-3 flex items-center gap-2">
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading && (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[88px] rounded-xl bg-[#1a2640] animate-pulse border border-[#1f2937]" />
            ))}
          </div>
        )}
        {!loading && error && (
          <div className="flex items-center justify-center h-40 text-red-400 text-[13px]">{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex items-center justify-center h-40 text-gray-500 text-[13px]">
            No connectors found.
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((connector) => (
              <div
                key={connector.id}
                onClick={connector.type === "oauth" ? onOpenSettings : undefined}
                className={`bg-[#141d2e] border border-[#1f2937] rounded-xl p-4 flex items-center gap-3 hover:border-[#374151] transition-colors ${
                  connector.type === "oauth" ? "cursor-pointer" : ""
                }`}
              >
                <ConnectorIcon name={connector.name} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-gray-100 truncate">{connector.name}</p>
                  <p className="text-[12px] text-gray-500 mt-0.5 truncate">{connector.description}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${connector.status === "connected" ? "bg-green-500" : "bg-gray-600"}`} />
                    <span className={`text-[10px] font-medium ${connector.status === "connected" ? "text-green-400" : "text-gray-500"}`}>
                      {connector.status === "connected" ? "Connected" : "Available"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
