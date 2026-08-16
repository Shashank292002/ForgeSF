import { useEffect } from "react";

import { useWorkspaceStore } from "../store/workspaceStore";

export interface WorkspaceInitState {
  loaded: boolean;
  error: string | null;
  booting: boolean;
}

/**
 * Lazily boots the workspace store on mount. Returns the initialisation
 * state so the page can render loading / error / ready chrome.
 */
export function useWorkspaceInit(): WorkspaceInitState {
  const loaded = useWorkspaceStore((state) => state.loaded);
  const error = useWorkspaceStore((state) => state.error);
  const booting = useWorkspaceStore((state) => state.booting);
  const initWorkspace = useWorkspaceStore((state) => state.initWorkspace);

  useEffect(() => {
    if (!loaded && !booting) {
      void initWorkspace();
    }
  }, [loaded, booting, initWorkspace]);

  return { loaded, error, booting };
}