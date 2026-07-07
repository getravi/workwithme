import { useEffect, useState, useCallback, useRef, CSSProperties } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type { CaptureEntry } from "./LibraryWindow";

interface LibraryGridProps {
  query: string;
  selected: CaptureEntry | null;
  onSelect: (entry: CaptureEntry) => void;
  style?: CSSProperties;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 2) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "Yesterday";
  if (diffD < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function LibraryGrid({ query, selected, onSelect, style }: LibraryGridProps) {
  const [entries, setEntries] = useState<CaptureEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (q: string, cursor?: number) => {
    setLoading(true);
    setLoadError(null);
    try {
      const results: CaptureEntry[] = q
        ? await invoke("library_search", { query: q })
        : await invoke("library_list", { beforeTs: cursor });
      if (cursor !== undefined) {
        setEntries((prev) => [...prev, ...results]);
      } else {
        setEntries(results);
      }
      setHasMore(results.length === 50);
    } catch (e) {
      console.error("[LibraryGrid] load error:", e);
      setLoadError("Failed to load captures.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + query changes (debounced 300ms for non-empty, immediate for clear)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay = query ? 300 : 0;
    debounceRef.current = setTimeout(() => {
      setHasMore(true);
      load(query);
    }, delay);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, load]);

  // Infinite scroll
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loading && !query && entries.length > 0) {
          const last = entries[entries.length - 1];
          load("", last.timestamp);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, query, entries, load]);

  return (
    <div className="overflow-y-auto p-[12px]" style={style}>
      {loadError && (
        <p className="text-[#f87171] text-center mt-[40px]">{loadError}</p>
      )}
      {entries.length === 0 && !loading && !loadError && (
        <p className="text-[#6b7280] text-center mt-[40px]">
          {query ? "No captures match your search." : "No captures yet."}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-[10px]">
        {entries.map((entry) => (
          <div
            key={entry.id}
            data-testid={`capture-card-${entry.id}`}
            onClick={() => onSelect(entry)}
            className={`bg-[#1e2a3a] rounded-[8px] overflow-hidden cursor-pointer border-2 ${
              selected?.id === entry.id ? "border-[#6c63ff]" : "border-transparent"
            }`}
            style={{ transition: "border-color 0.15s" }}
          >
            <div className="relative">
              <img
                src={convertFileSrc(
                  entry.media_type === "video" && entry.thumbnail_path
                    ? entry.thumbnail_path
                    : entry.file_path
                )}
                alt=""
                className="w-full aspect-[4/3] object-cover block"
              />
              {entry.is_draft && (
                <div
                  data-testid={`draft-dot-${entry.id}`}
                  className="absolute top-[6px] right-[6px] w-[8px] h-[8px] bg-[#f59e0b] rounded-full border border-[#1e2a3a]"
                />
              )}
              {entry.media_type === "video" && (
                <div
                  data-testid={`video-badge-${entry.id}`}
                  className="absolute bottom-[6px] left-[6px] bg-[rgba(0,0,0,0.7)] text-white text-[10px] py-[2px] px-[6px] rounded-[4px] font-semibold"
                >
                  ▶
                </div>
              )}
            </div>
            <div className="pt-[4px] px-[8px] pb-[6px] text-[11px] text-[#9ca3af]">
              {formatTimestamp(entry.timestamp)}
            </div>
          </div>
        ))}
      </div>
      <div ref={bottomRef} className="h-px" />
      {loading && (
        <p className="text-[#6b7280] text-center p-[12px]">Loading...</p>
      )}
    </div>
  );
}
