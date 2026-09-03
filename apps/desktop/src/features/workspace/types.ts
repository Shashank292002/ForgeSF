/**
 * Workspace domain types shared between the store, services and UI.
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

/** The sidebar views reachable from the activity bar. */
export type SidebarView =
  "explorer" | "search" | "scm" | "metadata" | "settings";

export const SIDEBAR_VIEWS: SidebarView[] = [
  "explorer",
  "search",
  "scm",
  "metadata",
  "settings",
] as const;

export type TerminalSource = "terminal" | "deploy" | "command" | "system";
export type TerminalKind = "info" | "success" | "error" | "cmd" | "warning";

export interface TerminalEntry {
  id: number;
  source: TerminalSource;
  kind: TerminalKind;
  text: string;
  time: string;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface CursorPosition {
  line: number;
  column: number;
}

/** Context-menu request emitted by the explorer tree. */
export interface TreeContextMenu {
  x: number;
  y: number;
  path: string;
  type: WorkspaceFileType;
}
