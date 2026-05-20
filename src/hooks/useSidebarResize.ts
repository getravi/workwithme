import { useRef, useCallback } from "react";
import { useUI } from "../context/UIContext";

export function useSidebarResize() {
  const { sidebarWidth, setSidebarWidth } = useUI();
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: sidebarWidth };

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const next = Math.min(400, Math.max(160, dragRef.current.startWidth + ev.clientX - dragRef.current.startX));
        setSidebarWidth(next);
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth, setSidebarWidth],
  );

  return { sidebarWidth, handleSidebarResizeStart };
}
