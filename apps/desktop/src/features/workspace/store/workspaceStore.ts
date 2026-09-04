import { create } from "zustand";

import { useOrganizationStore } from "../../../store/orgStore";

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
  addWorkspace as registerWorkspace,
  listWorkspaces,
  removeWorkspace as forgetWorkspace,
  renameWorkspace as renameWorkspaceEntry,
  setActiveWorkspace,
  workspaceForOrg,
  deployPaths,
  retrievePaths,
  diffWorkspacePath,
  clearDiffSessions,
  type WorkspaceNode,
} from "../services/workspaceService";
import {
  addNode,
  getBaseName,
  getParentPath,
  mapTreePaths,
  normalizePath,
  removeNode,
  setChildren,
} from "../lib/workspaceUtils";
import { buffersAffectedBy, needsDeployConfirmation } from "../lib/deployGuards";
import { tokenize } from "../lib/tokenize";
import { protectionPrompt } from "../../org-manager/lib/orgProtection";
import type {
  CursorPosition,
  SaveStatus,
  SidebarView,
  TerminalEntry,
  TerminalKind,
  TerminalSource,
  DiffSession,
  Workspace,
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

  /** Folders whose contents have been fetched. */
  loadedFolders: Set<string>;
  /** Folders with a read in flight, so expanding twice does not double-fetch. */
  loadingFolders: Set<string>;

  initWorkspace: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  setFiles: (files: WorkspaceFile[]) => void;
  /** Fetches one folder's children, unless already loaded or in flight. */
  loadFolder: (path: string) => Promise<void>;
  /** Reads the whole tree in one call. Needed to filter across every file. */
  loadFullTree: () => Promise<void>;
  /** True once the whole tree has been read, so filtering sees everything. */
  fullyLoaded: boolean;

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

  /** Registered projects, and which one is active. */
  workspaces: Workspace[];
  activeWorkspaceId: string | null;

  loadWorkspaces: () => Promise<void>;
  /** Loads whichever project is active into the editor. */
  openActiveWorkspace: (name: string) => Promise<void>;
  /** Registers a folder (via the native picker) and opens it. */
  addWorkspace: () => Promise<void>;
  /** Opens an already-registered project. */
  switchWorkspace: (id: string) => Promise<void>;
  /** Forgets a project. Never deletes anything on disk. */
  removeWorkspace: (id: string) => Promise<void>;
  renameWorkspace: (id: string, name: string) => Promise<void>;

  /** Deploys specific files/folders rather than the whole package directory. */
  deployPathsAction: (paths: string[]) => Promise<void>;
  /** Pulls specific files/folders from the org into the workspace. */
  retrievePathsAction: (paths: string[]) => Promise<void>;

  /** The open Diff Check result, if any. */
  diffSession: DiffSession | null;
  diffLoading: boolean;
  diffError: string | null;
  openDiff: (path: string) => Promise<void>;
  closeDiff: () => void;

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
    // `undefined` is meaningful on a folder: its contents are not loaded yet.
    children: node.children ? node.children.map(mapNode) : undefined,
    hasChildren: node.hasChildren,
  };
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

/**
 * Confirms before an action that discards unsaved editor buffers.
 *
 * Opening a different folder used to clear `dirty` outright, losing edits with
 * no prompt; switching projects would have walked the same path.
 */
function confirmDiscardUnsaved(dirty: Record<string, boolean>): boolean {
  const paths = Object.entries(dirty)
    .filter(([, isDirty]) => isDirty)
    .map(([path]) => path);
  if (paths.length === 0) return true;

  const preview = paths.slice(0, 8).join("\n  ");
  const more = paths.length > 8 ? `\n  …and ${paths.length - 8} more` : "";
  return window.confirm(
    `${paths.length} file(s) have unsaved changes:\n\n  ${preview}${more}\n\n` +
      "Switching workspaces closes them without saving. Continue?",
  );
}

