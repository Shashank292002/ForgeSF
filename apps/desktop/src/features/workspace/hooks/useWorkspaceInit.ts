import { useEffect, useRef } from "react";

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

  // Boot exactly once per mount. Watching `loaded`/`booting` here caused an
  // unbounded retry loop on failure: init sets `booting` false in its
  // `finally`, the dependency changed, the effect re-fired, and the store's
  // own `(booting || loaded)` guard let it straight through again. Recovery
  // is now an explicit user action (the Retry button on the error card).
  const bootRequested = useRef(false);

  useEffect(() => {
    if (bootRequested.current) return;
    bootRequested.current = true;
    void initWorkspace();
  }, [initWorkspace]);

  return { loaded, error, booting };
}
