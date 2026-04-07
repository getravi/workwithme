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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (q: string, cursor?: number) => {
    setLoading(true);
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
    <div style={{ overflowY: "auto", padding: 12, ...style }}>
      {entries.length === 0 && !loading && (
        <p style={{ color: "#6b7280", textAlign: "center", marginTop: 40 }}>
          {query ? "No captures match your search." : "No captures yet."}
        </p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        {entries.map((entry) => (
          <div
            key={entry.id}
            data-testid={`capture-card-${entry.id}`}
            onClick={() => onSelect(entry)}
            style={{
              background: "#1e2a3a",
              borderRadius: 8,
              overflow: "hidden",
              cursor: "pointer",
              border: selected?.id === entry.id
                ? "2px solid #6c63ff"
                : "2px solid transparent",
              transition: "border-color 0.15s",
            }}
          >
            <div style={{ position: "relative" }}>
              <img
                src={convertFileSrc(
                  entry.media_type === "video" && entry.thumbnail_path
                    ? entry.thumbnail_path
                    : entry.file_path
                )}
                alt=""
                style={{
                  width: "100%",
                  aspectRatio: "4/3",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              {entry.is_draft && (
                <div
                  data-testid={`draft-dot-${entry.id}`}
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    width: 8,
                    height: 8,
                    background: "#f59e0b",
                    borderRadius: "50%",
                    border: "1px solid #1e2a3a",
                  }}
                />
              )}
              {entry.media_type === "video" && (
                <div
                  data-testid={`video-badge-${entry.id}`}
                  style={{
                    position: "absolute",
                    bottom: 6,
                    left: 6,
                    background: "rgba(0,0,0,0.7)",
                    color: "#fff",
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    fontWeight: 600,
                  }}
                >
                  ▶
                </div>
              )}
            </div>
            <div style={{ padding: "4px 8px 6px", fontSize: 11, color: "#9ca3af" }}>
              {formatTimestamp(entry.timestamp)}
            </div>
          </div>
        ))}
      </div>
      <div ref={bottomRef} style={{ height: 1 }} />
      {loading && (
        <p style={{ color: "#6b7280", textAlign: "center", padding: 12 }}>Loading...</p>
      )}
    </div>
  );
}
