import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSession } from "../context/SessionContext";

export function useProjectPicker() {
  const { changeProjectDir } = useSession();

  const openProjectPicker = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false, title: "Select Project Folder" });
    if (selected && typeof selected === "string") {
      await changeProjectDir(selected);
    }
  }, [changeProjectDir]);

  return { openProjectPicker };
}
