import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Save, CheckCircle2, AlertCircle, Wifi } from "lucide-react";
import { useDebouncedSave } from "./hooks/useDebouncedSave";
import { ShortcutSection, type ShortcutsConfig } from "./ShortcutSection";

// ── Types ─────────────────────────────────────────────────────────────────────

type LlmProvider = "anthropic" | "open_ai_compatible";
type OpenAiPreset = "openai" | "ollama" | "custom";

interface LlmConfig {
  provider: LlmProvider;
  base_url: string;
  model: string;
  api_key_name: string;
}

type ConnectionStatus = "idle" | "loading" | "ok" | "error";

// ── Provider presets ──────────────────────────────────────────────────────────

const ANTHROPIC_DEFAULTS: Omit<LlmConfig, "provider"> = {
  base_url: "https://api.anthropic.com/v1",
  model: "claude-sonnet-4-6",
  api_key_name: "anthropic-api-key",
};

const OPENAI_PRESETS: Record<OpenAiPreset, Omit<LlmConfig, "provider">> = {
  openai: {
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o",
    api_key_name: "openai-api-key",
  },
  ollama: {
    base_url: "http://localhost:11434/v1",
    model: "llama3",
    api_key_name: "",
  },
  custom: {
    base_url: "",
    model: "",
    api_key_name: "custom-llm-api-key",
  },
};

