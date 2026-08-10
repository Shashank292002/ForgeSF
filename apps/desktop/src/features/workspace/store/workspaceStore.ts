import { create } from "zustand";
import {
  loadWorkspaceFileContent,
  loadWorkspaceFiles,
  saveWorkspaceFileContent,
  type WorkspaceNode,
} from "../services/workspaceService";
import { deployWorkspace } from "../../../services/tauri";
import type { WorkspaceFile } from "../types";

export interface TerminalEntry {
  id: number;
  source: "terminal" | "deploy";
  text: string;
  kind: "info" | "success" | "error" | "cmd";
}

interface WorkspaceState {
  files: WorkspaceFile[];
  selectedFile: string | null;
  openFiles: string[];
  fileContents: Record<string, string>;
  dirtyFiles: Record<string, boolean>;
  saveStatus: "idle" | "saving" | "saved";
  logs: TerminalEntry[];
  deploying: boolean;
  loaded: boolean;

  /** Replace the entire file tree (used after metadata retrieve). */
  setFiles: (files: WorkspaceFile[]) => void;
  /** Select a file — opens it in a tab if not already open. */
  selectFile: (file: string) => void;
  /** Close a tab and clear dirty state for that file if unsaved. */
  closeFile: (file: string) => void;
  /** Update in-memory content for a file and mark it dirty. */
  updateFileContent: (file: string, content: string) => void;
  markDirty: (file: string, dirty: boolean) => void;
  saveFile: (file: string) => Promise<boolean>;
  saveAll: () => Promise<void>;
  appendLog: (
    text: string,
    kind?: TerminalEntry["kind"],
    source?: TerminalEntry["source"],
  ) => void;
  clearLogs: () => void;
  runDeploy: (username: string, checkOnly: boolean) => Promise<void>;
  /** Re-read the entire workspace tree from disk. */
  refreshFiles: () => Promise<void>;
  setLoaded: (loaded: boolean) => void;
}

