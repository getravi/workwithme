import { useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type { CaptureEntry } from "./LibraryWindow";

interface Props {
  entry: CaptureEntry;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

export function LibraryDetailPanel({ entry, onClose, onDeleted }: Props) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await invoke("library_delete", { id: entry.id });
      onDeleted(entry.id);
    } catch (e) {
      console.error("[LibraryDetailPanel] delete failed:", e);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleCopy() {
    try {
      await invoke("copy_image_to_clipboard_from_path", { filePath: entry.file_path });
    } catch (e) {
      console.error("[LibraryDetailPanel] copy failed:", e);
    }
  }

  const date = new Date(entry.timestamp);
  const dateStr = date.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div
      style={{
        width: 260,
        flexShrink: 0,
        borderLeft: "1px solid #1f2937",
        background: "#0f172a",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderBottom: "1px solid #1f2937",
        }}
      >
        <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>Details</span>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", color: "#6b7280",
            cursor: "pointer", fontSize: 16, lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Preview */}
      <div style={{ padding: 12 }}>
        <img
          src={convertFileSrc(entry.file_path)}
          alt="capture preview"
          style={{ width: "100%", borderRadius: 6, border: "1px solid #1f2937" }}
        />
      </div>

      {/* Metadata */}
      <div style={{ padding: "0 12px", flex: 1, overflowY: "auto" }}>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
          {dateStr} · {timeStr}
        </div>
        {entry.width != null && entry.height != null && (
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
            {entry.width} × {entry.height}
          </div>
        )}
        {entry.is_draft && (
          <div
            data-testid="draft-badge"
            style={{
              display: "inline-block",
              background: "#78350f",
              color: "#fcd34d",
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 4,
              marginBottom: 8,
            }}
          >
            Draft
          </div>
        )}
        {(entry.app_name || entry.window_title) && (
          <div data-testid="app-info" style={{ marginBottom: 8 }}>
            {entry.app_name && (
              <div style={{ fontSize: 12, color: "#e0e0e0", fontWeight: 600 }}>
                {entry.app_name}
              </div>
            )}
            {entry.window_title && (
              <div style={{ fontSize: 11, color: "#9ca3af" }}>
                {entry.window_title}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ padding: 12, borderTop: "1px solid #1f2937", display: "flex", flexDirection: "column", gap: 6 }}>
        <button onClick={handleCopy} style={actionBtn}>
          Copy to Clipboard
        </button>

        {!showDeleteConfirm ? (
          <button
            data-testid="delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
            style={{ ...actionBtn, background: "#7f1d1d", color: "#fca5a5", border: "1px solid #991b1b" }}
          >
            Delete
          </button>
        ) : (
          <div>
            <p style={{ fontSize: 11, color: "#f87171", margin: "0 0 6px" }}>
              Delete this capture?
            </p>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                data-testid="delete-confirm-yes"
                onClick={handleDelete}
                disabled={deleting}
                style={{ ...actionBtn, flex: 1, background: "#7f1d1d", color: "#fca5a5" }}
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{ ...actionBtn, flex: 1 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const actionBtn: React.CSSProperties = {
  background: "#1f2937",
  border: "1px solid #374151",
  borderRadius: 6,
  color: "#e0e0e0",
  padding: "6px 10px",
  fontSize: 12,
  cursor: "pointer",
  width: "100%",
  textAlign: "center",
};