/** State reset shared by every "open a different project" path. */
const EMPTY_WORKSPACE_STATE = {
  loaded: false,
  files: [] as WorkspaceFile[],
  openFiles: [] as string[],
  selectedFile: null as string | null,
  fileContents: {} as Record<string, string>,
  savedContents: {} as Record<string, string>,
  loadingContent: {} as Record<string, boolean>,
  dirty: {} as Record<string, boolean>,
  loadedFolders: new Set<string>(),
  loadingFolders: new Set<string>(),
  fullyLoaded: false,
  error: null as string | null,
};

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

    loadedFolders: new Set<string>(),
    loadingFolders: new Set<string>(),
    fullyLoaded: false,

    workspaces: [],
    activeWorkspaceId: null,

    diffSession: null,
    diffLoading: false,
    diffError: null,

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

        // Open tabs are kept as-is. The tree is now only the root level plus
        // whatever has been expanded, so it can no longer answer "does this
        // file still exist?" — a file deleted underneath us surfaces as a read
        // error when it is next opened, which beats silently closing tabs.
        //
        // `loadedFolders` resets so expanded folders re-read from disk; the
        // explorer re-requests them for anything currently expanded.
        set({
          files: nextFiles,
          loadedFolders: new Set<string>(),
          loadingFolders: new Set<string>(),
          fullyLoaded: false,
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

    loadFullTree: async () => {
      if (get().fullyLoaded) return;
      set({ loading: true });
      try {
        // One deep read. Filtering has to match files the user has never
        // expanded to, so it pays for the full walk once rather than the
        // explorer paying for it on every open.
        const nodes = (await loadWorkspaceFiles("", 64)).map(mapNode);
        set({ files: nodes, fullyLoaded: true, loading: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ loading: false });
        get().appendLog(
          `Failed to read the workspace tree — ${message}`,
          "error",
          "system",
        );
      }
    },

    loadFolder: async (path) => {
      const target = normalizePath(path);
      const state = get();
      if (state.loadedFolders.has(target) || state.loadingFolders.has(target)) {
        return;
      }

      set({ loadingFolders: new Set(state.loadingFolders).add(target) });

      try {
        const children = (await loadWorkspaceFiles(target)).map(mapNode);
        set((current) => {
          const loadingFolders = new Set(current.loadingFolders);
          loadingFolders.delete(target);
          return {
            files: setChildren(current.files, target, children),
            loadedFolders: new Set(current.loadedFolders).add(target),
            loadingFolders,
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set((current) => {
          const loadingFolders = new Set(current.loadingFolders);
          loadingFolders.delete(target);
          return { loadingFolders };
        });
        get().appendLog(
          `Failed to read ${target} — ${message}`,
          "error",
          "system",
        );
      }
    },

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

    loadWorkspaces: async () => {
      try {
        const registry = await listWorkspaces();
        set({
          workspaces: registry.workspaces,
          activeWorkspaceId: registry.activeId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(
          `Could not read the workspace list — ${message}`,
          "error",
          "system",
        );
      }
    },

    /** Loads a newly activated project into the editor. */
    openActiveWorkspace: async (name: string) => {
      set(EMPTY_WORKSPACE_STATE);
      await get().refreshFiles();
      const root = await getWorkspaceRoot().catch(() => "");
      if (root) {
        set({ workspaceRoot: root, workspaceName: getBaseName(root) });
      }

      get().appendLog(`Opened workspace — ${name}`, "success", "system");
    },

    addWorkspace: async () => {
      try {
        const folder = await selectWorkspaceFolder();
        if (!folder) return;
        if (!confirmDiscardUnsaved(get().dirty)) return;

        // Binds the chosen folder to the current org, so "Open folder…"
        // repoints that org at your own repo instead of the auto-created one.
        const orgId =
          useOrganizationStore.getState().selectedOrganization?.id ?? null;
        const entry = await registerWorkspace(folder, orgId);
        await get().loadWorkspaces();
        await get().openActiveWorkspace(entry.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(`Failed to open folder — ${message}`, "error", "system");
      }
    },

    /** `openFolder` is the older name for the same action. */
    openFolder: async () => {
      await get().addWorkspace();
    },

    switchWorkspace: async (id) => {
      if (id === get().activeWorkspaceId) return;
      if (!confirmDiscardUnsaved(get().dirty)) return;

      try {
        const entry = await setActiveWorkspace(id);
        await get().loadWorkspaces();
        await get().openActiveWorkspace(entry.name);

        // Selecting the owning org keeps the two in step. The org subscribe
        // sees the workspace is already active and settles without a second
        // switch.
        const orgs = useOrganizationStore.getState();
        const owner = entry.orgId
          ? orgs.organizations.find((org) => org.id === entry.orgId)
          : undefined;
        if (owner && owner.id !== orgs.selectedOrganization?.id) {
          orgs.setSelectedOrganization(owner);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(
          `Could not switch workspace — ${message}`,
          "error",
          "system",
        );
      }
    },

    removeWorkspace: async (id) => {
      const wasActive = get().activeWorkspaceId === id;
      if (wasActive && !confirmDiscardUnsaved(get().dirty)) return;

      try {
        const registry = await forgetWorkspace(id);
        set({
          workspaces: registry.workspaces,
          activeWorkspaceId: registry.activeId,
        });
        // Removing the active project promotes another one, so the editor has
        // to follow. Files on disk are untouched either way.
        if (wasActive) {
          const next = registry.workspaces.find(
            (item) => item.id === registry.activeId,
          );
          await get().openActiveWorkspace(next?.name ?? "workspace");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(
          `Could not remove workspace — ${message}`,
          "error",
          "system",
        );
      }
    },

    renameWorkspace: async (id, name) => {
      try {
        const registry = await renameWorkspaceEntry(id, name);
        set({
          workspaces: registry.workspaces,
          activeWorkspaceId: registry.activeId,
        });
        if (registry.activeId === id) {
          const entry = registry.workspaces.find((item) => item.id === id);
          if (entry) set({ workspaceName: entry.name });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(
          `Could not rename workspace — ${message}`,
          "error",
          "system",
        );
      }
    },

    /**
     * Deploys specific files or folders instead of the whole package
     * directory — the common edit→push loop.
     */
    deployPathsAction: async (paths) => {
      if (get().deploying || paths.length === 0) return;

      const org = useOrganizationStore.getState().selectedOrganization;
      if (!org) {
        get().appendLog(
          "Connect an org before deploying.",
          "warning",
          "deploy",
        );
        return;
      }

      const label = paths.length === 1 ? paths[0] : `${paths.length} items`;

      // Sandboxes deploy straight away; Production is the one worth a pause.
      if (needsDeployConfirmation(org)) {
        const proceed = window.confirm(
          `Deploy to PRODUCTION?\n\n  Org:  ${org.alias} (${org.username})\n` +
            `  Item: ${label}\n\nThis writes to a live production org.`,
        );
        if (!proceed) return;
      }

      set({ deploying: true });
      get().appendLog(`🚀 Deploying ${label} → ${org.alias}…`, "cmd", "deploy");

      try {
        const outcome = await deployPaths(org.username, paths);
        get().appendLog(outcome.summary, "success", "deploy");
        get().appendLog(`✅ Deployed ${label}.`, "success", "deploy");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(message, "error", "deploy");
        get().appendLog(`❌ Deploy of ${label} failed.`, "error", "deploy");
      } finally {
        set({ deploying: false });
      }
    },

    /** Pulls specific files or folders from the org into the workspace. */
    retrievePathsAction: async (paths) => {
      if (paths.length === 0) return;

      const org = useOrganizationStore.getState().selectedOrganization;
      if (!org) {
        get().appendLog(
          "Connect an org before retrieving.",
          "warning",
          "terminal",
        );
        return;
      }

      // Retrieving rewrites files on disk; edits held only in the editor would
      // be silently superseded.
      const affected = paths.flatMap((path) =>
        buffersAffectedBy(path, get().dirty),
      );
      if (affected.length > 0) {
        const proceed = window.confirm(
          `${affected.length} open file(s) have unsaved changes:\n\n  ` +
            `${affected.slice(0, 8).join("\n  ")}\n\n` +
            "Retrieving overwrites them on disk. Continue?",
        );
        if (!proceed) return;
      }

      const label = paths.length === 1 ? paths[0] : `${paths.length} items`;
      get().appendLog(
        `⬇ Retrieving ${label} from ${org.alias}…`,
        "cmd",
        "terminal",
      );

      try {
        const summary = await retrievePaths(org.username, paths);
        get().appendLog(summary, "success", "terminal");

        // Drop cached buffers for the retrieved files so the editor shows what
        // actually landed rather than the pre-retrieve copy.
        set((state) => {
          const stale = (file: string) =>
            paths.some(
              (path) => file === path || file.startsWith(`${path}/`),
            );
          const keep = <T,>(map: Record<string, T>) =>
            Object.fromEntries(
              Object.entries(map).filter(([file]) => !stale(file)),
            );
          return {
            fileContents: keep(state.fileContents),
            savedContents: keep(state.savedContents),
            dirty: keep(state.dirty),
          };
        });

        await get().refreshFiles();
        const selected = get().selectedFile;
        if (selected) await get().selectFile(selected);

        get().appendLog(`✅ Retrieved ${label}.`, "success", "terminal");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().appendLog(message, "error", "terminal");
      }
    },

    /** Compares a file or folder against the org and opens the diff overlay. */
    openDiff: async (path) => {
      const org = useOrganizationStore.getState().selectedOrganization;
      if (!org) {
        get().appendLog(
          "Connect an org before running a diff.",
          "warning",
          "terminal",
        );
        return;
      }

      set({ diffLoading: true, diffError: null, diffSession: null });
      try {
        const session = await diffWorkspacePath(org.username, path);
        set({ diffSession: session, diffLoading: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ diffError: message, diffLoading: false });
      }
    },

    closeDiff: () => {
      set({ diffSession: null, diffError: null, diffLoading: false });
      // Scratch directories are disposable; failing to clear them must not
      // block closing the overlay.
      void clearDiffSessions().catch(() => {});
    },

    runDeploy: async (username, checkOnly) => {
      if (get().deploying) return;

      // A full-workspace deploy is the broadest action in the app and had no
      // confirmation at all; per-file deploys already had one.
      if (!checkOnly) {
        const org = useOrganizationStore.getState().selectedOrganization;
        const prompt = protectionPrompt(org, "Deploy the whole workspace");
        if (prompt && !window.confirm(prompt)) return;
      }

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


export { useWorkspaceInit } from "../hooks/useWorkspaceInit";

/**
 * Switches the workspace whenever the selected org changes.
 *
 * Each org owns a folder, so changing org swaps the whole tree rather than just
 * repointing the deploy target. Subscribed at module level so it fires wherever
 * the org was switched from — Org Manager, the dashboard, the activity bar.
 */
let switchingForOrg = false;

useOrganizationStore.subscribe((state, previous) => {
  const nextOrg = state.selectedOrganization;
  const previousOrg = previous.selectedOrganization;
  if (nextOrg?.id === previousOrg?.id) return;

  // Reverting the selection below re-enters this listener; ignore that pass.
  if (switchingForOrg) return;

  // No org selected: leave whatever workspace is open rather than closing it.
  if (!nextOrg) return;

  void (async () => {
    switchingForOrg = true;
    try {
      const store = useWorkspaceStore.getState();

      // Unsaved buffers belong to the *outgoing* org's folder and would be
      // lost. Declining has to undo the org change too, or the selected org
      // and the open tree would disagree.
      if (!confirmDiscardUnsaved(store.dirty)) {
        useOrganizationStore.getState().setSelectedOrganization(previousOrg);
        return;
      }

      const entry = await workspaceForOrg(nextOrg.id, nextOrg.alias);
      await store.loadWorkspaces();
      await useWorkspaceStore.getState().openActiveWorkspace(entry.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useWorkspaceStore
        .getState()
        .appendLog(
          `Could not open the workspace for ${nextOrg.alias} — ${message}`,
          "error",
          "system",
        );
    } finally {
      switchingForOrg = false;
    }
  })();
});
