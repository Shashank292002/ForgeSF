import { create } from "zustand";

import {
  createWorkspaceItem,
  deleteWorkspaceItem,
  deployWorkspace,
  getWorkspaceRoot,
  isTauriRuntime,
  loadWorkspaceFileContent,
  loadWorkspaceFiles,
  renameWorkspaceItem,
  runSfCommand,
  saveWorkspaceFileContent,
  selectWorkspaceFolder,
  setWorkspaceRoot,
  type WorkspaceNode,
} from "../services/workspaceService";
import {
  addNode,
  getBaseName,
  getParentPath,
  mapTreePaths,
  normalizePath,
  removeNode,
} from "../lib/workspaceUtils";
import type {
  CursorPosition,
  SaveStatus,
  SidebarView,
  TerminalEntry,
  TerminalKind,
  TerminalSource,
  WorkspaceFile,
} from "../types";

interface RevealRequest {
  path: string;
  seq: number;
}

interface WorkspaceState {
  files: WorkspaceFile[];
  loaded: boolean;
  booting: boolean;
  loading: boolean;
  error: string | null;
  workspaceName: string;
  workspaceRoot: string;

  selectedFile: string | null;
  openFiles: string[];
  fileContents: Record<string, string>;
  savedContents: Record<string, string>;
  loadingContent: Record<string, boolean>;
  dirty: Record<string, boolean>;
  saveStatus: SaveStatus;

  activeView: SidebarView;
  sidebarVisible: boolean;
  panelOpen: boolean;
  cursorPosition: CursorPosition;
  revealRequest: RevealRequest | null;

  logs: TerminalEntry[];
  deploying: boolean;

  initWorkspace: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  setFiles: (files: WorkspaceFile[]) => void;

  selectFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  closeAll: () => void;
  updateFileContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<boolean>;
  saveAll: () => Promise<void>;
  revertFile: (path: string) => Promise<void>;

  createItem: (
    parentPath: string,
    name: string,
    isFolder: boolean,
  ) => Promise<boolean>;
  deleteItem: (path: string) => Promise<boolean>;
  renameItem: (path: string, newName: string) => Promise<boolean>;
  openFolder: () => Promise<void>;

  runDeploy: (username: string, checkOnly: boolean) => Promise<void>;
  runTerminalCommand: (line: string) => Promise<void>;
  appendLog: (
    text: string,
    kind?: TerminalKind,
    source?: TerminalSource,
  ) => void;
  clearLogs: () => void;

  setActiveView: (view: SidebarView) => void;
  setSidebarVisible: (visible: boolean) => void;
  toggleSidebar: () => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setCursorPosition: (position: CursorPosition) => void;
  revealFile: (path: string) => void;

  /** Whether the retrieve-metadata overlay is open. */
  retrieveOpen: boolean;
  openRetrieve: () => void;
  closeRetrieve: () => void;
}

/** Stable id generator for terminal entries. */
let __logCounter = 0;
function nextLogId(): number {
  __logCounter += 1;
  return Date.now() * 1000 + __logCounter;
}

function mapNode(node: WorkspaceNode): WorkspaceFile {
  return {
    path: node.path.replace(/\\/g, "/").replace(/^\/+/, ""),
    name: node.name,
    type: node.nodeType === "folder" ? "folder" : "file",
    children: node.children ? node.children.map(mapNode) : undefined,
  };
}

function collectFilesDeep(items: WorkspaceFile[]): WorkspaceFile[] {
  return items.flatMap((item) => [
    item,
    ...(item.children ? collectFilesDeep(item.children) : []),
  ]);
}

/** Maps `from` → `to` (and `from/…` → `to/…`) across a string-keyed map. */
function remapKeys<K>(
  map: Record<string, K>,
  from: string,
  to: string,
): Record<string, K> {
  const next: Record<string, K> = {};
  for (const [key, value] of Object.entries(map)) {
    const movedKey =
      key === from || key.startsWith(`${from}/`)
        ? `${to}${key.slice(from.length)}`
        : key;
    next[movedKey] = value;
  }
  return next;
}

