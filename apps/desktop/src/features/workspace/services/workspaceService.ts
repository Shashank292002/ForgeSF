import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { open } from "@tauri-apps/plugin-dialog";

import type {
  CopyResult,
  FileContent,
  FileStamp,
  PathChange,
  RenameResult,
  SearchRequest,
  SearchResults,
  TerminalEvent,
  WorkspaceFileList,
  WorkspaceFsEvent,
} from "@/types/generated";
import type {
  DiffPair,
  DiffSession,
  Workspace,
  WorkspaceRegistry,
} from "../types";

export interface WorkspaceNode {
  name: string;
  path: string;
  nodeType: string;
  /** Undefined on a folder means "not read yet" — see `hasChildren`. */
  children?: WorkspaceNode[];
  /** Whether a folder holds anything, known without having read it. */
  hasChildren: boolean;
}

/**
 * The workspace a request acts on.
 *
 * File, deploy, retrieve and diff commands take the id of the workspace the UI
 * is showing. Without it Rust resolved whichever workspace was active when the
 * command ran, so a request issued just before an org switch landed in the
 * next org's folder, where the same relative paths exist. `null` means "the
 * active workspace" and is only used before any workspace has been opened.
 */
export type WorkspaceId = string | null | undefined;

/** True when the app is running inside the Tauri webview. */
export const isTauriRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Opens the native folder picker. Returns the selected folder or null. */
export async function selectWorkspaceFolder(): Promise<string | null> {
  const folder = await open({ directory: true, multiple: false });
  return typeof folder === "string" ? folder : null;
}

/** Returns the absolute path of a workspace root. */
export function getWorkspaceRoot(workspaceId?: WorkspaceId): Promise<string> {
  return invoke<string>("get_workspace_root", {
    workspaceId: workspaceId ?? null,
  });
}

/**
 * Reads one level of the workspace tree (relative paths, `/` separators).
 *
 * `depth` defaults to 1 so expanding a folder costs one shallow read instead
 * of walking every descendant.
 */
export function loadWorkspaceFiles(
  path = "",
  depth = 1,
  workspaceId?: WorkspaceId,
): Promise<WorkspaceNode[]> {
  return invoke<WorkspaceNode[]>("read_workspace", {
    path,
    depth,
    workspaceId: workspaceId ?? null,
  });
}

/** A file's text, with the stamp a later save is checked against. */
export function loadWorkspaceFileContent(
  path: string,
  workspaceId?: WorkspaceId,
): Promise<FileContent> {
  return invoke<FileContent>("read_workspace_file", {
    path,
    workspaceId: workspaceId ?? null,
  });
}

/**
 * Saves a file. With `expected` — the stamp the text was read with — a file
 * that changed on disk meanwhile is not overwritten: the call fails with an
 * error `isChangedOnDisk` recognises. Resolves with the new stamp.
 */
export function saveWorkspaceFileContent(
  path: string,
  content: string,
  workspaceId?: WorkspaceId,
  expected?: FileStamp | null,
): Promise<FileStamp> {
  return invoke<FileStamp>("write_workspace_file", {
    path,
    content,
    workspaceId: workspaceId ?? null,
    expected: expected ?? null,
  });
}

/** Whether a save failed because the file changed on disk after it was read. */
export function isChangedOnDisk(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("CHANGED_ON_DISK");
}

/**
 * Creates a file or folder. New Apex or Visualforce also gets its
 * `-meta.xml`; every created path is returned, the item first.
 */
export function createWorkspaceItem(
  path: string,
  isFolder: boolean,
  workspaceId?: WorkspaceId,
): Promise<string[]> {
  return invoke<string[]>("create_workspace_item", {
    itemPath: path,
    isFolder,
    workspaceId: workspaceId ?? null,
  });
}

/**
 * Renames an item and what belongs with it; the item's own change is first.
 * With `renameInFile`, a class or trigger also takes its new name inside.
 */
