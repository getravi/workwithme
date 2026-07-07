import { useState, useCallback } from "react";
import { LibraryGrid } from "./LibraryGrid";
import { LibraryDetailPanel } from "./LibraryDetailPanel";

export interface CaptureEntry {
  id: string;
  file_path: string;
  timestamp: number;
  app_name: string | null;
  window_title: string | null;
  is_draft: boolean;
  width: number | null;
  height: number | null;
  media_type: string;
  thumbnail_path: string | null;
}

export function LibraryWindow() {
  const [selected, setSelected] = useState<CaptureEntry | null>(null);
  const [query, setQuery] = useState("");
  // Incrementing this causes LibraryGrid to reload, refreshing search results
  // after a delete so the deleted item disappears without requiring a manual search clear.
  const [gridKey, setGridKey] = useState(0);

  const handleDelete = useCallback(
    (id: string) => {
      setSelected((prev) => (prev?.id === id ? null : prev));
      setGridKey((k) => k + 1);
    },
    [],
  );

  return (
    <div className="flex flex-col h-screen bg-[#0d0d1a] text-[#e0e0e0] font-[family-name:system-ui,-apple-system,sans-serif] overflow-hidden">
      {/* Search bar */}
      <div className="py-[12px] px-[16px] border-b border-[#1f2937] shrink-0">
        <input
          type="text"
          placeholder="Search captures by app, window, or content..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-[#1f2937] border border-[#374151] rounded-[6px] py-[8px] px-[12px] text-[#e0e0e0] text-[13px] outline-none box-border"
        />
      </div>

      {/* Grid + optional detail panel */}
      <div className="flex flex-1 overflow-hidden">
        <LibraryGrid
          key={gridKey}
          query={query}
          selected={selected}
          onSelect={setSelected}
          style={{ flex: selected ? "0 0 60%" : "1 1 auto" }}
        />
        {selected && (
          <LibraryDetailPanel
            entry={selected}
            onClose={() => setSelected(null)}
            onDeleted={handleDelete}
          />
        )}
      </div>
    </div>
  );
}
