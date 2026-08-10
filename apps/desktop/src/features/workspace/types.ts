/**
 * Workspace domain types.
 *
 * These are shared between the workspace store and UI components.
 * The {@link WorkspaceFile} interface mirrors the `FileNode` / `WorkspaceNode`
 * shapes returned by the Tauri `read_workspace` command but is normalised
 * to a single canonical definition used across the UI layer.
 */

export type WorkspaceFileType = "folder" | "file";

export interface WorkspaceFile {
  path: string;
  name: string;
  type: WorkspaceFileType;
  children?: WorkspaceFile[];
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  orgId?: string;
  orgAlias?: string;
  status: "Connected" | "Disconnected";
  createdAt: string;
}