export function renameWorkspaceItem(
  path: string,
  newName: string,
  workspaceId?: WorkspaceId,
  renameInFile = false,
): Promise<RenameResult> {
  return invoke<RenameResult>("rename_workspace_item", {
    itemPath: path,
    newName,
    workspaceId: workspaceId ?? null,
    renameInFile,
  });
}

/** The name an Apex class or trigger file declares, or null for other files. */
export function apexDeclaredName(
  path: string,
  workspaceId?: WorkspaceId,
): Promise<string | null> {
  return invoke<string | null>("apex_declared_name", {
    itemPath: path,
    workspaceId: workspaceId ?? null,
  });
}

/**
 * `paths` with the files that belong to them — a class's `-meta.xml`, a static
 * resource's content — which a delete removes and a move carries along.
 */
export function includeCompanions(
  paths: string[],
  workspaceId?: WorkspaceId,
): Promise<string[]> {
  return invoke<string[]>("include_companions", {
    itemPaths: paths,
    workspaceId: workspaceId ?? null,
  });
}

/** Deletes items with their companions. Resolves with every path removed. */
export function deleteWorkspaceItems(
  paths: string[],
  workspaceId?: WorkspaceId,
): Promise<string[]> {
  return invoke<string[]>("delete_workspace_items", {
    itemPaths: paths,
    workspaceId: workspaceId ?? null,
  });
}

/** Moves items into a folder ("" for the root). */
export function moveWorkspaceItems(
  paths: string[],
  targetFolder: string,
  workspaceId?: WorkspaceId,
): Promise<PathChange[]> {
  return invoke<PathChange[]>("move_workspace_items", {
    itemPaths: paths,
    targetFolder,
    workspaceId: workspaceId ?? null,
  });
}

/**
 * Copies items into a folder ("" for the root). A copied class or trigger
 * that got a new name is renamed inside to match.
 */
export function copyWorkspaceItems(
  paths: string[],
  targetFolder: string,
  workspaceId?: WorkspaceId,
): Promise<CopyResult> {
  return invoke<CopyResult>("copy_workspace_items", {
    itemPaths: paths,
    targetFolder,
    workspaceId: workspaceId ?? null,
  });
}

/** Shows an item in the system file manager. */
export function revealWorkspaceItem(
  path: string,
  workspaceId?: WorkspaceId,
): Promise<void> {
  return invoke<void>("reveal_workspace_item", {
    itemPath: path,
    workspaceId: workspaceId ?? null,
  });
}

/** The project's package directories — where deployable metadata lives. */
export function workspacePackageDirectories(
  workspaceId?: WorkspaceId,
): Promise<string[]> {
  return invoke<string[]>("workspace_package_directories", {
    workspaceId: workspaceId ?? null,
  });
}

/** Starts watching a workspace for changes made outside the app. */
export function watchWorkspace(workspaceId?: WorkspaceId): Promise<void> {
  return invoke<void>("watch_workspace", { workspaceId: workspaceId ?? null });
}

/** Subscribes to changes the watcher reports. Resolves to an unsubscribe. */
export function onWorkspaceFsChanged(
  callback: (event: WorkspaceFsEvent) => void,
): Promise<UnlistenFn> {
  return listen<WorkspaceFsEvent>("workspace_fs_changed", (event) =>
    callback(event.payload),
  );
}

/**
 * Finds text in the workspace's files. A newer search stops this one, which
 * then resolves with `cancelled` set.
 */
export function searchWorkspace(
  request: SearchRequest,
  workspaceId?: WorkspaceId,
): Promise<SearchResults> {
  return invoke<SearchResults>("search_workspace", {
    request,
    workspaceId: workspaceId ?? null,
  });
}

/** Stops the running search, if any. */
export function cancelWorkspaceSearch(): Promise<void> {
  return invoke<void>("cancel_workspace_search");
}

/** Every file in the workspace, for Quick Open. */
export function listWorkspaceFiles(
  workspaceId?: WorkspaceId,
): Promise<WorkspaceFileList> {
  return invoke<WorkspaceFileList>("list_workspace_files", {
    workspaceId: workspaceId ?? null,
  });
}

