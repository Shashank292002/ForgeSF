/**
 * Workspace domain types shared between the store, services and UI.
 */

export type WorkspaceFileType = "folder" | "file";

export interface WorkspaceFile {
  path: string;
  name: string;
  type: WorkspaceFileType;
  /** Undefined on a folder means its contents have not been loaded yet. */
  children?: WorkspaceFile[];
  /** Whether a folder has contents, known before they are loaded. */
  hasChildren?: boolean;
}

/**
 * A registered project.
 *
 * `id` is the canonicalised folder path, so registering the same folder twice
 * is a no-op and no id generation is needed. `name` is the renameable label.
 */
export interface Workspace {
  id: string;
  name: string;
  path: string;
  /** The org this folder belongs to. `null` on the no-org fallback workspace. */
  orgId: string | null;
  /** Org restored when this project is opened; mirrors `orgId` when owned. */
  lastOrgId: string | null;
  /** Org that actually populated this tree — drives the mixing warning. */
  lastRetrievedOrgId: string | null;
  /** Milliseconds since the Unix epoch. */
  createdAt: number;
}

/** The persisted registry of projects. */
export interface WorkspaceRegistry {
  version: number;
  activeId: string | null;
  workspaces: Workspace[];
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

/** How one file compares between the workspace and the org. */
export type DiffStatus =
  | "changed"
  | "identical"
  | "localOnly"
  | "orgOnly"
  | "binary";

export interface DiffEntry {
  path: string;
  status: DiffStatus;
  localLines: number;
  orgLines: number;
}

/**
 * One Diff Check run. Entries carry counts only — a file's two sides are
 * fetched on demand via `readDiffPair`.
 */
export interface DiffSession {
  sessionDir: string;
  /** The file or folder the check was started from. */
  target: string;
  entries: DiffEntry[];
}

export interface DiffPair {
  local: string;
  org: string;
}
