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
  /**
   * Present once when the saved list was unreadable: it was kept as a backup
   * and a new list started. Explains why previously added folders are gone.
   */
  notice?: string | null;
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

/** What the status bar says about the file in the editor. */
export interface EditorInfo {
  /** Indents with spaces rather than tabs. */
  insertSpaces: boolean;
  tabSize: number;
  eol: "LF" | "CRLF";
}

/** Where the editor should put the cursor once a file is open. */
export interface EditorReveal {
  path: string;
  /** 1-based; null only moves focus to the editor. */
  line: number | null;
  /** 1-based, in UTF-16 code units, as search results count. */
  column: number;
  /** Characters to select from the column: a search match. */
  length: number;
  /** Give the editor keyboard focus. */
  focus: boolean;
  seq: number;
}

/** What the explorer has selected — separate from the editor's active file. */
export interface ExplorerSelection {
  paths: string[];
  /** Where a Shift+click or Shift+arrow range starts. */
  anchor: string | null;
  /** The row keyboard commands act on. */
  focus: string | null;
  /**
   * The focused row's position when it was focused. When that row goes away
   * — deleted, or moved — focus stays at the same place: the next row.
   */
  focusIndex: number;
}

/** How one file compares between the workspace and the org. */
export type DiffStatus =
  "changed" | "identical" | "localOnly" | "orgOnly" | "binary";

export interface DiffEntry {
  path: string;
  /** Where the org's copy sits, when its folder layout differs from `path`. */
  orgPath: string | null;
  status: DiffStatus;
  localLines: number;
  orgLines: number;
}

/**
 * One Diff Check run. Entries carry counts only — a file's two sides are
 * fetched on demand via `readDiffPair`.
 */
export interface DiffSession {
  /** Names the session to `readDiffPair`; digits only, never a path. */
  sessionId: string;
  /** The file or folder the check was started from. */
  target: string;
  entries: DiffEntry[];
  /** Problems the retrieve reported, such as components the org lacks. */
  warnings: string[];
}

export interface DiffPair {
  local: string;
  org: string;
}