/**
 * Runs an `sf` command for the terminal. Its output arrives through
 * `onTerminalOutput` while it runs, ending with an event that carries the
 * exit; this rejects only when the command could not start. Stop it with
 * `cancelSfCommand(runId)`.
 */
export function startTerminalCommand(
  args: string[],
  runId: string,
  workspaceId?: WorkspaceId,
): Promise<void> {
  return invoke<void>("run_terminal_command", {
    args,
    runId,
    workspaceId: workspaceId ?? null,
  });
}

/** Subscribes to terminal output. Resolves to an unsubscribe. */
export function onTerminalOutput(
  callback: (event: TerminalEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalEvent>("terminal_output", (event) =>
    callback(event.payload),
  );
}

/* ── Workspace registry ──────────────────────────────────────────
   Projects are first-class: each is a folder that remembers the org it was
   last used with. Removing one forgets the registry entry only — the files
   on disk are never touched. */

/** Every registered project, plus which one is active. */
export function listWorkspaces(): Promise<WorkspaceRegistry> {
  return invoke<WorkspaceRegistry>("list_workspaces");
}

/**
 * Registers a folder and makes it active. Re-adding an existing one activates
 * it. Passing `orgId` binds the folder to that org, replacing whatever folder
 * the org was using.
 */
export function addWorkspace(
  path: string,
  orgId?: string | null,
): Promise<Workspace> {
  return invoke<Workspace>("add_workspace", { path, orgId: orgId ?? null });
}

/**
 * The workspace belonging to an org, created on first use and made active.
 *
 * Each org owns a folder, so a retrieve can only write into the tree for the
 * org it came from. `label` names a *new* folder only — renaming an org later
 * does not move an existing one.
 */
export function workspaceForOrg(
  orgId: string,
  label?: string | null,
): Promise<Workspace> {
  return invoke<Workspace>("workspace_for_org", {
    orgId,
    label: label ?? null,
  });
}

export function setActiveWorkspace(id: string): Promise<Workspace> {
  return invoke<Workspace>("set_active_workspace", { id });
}

export function removeWorkspace(id: string): Promise<WorkspaceRegistry> {
  return invoke<WorkspaceRegistry>("remove_workspace", { id });
}

export function renameWorkspace(
  id: string,
  name: string,
): Promise<WorkspaceRegistry> {
  return invoke<WorkspaceRegistry>("rename_workspace", { id, name });
}

/** Records the org that populated this tree, after a successful retrieve. */
export function setWorkspaceRetrievedOrg(
  id: string,
  orgId: string,
): Promise<void> {
  return invoke<void>("set_workspace_retrieved_org", { id, orgId });
}

/* ── Per-file / per-folder actions ───────────────────────────────
   `sf project deploy/retrieve start --source-dir` accepts a file or a
   directory, so the same call covers "this class" and "this folder". */

export function retrievePaths(
  username: string,
  paths: string[],
  workspaceId?: WorkspaceId,
): Promise<string> {
  return invoke<string>("retrieve_paths", {
    username,
    paths,
    workspaceId: workspaceId ?? null,
  });
}

/** Compares a file or folder against the org's current version. */
export function diffWorkspacePath(
  username: string,
  path: string,
  workspaceId?: WorkspaceId,
): Promise<DiffSession> {
  return invoke<DiffSession>("diff_workspace_path", {
    username,
    path,
    workspaceId: workspaceId ?? null,
  });
}

/** Both sides of one file from an open diff session. */
export function readDiffPair(
  sessionId: string,
  path: string,
  orgPath: string | null,
  workspaceId?: WorkspaceId,
): Promise<DiffPair> {
  return invoke<DiffPair>("read_diff_pair", {
    sessionId,
    path,
    orgPath,
    workspaceId: workspaceId ?? null,
  });
}

/** Removes previous Diff Check scratch directories. */
export function clearDiffSessions(): Promise<void> {
  return invoke<void>("clear_diff_sessions");
}
