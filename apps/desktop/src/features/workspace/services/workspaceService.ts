import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface WorkspaceNode {
  name: string;
  path: string;
  nodeType: string;
  children?: WorkspaceNode[];
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

/** Reads the workspace file tree (relative paths, `/` separators). */
export function loadWorkspaceFiles(path = ""): Promise<WorkspaceNode[]> {
  return invoke<WorkspaceNode[]>("read_workspace", { path });
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

export function deployWorkspace(
  username: string,
  checkOnly = false,
): Promise<string> {
  return invoke<string>("deploy_workspace", { username, checkOnly });
}

/** Runs an arbitrary `sf` CLI command (used by the terminal). */
export function runSfCommand(args: string[]): Promise<string> {
  return invoke<string>("run_command", { args });
}