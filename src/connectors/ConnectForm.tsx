import { useState } from "react";
import { API_BASE } from "../config";
import type { ConnectorEntry } from "./types";
import { TIMEOUT_MS } from "./types";
import { safeOpenUrl } from "./utils";

// ── ConnectForm ───────────────────────────────────────────────────────────────

interface ConnectFormProps {
  connector: ConnectorEntry;
  onCancel: () => void;
  onConnected: (entry: ConnectorEntry) => void;
}

export function ConnectForm({ connector, onCancel, onConnected }: ConnectFormProps) {
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
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
                onClick={() => safeOpenUrl(connector.docsUrl!)}
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