function detectPreset(config: LlmConfig): OpenAiPreset {
  if (config.base_url === OPENAI_PRESETS.openai.base_url) return "openai";
  if (config.base_url === OPENAI_PRESETS.ollama.base_url) return "ollama";
  return "custom";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VoiceWorkspaceSettings() {
  const [config, setConfig] = useState<LlmConfig>({
    provider: "anthropic",
    ...ANTHROPIC_DEFAULTS,
  });
  const [preset, setPreset] = useState<OpenAiPreset>("openai");
  const [apiKey, setApiKey] = useState("");
  const [keySaveStatus, setKeySaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [shortcuts, setShortcuts] = useState<ShortcutsConfig | null>(null);
  const [whisperAvailable, setWhisperAvailable] = useState<boolean | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      try {
        const loaded = await invoke<LlmConfig>("llm_get_config");
        if (!mountedRef.current) return;
        setConfig(loaded);
        if (loaded.provider === "open_ai_compatible") {
          setPreset(detectPreset(loaded));
        }
      } catch {
        // non-critical — keep defaults
      }
      try {
        const sc = await invoke<ShortcutsConfig>("voice_get_shortcuts");
        if (!mountedRef.current) return;
        setShortcuts(sc);
      } catch {
        // non-critical — leave null, section stays hidden
      }
      try {
        const available = await invoke<boolean>("whisper_model_available");
        if (!mountedRef.current) return;
        setWhisperAvailable(available);
      } catch {
        // non-critical
      }
    })();
    return () => { mountedRef.current = false; };
  }, []);

  // Debounced config save that also flushes on unmount (e.g. user closes the
  // settings window immediately after editing a field).
  const debouncedSave = useDebouncedSave<LlmConfig>((cfg) => {
    invoke("llm_save_config", { config: cfg }).catch(() => {});
  }, 500);

  const updateConfig = useCallback((patch: Partial<LlmConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      debouncedSave(next);
      return next;
    });
  }, [debouncedSave]);

  const handleProviderChange = (provider: LlmProvider) => {
    if (provider === "anthropic") {
      const next: LlmConfig = { provider, ...ANTHROPIC_DEFAULTS };
      setConfig(next);
      debouncedSave(next);
    } else {
      // default to openai preset
      const p: OpenAiPreset = "openai";
      setPreset(p);
      const next: LlmConfig = { provider, ...OPENAI_PRESETS[p] };
      setConfig(next);
      debouncedSave(next);
    }
  };

  const handlePresetChange = (p: OpenAiPreset) => {
    setPreset(p);
    const defaults = OPENAI_PRESETS[p];
    const next: LlmConfig = { provider: "open_ai_compatible", ...defaults };
    setConfig(next);
    debouncedSave(next);
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setKeySaveStatus("saving");
    try {
      await invoke("llm_set_api_key", { apiKeyName: config.api_key_name, key: apiKey.trim() });
      setKeySaveStatus("saved");
      setTimeout(() => setKeySaveStatus("idle"), 3000);
    } catch {
      setKeySaveStatus("error");
    }
  };

  const handleTestConnection = async () => {
    setConnectionStatus("loading");
    setConnectionMessage("");
    try {
      const result = await invoke<string>("llm_test_connection");
      setConnectionStatus("ok");
      setConnectionMessage(result === "ok" ? "Connected" : result);
    } catch (e: any) {
      setConnectionStatus("error");
      setConnectionMessage(e?.message || String(e) || "Connection failed");
    }
  };

  const isOllama = config.provider === "open_ai_compatible" && preset === "ollama";
  const showApiKey = !isOllama;

  return (
    <div className="p-4 space-y-6 max-w-2xl">

      {/* LLM Provider */}
      <section>
        <h3 className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Wifi className="w-3.5 h-3.5" /> LLM Provider
        </h3>
        <div className="space-y-3">

          {/* Provider selector */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-gray-400">Provider</label>
            <select
              value={config.provider}
              onChange={(e) => handleProviderChange(e.target.value as LlmProvider)}
              className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-[#c5f016] transition-colors appearance-none"
            >
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="open_ai_compatible">OpenAI-Compatible</option>
            </select>
          </div>

          {/* Sub-preset for OpenAI-compatible */}
          {config.provider === "open_ai_compatible" && (
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-gray-400">Preset</label>
              <select
                value={preset}
                onChange={(e) => handlePresetChange(e.target.value as OpenAiPreset)}
                className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-[#c5f016] transition-colors appearance-none"
              >
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama (local)</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          )}

          {/* Base URL */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-gray-400">Base URL</label>
            <input
              type="text"
              value={config.base_url}
              onChange={(e) => updateConfig({ base_url: e.target.value })}
              placeholder="https://api.example.com/v1"
              className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-[#c5f016] transition-colors font-mono"
            />
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-gray-400">Model</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => updateConfig({ model: e.target.value })}
              placeholder="model-name"
              className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-[#c5f016] transition-colors font-mono"
            />
          </div>

        </div>
      </section>

      {/* API Key */}
      {showApiKey && (
        <section>
          <h3 className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            API Key
          </h3>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-gray-400">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="API key"
                className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-[#c5f016] transition-all font-mono text-[13px]"
              />
            </div>

            {keySaveStatus === "error" && (
              <div className="flex items-center gap-2 text-red-400 text-[13px] bg-red-400/10 p-2.5 rounded-lg border border-red-400/20">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> Failed to save key.
              </div>
            )}
            {keySaveStatus === "saved" && (
              <div className="flex items-center gap-2 text-[#9df0c0] text-[13px] bg-[#9df0c0]/10 p-2.5 rounded-lg border border-[#9df0c0]/20">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> Key saved!
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleSaveKey}
                disabled={!apiKey.trim() || keySaveStatus === "saving"}
                className="flex items-center gap-2 px-4 py-2 bg-[#c5f016] text-[#111827] text-[13px] font-medium rounded-lg hover:bg-[#d6f733] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {keySaveStatus === "saving"
                  ? <span className="w-4 h-4 border-2 border-[#111827] border-t-transparent rounded-full animate-spin" />
                  : <Save className="w-4 h-4" />}
                Save Key
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Whisper model warning */}
      {whisperAvailable === false && (
        <div className="flex items-start gap-2 text-amber-400 text-[13px] bg-amber-400/10 p-3 rounded-lg border border-amber-400/20">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Voice model not found — dictation and meeting transcription are disabled.
            Place <code className="font-mono text-[12px]">ggml-small.en-q8_0.bin</code> in the app resources folder and restart.
          </span>
        </div>
      )}

      {/* Keyboard Shortcuts */}
      {shortcuts && <ShortcutSection shortcuts={shortcuts} onChange={setShortcuts} />}

      {/* Test Connection */}
      <section>
        <h3 className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Connection
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleTestConnection}
            disabled={connectionStatus === "loading"}
            className="flex items-center gap-2 px-4 py-2 bg-[#1f2937] border border-[#374151] text-[13px] font-medium text-gray-200 rounded-lg hover:border-[#c5f016] hover:text-[#c5f016] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {connectionStatus === "loading" && (
              <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            )}
            Test Connection
          </button>

          {connectionStatus === "ok" && (
            <span className="flex items-center gap-1.5 text-[13px] text-[#9df0c0]">
              <CheckCircle2 className="w-4 h-4" />
              {connectionMessage || "Connected"}
            </span>
          )}
          {connectionStatus === "error" && (
            <span className="flex items-center gap-1.5 text-[13px] text-red-400">
              <AlertCircle className="w-4 h-4" />
              {connectionMessage || "Connection failed"}
            </span>
          )}
        </div>
      </section>

    </div>
  );
}