const EMPTY_CURSOR: CursorPosition = { line: 1, column: 1 };

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** Loads the file tree only — file contents stay lazy. */
  async function loadTree(): Promise<WorkspaceFile[]> {
    const nodes = await loadWorkspaceFiles("");
    return nodes.map(mapNode);
  }

  return {
    files: [],
    loaded: false,
    booting: false,
    loading: false,
    error: null,
    workspaceName: "",
    workspaceRoot: "",

    selectedFile: null,
    openFiles: [],
    fileContents: {},
    savedContents: {},
    loadingContent: {},
    dirty: {},
    saveStatus: "idle",

    activeView: "explorer",
    sidebarVisible: true,
    panelOpen: true,
    cursorPosition: EMPTY_CURSOR,
    revealRequest: null,

    logs: [],
    deploying: false,

    initWorkspace: async () => {
      const state = get();
      if (state.booting || state.loaded) return;

      set({ booting: true, error: null });

      try {
        const root = await getWorkspaceRoot();
        get().appendLog(`Opening workspace — ${root}`, "info", "system");
        set({
          workspaceRoot: root,
          workspaceName: getBaseName(root),
        });
        await get().refreshFiles();
        if (!isTauriRuntime) {
          get().appendLog(
            "Running outside Tauri — file operations need the desktop shell.",
            "warning",
            "system",
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ loaded: false, error: message });
        get().appendLog(
          `Failed to open workspace — ${message}`,
          "error",
          "system",
        );
      } finally {
        set({ booting: false });
      }
    },

    refreshFiles: async () => {
      set({ loading: true, error: null });
      try {
        const nextFiles = await loadTree();
        const list = collectFilesDeep(nextFiles);
        const available = new Set(list.map((node) => node.path));
        const prev = get();

        // Keep tabs for files that still exist; drop orphaned buffers that are
        // clean, but preserve dirty buffers so unsaved work is never lost.
        const nextOpenFiles = prev.openFiles.filter((file) =>
          available.has(file),
        );
        for (const file of prev.openFiles) {
          if (
            !available.has(file) &&
            prev.dirty[file] &&
            !nextOpenFiles.includes(file)
          ) {
            nextOpenFiles.push(file);
          }
        }

        const nextSelected =
          prev.selectedFile &&
          (available.has(prev.selectedFile) || prev.dirty[prev.selectedFile])
            ? prev.selectedFile
            : (nextOpenFiles[0] ?? null);

        set({
          files: nextFiles,
          openFiles: nextOpenFiles,
          selectedFile: nextSelected,
          loaded: true,
          loading: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ error: message, loading: false, loaded: false });
        get().appendLog(
          `Failed to refresh workspace — ${message}`,
          "error",
          "system",
        );
      }
    },

    setFiles: (files) => set({ files }),

    /** Ensures a file's content is loaded, then selects it. */
    selectFile: async (path) => {
      const cleanPath = normalizePath(path);
      const state = get();

      const nextOpen = state.openFiles.includes(cleanPath)
        ? state.openFiles
        : [...state.openFiles, cleanPath];

      // Deliberately does not switch `activeView`. Forcing it to "explorer"
      // meant clicking a search result closed the Search panel, so you could
      // never open a second result without searching again. Callers that do
      // want the tree revealed call `revealFile`.
      set({
        selectedFile: cleanPath,
        openFiles: nextOpen,
      });

      // Lazy-load the file content on first open.
      if (
        state.savedContents[cleanPath] === undefined &&
        !state.loadingContent[cleanPath]
      ) {
        set((current) => ({
          loadingContent: {
            ...current.loadingContent,
            [cleanPath]: true,
          },
        }));

        try {
          const content = await loadWorkspaceFileContent(cleanPath);
          set((current) => ({
            fileContents: { ...current.fileContents, [cleanPath]: content },
            savedContents: { ...current.savedContents, [cleanPath]: content },
            loadingContent: {
              ...current.loadingContent,
              [cleanPath]: false,
            },
          }));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          set((current) => ({
            loadingContent: {
              ...current.loadingContent,
              [cleanPath]: false,
            },
          }));
          get().appendLog(
            `Failed to read ${cleanPath} — ${message}`,
            "error",
            "terminal",
          );
        }
      }
    },

    closeFile: (path) =>
      set((state) => {
        const nextOpenFiles = state.openFiles.filter((file) => file !== path);
        const isDirty = Boolean(state.dirty[path]);

        const nextSelected =
          state.selectedFile === path
            ? (nextOpenFiles[0] ?? null)
            : state.selectedFile;

        // Drop caches for non-dirty files to keep memory low.
        if (!isDirty) {
          const nextContents = { ...state.fileContents };
          const nextSaved = { ...state.savedContents };
          delete nextContents[path];
          delete nextSaved[path];
          return {
            openFiles: nextOpenFiles,
            selectedFile: nextSelected,
            fileContents: nextContents,
            savedContents: nextSaved,
          };
        }

        return { openFiles: nextOpenFiles, selectedFile: nextSelected };
      }),

    closeAll: () =>
      set((state) => ({
        openFiles: [],
        selectedFile: null,
        fileContents: Object.fromEntries(
          Object.entries(state.fileContents).filter(
            ([path]) => state.dirty[path],
          ),
        ),
        savedContents: Object.fromEntries(
          Object.entries(state.savedContents).filter(
            ([path]) => state.dirty[path],
          ),
        ),
      })),

    /**
     * Tracks buffer edits. A file that is edited back to its saved content is
     * *removed* from `dirty` rather than set to `false` — every consumer
     * (source control list, save-all buttons, status bar, activity-bar badge)
     * counts keys, so a lingering `false` entry made the file look modified
     * forever and made `saveAll` re-write clean files to disk.
     */
    updateFileContent: (path, content) =>
      set((state) => {
        const nextDirty = { ...state.dirty };
        if (state.savedContents[path] !== content) {
          nextDirty[path] = true;
        } else {
          delete nextDirty[path];
        }
        return {
          fileContents: { ...state.fileContents, [path]: content },
          dirty: nextDirty,
        };
      }),

    saveFile: async (path) => {
      const content = get().fileContents[path];
      if (content === undefined) return false;

      set({ saveStatus: "saving" });
      try {
        await saveWorkspaceFileContent(path, content);
        set((state) => {
          const nextDirty = { ...state.dirty };
          delete nextDirty[path];
          return {
            dirty: nextDirty,
            savedContents: { ...state.savedContents, [path]: content },
            saveStatus: "saved",
          };
        });
        get().appendLog(`Saved ${path}`, "success", "terminal");
        // Return to idle so the status bar stops claiming "Saved" forever.
        window.setTimeout(() => {
          if (useWorkspaceStore.getState().saveStatus === "saved") {
            useWorkspaceStore.setState({ saveStatus: "idle" });
          }
        }, 2000);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ saveStatus: "error" });
        get().appendLog(
          `Failed to save ${path} — ${message}`,
          "error",
          "terminal",
        );
        return false;
      }
    },

    saveAll: async () => {
      // Only genuinely dirty buffers, and sequential: running these through
      // Promise.all had every save racing on the single `saveStatus` field.
      const dirtyPaths = Object.entries(get().dirty)
        .filter(([, isDirty]) => isDirty)
        .map(([path]) => path);

      for (const path of dirtyPaths) {
        await get().saveFile(path);
      }
    },

    revertFile: async (path) => {
      const saved = get().savedContents[path];
      set((state) => {
        const nextDirty = { ...state.dirty };
        delete nextDirty[path];
        return {
          dirty: nextDirty,
          ...(saved !== undefined
            ? { fileContents: { ...state.fileContents, [path]: saved } }
            : {}),
        };
      });
      if (saved === undefined) {
        try {
          const content = await loadWorkspaceFileContent(path);
          set((state) => ({
            fileContents: { ...state.fileContents, [path]: content },
            savedContents: { ...state.savedContents, [path]: content },
          }));
        } catch (error) {
          get().appendLog(
            `Could not revert ${path} — ${String(error)}`,
            "error",
            "terminal",
          );
        }
      }
      get().appendLog(`Reverted ${path}`, "info", "terminal");
    },

    createItem: async (parentPath, name, isFolder) => {
      const cleanParent = normalizePath(parentPath);
      const base = name.trim();
      if (!base) return false;

      const fullPath = cleanParent ? `${cleanParent}/${base}` : base;

      try {
        await createWorkspaceItem(fullPath, isFolder);
        const newNode: WorkspaceFile = {
          path: fullPath,
          name: base,
          type: isFolder ? "folder" : "file",
          children: isFolder ? [] : undefined,
        };
        set((state) => ({
          files: addNode(state.files, cleanParent, newNode),
        }));
        get().appendLog(
          `${isFolder ? "Folder" : "File"} created — ${fullPath}`,
          "success",
          "terminal",
        );
        if (!isFolder) {
          await get().selectFile(fullPath);
        } else {
          get().revealFile(fullPath);
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(
          `Failed to create ${fullPath} — ${message}`,
          "error",
          "terminal",
        );
        return false;
      }
    },

    deleteItem: async (path) => {
      const target = normalizePath(path);
      try {
        await deleteWorkspaceItem(target);
        set((state) => {
          const nextOpenFiles = state.openFiles.filter(
            (file) => file !== target && !file.startsWith(`${target}/`),
          );
          const inOpen = (file: string) =>
            file === target || file.startsWith(`${target}/`);

          const nextContents: Record<string, string> = {};
          const nextSaved: Record<string, string> = {};
          const nextDirty: Record<string, boolean> = {};
          for (const [key, value] of Object.entries(state.fileContents)) {
            if (!inOpen(key)) nextContents[key] = value;
          }
          for (const [key, value] of Object.entries(state.savedContents)) {
            if (!inOpen(key)) nextSaved[key] = value;
          }
          for (const [key, value] of Object.entries(state.dirty)) {
            if (!inOpen(key)) nextDirty[key] = value;
          }

          return {
            files: removeNode(state.files, target),
            openFiles: nextOpenFiles,
            selectedFile:
              state.selectedFile && inOpen(state.selectedFile)
                ? (nextOpenFiles[0] ?? null)
                : state.selectedFile,
            fileContents: nextContents,
            savedContents: nextSaved,
            dirty: nextDirty,
          };
        });
        get().appendLog(`Deleted ${target}`, "success", "terminal");
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(
          `Failed to delete ${target} — ${message}`,
          "error",
          "terminal",
        );
        return false;
      }
    },

    renameItem: async (path, newName) => {
      const from = normalizePath(path);
      const base = newName.trim();
      if (!base || base.includes("/")) return false;

      const to = `${getParentPath(from)}${getParentPath(from) ? "/" : ""}${base}`;
      try {
        await renameWorkspaceItem(from, base);
        set((state) => {
          const moved = (file: string[]) =>
            file.map((item) =>
              item === from || item.startsWith(`${from}/`)
                ? `${to}${item.slice(from.length)}`
                : item,
            );

          return {
            files: mapTreePaths(state.files, from, to),
            openFiles: moved(state.openFiles),
            selectedFile:
              state.selectedFile === from ||
              (state.selectedFile !== null &&
                state.selectedFile.startsWith(`${from}/`))
                ? `${to}${state.selectedFile.slice(from.length)}`
                : state.selectedFile,
            fileContents: remapKeys(state.fileContents, from, to),
            savedContents: remapKeys(state.savedContents, from, to),
            loadingContent: remapKeys(state.loadingContent, from, to),
            dirty: remapKeys(state.dirty, from, to),
          };
        });
        get().appendLog(`Renamed ${from} → ${to}`, "success", "terminal");
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(
          `Failed to rename ${from} — ${message}`,
          "error",
          "terminal",
        );
        return false;
      }
    },

    openFolder: async () => {
      try {
        const folder = await selectWorkspaceFolder();
        if (!folder) return;
        const root = await setWorkspaceRoot(folder);
        set({
          workspaceRoot: root,
          workspaceName: getBaseName(root),
          loaded: false,
          openFiles: [],
          selectedFile: null,
          fileContents: {},
          savedContents: {},
          dirty: {},
          error: null,
        });
        await get().refreshFiles();
        get().appendLog(`Opened folder — ${root}`, "success", "system");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(
          `Failed to open folder — ${message}`,
          "error",
          "system",
        );
      }
    },

    runDeploy: async (username, checkOnly) => {
      if (get().deploying) return;

      const target = username || "default org";
      const action = checkOnly ? "Validating (check-only)" : "Deploying";
      get().appendLog(`🚀 ${action} against ${target}...`, "cmd", "deploy");
      set({ deploying: true });

      try {
        const outcome = await deployWorkspace(username, checkOnly);
        get().appendLog(outcome.summary, "success", "deploy");
        if (checkOnly && outcome.jobId) {
          get().appendLog(
            `Validated — job ${outcome.jobId}. Deploy from the Deployments page to promote it without re-running.`,
            "info",
            "deploy",
          );
        }
        get().appendLog(
          `✅ ${checkOnly ? "Validation" : "Deployment"} finished successfully.`,
          "success",
          "deploy",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(message, "error", "deploy");
        get().appendLog(
          `❌ ${checkOnly ? "Validation" : "Deployment"} failed.`,
          "error",
          "deploy",
        );
      } finally {
        set({ deploying: false });
      }
    },

    /** Splits a terminal line into CLI args, handling simple quotes. */
    runTerminalCommand: async (line) => {
      const trimmed = line.trim().replace(/^\$?\s*/, "");
      if (!trimmed) return;

      get().appendLog(`$ ${trimmed}`, "cmd", "command");

      const tokens = tokenize(trimmed);
      const args = tokens[0]?.toLowerCase() === "sf" ? tokens.slice(1) : tokens;

      try {
        const out = await runSfCommand(args);
        if (out.trim()) {
          get().appendLog(out.trimEnd(), "info", "command");
        }
        get().appendLog("Command finished.", "success", "command");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(message, "error", "command");
      }
    },

    appendLog: (text, kind = "info", source = "terminal") =>
      set((state) => ({
        logs: [
          ...state.logs,
          {
            id: nextLogId(),
            text,
            kind,
            source,
            time: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
          },
        ].slice(-1000),
      })),

    clearLogs: () => set({ logs: [] }),

    setActiveView: (view) => set({ activeView: view, sidebarVisible: true }),

    setSidebarVisible: (visible) => set({ sidebarVisible: visible }),

    toggleSidebar: () =>
      set((state) => ({ sidebarVisible: !state.sidebarVisible })),

    setPanelOpen: (open) => set({ panelOpen: open }),

    togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),

    setCursorPosition: (position) => set({ cursorPosition: position }),

    revealFile: (path) =>
      set(() => ({
        revealRequest: { path: normalizePath(path), seq: Date.now() },
        activeView: "explorer",
        sidebarVisible: true,
      })),

    retrieveOpen: false,

    openRetrieve: () => set({ retrieveOpen: true, activeView: "metadata" }),

    closeRetrieve: () => set({ retrieveOpen: false }),
  };
});

/** Minimal shell-like tokenizer (handles "quoted" and 'single' args). */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const buffer: string[] = [];
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        buffer.push(char);
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (buffer.length) {
        tokens.push(buffer.join(""));
        buffer.length = 0;
      }
    } else {
      buffer.push(char);
    }
  }

  if (buffer.length) tokens.push(buffer.join(""));
  return tokens;
}

export { useWorkspaceInit } from "../hooks/useWorkspaceInit";
