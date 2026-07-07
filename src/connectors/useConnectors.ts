import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../config";
import type { ConnectorEntry, GetConnectorsResponse } from "./types";
import { TIMEOUT_MS } from "./types";

export function useConnectors(refreshKey: number) {
  const [connectors, setConnectors] = useState<ConnectorEntry[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissedWarning, setDismissedWarning] = useState(false);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDismissedWarning(false);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
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

  return {
    connectors,
    setConnectors,
    warning,
    loading,
    error,
    dismissedWarning,
    setDismissedWarning,
    fetchConnectors,
  };
}
