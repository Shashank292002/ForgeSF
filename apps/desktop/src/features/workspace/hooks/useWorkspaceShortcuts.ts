import { useEffect } from "react";

import { useWorkspaceStore } from "../store/workspaceStore";

/**
 * Global workspace keyboard shortcuts, matching VS Code muscle memory:
 *   Ctrl/Cmd+S  – save the active file
 *   Ctrl/Cmd+Shift+S – save all files
 *   Ctrl/Cmd+B  – toggle the side bar
 *   Ctrl/Cmd+` – toggle the terminal panel
 *   Ctrl/Cmd+Shift+F – open search
 */
export function useWorkspaceShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const store = useWorkspaceStore.getState();

      if (mod && key === "s") {
        event.preventDefault();
        if (event.shiftKey) {
          void store.saveAll();
        } else if (store.selectedFile) {
          void store.saveFile(store.selectedFile);
        }
        return;
      }

      if (mod && key === "b") {
        event.preventDefault();
        store.toggleSidebar();
        return;
      }

      if (mod && event.key === "`") {
        event.preventDefault();
        store.togglePanel();
        return;
      }

      if (mod && event.shiftKey && key === "f") {
        event.preventDefault();
        store.setActiveView("search");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}