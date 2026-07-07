import { useState } from "react";
import { API_BASE } from "../config";
import type { ConnectorEntry } from "./types";
import { TIMEOUT_MS } from "./types";
import { ConnectorLogo, StatusDot } from "./ConnectorLogo";
import { ConnectForm } from "./ConnectForm";

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

export function ConnectorCard({ connector, expanded, onCardClick, onConnected, onDisconnected, onDisconnectError }: ConnectorCardProps) {
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  async function handleDisconnect(e: React.MouseEvent) {
    e.stopPropagation();
    setDisconnectError(null);
    onDisconnected(connector.id);
    const slug = connector.id.replace('remote-mcp/', '');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
