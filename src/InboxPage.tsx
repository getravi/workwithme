import { useEffect, useState, useCallback } from "react";
import { Bell, RefreshCw, Info, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";
import { API_BASE } from "./config";

interface Notification {
  id: string;
  title: string;
  body: string;
  level: "info" | "warning" | "error" | "success";
  timestamp: string;
}

const LEVEL_CONFIG: Record<Notification["level"], { icon: React.ElementType; color: string; bg: string; border: string }> = {
  info:    { icon: Info,          color: "text-blue-400",   bg: "bg-blue-400/10",   border: "border-blue-400/30" },
  warning: { icon: AlertTriangle, color: "text-amber-400",  bg: "bg-amber-400/10",  border: "border-amber-400/30" },
  error:   { icon: AlertCircle,   color: "text-red-400",    bg: "bg-red-400/10",    border: "border-red-400/30" },
  success: { icon: CheckCircle2,  color: "text-[#c5f016]",  bg: "bg-[#c5f016]/10",  border: "border-[#c5f016]/30" },
};

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

export function InboxPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/api/notifications`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setNotifications(data.notifications ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  return (
    <main className="flex-1 flex flex-col bg-[#111827] min-w-0 rounded-tl-[20px] rounded-bl-[20px] z-10 overflow-hidden">
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 flex items-center justify-between px-5 border-b border-[#1f2937]/60" data-tauri-drag-region>
        <div className="flex items-center gap-2.5">
          <Bell className="w-4 h-4 text-[#c5f016]" />
          <h1 className="text-[14px] font-semibold text-gray-200">Inbox</h1>
          {notifications.length > 0 && (
            <span className="text-[11px] font-bold bg-[#c5f016]/20 text-[#c5f016] px-1.5 py-0.5 rounded-full">
              {notifications.length}
            </span>
          )}
        </div>
        <button
          onClick={fetchNotifications}
          disabled={loading}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#1f2937] transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && notifications.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-[13px]">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : error ? (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-[13px]">
            {error}
          </div>
        ) : notifications.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-3 max-w-xs mx-auto text-center">
            <Bell className="w-10 h-10 opacity-20" />
            <p className="text-[13px]">No notifications yet.</p>
            <p className="text-[12px] text-gray-600">System and agent notifications will appear here.</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-2">
            {notifications.map((n) => {
              const cfg = LEVEL_CONFIG[n.level] ?? LEVEL_CONFIG.info;
              const Icon = cfg.icon;
              return (
                <div
                  key={n.id}
                  className={`flex gap-3 p-3 rounded-xl border ${cfg.bg} ${cfg.border} transition-all`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${cfg.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span className={`text-[13px] font-semibold ${cfg.color}`}>{n.title}</span>
                      <span className="text-[11px] text-gray-500 flex-shrink-0">{formatTimestamp(n.timestamp)}</span>
                    </div>
                    <p className="text-[12px] text-gray-300 leading-5">{n.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