function mapNode(node: WorkspaceNode): WorkspaceFile {
  return {
    path: node.path.replace(/\\/g, "/").replace(/^\//, ""),
    name: node.name,
    type: node.nodeType === "folder" ? "folder" : "file",
    children: node.children?.map(mapNode),
  };
}

function collectFiles(items: WorkspaceFile[]): WorkspaceFile[] {
  return items.flatMap((item) => {
    const children = item.children ? collectFiles(item.children) : [];
    return [item, ...children];
  });
}

function findFirstFile(items: WorkspaceFile[]): string | null {
  const files = collectFiles(items).filter((item) => item.type === "file");
  return files[0]?.path ?? null;
}

/** Build the full in-memory workspace snapshot: tree + all file contents. */
async function loadWorkspaceSnapshot(): Promise<{
  files: WorkspaceFile[];
  firstFile: string | null;
  fileContents: Record<string, string>;
}> {
  const nodes = await loadWorkspaceFiles("");
  const files = nodes.map(mapNode);
  const fileContents: Record<string, string> = {};
  const filesToLoad = collectFiles(files).filter(
    (item) => item.type === "file",
  );

  for (const file of filesToLoad) {
    try {
      fileContents[file.path] = await loadWorkspaceFileContent(file.path);
    } catch {
      fileContents[file.path] = "";
    }
  }

  return {
    files,
    firstFile: findFirstFile(files),
    fileContents,
  };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  files: [],
  selectedFile: null,
  openFiles: [],
  fileContents: {},
  dirtyFiles: {},
  saveStatus: "idle",
  logs: [],
  deploying: false,
  loaded: false,

  setFiles: (files) => set({ files }),

  selectFile: (file) =>
    set((state) => ({
      selectedFile: file,
      openFiles: state.openFiles.includes(file)
        ? state.openFiles
        : [...state.openFiles, file],
    })),

  closeFile: (file) =>
    set((state) => {
      const nextOpenFiles = state.openFiles.filter(
        (openFile) => openFile !== file,
      );
      // Discard content for a closed file that was never saved — keeps the
      // in-memory cache from growing unbounded.
      const nextContents = { ...state.fileContents };
      if (!state.dirtyFiles[file]) {
        delete nextContents[file];
      }

      return {
        openFiles: nextOpenFiles,
        selectedFile:
          state.selectedFile === file
            ? nextOpenFiles[0] ?? null
            : state.selectedFile,
        fileContents: nextContents,
      };
    }),

  updateFileContent: (file, content) =>
    set((state) => ({
      fileContents: {
        ...state.fileContents,
        [file]: content,
      },
    })),

  markDirty: (file, dirty) =>
    set((state) => {
      const next = { ...state.dirtyFiles };
      if (dirty) next[file] = true;
      else delete next[file];
      return { dirtyFiles: next };
    }),

  saveFile: async (file) => {
    const content = get().fileContents[file];
    if (content === undefined) return false;

    set({ saveStatus: "saving" });
    try {
      await saveWorkspaceFileContent(file, content);
      set((state) => {
        const nextDirty = { ...state.dirtyFiles };
        delete nextDirty[file];
        return { dirtyFiles: nextDirty, saveStatus: "saved" };
      });
      get().appendLog(`Saved ${file}`, "success", "terminal");
      return true;
    } catch (error) {
      get().appendLog(
        `Failed to save ${file}: ${String(error)}`,
        "error",
        "terminal",
      );
      set({ saveStatus: "idle" });
      return false;
    }
  },

  saveAll: async () => {
    const dirty = Object.keys(get().dirtyFiles);
    for (const file of dirty) {
      await get().saveFile(file);
    }
  },

  appendLog: (text, kind = "info", source = "terminal") =>
    set((state) => ({
      logs: [
        ...state.logs,
        {
          id: Date.now() + Math.random(),
          text,
          kind,
          source,
        },
      ].slice(-500),
    })),

  clearLogs: () => set({ logs: [] }),

  runDeploy: async (username, checkOnly) => {
    if (get().deploying) return;

    set({ deploying: true });

    const action = checkOnly
      ? "Validating (check-only deploy)"
      : "Deploying";
    get().appendLog(`🚀 ${action} to ${username}...`, "info", "deploy");

    try {
      const out = await deployWorkspace(username, checkOnly);
      get().appendLog(out, "success", "deploy");
      get().appendLog(
        `✅ ${checkOnly ? "Validation" : "Deployment"} finished successfully.`,
        "success",
        "deploy",
      );
    } catch (error) {
      get().appendLog(String(error), "error", "deploy");
      get().appendLog(
        `❌ ${checkOnly ? "Validation" : "Deployment"} failed.`,
        "error",
        "deploy",
      );
    } finally {
      set({ deploying: false });
    }
  },

  refreshFiles: async () => {
    try {
      const { files, firstFile, fileContents } =
        await loadWorkspaceSnapshot();
      const state = get();
      const currentSelection = state.selectedFile;
      const currentOpenFiles = state.openFiles;
      const dirty = state.dirtyFiles;
      const preservedContents = state.fileContents;
      const availableFiles = new Set(Object.keys(fileContents));

      const nextSelected =
        currentSelection && availableFiles.has(currentSelection)
          ? currentSelection
          : firstFile;
      const nextOpenFiles = currentOpenFiles.filter((file) =>
        availableFiles.has(file),
      );

      if (nextSelected && !nextOpenFiles.includes(nextSelected)) {
        nextOpenFiles.unshift(nextSelected);
      }

      // Keep in-memory edits for dirty files so we never clobber unsaved work.
      const mergedContents = { ...fileContents };
      for (const file of Object.keys(dirty)) {
        if (preservedContents[file] !== undefined) {
          mergedContents[file] = preservedContents[file];
        }
      }

      set({
        files,
        selectedFile: nextSelected,
        openFiles: nextOpenFiles,
        fileContents: mergedContents,
        saveStatus: "idle",
        loaded: true,
      });
    } catch (error) {
      console.error("Failed to load workspace files", error);
      get().appendLog(
        `Failed to load workspace files: ${String(error)}`,
        "error",
        "terminal",
      );
    }
  },

  setLoaded: (loaded) => set({ loaded }),
}));

export { useWorkspaceInit } from "../hooks/useWorkspaceInit";
