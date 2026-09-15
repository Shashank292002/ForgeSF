import { create } from "zustand";

import { useOrganizationStore } from "../../../store/orgStore";
import type { Organization } from "../../org-manager/types";

import {
  apexDeclaredName,
  copyWorkspaceItems,
  createWorkspaceItem,
  deleteWorkspaceItems,
  getWorkspaceRoot,
  includeCompanions,
  isChangedOnDisk,
  isTauriRuntime,
  loadWorkspaceFileContent,
  loadWorkspaceFiles,
  moveWorkspaceItems,
  onWorkspaceFsChanged,
  renameWorkspaceItem,
  revealWorkspaceItem,
  onTerminalOutput,
  saveWorkspaceFileContent,
  selectWorkspaceFolder,
  startTerminalCommand,
  watchWorkspace,
  workspacePackageDirectories,
  addWorkspace as registerWorkspace,
  listWorkspaces,
  removeWorkspace as forgetWorkspace,
  renameWorkspace as renameWorkspaceEntry,
  setActiveWorkspace,
  workspaceForOrg,
  retrievePaths,
  diffWorkspacePath,
  clearDiffSessions,
  type WorkspaceNode,
} from "../services/workspaceService";
import {
  resetWorkspaceBaseline,
  workspaceChanges,
} from "../../deployments/services/deployService";
import { useDeployJobsStore } from "../../deployments/store/deployJobsStore";
import {
  describeProgress,
  succeeded,
} from "../../deployments/lib/deployStatus";
import type {
  DeployScope,
  FileStamp,
  PathChange,
  TerminalEvent,
  WorkspaceChanges,
  WorkspaceFsEvent,
} from "@/types/generated";
import { cancelSfCommand, newRunId } from "../../../services/tauri";
import {
  addNode,
  apexKind,
  apexStem,
  childWithin,
  findNode,
  getAncestors,
  getBaseName,
  getParentPath,
  isApexName,
  isWithin,
  mapTreePaths,
  markHasChildren,
  mergeLoaded,
  normalizePath,
  remapPath,
  removeNode,
  setChildren,
} from "../lib/workspaceUtils";
import {
  buffersAffectedBy,
  workspaceOrgMismatchPrompt,
} from "../lib/deployGuards";
import { tokenize } from "../lib/tokenize";
import { protectionPrompt } from "../../org-manager/lib/orgProtection";
import { cliProtectionPrompt, stripCliName } from "../../../lib/sfCli";
import {
  ask,
  confirm,
  previewList,
} from "../../../components/ui/Confirm/confirm";
import { toast } from "../../../components/ui/Toast/toast";
import type {
  CursorPosition,
  EditorInfo,
  EditorReveal,
  ExplorerSelection,
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

  /**
   * The workspace whose tree and buffers are loaded — every file, deploy,
   * retrieve and diff request names it. This can briefly differ from
   * `activeWorkspaceId` while a switch is in progress, and the difference is
   * the point: a request made from the old tree must act on the old folder.
   */
  openWorkspaceId: string | null;

  selectedFile: string | null;
  openFiles: string[];
  fileContents: Record<string, string>;
  savedContents: Record<string, string>;
  loadingContent: Record<string, boolean>;
  /**
   * Files whose content could not be read (binary, not UTF-8, too large, or
   * gone from disk), keyed by path, with the reason. Such a tab has no buffer:
   * it must never be saved, or the empty editor would overwrite the real file.
   */
  loadErrors: Record<string, string>;
  dirty: Record<string, boolean>;
  saveStatus: SaveStatus;
  /** The stamp each buffer was read or last saved with; a save checks it. */
  fileStamps: Record<string, FileStamp>;
  /**
   * Buffers with unsaved edits whose file changed on disk meanwhile — a
   * retrieve, a git checkout, another editor. The editor offers to reload.
   */
  diskConflicts: Record<string, boolean>;
  /** Where deployable metadata lives in the open workspace. */
  packageDirectories: string[];
  /** Explorer items cut or copied, waiting to be pasted. */
  clipboard: { mode: "copy" | "cut"; paths: string[] } | null;
  /**
   * Folders open in the explorer. Kept here, not in the component, so they
   * survive switching sidebar views and follow renames and moves.
   */
  expandedFolders: Set<string>;
  /** What the explorer has selected, and where its keyboard focus is. */
  explorerSelection: ExplorerSelection;
  setFolderExpanded: (path: string, expanded: boolean) => void;
  /** Opens folders (and reads the ones not loaded yet). */
  expandFolders: (paths: string[]) => void;
  collapseFolders: () => void;
  setExplorerSelection: (selection: ExplorerSelection) => void;

  /** Indentation and line endings of the file in the editor, for the status bar. */
  editorInfo: EditorInfo | null;
  setEditorInfo: (info: EditorInfo | null) => void;
  /** A place the editor should show once its file is open. */
  editorReveal: EditorReveal | null;
  /**
   * Opens a file and puts the cursor at `target` — a search match, a line
   * from Quick Open. Without a target the editor just takes focus.
   */
  openFileAt: (
    path: string,
    target?: {
      line: number;
      column?: number;
      length?: number;
      focus?: boolean;
    },
  ) => Promise<void>;
  /** Quick Open or the command palette, while open, and the text it opened with. */
  quickInput: { text: string; seq: number } | null;
  /** Opens Quick Open: "" for files, ">" for commands, ":" for a line. */
  openQuickInput: (text?: string) => void;
  closeQuickInput: () => void;
  /** Bumped to move focus into the Search view's input. */
  searchFocusSeq: number;
  focusSearch: () => void;
  /**
   * Closes editor tabs, asking once about unsaved changes: save them, drop
   * them, or close nothing.
   */
  closeFiles: (paths: string[]) => Promise<void>;

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
  /**
   * Reloads every open buffer without unsaved edits from disk, after
   * something outside the editor (a metadata retrieve) rewrote files.
   */
  reloadCleanBuffers: () => Promise<void>;

  createItem: (
    parentPath: string,
    name: string,
    isFolder: boolean,
  ) => Promise<boolean>;
  /**
   * `paths` with the files that belong to them, which deleting removes and
   * moving carries along — for a confirmation to list.
   */
  withCompanions: (paths: string[]) => Promise<string[]>;
  /** Deletes items with their companion files. Callers confirm first. */
  deleteItems: (paths: string[]) => Promise<boolean>;
  /**
   * Renames a file or folder with what belongs to it (a class's `-meta.xml`,
   * a bundle's files). Resolves with every path that changed, the item's own
   * first, or null on failure.
   */
  renameItem: (path: string, newName: string) => Promise<PathChange[] | null>;
  /** Moves items into a folder ("" for the root). Callers confirm first. */
  moveItems: (
    paths: string[],
    targetFolder: string,
  ) => Promise<PathChange[] | null>;
  /** Copies items into a folder, renaming copies that would clash. */
  copyItems: (
    paths: string[],
    targetFolder: string,
  ) => Promise<string[] | null>;
  setClipboard: (clipboard: WorkspaceState["clipboard"]) => void;
  /**
   * Pastes the clipboard into a folder: a copy, or the move a cut asked for.
   * Resolves with what was created or moved, or null when nothing was.
   */
  pasteInto: (
    folder: string,
  ) => Promise<{ copied: string[]; moved: PathChange[] } | null>;
  revealItem: (path: string) => Promise<void>;
  /** Drops a buffer's unsaved edits in favour of what is on disk now. */
  reloadFromDisk: (path: string) => Promise<void>;
  /** Keeps a buffer's edits over a change on disk; its next save overwrites. */
  keepBufferOverDisk: (path: string) => Promise<void>;
  /** Applies changes the file watcher reported. */
  handleFsEvent: (event: WorkspaceFsEvent) => Promise<void>;
  openFolder: () => Promise<void>;

  runDeploy: (username: string, checkOnly: boolean) => Promise<void>;
  /**
   * Offers to save unsaved buffers before a deploy, which sends what is on
   * disk. Resolves false when the deploy should not start.
   */
  saveBeforeDeploy: () => Promise<boolean>;
  runTerminalCommand: (line: string) => Promise<void>;
  /** The terminal command running now, if any. */
  terminalRun: { runId: string; line: string } | null;
  /** Lines run in the terminal this session, most recent last. */
  terminalHistory: string[];
  cancelTerminalCommand: () => void;
  /** Applies streamed output, and the end, of a terminal command. */
  handleTerminalEvent: (event: TerminalEvent) => void;
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

  /** Files changed since the workspace last matched its org. */
  changes: WorkspaceChanges | null;
  changesLoading: boolean;
  changesError: string | null;
  loadChanges: () => Promise<void>;
  /** Takes the current tree as matching the org. */
  resetBaseline: () => Promise<void>;
  /** Deploys every modified and added file. */
  deployChangedFiles: () => Promise<void>;
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

/**
 * Incremented whenever a different workspace is opened.
 *
 * Async work records the epoch it started in and drops its result if the
 * epoch moved on. Without it, a file read still in flight during a switch
 * landed in the new workspace's cache under the same relative path — per-org
 * trees share paths — so the previous org's source could be shown, then saved
 * into the new org's folder.
 */
let workspaceEpoch = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    next[remapPath(key, from, to)] = value;
  }
  return next;
}

