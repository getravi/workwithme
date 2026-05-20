import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import type { AttachedFile } from "../types";

export function useFileAttachments() {
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);

  const handleAttachFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Images", extensions: ["png", "jpeg", "jpg", "webp", "gif"] }],
      });
      if (!selected) return;
      const files = Array.isArray(selected) ? selected : [selected];
      const newAttachments: AttachedFile[] = [];
      for (const file of files) {
        const data = await readFile(file);
        const name = file.split(/[\\/]/).pop() ?? file;
        newAttachments.push({ path: file, name, data });
      }
      setAttachments((prev) => [...prev, ...newAttachments]);
    } catch (err) {
      console.error("[useFileAttachments] handleAttachFile failed", err);
    }
  }, []);

  const handleTextareaPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        file.arrayBuffer().then((buf) => {
          setAttachments((prev) => [
            ...prev,
            { name: file.name || "pasted-image.png", path: "", data: new Uint8Array(buf) },
          ]);
        });
        return;
      }
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearAttachments = useCallback(() => setAttachments([]), []);

  return { attachments, handleAttachFile, handleTextareaPaste, removeAttachment, clearAttachments };
}
