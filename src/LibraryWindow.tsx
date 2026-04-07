import { useState, useCallback } from "react";

export interface CaptureEntry {
  id: string;
  file_path: string;
  timestamp: number;
  app_name: string | null;
  window_title: string | null;
  is_draft: boolean;
  width: number | null;
  height: number | null;
}

export function LibraryWindow() {
  const [selected, setSelected] = useState<CaptureEntry | null>(null);
  const [query, setQuery] = useState("");

  const handleDelete = useCallback(
    (id: string) => {
      setSelected((prev) => (prev?.id === id ? null : prev));
    },
    [setSelected],
  );

  void handleDelete;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0d0d1a",
        color: "#e0e0e0",
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Search bar */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #1f2937", flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Search captures by app, window, or content..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: "100%",
            background: "#1f2937",
            border: "1px solid #374151",
            borderRadius: 6,
            padding: "8px 12px",
            color: "#e0e0e0",
            fontSize: 13,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Grid + optional detail panel */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div
          style={{
            flex: selected ? "0 0 60%" : "1 1 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#6b7280",
            fontSize: 13,
          }}
        >
          {/* LibraryGrid renders here — added in Task 6 */}
          Loading captures...
        </div>
        {selected && (
          <div
            style={{
              width: 260,
              borderLeft: "1px solid #1f2937",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#6b7280",
              fontSize: 13,
            }}
          >
            {/* LibraryDetailPanel renders here — added in Task 7 */}
            Detail panel
          </div>
        )}
      </div>
    </div>
  );
}