const EMPTY_CURSOR: CursorPosition = { line: 1, column: 1 };

/** Terminal lines kept for ↑/↓ recall. Not saved: they can hold record ids. */
const TERMINAL_HISTORY_SIZE = 50;

const EMPTY_SELECTION: ExplorerSelection = {
  paths: [],
  anchor: null,
  focus: null,
  focusIndex: 0,
};

/** A selection of `paths`, focused on the last, keeping the focus position. */
function selectionOf(
  paths: string[],
  previous: ExplorerSelection,
): ExplorerSelection {
  const focus = paths.at(-1) ?? previous.focus;
  return {
    paths,
    anchor: paths[0] ?? null,
    focus,
    focusIndex: previous.focusIndex,
  };
}

/** `folder` and every folder above it, so its contents are on screen. */
function withAncestors(folder: string): string[] {
  return folder ? [...getAncestors(folder), folder] : [];
}

/**
 * Confirms before an action that discards unsaved editor buffers.
 *
 * Opening a different folder used to clear `dirty` outright, losing edits with
 * no prompt; switching projects would have walked the same path.
 */
async function confirmDiscardUnsaved(
  dirty: Record<string, boolean>,
): Promise<boolean> {
  const paths = Object.entries(dirty)
    .filter(([, isDirty]) => isDirty)
    .map(([path]) => path);
  if (paths.length === 0) return true;

  return confirm({
    title: `Discard unsaved changes in ${paths.length} file${paths.length === 1 ? "" : "s"}?`,
    message: "Switching workspaces closes these files without saving them.",
    details: previewList(paths),
    confirmLabel: "Discard and switch",
    tone: "danger",
  });
}

/** State reset shared by every "open a different project" path. */
function emptyWorkspaceState() {
  return {
    loaded: false,
    files: [] as WorkspaceFile[],
    openFiles: [] as string[],
    selectedFile: null as string | null,
    fileContents: {} as Record<string, string>,
    savedContents: {} as Record<string, string>,
    loadingContent: {} as Record<string, boolean>,
    loadErrors: {} as Record<string, string>,
    dirty: {} as Record<string, boolean>,
    fileStamps: {} as Record<string, FileStamp>,
    diskConflicts: {} as Record<string, boolean>,
    packageDirectories: [] as string[],
    clipboard: null as WorkspaceState["clipboard"],
    expandedFolders: new Set<string>(),
    explorerSelection: EMPTY_SELECTION,
    loadedFolders: new Set<string>(),
    loadingFolders: new Set<string>(),
    fullyLoaded: false,
    error: null as string | null,
    diffSession: null as DiffSession | null,
    diffError: null as string | null,
    diffLoading: false,
    changes: null as WorkspaceChanges | null,
    changesError: null as string | null,
    changesLoading: false,
  };
}

