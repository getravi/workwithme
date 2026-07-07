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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await invoke("library_delete", { id: entry.id });
      onDeleted(entry.id);
      setShowDeleteConfirm(false);
    } catch (e) {
      console.error("[LibraryDetailPanel] delete failed:", e);
      setDeleteError("Delete failed. Please try again.");
      setDeleting(false);
    }
  }

  async function handleCopy() {
    setCopying(true);
    setActionError(null);
    try {
      await invoke("copy_image_to_clipboard_from_path", { filePath: entry.file_path });
    } catch (e) {
      console.error("[LibraryDetailPanel] copy failed:", e);
      setActionError("Copy to clipboard failed.");
    } finally {
      setCopying(false);
    }
  }

  async function handlePlay() {
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(entry.file_path);
    } catch (e) {
      console.error("[LibraryDetailPanel] open failed:", e);
      setActionError("Could not open file.");
    }
  }

  async function handleExportMp4() {
    setExporting(true);
    setActionError(null);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const outputPath = await save({
        defaultPath: `recording-${new Date().toISOString().slice(0, 10)}.mp4`,
        filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
      });
      if (!outputPath) return;
      const { copyFile } = await import("@tauri-apps/plugin-fs");
      await copyFile(entry.file_path, outputPath);
    } catch (e) {
      console.error("[LibraryDetailPanel] export failed:", e);
      setActionError("Export failed.");
    } finally {
      setExporting(false);
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
    <div className="w-[260px] shrink-0 border-l border-[#1f2937] bg-[#0f172a] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between py-[10px] px-[12px] border-b border-[#1f2937]">
        <span className="text-[12px] text-[#9ca3af] font-semibold">Details</span>
        <button
          onClick={onClose}
          className="bg-transparent border-none text-[#6b7280] cursor-pointer text-[16px] leading-none"
        >
          ×
        </button>
      </div>

      {/* Preview: video shows <video>, image shows <img> */}
      <div className="p-[12px]">
        {entry.media_type === "video" ? (
          <video
            src={convertFileSrc(entry.file_path)}
            poster={entry.thumbnail_path ? convertFileSrc(entry.thumbnail_path) : undefined}
            className="w-full rounded-[6px] border border-[#1f2937]"
            controls
          />
        ) : (
          <img
            src={convertFileSrc(entry.file_path)}
            alt="capture preview"
            className="w-full rounded-[6px] border border-[#1f2937]"
          />
        )}
      </div>

      {/* Metadata */}
      <div className="px-[12px] flex-1 overflow-y-auto">
        <div className="text-[11px] text-[#6b7280] mb-[6px]">
          {dateStr} · {timeStr}
        </div>
        {entry.width != null && entry.height != null && (
          <div className="text-[11px] text-[#6b7280] mb-[6px]">
            {entry.width} × {entry.height}
          </div>
        )}
        {entry.is_draft && (
          <div
            data-testid="draft-badge"
            className="inline-block bg-[#78350f] text-[#fcd34d] text-[10px] py-[2px] px-[6px] rounded-[4px] mb-[8px]"
          >
            Draft
          </div>
        )}
        {(entry.app_name || entry.window_title) && (
          <div data-testid="app-info" className="mb-[8px]">
            {entry.app_name && (
              <div className="text-[12px] text-[#e0e0e0] font-semibold">
                {entry.app_name}
              </div>
            )}
            {entry.window_title && (
              <div className="text-[11px] text-[#9ca3af]">
                {entry.window_title}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-[12px] border-t border-[#1f2937] flex flex-col gap-[6px]">
        {actionError && (
          <p className="text-[11px] text-[#f87171] m-0 mb-[2px]">{actionError}</p>
        )}
        {entry.media_type === "video" ? (
          <>
            <button
              data-testid="play-btn"
              onClick={handlePlay}
              className={`${btnDefault} cursor-pointer`}
            >
              Play
            </button>
            <button
              data-testid="export-mp4-btn"
              onClick={handleExportMp4}
              disabled={exporting}
              className={`${btnDefault} ${exporting ? "opacity-60 cursor-default" : "opacity-100 cursor-pointer"}`}
            >
              {exporting ? "Exporting…" : "Export MP4"}
            </button>
          </>
        ) : (
          <button
            onClick={handleCopy}
            disabled={copying}
            className={`${btnDefault} ${copying ? "opacity-60 cursor-default" : "opacity-100 cursor-pointer"}`}
          >
            {copying ? "Copying…" : "Copy to Clipboard"}
          </button>
        )}

        {!showDeleteConfirm ? (
          <button
            data-testid="delete-btn"
            onClick={() => { setShowDeleteConfirm(true); setDeleteError(null); }}
            className={`${btnBase} bg-[#7f1d1d] text-[#fca5a5] border border-[#991b1b] cursor-pointer`}
          >
            Delete
          </button>
        ) : (
          <div>
            <p className="text-[11px] text-[#f87171] m-0 mb-[6px]">
              Delete this capture?
            </p>
            {deleteError && (
              <p className="text-[11px] text-[#f87171] m-0 mb-[6px]">{deleteError}</p>
            )}
            <div className="flex gap-[6px]">
              <button
                data-testid="delete-confirm-yes"
                onClick={handleDelete}
                disabled={deleting}
                className={`${btnBase} flex-1 bg-[#7f1d1d] text-[#fca5a5] border border-[#374151] cursor-pointer`}
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteError(null); }}
                className={`${btnDefault} flex-1 cursor-pointer`}
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

// Shared button classes. btnBase omits background/border/text colors so callers
// can set their own without conflicting duplicate utilities; btnDefault adds the
// standard gray appearance used by most buttons.
const btnBase = "rounded-[6px] py-[6px] px-[10px] text-[12px] w-full text-center";
const btnDefault = `${btnBase} bg-[#1f2937] border border-[#374151] text-[#e0e0e0]`;
