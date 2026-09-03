import { useEffect } from "react";

import { useWorkspaceStore } from "../store/workspaceStore";
import type { SidebarView } from "../types";

/** Activity-bar views reachable by chord, matching the tooltips they advertise. */
const VIEW_CHORDS: Record<string, SidebarView> = {
  e: "explorer",
  f: "search",
  g: "scm",
  m: "metadata",
};

/**
 * Global workspace keyboard shortcuts, matching VS Code muscle memory:
 *   Ctrl/Cmd+S           – save the active file
 *   Ctrl/Cmd+Shift+S     – save all files
 *   Ctrl/Cmd+B           – toggle the side bar
 *   Ctrl/Cmd+`           – toggle the terminal panel
 *   Ctrl/Cmd+Shift+E/F/G/M – Explorer / Search / Source Control / Metadata
 *   Ctrl/Cmd+,           – workspace settings
 *
 * Everything except Ctrl+S/B/`/Shift+F was advertised in the activity-bar
 * tooltips without ever being implemented.
 */
export function useWorkspaceShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      const key = event.key.toLowerCase();
      const store = useWorkspaceStore.getState();

      if (key === "s") {
        event.preventDefault();
        if (event.shiftKey) {
          void store.saveAll();
        } else if (store.selectedFile) {
          void store.saveFile(store.selectedFile);
        }
        return;
      }

      if (key === "b" && !event.shiftKey) {
        event.preventDefault();
        store.toggleSidebar();
        return;
      }

      if (event.key === "`") {
        event.preventDefault();
        store.togglePanel();
        return;
      }

      if (event.key === ",") {
        event.preventDefault();
        store.setActiveView("settings");
        return;
      }

      if (event.shiftKey && VIEW_CHORDS[key]) {
        event.preventDefault();
        store.setActiveView(VIEW_CHORDS[key]);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