/** The org that owns a workspace, when it is one the app knows. */
function ownerOf(workspace: Workspace | undefined): Organization | undefined {
  if (!workspace?.orgId) return undefined;
  return useOrganizationStore
    .getState()
    .organizations.find((org) => org.id === workspace.orgId);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** The workspace and epoch an async operation belongs to. */
  function scope() {
    return { id: get().openWorkspaceId, epoch: workspaceEpoch };
  }

  /** Whether an operation's workspace is still the open one. */
  function isCurrent(started: { epoch: number }): boolean {
    return started.epoch === workspaceEpoch;
  }

  /** The registry entry for the open workspace. */
  function openWorkspace(): Workspace | undefined {
    const { workspaces, openWorkspaceId } = get();
    return workspaces.find((item) => item.id === openWorkspaceId);
  }

  /**
   * Reports a failed file operation in the terminal and as a notice: the
   * terminal panel is often closed while working in the explorer.
   */
  function reportFailure(title: string, error: unknown) {
    const message = errorMessage(error);
    get().appendLog(`${title} — ${message}`, "error", "terminal");
    toast.error(message, { title });
  }

  /**
   * Moves open tabs, buffers, loaded folders and the explorer clipboard along
   * with renamed or moved paths.
   */
  function followPathChanges(changes: PathChange[]) {
    set((state) => {
      let next = {
        openFiles: state.openFiles,
        selectedFile: state.selectedFile,
        fileContents: state.fileContents,
        savedContents: state.savedContents,
        loadingContent: state.loadingContent,
        loadErrors: state.loadErrors,
        dirty: state.dirty,
        fileStamps: state.fileStamps,
        diskConflicts: state.diskConflicts,
        loadedFolders: state.loadedFolders,
        expandedFolders: state.expandedFolders,
        explorerSelection: state.explorerSelection,
        clipboard: state.clipboard,
      };
      for (const { from, to } of changes) {
        const remap = (path: string) => remapPath(path, from, to);
        const selection = next.explorerSelection;
        next = {
          openFiles: next.openFiles.map((item) => remapPath(item, from, to)),
          selectedFile:
            next.selectedFile === null
              ? null
              : remapPath(next.selectedFile, from, to),
          fileContents: remapKeys(next.fileContents, from, to),
          savedContents: remapKeys(next.savedContents, from, to),
          loadingContent: remapKeys(next.loadingContent, from, to),
          loadErrors: remapKeys(next.loadErrors, from, to),
          dirty: remapKeys(next.dirty, from, to),
          fileStamps: remapKeys(next.fileStamps, from, to),
          diskConflicts: remapKeys(next.diskConflicts, from, to),
          // A folder read under its old name would otherwise be read again,
          // and one created later under that name never would be.
          loadedFolders: new Set([...next.loadedFolders].map(remap)),
          // A renamed or moved folder stays open, and a selected item stays
          // selected under its new path.
          expandedFolders: new Set([...next.expandedFolders].map(remap)),
          explorerSelection: {
            paths: selection.paths.map(remap),
            anchor: selection.anchor === null ? null : remap(selection.anchor),
            focus: selection.focus === null ? null : remap(selection.focus),
            focusIndex: selection.focusIndex,
          },
          clipboard: next.clipboard && {
            ...next.clipboard,
            paths: next.clipboard.paths.map(remap),
          },
        };
      }
      return next;
    });
  }

  /**
   * Drops open tabs, buffers, loaded folders and clipboard entries for removed
   * paths (and anything inside them).
   */
  function forgetPaths(removed: string[]) {
    set((state) => {
      const gone = (file: string) =>
        removed.some((target) => isWithin(file, target));
      const keep = <T>(map: Record<string, T>) =>
        Object.fromEntries(Object.entries(map).filter(([key]) => !gone(key)));
      const openFiles = state.openFiles.filter((file) => !gone(file));
      const clipboardPaths =
        state.clipboard?.paths.filter((path) => !gone(path)) ?? [];
      return {
        openFiles,
        selectedFile:
          state.selectedFile && gone(state.selectedFile)
            ? (openFiles[0] ?? null)
            : state.selectedFile,
        fileContents: keep(state.fileContents),
        savedContents: keep(state.savedContents),
        dirty: keep(state.dirty),
        loadErrors: keep(state.loadErrors),
        fileStamps: keep(state.fileStamps),
        diskConflicts: keep(state.diskConflicts),
        loadedFolders: new Set(
          [...state.loadedFolders].filter((folder) => !gone(folder)),
        ),
        expandedFolders: new Set(
          [...state.expandedFolders].filter((folder) => !gone(folder)),
        ),
        // Focus keeps its stale path on purpose: the explorer then settles on
        // the row now at the same position, the one after what was removed.
        explorerSelection: {
          ...state.explorerSelection,
          paths: state.explorerSelection.paths.filter((path) => !gone(path)),
          anchor:
            state.explorerSelection.anchor &&
            gone(state.explorerSelection.anchor)
              ? null
              : state.explorerSelection.anchor,
        },
        clipboard:
          state.clipboard && clipboardPaths.length > 0
            ? { ...state.clipboard, paths: clipboardPaths }
            : null,
      };
    });
  }

  /**
   * Re-reads one folder ("" for the root) after its contents changed, keeping
   * what is loaded beneath it. A folder whose contents were never read only
   * learns that it has some now.
   */
  async function reloadFolder(folder: string) {
    const started = scope();
    // Judged by the tree, not `loadedFolders`: a full read for filtering
    // fills in every folder without listing them there.
    if (
      folder !== "" &&
      findNode(get().files, folder)?.children === undefined
    ) {
      set((state) => ({ files: markHasChildren(state.files, folder) }));
      return;
    }
    try {
      const nodes = (await loadWorkspaceFiles(folder, 1, started.id)).map(
        mapNode,
      );
      if (!isCurrent(started)) return;
      const present = new Set(nodes.map((node) => node.path));
      set((state) => ({
        files:
          folder === ""
            ? mergeLoaded(state.files, nodes)
            : setChildren(
                state.files,
                folder,
                mergeLoaded(findNode(state.files, folder)?.children, nodes),
              ),
        // Subfolders that are gone take their loaded state with them, so a
        // folder recreated under the same name is read again.
        loadedFolders: new Set(
          [...state.loadedFolders].filter((loaded) => {
            const top = childWithin(loaded, folder);
            return top === null || present.has(top);
          }),
        ),
      }));
    } catch {
      // The folder itself is gone; reloading its parent removes it.
    }
  }

  /** The package directories deployable metadata lives in. */
  async function loadPackageDirectories() {
    const started = scope();
    try {
      const packageDirectories = await workspacePackageDirectories(started.id);
      if (isCurrent(started)) set({ packageDirectories });
    } catch {
      // Without them the explorer just offers deploy everywhere, as before.
    }
  }

  /**
   * Follows the open workspace for changes made outside the app. Started
   * whenever a workspace opens; a watch on another folder is replaced.
   */
  function startWatching() {
    if (!isTauriRuntime) return;
    const id = get().openWorkspaceId;
    void watchWorkspace(id).catch((error: unknown) =>
      get().appendLog(
        `Changes made outside ForgeSF won't show until you refresh — ${errorMessage(error)}`,
        "warning",
        "system",
      ),
    );
  }

  /**
   * Brings one open buffer in line with the file on disk. A buffer without
   * edits simply takes the new content; one with edits keeps them and is
   * flagged, because overwriting either side silently loses work.
   */
  async function syncBufferWithDisk(path: string) {
    const started = scope();
    try {
      const { content, stamp } = await loadWorkspaceFileContent(
        path,
        started.id,
      );
      if (!isCurrent(started)) return;
      const state = get();
      if (state.savedContents[path] === undefined) return;

      if (content === state.savedContents[path]) {
        set({ fileStamps: { ...state.fileStamps, [path]: stamp } });
        return;
      }
      if (state.dirty[path]) {
        set({ diskConflicts: { ...state.diskConflicts, [path]: true } });
        return;
      }
      set({
        fileContents: { ...state.fileContents, [path]: content },
        savedContents: { ...state.savedContents, [path]: content },
        fileStamps: { ...state.fileStamps, [path]: stamp },
      });
    } catch (error) {
      if (!isCurrent(started)) return;
      const state = get();
      if (state.dirty[path]) {
        set({ diskConflicts: { ...state.diskConflicts, [path]: true } });
      } else {
        // Deleted or no longer readable: the tab shows why instead of text.
        set({
          loadErrors: { ...state.loadErrors, [path]: errorMessage(error) },
        });
      }
    }
  }

  /**
   * Whether renaming an Apex class or trigger file should rename it inside
   * the file too. Salesforce only deploys `Bar.cls` when it declares `class
   * Bar`, but other files that use the old name are not changed, so the user
   * decides. Resolves null when they cancel the rename altogether.
   */
  async function askRenameInFile(
    from: string,
    newName: string,
    workspaceId: string | null,
  ): Promise<boolean | null> {
    const oldName = getBaseName(from);
    const kind = apexKind(oldName);
    if (!kind || apexKind(newName) !== kind) return false;
    const oldStem = apexStem(oldName);
    const newStem = apexStem(newName);
    // A change of letter case alone deploys fine: Apex ignores case.
    if (oldStem.toLowerCase() === newStem.toLowerCase()) return false;
    if (!isApexName(newStem)) return false;

    const declared = await apexDeclaredName(from, workspaceId).catch(
      () => null,
    );
    if (!declared || declared.toLowerCase() !== oldStem.toLowerCase()) {
      return false;
    }

    const noun = kind === "cls" ? "class" : "trigger";
    const unsaved = Boolean(get().dirty[from]);
    const choice = await ask({
      title: `Rename the ${noun} inside ${oldName} too?`,
      message: [
        `${oldName} declares ${noun} ${declared}. Salesforce only deploys it when that name matches the file name.`,
        kind === "cls"
          ? `Renaming changes ${declared} to ${newStem} in its declaration, constructors and other uses in this file. Other files that use ${declared} are not changed.`
          : `Other files that mention ${declared} are not changed.`,
        unsaved ? "Its unsaved changes are saved first." : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      actions: [
        { value: "file", label: "Rename file only", variant: "secondary" },
        {
          value: "both",
          label: unsaved ? "Save and rename both" : "Rename both",
        },
      ],
    });
    if (choice === null) return null;
    if (choice === "file") return false;
    if (unsaved && !(await get().saveFile(from))) return null;
    return true;
  }

  /**
   * Writes a buffer. Unless `force`d, the save is refused when the file
   * changed on disk since it was read, and the user picks which version wins.
   */
  async function saveBuffer(path: string, force: boolean): Promise<boolean> {
    const state = get();
    const content = state.fileContents[path];
    if (content === undefined) return false;

    // A buffer that never loaded from disk is not the file's content. Saving
    // it would overwrite a binary or unreadable file with editor text, or
    // recreate a file deleted outside the app.
    if (state.savedContents[path] === undefined || state.loadErrors[path]) {
      get().appendLog(
        `Not saving ${path} — its content was never loaded from disk.`,
        "warning",
        "terminal",
      );
      return false;
    }

    const started = scope();
    set({ saveStatus: "saving" });
    try {
      // Written to the workspace the buffer came from, even if a switch
      // started meanwhile.
      const stamp = await saveWorkspaceFileContent(
        path,
        content,
        started.id,
        force ? null : (state.fileStamps[path] ?? null),
      );
      if (!isCurrent(started)) {
        get().appendLog(`Saved ${path}`, "success", "terminal");
        return true;
      }
      set((current) => {
        const nextDirty = { ...current.dirty };
        const buffer = current.fileContents[path];
        // Only what was written counts as saved. Keystrokes that landed
        // while the write was in flight stay dirty, rather than being
        // marked clean and then discarded on close.
        if (buffer === undefined || buffer === content) {
          delete nextDirty[path];
        } else {
          nextDirty[path] = true;
        }
        const diskConflicts = { ...current.diskConflicts };
        delete diskConflicts[path];
        return {
          dirty: nextDirty,
          // A tab closed mid-save has no buffer; recording a saved copy for
          // it would make a later reopen render "" instead of reloading.
          savedContents:
            buffer === undefined
              ? current.savedContents
              : { ...current.savedContents, [path]: content },
          fileStamps:
            buffer === undefined
              ? current.fileStamps
              : { ...current.fileStamps, [path]: stamp },
          diskConflicts,
          saveStatus: "saved",
        };
      });
      get().appendLog(`Saved ${path}`, "success", "terminal");
      // A saved edit is a pending change; keep the open panel current.
      if (get().activeView === "scm") void get().loadChanges();
      // Return to idle so the status bar stops claiming "Saved" forever.
      window.setTimeout(() => {
        if (useWorkspaceStore.getState().saveStatus === "saved") {
          useWorkspaceStore.setState({ saveStatus: "idle" });
        }
      }, 2000);
      return true;
    } catch (error) {
      if (isChangedOnDisk(error) && isCurrent(started)) {
        set({ saveStatus: "idle" });
        const choice = await ask({
          title: `${getBaseName(path)} changed on disk`,
          message:
            "It was changed or deleted outside ForgeSF after you opened it — by a " +
            "retrieve, git, or another editor. Overwrite it with your version, or " +
            "reload it from disk and lose your unsaved edits.",
          details: [path],
          actions: [
            {
              value: "reload",
              label: "Reload from disk",
              variant: "secondary",
            },
            { value: "overwrite", label: "Overwrite", variant: "danger" },
          ],
          focus: "cancel",
        });
        if (choice === "overwrite") return saveBuffer(path, true);
        if (choice === "reload") await get().reloadFromDisk(path);
        return false;
      }
      const message = errorMessage(error);
      set({ saveStatus: "error" });
      get().appendLog(
        `Failed to save ${path} — ${message}`,
        "error",
        "terminal",
      );
      return false;
    }
  }

  /**
   * Offers to save unsaved buffers before a deploy.
   *
   * A deploy sends what is on disk. Deploying with unsaved edits open used to
   * send the older saved copy without a word, so the change you were looking
   * at was not the change that went out. Returns false to stop the deploy.
   */
  async function saveBeforeDeploy(): Promise<boolean> {
    const unsaved = Object.keys(get().dirty);
    if (unsaved.length === 0) return true;

    const proceed = await confirm({
      title: "Save changes before deploying?",
      message:
        "A deploy sends what is saved on disk, not what is open in the editor.",
      details: previewList(unsaved),
      confirmLabel: "Save and deploy",
    });
    if (!proceed) return false;

    await get().saveAll();
    if (Object.keys(get().dirty).length > 0) {
      get().appendLog(
        "Some files could not be saved, so the deploy did not start.",
        "error",
        "deploy",
      );
      return false;
    }
    return true;
  }

  /**
   * Runs a deploy or validation as a background job and reports its outcome
   * in the terminal. The job is also listed, with full results, on the
   * Deployments page.
   */
  async function runDeployJob(input: {
    username: string;
    alias: string;
    scope: DeployScope;
    checkOnly: boolean;
    label: string;
  }) {
    const started = scope();
    const { appendLog } = get();
    const noun = input.checkOnly ? "Validation" : "Deployment";

    set({ deploying: true });
    appendLog(
      `🚀 ${input.checkOnly ? "Validating" : "Deploying"} ${input.label} → ${input.alias}…`,
      "cmd",
      "deploy",
    );

    try {
      const jobs = useDeployJobsStore.getState();
      const record = await jobs.start({
        username: input.username,
        workspaceId: started.id,
        options: {
          scope: input.scope,
          checkOnly: input.checkOnly,
          testLevel: null,
          tests: [],
          ignoreWarnings: false,
          label: input.label,
        },
      });
      appendLog(
        `Job ${record.jobId} started. It keeps running if you leave this page; results are on the Deployments page.`,
        "info",
        "deploy",
      );

      const report = await jobs.watch(record);
      if (!report) {
        appendLog(
          `Lost track of job ${record.jobId}. Check it on the Deployments page.`,
          "warning",
          "deploy",
        );
        return;
      }

      const ok = succeeded(report.status);
      appendLog(describeProgress(report), ok ? "success" : "error", "deploy");
      for (const failure of report.componentFailures.slice(0, 20)) {
        const where = failure.line ? ` (line ${failure.line})` : "";
        appendLog(
          `${failure.componentType} ${failure.fullName}${where}: ${failure.problem}`,
          "error",
          "deploy",
        );
      }
      for (const failure of report.testFailures.slice(0, 20)) {
        appendLog(
          `Test ${failure.className}.${failure.methodName}: ${failure.message}`,
          "error",
          "deploy",
        );
      }
      if (report.errorMessage && !ok) {
        appendLog(report.errorMessage, "error", "deploy");
      }

      appendLog(
        ok
          ? `✅ ${noun} of ${input.label} succeeded.`
          : `❌ ${noun} of ${input.label} finished as ${report.status}.`,
        ok ? "success" : "error",
        "deploy",
      );
      if (ok && input.checkOnly) {
        appendLog(
          "Validated — quick deploy it from the Deployments page without running the tests again.",
          "info",
          "deploy",
        );
      }
      if (ok && !input.checkOnly && isCurrent(started)) {
        void get().loadChanges();
      }
    } catch (error) {
      appendLog(errorMessage(error), "error", "deploy");
      appendLog(
        `❌ ${noun} of ${input.label} did not start.`,
        "error",
        "deploy",
      );
    } finally {
      set({ deploying: false });
    }
  }

  return {
    files: [],
    loaded: false,
    booting: false,
    loading: false,
    error: null,
    workspaceName: "",
    workspaceRoot: "",
    openWorkspaceId: null,

    selectedFile: null,
    openFiles: [],
    fileContents: {},
    savedContents: {},
    loadingContent: {},
    loadErrors: {},
    dirty: {},
    saveStatus: "idle",
    fileStamps: {},
    diskConflicts: {},
    packageDirectories: [],
    clipboard: null,
    expandedFolders: new Set<string>(),
    explorerSelection: EMPTY_SELECTION,
    editorInfo: null,
    editorReveal: null,
    quickInput: null,
    searchFocusSeq: 0,

    activeView: "explorer",
    sidebarVisible: true,
    panelOpen: true,
    cursorPosition: EMPTY_CURSOR,
    revealRequest: null,

    logs: [],
    deploying: false,
    terminalRun: null,
    terminalHistory: [],

    loadedFolders: new Set<string>(),
    loadingFolders: new Set<string>(),
    fullyLoaded: false,

    workspaces: [],
    activeWorkspaceId: null,

    diffSession: null,
    diffLoading: false,
    diffError: null,

    changes: null,
    changesLoading: false,
    changesError: null,

    initWorkspace: async () => {
      if (get().booting || get().loaded) return;
      set({ booting: true, error: null });

      try {
        // An org switch already opening a workspace wins; opening the active
        // one in parallel would race it and load the tree twice.
        await waitForWorkspaceSync();
        if (get().loaded) return;

        if (!get().activeWorkspaceId) await get().loadWorkspaces();
        const id = get().activeWorkspaceId;
        workspaceEpoch += 1;
        set({ openWorkspaceId: id });

        const root = await getWorkspaceRoot(id);
        get().appendLog(`Opening workspace — ${root}`, "info", "system");
        set({
          workspaceRoot: root,
          workspaceName: getBaseName(root),
        });
        await get().refreshFiles();
        void loadPackageDirectories();
        startWatching();
        if (!isTauriRuntime) {
          get().appendLog(
            "Running outside Tauri — file operations need the desktop shell.",
            "warning",
            "system",
          );
        }
      } catch (error) {
        const message = errorMessage(error);
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
      const started = scope();
      set({ loading: true, error: null });
      try {
        const nextFiles = (await loadWorkspaceFiles("", 1, started.id)).map(
          mapNode,
        );
        if (!isCurrent(started)) return;

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
        if (!isCurrent(started)) return;
        const message = errorMessage(error);
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
      const started = scope();
      set({ loading: true });
      try {
        // One deep read. Filtering has to match files the user has never
        // expanded to, so it pays for the full walk once rather than the
        // explorer paying for it on every open.
        const nodes = (await loadWorkspaceFiles("", 64, started.id)).map(
          mapNode,
        );
        if (!isCurrent(started)) return;
        set({ files: nodes, fullyLoaded: true, loading: false });
      } catch (error) {
        if (!isCurrent(started)) return;
        set({ loading: false });
        get().appendLog(
          `Failed to read the workspace tree — ${errorMessage(error)}`,
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

      const started = scope();
      set({ loadingFolders: new Set(state.loadingFolders).add(target) });

      try {
        const children = (await loadWorkspaceFiles(target, 1, started.id)).map(
          mapNode,
        );
        if (!isCurrent(started)) return;
        set((current) => {
          const loadingFolders = new Set(current.loadingFolders);
          loadingFolders.delete(target);
          // Gone from the tree meanwhile (a refresh, a move): not loaded, or
          // the folder would never be read again once it reappears.
          if (!findNode(current.files, target)) return { loadingFolders };
          return {
            files: setChildren(current.files, target, children),
            loadedFolders: new Set(current.loadedFolders).add(target),
            loadingFolders,
          };
        });
      } catch (error) {
        if (!isCurrent(started)) return;
        set((current) => {
          const loadingFolders = new Set(current.loadingFolders);
          loadingFolders.delete(target);
          return { loadingFolders };
        });
        get().appendLog(
          `Failed to read ${target} — ${errorMessage(error)}`,
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
        // A newly active file is shown in the explorer: its folders open and
        // it becomes the selection. Re-selecting the active file (a reload
        // after a retrieve) leaves a multi-selection alone.
        ...(cleanPath !== state.selectedFile
          ? {
              expandedFolders: new Set([
                ...state.expandedFolders,
                ...getAncestors(cleanPath),
              ]),
              explorerSelection: selectionOf(
                [cleanPath],
                state.explorerSelection,
              ),
            }
          : {}),
      });

      // Lazy-load the file content on first open. Both maps are checked: a
      // buffer is only usable when the on-disk copy *and* the editor copy
      // exist, otherwise the editor would render "" for a file with content.
      if (
        (state.savedContents[cleanPath] === undefined ||
          state.fileContents[cleanPath] === undefined) &&
        !state.loadingContent[cleanPath]
      ) {
        const started = scope();
        set((current) => {
          const loadErrors = { ...current.loadErrors };
          delete loadErrors[cleanPath];
          return {
            loadingContent: {
              ...current.loadingContent,
              [cleanPath]: true,
            },
            loadErrors,
          };
        });

        try {
          const { content, stamp } = await loadWorkspaceFileContent(
            cleanPath,
            started.id,
          );
          // Read from a workspace that is no longer open: its content must
          // not become a buffer in the one that is.
          if (!isCurrent(started)) return;
          set((current) => ({
            fileContents: { ...current.fileContents, [cleanPath]: content },
            savedContents: { ...current.savedContents, [cleanPath]: content },
            fileStamps: { ...current.fileStamps, [cleanPath]: stamp },
            loadingContent: {
              ...current.loadingContent,
              [cleanPath]: false,
            },
          }));
        } catch (error) {
          if (!isCurrent(started)) return;
          const message = errorMessage(error);
          // Recorded so the editor shows a read-only notice instead of an
          // empty, editable buffer that a save would write over the real file.
          set((current) => ({
            loadingContent: {
              ...current.loadingContent,
              [cleanPath]: false,
            },
            loadErrors: { ...current.loadErrors, [cleanPath]: message },
          }));
          get().appendLog(
            `Failed to read ${cleanPath} — ${message}`,
            "error",
            "terminal",
          );
        }
      }
    },

    /**
     * Closes a tab and discards its buffer.
     *
     * Callers confirm "Close without saving?" before this runs for a dirty
     * file. Dirty buffers used to be kept anyway, so edits the user had just
     * chosen to discard stayed in Pending Changes and came back on reopen.
     */
    closeFile: (path) =>
      set((state) => {
        const nextOpenFiles = state.openFiles.filter((file) => file !== path);

        const nextSelected =
          state.selectedFile === path
            ? (nextOpenFiles[0] ?? null)
            : state.selectedFile;

        const without = <T>(map: Record<string, T>) => {
          const next = { ...map };
          delete next[path];
          return next;
        };

        return {
          openFiles: nextOpenFiles,
          selectedFile: nextSelected,
          fileContents: without(state.fileContents),
          savedContents: without(state.savedContents),
          dirty: without(state.dirty),
          loadErrors: without(state.loadErrors),
          fileStamps: without(state.fileStamps),
          diskConflicts: without(state.diskConflicts),
        };
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
        // No loaded copy means nothing to edit (see `saveFile`).
        if (state.savedContents[path] === undefined) return state;

        // `dirty` is only replaced when a file turns dirty or clean. The
        // explorer, tabs, toolbar and status bar all subscribe to it, and a
        // new object on every keystroke re-rendered each of them as you typed.
        const isDirty = state.savedContents[path] !== content;
        let dirty = state.dirty;
        if (isDirty !== Boolean(state.dirty[path])) {
          dirty = { ...state.dirty };
          if (isDirty) dirty[path] = true;
          else delete dirty[path];
        }
        return {
          fileContents: { ...state.fileContents, [path]: content },
          dirty,
        };
      }),

    saveFile: (path) => saveBuffer(path, false),

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
        const diskConflicts = { ...state.diskConflicts };
        delete diskConflicts[path];
        return {
          dirty: nextDirty,
          diskConflicts,
          ...(saved !== undefined
            ? { fileContents: { ...state.fileContents, [path]: saved } }
            : {}),
        };
      });
      if (saved === undefined) {
        const started = scope();
        try {
          const { content, stamp } = await loadWorkspaceFileContent(
            path,
            started.id,
          );
          if (!isCurrent(started)) return;
          set((state) => ({
            fileContents: { ...state.fileContents, [path]: content },
            savedContents: { ...state.savedContents, [path]: content },
            fileStamps: { ...state.fileStamps, [path]: stamp },
          }));
        } catch (error) {
          get().appendLog(
            `Could not revert ${path} — ${errorMessage(error)}`,
            "error",
            "terminal",
          );
        }
      }
      get().appendLog(`Reverted ${path}`, "info", "terminal");
    },

    reloadCleanBuffers: async () => {
      // Buffers with unsaved edits are kept: the retrieve confirmed first
      // that it would overwrite those files on disk.
      set((state) => {
        const keep = <T>(map: Record<string, T>) =>
          Object.fromEntries(
            Object.entries(map).filter(([path]) => state.dirty[path]),
          );
        return {
          fileContents: keep(state.fileContents),
          savedContents: keep(state.savedContents),
          fileStamps: keep(state.fileStamps),
          loadErrors: {},
        };
      });
      const selected = get().selectedFile;
      if (selected) await get().selectFile(selected);
    },

    createItem: async (parentPath, name, isFolder) => {
      const cleanParent = normalizePath(parentPath);
      const base = name.trim();
      if (!base) return false;

      const fullPath = cleanParent ? `${cleanParent}/${base}` : base;
      const started = scope();

      try {
        // New Apex or Visualforce comes back with its -meta.xml as well.
        const created = await createWorkspaceItem(
          fullPath,
          isFolder,
          started.id,
        );
        if (!isCurrent(started)) return true;
        set((state) => {
          let files = state.files;
          for (const path of created) {
            files = addNode(files, getParentPath(path), {
              path,
              name: getBaseName(path),
              type: isFolder && path === fullPath ? "folder" : "file",
              children: isFolder && path === fullPath ? [] : undefined,
            });
          }
          return { files };
        });
        get().appendLog(
          `${isFolder ? "Folder" : "File"} created — ${created.join(", ")}`,
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
        reportFailure(`Could not create ${base}`, error);
        return false;
      }
    },

    withCompanions: async (paths) => {
      try {
        return await includeCompanions(
          paths.map(normalizePath),
          get().openWorkspaceId,
        );
      } catch {
        // The confirmation still lists what was selected.
        return paths;
      }
    },

    deleteItems: async (paths) => {
      if (paths.length === 0) return false;
      const started = scope();
      try {
        const removed = await deleteWorkspaceItems(
          paths.map(normalizePath),
          started.id,
        );
        get().appendLog(`Deleted ${removed.join(", ")}`, "success", "terminal");
        if (!isCurrent(started)) return true;

        set((state) => ({
          files: removed.reduce(
            (files, path) => removeNode(files, path),
            state.files,
          ),
        }));
        forgetPaths(removed);
        if (get().activeView === "scm") void get().loadChanges();
        return true;
      } catch (error) {
        reportFailure("Could not delete", error);
        // Part of it may have gone before the failure.
        await get().refreshFiles();
        return false;
      }
    },

    renameItem: async (path, newName) => {
      const from = normalizePath(path);
      const base = newName.trim();
      if (!base || base.includes("/")) return null;

      const started = scope();
      try {
        const renameInFile = await askRenameInFile(from, base, started.id);
        if (renameInFile === null) return null;

        const { changes, renamedUses } = await renameWorkspaceItem(
          from,
          base,
          started.id,
          renameInFile,
        );
        if (changes.length === 0) return [];
        get().appendLog(
          changes
            .map((change) => `Renamed ${change.from} → ${change.to}`)
            .join("\n"),
          "success",
          "terminal",
        );
        if (renamedUses > 0) {
          get().appendLog(
            `Renamed ${apexStem(getBaseName(from))} → ${apexStem(base)} inside ${changes[0].to} (${renamedUses} place${renamedUses === 1 ? "" : "s"})`,
            "success",
            "terminal",
          );
        }
        if (!isCurrent(started)) return changes;

        // In order: a bundle's folder first, then the files inside it, which
        // are addressed by the folder's new path.
        set((state) => ({
          files: changes.reduce(
            (files, change) => mapTreePaths(files, change.from, change.to),
            state.files,
          ),
        }));
        followPathChanges(changes);
        // An open tab shows the renamed class straight away.
        if (renamedUses > 0) await syncBufferWithDisk(changes[0].to);
        return changes;
      } catch (error) {
        reportFailure(`Could not rename ${getBaseName(from)}`, error);
        return null;
      }
    },

    moveItems: async (paths, targetFolder) => {
      if (paths.length === 0) return null;
      const target = normalizePath(targetFolder);
      const started = scope();
      try {
        const changes = await moveWorkspaceItems(
          paths.map(normalizePath),
          target,
          started.id,
        );
        if (changes.length === 0) return [];
        get().appendLog(
          `Moved ${changes.map((change) => change.from).join(", ")} → ${target || "the workspace root"}`,
          "success",
          "terminal",
        );
        if (!isCurrent(started)) return changes;

        set((state) => ({
          files: changes.reduce(
            (files, change) => removeNode(files, change.from),
            state.files,
          ),
          // Moved folders are read again where they landed.
          loadedFolders: new Set(
            [...state.loadedFolders].filter(
              (folder) =>
                !changes.some((change) => isWithin(folder, change.from)),
            ),
          ),
        }));
        followPathChanges(changes);
        // What moved is shown where it went: its new folder opens, and the
        // items that were dragged become the selection.
        const moved = changes
          .filter((change) => paths.map(normalizePath).includes(change.from))
          .map((change) => change.to);
        get().expandFolders(withAncestors(target));
        set((state) => ({
          explorerSelection: selectionOf(moved, state.explorerSelection),
        }));
        await reloadFolder(target);
        if (get().activeView === "scm") void get().loadChanges();
        return changes;
      } catch (error) {
        reportFailure("Could not move", error);
        return null;
      }
    },

    copyItems: async (paths, targetFolder) => {
      if (paths.length === 0) return null;
      const target = normalizePath(targetFolder);
      const started = scope();
      try {
        const { created, renamedIn } = await copyWorkspaceItems(
          paths.map(normalizePath),
          target,
          started.id,
        );
        get().appendLog(
          `Copied to ${created.join(", ")}`,
          "success",
          "terminal",
        );
        for (const copy of renamedIn) {
          get().appendLog(
            `Renamed ${apexStem(getBaseName(copy))} inside ${copy}, to match its file name`,
            "info",
            "terminal",
          );
        }
        if (!isCurrent(started)) return created;
        await reloadFolder(target);
        if (created[0]) get().revealFile(created[0]);
        // Every copy is selected, not only the one scrolled to.
        set((state) => ({
          explorerSelection: selectionOf(
            created.filter((path) => getParentPath(path) === target),
            state.explorerSelection,
          ),
        }));
        return created;
      } catch (error) {
        reportFailure("Could not copy", error);
        return null;
      }
    },

    setClipboard: (clipboard) => set({ clipboard }),

    pasteInto: async (folder) => {
      const clipboard = get().clipboard;
      if (!clipboard || clipboard.paths.length === 0) return null;
      if (clipboard.mode === "copy") {
        const copied = await get().copyItems(clipboard.paths, folder);
        return copied && { copied, moved: [] };
      }
      const moved = await get().moveItems(clipboard.paths, folder);
      if (!moved) return null;
      // A cut is used up by its paste.
      set({ clipboard: null });
      return { copied: [], moved };
    },

    revealItem: async (path) => {
      try {
        await revealWorkspaceItem(normalizePath(path), get().openWorkspaceId);
      } catch (error) {
        reportFailure("Could not show it in the file manager", error);
      }
    },

    reloadFromDisk: async (path) => {
      const started = scope();
      try {
        const { content, stamp } = await loadWorkspaceFileContent(
          path,
          started.id,
        );
        if (!isCurrent(started)) return;
        set((state) => {
          const dirty = { ...state.dirty };
          delete dirty[path];
          const diskConflicts = { ...state.diskConflicts };
          delete diskConflicts[path];
          const loadErrors = { ...state.loadErrors };
          delete loadErrors[path];
          return {
            fileContents: { ...state.fileContents, [path]: content },
            savedContents: { ...state.savedContents, [path]: content },
            fileStamps: { ...state.fileStamps, [path]: stamp },
            dirty,
            diskConflicts,
            loadErrors,
          };
        });
        get().appendLog(`Reloaded ${path} from disk`, "info", "terminal");
      } catch (error) {
        reportFailure(`Could not reload ${getBaseName(path)}`, error);
      }
    },

    keepBufferOverDisk: async (path) => {
      const started = scope();
      try {
        // The disk's current stamp becomes the one the buffer was "read" with,
        // so the next save overwrites instead of asking again.
        const { stamp } = await loadWorkspaceFileContent(path, started.id);
        if (!isCurrent(started)) return;
        set((state) => ({
          fileStamps: { ...state.fileStamps, [path]: stamp },
        }));
      } catch {
        // Deleted on disk: saving recreates it, after asking.
      }
      set((state) => {
        const diskConflicts = { ...state.diskConflicts };
        delete diskConflicts[path];
        return { diskConflicts };
      });
    },

    handleFsEvent: async (event) => {
      const state = get();
      if (!state.loaded || event.workspaceId !== state.openWorkspaceId) return;

      if (event.overflow) {
        // Too much changed to follow one by one (a branch switch): reload.
        await get().refreshFiles();
        for (const path of Object.keys(get().savedContents)) {
          await syncBufferWithDisk(path);
        }
        if (get().activeView === "scm") void get().loadChanges();
        return;
      }

      const changed = event.paths;
      if (changed.length === 0) return;

      // The tree: each folder that holds a change, where it is on screen.
      const folders = [...new Set(changed.map(getParentPath))];
      for (const folder of folders) await reloadFolder(folder);

      // Open files that changed, directly or inside a changed folder.
      const open = Object.keys(get().savedContents).filter((path) =>
        changed.some((item) => isWithin(path, item)),
      );
      for (const path of open) await syncBufferWithDisk(path);

      if (changed.includes("sfdx-project.json")) void loadPackageDirectories();
      if (get().activeView === "scm") void get().loadChanges();
    },

    loadWorkspaces: async () => {
      try {
        const registry = await listWorkspaces();
        set({
          workspaces: registry.workspaces,
          activeWorkspaceId: registry.activeId,
        });
        if (registry.notice) {
          get().appendLog(registry.notice, "warning", "system");
        }
      } catch (error) {
        get().appendLog(
          `Could not read the workspace list — ${errorMessage(error)}`,
          "error",
          "system",
        );
      }
    },

    /** Loads the active project into the editor. */
    openActiveWorkspace: async (name: string) => {
      workspaceEpoch += 1;
      const started = { id: get().activeWorkspaceId, epoch: workspaceEpoch };
      set({ ...emptyWorkspaceState(), openWorkspaceId: started.id });

      await get().refreshFiles();
      const root = await getWorkspaceRoot(started.id).catch(() => "");
      if (!isCurrent(started)) return;
      if (root) {
        set({ workspaceRoot: root, workspaceName: getBaseName(root) });
      }
      void loadPackageDirectories();
      startWatching();

      get().appendLog(`Opened workspace — ${name}`, "success", "system");
    },

    addWorkspace: async () => {
      try {
        const folder = await selectWorkspaceFolder();
        if (!folder) return;
        if (!(await confirmDiscardUnsaved(get().dirty))) return;

        // Binds the chosen folder to the current org, so "Open folder…"
        // repoints that org at your own repo instead of the auto-created one.
        const orgId =
          useOrganizationStore.getState().selectedOrganization?.id ?? null;
        const entry = await registerWorkspace(folder, orgId);
        await get().loadWorkspaces();
        await get().openActiveWorkspace(entry.name);
      } catch (error) {
        get().appendLog(
          `Failed to open folder — ${errorMessage(error)}`,
          "error",
          "system",
        );
      }
    },

    /** `openFolder` is the older name for the same action. */
    openFolder: async () => {
      await get().addWorkspace();
    },

    switchWorkspace: async (id) => {
      if (id === get().openWorkspaceId) return;
      if (!(await confirmDiscardUnsaved(get().dirty))) return;

      try {
        const entry = await setActiveWorkspace(id);
        await get().loadWorkspaces();
        await get().openActiveWorkspace(entry.name);
        selectOwningOrg(entry);
      } catch (error) {
        get().appendLog(
          `Could not switch workspace — ${errorMessage(error)}`,
          "error",
          "system",
        );
      }
    },

    removeWorkspace: async (id) => {
      const wasOpen = get().openWorkspaceId === id;
      if (wasOpen && !(await confirmDiscardUnsaved(get().dirty))) return;

      try {
        const registry = await forgetWorkspace(id);
        set({
          workspaces: registry.workspaces,
          activeWorkspaceId: registry.activeId,
        });
        // Removing the open project promotes another one, so the editor has
        // to follow — and so does the org, or deploys would target an org
        // whose folder is no longer on screen. Files on disk are untouched.
        if (wasOpen) {
          const next = registry.workspaces.find(
            (item) => item.id === registry.activeId,
          );
          await get().openActiveWorkspace(next?.name ?? "workspace");
          if (next) selectOwningOrg(next);
        }
      } catch (error) {
        get().appendLog(
          `Could not remove workspace — ${errorMessage(error)}`,
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
        if (get().openWorkspaceId === id) {
          const entry = registry.workspaces.find((item) => item.id === id);
          if (entry) set({ workspaceName: entry.name });
        }
      } catch (error) {
        get().appendLog(
          `Could not rename workspace — ${errorMessage(error)}`,
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

      const { selectedOrganization: org, organizations } =
        useOrganizationStore.getState();
      if (!org) {
        get().appendLog(
          "Connect an org before deploying.",
          "warning",
          "deploy",
        );
        return;
      }

      const label = paths.length === 1 ? paths[0] : `${paths.length} items`;

      // Another org's folder is on screen: say so before sending it.
      const mismatch = workspaceOrgMismatchPrompt(
        openWorkspace(),
        org,
        organizations,
      );
      if (mismatch && !(await confirm(mismatch))) return;

      // Sandboxes deploy straight away; Production is the one worth a pause.
      const production = protectionPrompt(
        org,
        `Deploy ${paths.length === 1 ? getBaseName(paths[0]) : label}`,
        "Deploy",
      );
      if (production && !(await confirm(production))) return;

      if (!(await saveBeforeDeploy())) return;

      await runDeployJob({
        username: org.username,
        alias: org.alias,
        scope: { kind: "paths", paths },
        checkOnly: false,
        label,
      });
    },

    loadChanges: async () => {
      const started = scope();
      set({ changesLoading: true, changesError: null });
      try {
        const changes = await workspaceChanges(started.id);
        if (!isCurrent(started)) return;
        set({ changes, changesLoading: false });
      } catch (error) {
        if (!isCurrent(started)) return;
        set({ changesError: errorMessage(error), changesLoading: false });
      }
    },

    resetBaseline: async () => {
      const started = scope();
      set({ changesLoading: true, changesError: null });
      try {
        const changes = await resetWorkspaceBaseline(started.id);
        if (!isCurrent(started)) return;
        set({ changes, changesLoading: false });
        get().appendLog(
          "Marked the workspace as matching the org — pending changes cleared.",
          "info",
          "system",
        );
      } catch (error) {
        if (!isCurrent(started)) return;
        set({ changesError: errorMessage(error), changesLoading: false });
      }
    },

    deployChangedFiles: async () => {
      const changes = get().changes;
      const paths = changes ? [...changes.modified, ...changes.added] : [];
      if (paths.length === 0) {
        get().appendLog(
          "No modified or added files to deploy.",
          "info",
          "deploy",
        );
        return;
      }
      await get().deployPathsAction(paths);
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
        const proceed = await confirm({
          title: "Retrieve over unsaved changes?",
          message:
            "Retrieving replaces these files on disk, and their unsaved edits are dropped.",
          details: previewList(affected),
          confirmLabel: "Retrieve",
          tone: "danger",
        });
        if (!proceed) return;
      }

      const label = paths.length === 1 ? paths[0] : `${paths.length} items`;
      const started = scope();
      get().appendLog(
        `⬇ Retrieving ${label} from ${org.alias}…`,
        "cmd",
        "terminal",
      );

      try {
        const summary = await retrievePaths(org.username, paths, started.id);
        get().appendLog(summary, "success", "terminal");
        get().appendLog(`✅ Retrieved ${label}.`, "success", "terminal");
        if (!isCurrent(started)) return;

        // Drop cached buffers for the retrieved files so the editor shows what
        // actually landed rather than the pre-retrieve copy.
        set((state) => {
          const stale = (file: string) =>
            paths.some((path) => file === path || file.startsWith(`${path}/`));
          const keep = <T>(map: Record<string, T>) =>
            Object.fromEntries(
              Object.entries(map).filter(([file]) => !stale(file)),
            );
          return {
            fileContents: keep(state.fileContents),
            savedContents: keep(state.savedContents),
            dirty: keep(state.dirty),
            loadErrors: keep(state.loadErrors),
          };
        });

        await get().refreshFiles();
        const selected = get().selectedFile;
        if (selected) await get().selectFile(selected);
        // The retrieved files now match the org.
        void get().loadChanges();
      } catch (error) {
        get().appendLog(errorMessage(error), "error", "terminal");
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

      const started = scope();
      set({ diffLoading: true, diffError: null, diffSession: null });
      try {
        const session = await diffWorkspacePath(org.username, path, started.id);
        if (!isCurrent(started)) return;
        set({ diffSession: session, diffLoading: false });
      } catch (error) {
        if (!isCurrent(started)) return;
        set({ diffError: errorMessage(error), diffLoading: false });
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

      const { organizations } = useOrganizationStore.getState();
      const org = organizations.find((item) => item.username === username);
      // An empty username used to reach the CLI as `--target-org ""`.
      if (!org) {
        get().appendLog(
          "Connect an org before deploying.",
          "warning",
          "deploy",
        );
        return;
      }

      // A full-workspace deploy is the broadest action in the app. Validation
      // changes nothing in the org, so only a real deploy asks.
      if (!checkOnly) {
        const mismatch = workspaceOrgMismatchPrompt(
          openWorkspace(),
          org,
          organizations,
        );
        if (mismatch && !(await confirm(mismatch))) return;

        const prompt = protectionPrompt(
          org,
          "Deploy the whole workspace",
          "Deploy",
        );
        if (prompt && !(await confirm(prompt))) return;
      }

      if (!(await saveBeforeDeploy())) return;

      await runDeployJob({
        username: org.username,
        alias: org.alias,
        scope: { kind: "workspace" },
        checkOnly,
        label: "the whole workspace",
      });
    },

    saveBeforeDeploy,

    /**
     * Runs a terminal line as an `sf` command. Its output streams into the
     * terminal as it is printed, and `cancelTerminalCommand` stops it.
     */
    runTerminalCommand: async (line) => {
      const trimmed = line.trim().replace(/^\$?\s*/, "");
      if (!trimmed) return;

      if (get().terminalRun) {
        get().appendLog(
          "A command is still running. Wait for it, or cancel it first.",
          "warning",
          "command",
        );
        return;
      }

      set((state) => ({
        // Most recent last; running a line again moves it to the end.
        terminalHistory: [
          ...state.terminalHistory.filter((item) => item !== trimmed),
          trimmed,
        ].slice(-TERMINAL_HISTORY_SIZE),
      }));

      const args = stripCliName(tokenize(trimmed));

      // Commands that write to an org stop for Production, like every other
      // deploy path in the app.
      const prompt = cliProtectionPrompt(
        args,
        useOrganizationStore.getState().organizations,
      );
      if (prompt && !(await confirm(prompt))) {
        get().appendLog(`$ ${trimmed}`, "cmd", "command");
        get().appendLog("Cancelled.", "warning", "command");
        return;
      }

      const runId = newRunId();
      get().appendLog(`$ ${trimmed}`, "cmd", "command");
      set({ terminalRun: { runId, line: trimmed } });

      try {
        // Output and the outcome arrive as events: `handleTerminalEvent`.
        await startTerminalCommand(args, runId, get().openWorkspaceId);
      } catch (error) {
        // It never started, so no event will end the run.
        if (get().terminalRun?.runId === runId) {
          set({ terminalRun: null });
          get().appendLog(errorMessage(error), "error", "command");
        }
      }
    },

    cancelTerminalCommand: () => {
      const run = get().terminalRun;
      if (!run) return;
      get().appendLog("Cancelling…", "warning", "command");
      void cancelSfCommand(run.runId).catch(() => {});
    },

    handleTerminalEvent: (event) => {
      const run = get().terminalRun;
      if (!run || event.runId !== run.runId) return;

      for (const chunk of event.chunks) {
        if (!chunk.text) continue;
        // The CLI writes warnings and progress to stderr, not only errors.
        get().appendLog(
          chunk.text,
          chunk.stream === "stderr" ? "warning" : "info",
          "command",
        );
      }

      const exit = event.exit;
      if (!exit) return;
      set({ terminalRun: null });
      if (exit.truncated) {
        get().appendLog(
          "The output was too long, so only the start of it is shown.",
          "warning",
          "command",
        );
      }
      if (exit.cancelled) {
        get().appendLog("Cancelled.", "warning", "command");
      } else if (exit.timedOut) {
        get().appendLog(
          "Stopped: the command was still running after an hour.",
          "error",
          "command",
        );
      } else if (exit.code === 0) {
        get().appendLog("Command finished.", "success", "command");
      } else {
        get().appendLog(
          `The command failed${exit.code === null ? "" : ` (exit code ${exit.code})`}.`,
          "error",
          "command",
        );
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
      set((state) => {
        const target = normalizePath(path);
        return {
          // Strictly increasing: two reveals in the same millisecond must
          // still both scroll.
          revealRequest: {
            path: target,
            seq: Math.max(Date.now(), (state.revealRequest?.seq ?? 0) + 1),
          },
          activeView: "explorer",
          sidebarVisible: true,
          expandedFolders: new Set([
            ...state.expandedFolders,
            ...getAncestors(target),
          ]),
          explorerSelection: selectionOf([target], state.explorerSelection),
        };
      }),

    // Contents are read by the explorer as expanded folders come on screen,
    // parents before children: a folder read before its parent is in the tree
    // has nowhere to put its entries.
    setFolderExpanded: (path, expanded) => {
      const target = normalizePath(path);
      set((state) => {
        if (state.expandedFolders.has(target) === expanded) return state;
        const expandedFolders = new Set(state.expandedFolders);
        if (expanded) expandedFolders.add(target);
        else expandedFolders.delete(target);
        return { expandedFolders };
      });
    },

    expandFolders: (paths) => {
      const targets = paths.map(normalizePath).filter(Boolean);
      if (targets.every((path) => get().expandedFolders.has(path))) return;
      set((state) => ({
        expandedFolders: new Set([...state.expandedFolders, ...targets]),
      }));
    },

    collapseFolders: () => set({ expandedFolders: new Set<string>() }),

    setExplorerSelection: (explorerSelection) => set({ explorerSelection }),

    setEditorInfo: (editorInfo) =>
      set((state) =>
        // Called on every model switch; unchanged info renders nothing.
        state.editorInfo?.eol === editorInfo?.eol &&
        state.editorInfo?.tabSize === editorInfo?.tabSize &&
        state.editorInfo?.insertSpaces === editorInfo?.insertSpaces
          ? state
          : { editorInfo },
      ),

    openFileAt: async (path, target) => {
      const clean = normalizePath(path);
      set((state) => ({
        editorReveal: {
          path: clean,
          line: target?.line ?? null,
          column: target?.column ?? 1,
          length: target?.length ?? 0,
          focus: target?.focus ?? true,
          seq: (state.editorReveal?.seq ?? 0) + 1,
        },
      }));
      await get().selectFile(clean);
    },

    openQuickInput: (text = "") =>
      set((state) => ({
        quickInput: { text, seq: (state.quickInput?.seq ?? 0) + 1 },
      })),

    closeQuickInput: () => set({ quickInput: null }),

    focusSearch: () =>
      set((state) => ({
        activeView: "search",
        sidebarVisible: true,
        searchFocusSeq: state.searchFocusSeq + 1,
      })),

    closeFiles: async (paths) => {
      const { dirty } = get();
      const unsaved = paths.filter((file) => dirty[file]);
      let toClose = paths;

      if (unsaved.length > 0) {
        const single = unsaved.length === 1;
        const choice = await ask({
          title: single
            ? `Save changes to ${getBaseName(unsaved[0])}?`
            : `Save changes to ${unsaved.length} files?`,
          message: "Changes you don't save are lost.",
          details: single ? undefined : previewList(unsaved.map(getBaseName)),
          actions: [
            { value: "discard", label: "Don't save", variant: "secondary" },
            { value: "save", label: single ? "Save" : "Save all" },
          ],
        });
        if (choice === null) return;

        if (choice === "save") {
          for (const file of unsaved) {
            // A file that fails to save stays open, with its edits.
            if (!(await get().saveFile(file))) {
              toClose = toClose.filter((item) => item !== file);
            }
          }
        }
      }

      for (const file of toClose) get().closeFile(file);
    },

    retrieveOpen: false,

    openRetrieve: () => set({ retrieveOpen: true, activeView: "metadata" }),

    closeRetrieve: () => set({ retrieveOpen: false }),
  };
});

export { useWorkspaceInit } from "../hooks/useWorkspaceInit";

/* ── Keeping the org and the open workspace in step ─────────────────
   Each org owns a folder, so changing org swaps the whole tree rather than
   just repointing the deploy target. The listener below runs wherever the org
   was switched from — Org Manager, the dashboard, startup. */

/** The newest org the open workspace should follow, not yet acted on. */
let requestedOrg: Organization | null = null;
/** The org selected before the pending change, to restore if it is declined. */
let orgBeforeRequest: Organization | null = null;
/** The switch loop, while one is running. */
let orgSync: Promise<void> | null = null;
/** Set while this module changes the selection itself. */
let changingSelection = false;

/** Resolves once any in-progress org → workspace switch has settled. */
export function waitForWorkspaceSync(): Promise<void> {
  return orgSync ?? Promise.resolve();
}

/** Selects the org that owns `workspace`, if it is not already selected. */
function selectOwningOrg(workspace: Workspace) {
  const owner = ownerOf(workspace);
  const orgs = useOrganizationStore.getState();
  if (!owner || owner.id === orgs.selectedOrganization?.id) return;

  // The listener would find the workspace already open and do nothing, but
  // skipping it also avoids a pointless trip through the queue.
  changingSelection = true;
  try {
    orgs.setSelectedOrganization(owner);
  } finally {
    changingSelection = false;
  }
}

/**
 * Queues a switch to `org`'s workspace. Latest wins: a change made while a
 * switch is in flight is picked up by the next pass of the loop.
 *
 * The previous listener ignored any org change that arrived while a switch
 * was running, so picking A then B quickly left B selected — the deploy
 * target — with A's folder on screen.
 */
function requestWorkspaceForOrg(
  org: Organization,
  previous: Organization | null,
) {
  if (!orgSync) orgBeforeRequest = previous;
  requestedOrg = org;
  if (!orgSync) {
    orgSync = (async () => {
      try {
        while (requestedOrg) {
          const next = requestedOrg;
          requestedOrg = null;
          await openWorkspaceForOrg(next);
        }
      } finally {
        orgSync = null;
        orgBeforeRequest = null;
      }
    })();
  }
  return orgSync;
}

async function openWorkspaceForOrg(org: Organization) {
  const store = useWorkspaceStore.getState();
  const open = store.workspaces.find(
    (item) => item.id === store.openWorkspaceId,
  );

  // Already showing this org's folder — after `switchWorkspace` selected its
  // owner, or a startup that restored the org it last used.
  if (store.loaded && open?.orgId === org.id) return;

  // Unsaved buffers belong to the outgoing folder and would be lost. Declining
  // puts the selection back, or the selected org and the tree would disagree.
  if (!(await confirmDiscardUnsaved(store.dirty))) {
    const restore = ownerOf(open) ?? orgBeforeRequest;
    requestedOrg = null;
    changingSelection = true;
    try {
      useOrganizationStore.getState().setSelectedOrganization(restore ?? null);
    } finally {
      changingSelection = false;
    }
    return;
  }

  try {
    const entry = await workspaceForOrg(org.id, org.alias);
    await useWorkspaceStore.getState().loadWorkspaces();
    // Superseded while resolving: the next pass opens the newer org instead.
    if (requestedOrg) return;
    await useWorkspaceStore.getState().openActiveWorkspace(entry.name);
  } catch (error) {
    useWorkspaceStore
      .getState()
      .appendLog(
        `Could not open the workspace for ${org.alias} — ${errorMessage(error)}`,
        "error",
        "system",
      );
  }
}

useOrganizationStore.subscribe((state, previous) => {
  const nextOrg = state.selectedOrganization;
  const previousOrg = previous.selectedOrganization;
  if (nextOrg?.id === previousOrg?.id) return;
  if (changingSelection) return;

  // No org selected: leave whatever workspace is open rather than closing it.
  if (!nextOrg) return;

  void requestWorkspaceForOrg(nextOrg, previousOrg);
});

/* ── Changes made outside the app ───────────────────────────────────
   The watcher reports files changed by git, a terminal retrieve or another
   editor; they used to stay invisible until a manual refresh, and an open
   buffer could be saved straight over them. Events are applied one batch at a
   time, in order. */

if (isTauriRuntime) {
  let applying: Promise<void> = Promise.resolve();
  void onWorkspaceFsChanged((event) => {
    applying = applying
      .then(() => useWorkspaceStore.getState().handleFsEvent(event))
      .catch(() => {});
  });

  // Terminal output arrives in order, while its command is still running.
  void onTerminalOutput((event) =>
    useWorkspaceStore.getState().handleTerminalEvent(event),
  );
}
