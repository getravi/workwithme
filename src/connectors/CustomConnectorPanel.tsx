import { useState } from "react";
import { API_BASE } from "../config";
import type { ConnectorEntry } from "./types";
import { TIMEOUT_MS } from "./types";
import { generateSlug } from "./utils";

// ── CustomConnectorPanel ──────────────────────────────────────────────────────

interface CustomConnectorPanelProps {
  existingIds: Set<string>;
  onCancel: () => void;
  onSuccess: (entry: ConnectorEntry) => void;
}

export function CustomConnectorPanel({ existingIds, onCancel, onSuccess }: CustomConnectorPanelProps) {
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
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
