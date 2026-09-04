import { invoke } from "@tauri-apps/api/core";

import type { DeployOutcome } from "../../../services/tauri";
import { open } from "@tauri-apps/plugin-dialog";

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

/** True when the app is running inside the Tauri webview. */
export const isTauriRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Opens the native folder picker. Returns the selected folder or null. */
export async function selectWorkspaceFolder(): Promise<string | null> {
  const folder = await open({ directory: true, multiple: false });
  return typeof folder === "string" ? folder : null;
}

/** Returns the absolute path of the current workspace root. */
export function getWorkspaceRoot(): Promise<string> {
  return invoke<string>("get_workspace_root");
}

/** Persists a new workspace root on the Rust side. */
export function setWorkspaceRoot(path: string): Promise<string> {
  return invoke<string>("set_workspace_path", { path });
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
): Promise<WorkspaceNode[]> {
  return invoke<WorkspaceNode[]>("read_workspace", { path, depth });
}

export function loadWorkspaceFileContent(path: string): Promise<string> {
  return invoke<string>("read_workspace_file", { path });
}

export function saveWorkspaceFileContent(
  path: string,
  content: string,
): Promise<string> {
  return invoke<string>("write_workspace_file", { path, content });
}

export function createWorkspaceItem(
  path: string,
  isFolder: boolean,
): Promise<string> {
  return invoke<string>("create_workspace_item", { itemPath: path, isFolder });
}

export function renameWorkspaceItem(
  path: string,
  newName: string,
): Promise<string> {
  return invoke<string>("rename_workspace_item", { itemPath: path, newName });
}

export function deleteWorkspaceItem(path: string): Promise<void> {
  return invoke<void>("delete_workspace_item", { itemPath: path });
}

// Declared once in services/tauri.ts; re-exported so workspace callers do not
// need to reach across features for it.
export type { DeployOutcome } from "../../../services/tauri";

export function deployWorkspace(
  username: string,
  checkOnly = false,
): Promise<DeployOutcome> {
  return invoke<DeployOutcome>("deploy_workspace", {
    username,
    checkOnly,
    metadata: null,
  });
}

/** Runs an arbitrary `sf` CLI command (used by the terminal). */
export function runSfCommand(args: string[]): Promise<string> {
  return invoke<string>("run_command", { args });
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
  return invoke<Workspace>("workspace_for_org", { orgId, label: label ?? null });
}

/** Points an org at an already-registered folder. */
export function bindWorkspaceToOrg(
  id: string,
  orgId: string,
): Promise<WorkspaceRegistry> {
  return invoke<WorkspaceRegistry>("bind_workspace_to_org", { id, orgId });
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

/** Remembers the org this project is being used with. */
export function setWorkspaceOrg(
  id: string,
  orgId: string | null,
): Promise<void> {
  return invoke<void>("set_workspace_org", { id, orgId });
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

export function deployPaths(
  username: string,
  paths: string[],
): Promise<DeployOutcome> {
  return invoke<DeployOutcome>("deploy_paths", { username, paths });
}

export function retrievePaths(
  username: string,
  paths: string[],
): Promise<string> {
  return invoke<string>("retrieve_paths", { username, paths });
}

/** Compares a file or folder against the org's current version. */
export function diffWorkspacePath(
  username: string,
  path: string,
): Promise<DiffSession> {
  return invoke<DiffSession>("diff_workspace_path", { username, path });
}

/** Both sides of one file from an open diff session. */
export function readDiffPair(
  sessionDir: string,
  path: string,
): Promise<DiffPair> {
  return invoke<DiffPair>("read_diff_pair", { sessionDir, path });
}

/** Removes previous Diff Check scratch directories. */
export function clearDiffSessions(): Promise<void> {
  return invoke<void>("clear_diff_sessions");
}
