import {
  createElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  ChevronsDownUp,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Rocket,
  RotateCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useWorkspaceStore } from "../store/workspaceStore";
import NewSourceDialog from "./NewSourceDialog";
import { useOrganizationStore } from "../../../store/orgStore";
import type { WorkspaceFile } from "../types";
import { iconForFile } from "../lib/fileIcons";
import {
  absolutePath,
  entryNameProblem,
  findNode,
  flattenVisible,
  getAncestors,
  getBaseName,
  getParentPath,
  isDeployablePath,
  isWithin,
  pathsBetween,
  topLevelPaths,
  type FlatNode,
} from "../lib/workspaceUtils";
import { confirm, previewList } from "../../../components/ui/Confirm/confirm";
import { copyText } from "../../../lib/clipboard";
import { cls } from "../../../lib/cls";
import FileContextMenu, { type FileMenuActions } from "./FileContextMenu";

import "./WorkspaceExplorer.css";

/** Row height in px — must match `.fw-tree-row` in WorkspaceExplorer.css. */
const TREE_ROW_HEIGHT = 23;

/** Carries dragged explorer paths; anything else dropped on the tree is ignored. */
const DRAG_TYPE = "application/x-forgesf-paths";

/** How long a drag hovers over a closed folder before it opens. */
const DRAG_EXPAND_DELAY_MS = 700;

/** Typed letters jump to a matching row; a pause this long starts afresh. */
const TYPE_AHEAD_RESET_MS = 800;

/**
 * The React key of the row naming a new item. No path contains a NUL, so it
 * never clashes with a real row; built at runtime so the source stays text.
 */
const CREATE_ROW_KEY = `${String.fromCharCode(0)}create`;

interface PendingCreate {
  parentPath: string;
  kind: "file" | "folder";
}

/** A row of the virtual list: a tree entry, or the input naming a new one. */
type TreeItem =
  | ({ kind: "node" } & FlatNode)
  | {
      kind: "create";
      parentPath: string;
      depth: number;
      type: "file" | "folder";
    };

interface MenuRequest {
  x: number;
  y: number;
  /** The items acted on: the selection when the clicked row is part of it. */
  paths: string[];
  /** The row clicked, or null for the empty space below the rows. */
  target: WorkspaceFile | null;
}

/** How an inline edit ended. Only keyboard endings take focus back. */
type Finish = "enter" | "escape" | "blur";

/** The folder new items, pastes and drops go into for a row. */
function folderOf(node: WorkspaceFile | null | undefined): string {
  if (!node) return "";
  return node.type === "folder" ? node.path : getParentPath(node.path);
}

/* ─── Inline text input shared by rename + create ────────────── */

function InlineInput({
  defaultValue = "",
  placeholder,
  label,
  selectStem = false,
  validate,
  onCommit,
  onCancel,
}: {
  defaultValue?: string;
  placeholder?: string;
  label: string;
  /** Select the name without its extension, as a file rename does. */
  selectStem?: boolean;
  validate: (value: string) => string | null;
  onCommit: (value: string, how: Finish) => void;
  onCancel: (how: Finish) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const problemId = useId();
  const problem = validate(value);

  // Enter and Escape unmount the input, and removing a focused element fires
  // `blur` on the way out. That blur committed the very edit Escape had just
  // cancelled, or a rename a second time; only the first ending counts.
  const settled = useRef(false);
  const finish = (commit: boolean, how: Finish) => {
    if (settled.current) return;
    settled.current = true;
    if (commit) onCommit(value, how);
    else onCancel(how);
  };

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const dot = selectStem ? input.value.indexOf(".", 1) : -1;
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  }, [selectStem]);

  return (
    <span className="fw-tree__inline-field">
      <input
        ref={inputRef}
        className={cls("fw-tree__inline-input", problem && "is-invalid")}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Keys typed here are text, not tree commands.
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            if (!problem) finish(true, "enter");
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false, "escape");
          }
        }}
        // Clicking away keeps a usable name and drops one that can't be used.
        onBlur={() => finish(problem === null, "blur")}
      />
      {problem && (
        <span id={problemId} className="fw-tree__inline-problem" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}

/* ─── Tree filtering (search box) ────────────────────────────── */

function filterTree(nodes: WorkspaceFile[], rawQuery: string): WorkspaceFile[] {
  const query = rawQuery.trim().toLowerCase();

  const walk = (list: WorkspaceFile[]): WorkspaceFile[] =>
    list.flatMap((node) => {
      const selfMatch = node.name.toLowerCase().includes(query);
      if (node.type === "file") return selfMatch ? [node] : [];

      const matchedChildren = node.children ? walk(node.children) : [];

      // A folder that matches by name keeps *all* of its children: filtering
      // them too rendered the match as an empty folder.
      if (selfMatch) return [{ ...node, children: node.children }];
      if (matchedChildren.length > 0) {
        return [{ ...node, children: matchedChildren }];
      }
      return [];
    });

  return query ? walk(nodes) : nodes;
}

/* ─── One tree row ───────────────────────────────────────────────
   Flat, not recursive: the virtualiser needs a stable row index, which a
   recursive component tree cannot provide. Nesting is drawn with indent
   guides derived from `depth`. */

interface TreeRowProps {
  item: FlatNode;
  id: string;
  isExpanded: boolean;
  isLoading: boolean;
  /** In the explorer selection. */
  isSelected: boolean;
  /** Where keyboard commands act. */
  isFocused: boolean;
  /** The file shown in the editor. */
  isActive: boolean;
  isDirty: boolean;
  isOpenTab: boolean;
  isCut: boolean;
  isDropTarget: boolean;
  /** Inline deploy, offered for metadata when an org is connected. */
  deploy?: { title: string; disabled: boolean };
  onClick: (event: MouseEvent, node: WorkspaceFile) => void;
  onContextMenu: (event: MouseEvent, node: WorkspaceFile) => void;
  onDeploy: (path: string) => void;
  onStartCreate: (parentPath: string, kind: "file" | "folder") => void;
  onDragStart: (event: DragEvent, node: WorkspaceFile) => void;
  onDragOver: (event: DragEvent, node: WorkspaceFile) => void;
  onDrop: (event: DragEvent, node: WorkspaceFile) => void;
  onDragEnd: () => void;
}

function TreeRow({
  item,
  id,
  isExpanded,
  isLoading,
  isSelected,
  isFocused,
  isActive,
  isDirty,
  isOpenTab,
  isCut,
  isDropTarget,
  deploy,
  onClick,
  onContextMenu,
  onDeploy,
  onStartCreate,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: TreeRowProps) {
  const { node, depth, setSize, posInSet } = item;
  const isFile = node.type === "file";
  // A folder can be expandable before its children are loaded, so trust the
  // backend's `hasChildren` rather than the presence of a children array.
  const expandable = !isFile && (node.hasChildren ?? Boolean(node.children));

  return (
    <div
      id={id}
      className={cls(
        "fw-tree-row",
        isFile ? "is-file" : "is-folder",
        isSelected && "is-selected",
        isFocused && "is-focused",
        isActive && "is-active",
        isOpenTab && !isActive && "is-open",
        isDirty && "is-dirty",
        isCut && "is-cut",
        isDropTarget && "is-drop-target",
      )}
      data-path={node.path}
      role="treeitem"
      // The unsaved-changes dot is visual only; say it in words too.
      aria-label={isDirty ? `${node.name}, unsaved changes` : node.name}
      aria-selected={isSelected}
      aria-level={depth + 1}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      aria-expanded={expandable ? isExpanded : undefined}
      draggable
      onClick={(event) => onClick(event, node)}
      onContextMenu={(event) => onContextMenu(event, node)}
      onDragStart={(event) => onDragStart(event, node)}
      onDragOver={(event) => onDragOver(event, node)}
      onDrop={(event) => onDrop(event, node)}
      onDragEnd={onDragEnd}
    >
      {Array.from({ length: depth }).map((_, index) => (
        <span key={index} className="fw-tree__guide" aria-hidden />
      ))}

      <span className="fw-tree__chevron">
        {isLoading ? (
          <Loader2 size={12} className="fw-tree__spinner" />
        ) : expandable ? (
          <ChevronRight
            size={14}
            className={`fw-tree__chevron-icon ${isExpanded ? "is-open" : ""}`}
          />
        ) : null}
      </span>

      <span className="fw-tree__icon">
        {isFile ? (
          <TreeFileIcon name={node.name} muted={isDirty} />
        ) : isExpanded ? (
          <FolderOpen
            size={15}
            className="fw-tree__folder fw-tree__folder--open"
          />
        ) : (
          <Folder size={15} className="fw-tree__folder" />
        )}
      </span>

      <span className="fw-tree__name">{node.name}</span>

      {/* Out of the tab order: the tree is one tab stop, and the context
          menu (Shift+F10) reaches every action from the keyboard. */}
      <span className="fw-tree__row-actions">
        {deploy && (
          <button
            type="button"
            className="fw-tree__row-btn"
            title={deploy.title}
            aria-label={deploy.title}
            tabIndex={-1}
            disabled={deploy.disabled}
            onClick={(event) => {
              event.stopPropagation();
              onDeploy(node.path);
            }}
          >
            <Rocket size={13} />
          </button>
        )}
        {!isFile && (
          <>
            <button
              type="button"
              className="fw-tree__row-btn"
              title="New File…"
              aria-label={`New file in ${node.name}`}
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                onStartCreate(node.path, "file");
              }}
            >
              <FilePlus2 size={13} />
            </button>
            <button
              type="button"
              className="fw-tree__row-btn"
              title="New Folder…"
              aria-label={`New folder in ${node.name}`}
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                onStartCreate(node.path, "folder");
              }}
            >
              <FolderPlus size={13} />
            </button>
          </>
        )}
      </span>

      {isDirty && <span className="fw-tree__dirty" title="Unsaved changes" />}
      {isOpenTab && !isActive && !isDirty && (
        <span className="fw-tree__tab-dot" title="Open in editor" />
      )}
    </div>
  );
}

function TreeFileIcon({ name, muted }: { name: string; muted?: boolean }) {
  const icon = iconForFile(name, "file");
  return createElement(icon, {
    size: 15,
    className: muted ? "fw-tree__file-icon is-dirty" : "fw-tree__file-icon",
  });
}

/** A "3 items" label as the drag image, instead of a picture of one row. */
function showDragCount(event: DragEvent, count: number) {
  if (typeof event.dataTransfer.setDragImage !== "function") return;
  const badge = document.createElement("div");
  badge.className = "workspace-explorer__drag-count";
  badge.textContent = `${count} items`;
  document.body.appendChild(badge);
  event.dataTransfer.setDragImage(badge, 12, 12);
  // The image is captured during the call; the element is not needed after.
  window.setTimeout(() => badge.remove(), 0);
}

/* ─── WorkspaceExplorer component ─────────────────────────────── */

export default function WorkspaceExplorer() {
  const navigate = useNavigate();
  const treeId = useId();

  const files = useWorkspaceStore((state) => state.files);
  const loaded = useWorkspaceStore((state) => state.loaded);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  // Subscribed, not read via getState(): an imperative snapshot does not
  // re-render this component, so the unsaved-changes dots only refreshed when
  // some *other* subscribed value happened to change.
  const dirtyMap = useWorkspaceStore((state) => state.dirty);
  const workspaceName = useWorkspaceStore((state) => state.workspaceName);
  const workspaceRoot = useWorkspaceStore((state) => state.workspaceRoot);
  const revealRequest = useWorkspaceStore((state) => state.revealRequest);
  const loadingFolders = useWorkspaceStore((state) => state.loadingFolders);
  const packageDirectories = useWorkspaceStore(
    (state) => state.packageDirectories,
  );
  const clipboard = useWorkspaceStore((state) => state.clipboard);
  const expandedFolders = useWorkspaceStore((state) => state.expandedFolders);
  const selection = useWorkspaceStore((state) => state.explorerSelection);
  const deploying = useWorkspaceStore((state) => state.deploying);

  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const refreshFiles = useWorkspaceStore((state) => state.refreshFiles);
  const loadFolder = useWorkspaceStore((state) => state.loadFolder);
  const loadFullTree = useWorkspaceStore((state) => state.loadFullTree);
  const createItem = useWorkspaceStore((state) => state.createItem);
  const renameItem = useWorkspaceStore((state) => state.renameItem);
  const withCompanions = useWorkspaceStore((state) => state.withCompanions);
  const deleteItems = useWorkspaceStore((state) => state.deleteItems);
  const moveItems = useWorkspaceStore((state) => state.moveItems);
  const copyItems = useWorkspaceStore((state) => state.copyItems);
  const setClipboard = useWorkspaceStore((state) => state.setClipboard);
  const pasteInto = useWorkspaceStore((state) => state.pasteInto);
  const revealItem = useWorkspaceStore((state) => state.revealItem);
  const setFolderExpanded = useWorkspaceStore(
    (state) => state.setFolderExpanded,
  );
  const expandFolders = useWorkspaceStore((state) => state.expandFolders);
  const collapseFolders = useWorkspaceStore((state) => state.collapseFolders);
  const setExplorerSelection = useWorkspaceStore(
    (state) => state.setExplorerSelection,
  );
  const deployPathsAction = useWorkspaceStore(
    (state) => state.deployPathsAction,
  );
  const retrievePathsAction = useWorkspaceStore(
    (state) => state.retrievePathsAction,
  );
  const openDiff = useWorkspaceStore((state) => state.openDiff);
  const openFolder = useWorkspaceStore((state) => state.openFolder);
  const openRetrieve = useWorkspaceStore((state) => state.openRetrieve);
  const organization = useOrganizationStore(
    (state) => state.selectedOrganization,
  );

  const [query, setQuery] = useState("");
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
    null,
  );
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [newSource, setNewSource] = useState(false);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  /** The folder a drag would drop into ("" for the root), while dragging. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const treeRef = useRef<HTMLDivElement>(null);
  const dragPaths = useRef<string[]>([]);
  const dragExpand = useRef<{ path: string; timer: number } | null>(null);
  const typeAhead = useRef({ text: "", at: 0 });

  const filteredFiles = useMemo(() => filterTree(files, query), [files, query]);
  const isFiltering = query.trim().length > 0;

  // Filtering has to match files the user never expanded to, so the first
  // keystroke pays for one deep read. Without it the filter would silently
  // only search folders that happened to be open.
  useEffect(() => {
    if (isFiltering) void loadFullTree();
  }, [isFiltering, loadFullTree]);

  const rows = useMemo(
    () =>
      flattenVisible(filteredFiles, (path) =>
        isFiltering ? true : expandedFolders.has(path),
      ),
    [filteredFiles, expandedFolders, isFiltering],
  );
  const order = useMemo(() => rows.map((row) => row.node.path), [rows]);

  // Fetch contents for anything expanded but not yet read — covers expanding a
  // folder, revealing a file inside one, and re-expansion after a refresh.
  // Only rows on screen: a folder read before its parent is in the tree has
  // nowhere to put its entries.
  useEffect(() => {
    for (const { node } of rows) {
      if (
        node.type === "folder" &&
        node.children === undefined &&
        (node.hasChildren ?? false) &&
        expandedFolders.has(node.path)
      ) {
        void loadFolder(node.path);
      }
    }
  }, [rows, expandedFolders, loadFolder]);

  // The input naming a new item is a row of its own, directly under its
  // folder. Laid over the list, it used to cover the folder's first entry.
  const items = useMemo<TreeItem[]>(() => {
    const list: TreeItem[] = rows.map((row) => ({ kind: "node", ...row }));
    if (!pendingCreate) return list;
    const { parentPath, kind } = pendingCreate;
    const parentIndex = parentPath ? order.indexOf(parentPath) : -1;
    if (parentPath && parentIndex === -1) return list;
    list.splice(parentIndex + 1, 0, {
      kind: "create",
      parentPath,
      depth: parentIndex === -1 ? 0 : rows[parentIndex].depth + 1,
      type: kind,
    });
    return list;
  }, [rows, order, pendingCreate]);

  const itemIndex = useMemo(() => {
    const indexes = new Map<string, number>();
    items.forEach((item, index) => {
      if (item.kind === "node") indexes.set(item.node.path, index);
    });
    return indexes;
  }, [items]);
  const createIndex = items.findIndex((item) => item.kind === "create");

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => treeRef.current,
    estimateSize: () => TREE_ROW_HEIGHT,
    overscan: 20,
  });

  const selected = useMemo(() => new Set(selection.paths), [selection.paths]);
  const cut = useMemo(
    () => new Set(clipboard?.mode === "cut" ? clipboard.paths : []),
    [clipboard],
  );

  // Keyboard focus sits on a row; when that row is gone (deleted, moved) it
  // stays at the same position, which is now the next row.
  const focusRow = (() => {
    if (rows.length === 0) return -1;
    const index =
      selection.focus === null ? -1 : order.indexOf(selection.focus);
    if (index !== -1) return index;
    return Math.min(Math.max(selection.focusIndex, 0), rows.length - 1);
  })();
  const focusedNode = focusRow === -1 ? null : rows[focusRow].node;
  const rowId = (index: number) => `${treeId}-row-${index}`;

  const scrollToPath = (path: string) => {
    const index = itemIndex.get(path);
    if (index !== undefined)
      virtualizer.scrollToIndex(index, { align: "auto" });
  };

  // Scrolls to a file opened elsewhere (a tab, a search result) or revealed.
  // Its folders may still be loading when the request comes in, so each
  // waits for its row to exist, then scrolls once.
  const scrolled = useRef({
    file: null as string | null,
    seq: revealRequest?.seq ?? 0,
  });
  useEffect(() => {
    const done = scrolled.current;
    if (revealRequest && revealRequest.seq !== done.seq) {
      const index = itemIndex.get(revealRequest.path);
      if (index !== undefined) {
        virtualizer.scrollToIndex(index, { align: "auto" });
        done.seq = revealRequest.seq;
        done.file = selectedFile;
        return;
      }
    }
    if (selectedFile !== done.file) {
      const index =
        selectedFile === null ? undefined : itemIndex.get(selectedFile);
      if (selectedFile !== null && index === undefined) return;
      if (index !== undefined) {
        virtualizer.scrollToIndex(index, { align: "auto" });
      }
      done.file = selectedFile;
    }
  }, [revealRequest, selectedFile, itemIndex, virtualizer]);

  // A new item's input comes into view wherever its folder is.
  useEffect(() => {
    if (createIndex !== -1) {
      virtualizer.scrollToIndex(createIndex, { align: "auto" });
    }
  }, [createIndex, virtualizer]);

  /* ─── Selection ─────────────────────────────────────────────── */

  /** Selects `paths` with focus on `focus`; a range starts from `anchor`. */
  const select = (
    paths: string[],
    focus: string | null,
    anchor: string | null = focus,
  ) => {
    const index = focus === null ? -1 : order.indexOf(focus);
    setExplorerSelection({
      paths,
      anchor,
      focus,
      focusIndex: index === -1 ? selection.focusIndex : index,
    });
  };

  /** The selection in on-screen order, then anything selected but hidden. */
  const orderedSelection = () => {
    const visible = order.filter((path) => selected.has(path));
    return [
      ...visible,
      ...selection.paths.filter((path) => !visible.includes(path)),
    ];
  };

  const openNode = (node: WorkspaceFile) => {
    select([node.path], node.path);
    if (node.type === "file") void selectFile(node.path);
    else setFolderExpanded(node.path, !expandedFolders.has(node.path));
  };

  const onRowClick = (event: MouseEvent, node: WorkspaceFile) => {
    if (event.shiftKey) {
      const anchor = selection.anchor ?? node.path;
      select(pathsBetween(order, anchor, node.path), node.path, anchor);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      select(
        selected.has(node.path)
          ? selection.paths.filter((path) => path !== node.path)
          : [...selection.paths, node.path],
        node.path,
      );
      return;
    }
    openNode(node);
  };

  /* ─── Creating and renaming ─────────────────────────────────── */

  const childrenOf = (folder: string) =>
    folder ? findNode(files, folder)?.children : files;

  const startCreate = (parentPath: string, kind: "file" | "folder") => {
    setRenamingPath(null);
    // The new row has to be on screen: under its folder, not filtered away.
    setQuery("");
    if (parentPath) expandFolders([...getAncestors(parentPath), parentPath]);
    setPendingCreate({ parentPath, kind });
  };

  const commitCreate = async (value: string, how: Finish) => {
    const request = pendingCreate;
    setPendingCreate(null);
    if (how !== "blur") treeRef.current?.focus();
    const name = value.trim();
    if (!request || !name) return;
    // The store opens a new file, or reveals a new folder, and selects it.
    await createItem(request.parentPath, name, request.kind === "folder");
  };

  const startRename = (path: string) => {
    setPendingCreate(null);
    expandFolders(getAncestors(path));
    setRenamingPath(path);
    scrollToPath(path);
  };

  const commitRename = async (
    node: WorkspaceFile,
    value: string,
    how: Finish,
  ) => {
    setRenamingPath(null);
    if (how !== "blur") treeRef.current?.focus();
    const name = value.trim();
    if (!name || name === node.name) return;
    // Companions are renamed with it; open tabs, expanded folders and the
    // selection follow in the store.
    await renameItem(node.path, name);
  };

  const cancelInline = (how: Finish) => {
    setRenamingPath(null);
    setPendingCreate(null);
    if (how !== "blur") treeRef.current?.focus();
  };

  /* ─── Delete, move, copy ────────────────────────────────────── */

  const deletePaths = async (paths: string[]) => {
    const targets = topLevelPaths(paths);
    if (targets.length === 0) return;
    const all = await withCompanions(targets);
    const unsaved = Object.keys(useWorkspaceStore.getState().dirty).filter(
      (file) => all.some((path) => isWithin(file, path)),
    );
    const one = targets.length === 1;

    const proceed = await confirm({
      title: one
        ? `Delete ${getBaseName(targets[0])}?`
        : `Delete ${targets.length} items?`,
      message: [
        all.length > targets.length
          ? `The files that belong with ${one ? "it" : "them"} — a -meta.xml, a resource's content — are deleted too, or the metadata left behind could not be deployed.`
          : null,
        unsaved.length > 0
          ? `Unsaved changes in ${unsaved.length} open file${unsaved.length === 1 ? "" : "s"} are lost.`
          : null,
        "Deleting removes the files from disk and can't be undone.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      details: previewList(all),
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (proceed) await deleteItems(targets);
  };

  const moveInto = async (paths: string[], folder: string) => {
    const targets = topLevelPaths(paths).filter(
      (path) => getParentPath(path) !== folder,
    );
    if (targets.length === 0) return;
    const all = await withCompanions(targets);
    const destination = folder ? getBaseName(folder) : "the workspace root";

    // A drop is easy to make by accident, and a moved class can land far
    // from where it was dragged: say what moves, and where.
    const proceed = await confirm({
      title:
        targets.length === 1
          ? `Move ${getBaseName(targets[0])} into ${destination}?`
          : `Move ${targets.length} items into ${destination}?`,
      message: [
        folder ? `To ${folder}` : null,
        all.length > targets.length
          ? `The files that belong with ${targets.length === 1 ? "it" : "them"} — a -meta.xml, a resource's content — move too.`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      details: previewList(all),
      confirmLabel: "Move",
    });
    if (proceed) await moveItems(targets, folder);
  };

  const duplicate = async (paths: string[]) => {
    const byFolder = new Map<string, string[]>();
    for (const path of topLevelPaths(paths)) {
      const folder = getParentPath(path);
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
    }
    for (const [folder, group] of byFolder) await copyItems(group, folder);
  };

  const cutOrCopy = (mode: "cut" | "copy", paths: string[]) => {
    if (paths.length > 0) setClipboard({ mode, paths: topLevelPaths(paths) });
  };

  const copyPaths = (paths: string[], relative: boolean) => {
    const text = (paths.length > 0 ? paths : [""])
      .map((path) => (relative ? path : absolutePath(workspaceRoot, path)))
      .join("\n");
    const what = relative ? "relative path" : "path";
    return copyText(
      text,
      paths.length > 1 ? `${paths.length} ${what}s` : `the ${what}`,
    );
  };

  const deployable = (paths: string[]) =>
    paths.length > 0 &&
    paths.every((path) => isDeployablePath(path, packageDirectories));

  /* ─── Context menu ──────────────────────────────────────────── */

  const openMenu = (x: number, y: number, node: WorkspaceFile | null) => {
    let paths: string[] = [];
    if (node && selected.has(node.path)) {
      // Acting on a selected row acts on the whole selection.
      paths = orderedSelection();
      select(selection.paths, node.path, selection.anchor);
    } else if (node) {
      paths = [node.path];
      select([node.path], node.path);
    }
    setMenu({ x, y, paths, target: node });
  };

  const onRowContextMenu = (event: MouseEvent, node: WorkspaceFile) => {
    event.preventDefault();
    event.stopPropagation();
    treeRef.current?.focus();
    openMenu(event.clientX, event.clientY, node);
  };

  const openMenuFromKeyboard = () => {
    const tree = treeRef.current;
    if (!tree) return;
    const index = focusedNode ? itemIndex.get(focusedNode.path) : undefined;
    const row =
      index === undefined ? null : document.getElementById(rowId(index));
    const rect = (row ?? tree).getBoundingClientRect();
    openMenu(rect.left + 24, row ? rect.bottom : rect.top + 24, focusedNode);
  };

  // Every entry puts focus back on the tree first, so a dialog it opens
  // returns focus there instead of to the menu item that is going away.
  const withTreeFocus =
    <A extends unknown[]>(action: (...args: A) => unknown) =>
    (...args: A) => {
      treeRef.current?.focus();
      void action(...args);
    };

  const menuActions: FileMenuActions = {
    deploy: withTreeFocus((paths: string[]) =>
      deployPathsAction(topLevelPaths(paths)),
    ),
    // Validation needs an org and a test level: the Deployments page has both,
    // with these items preselected.
    validate: (paths) =>
      navigate("/deployments", {
        state: { deployPaths: topLevelPaths(paths) },
      }),
    retrieve: withTreeFocus((paths: string[]) =>
      retrievePathsAction(topLevelPaths(paths)),
    ),
    diff: withTreeFocus((path: string) => openDiff(path)),
    newFile: (folder) => startCreate(folder, "file"),
    newFolder: (folder) => startCreate(folder, "folder"),
    newSource: () => setNewSource(true),
    cut: withTreeFocus((paths: string[]) => cutOrCopy("cut", paths)),
    copy: withTreeFocus((paths: string[]) => cutOrCopy("copy", paths)),
    paste: withTreeFocus((folder: string) => pasteInto(folder)),
    duplicate: withTreeFocus(duplicate),
    copyPath: withTreeFocus((paths: string[]) => copyPaths(paths, false)),
    copyRelativePath: withTreeFocus((paths: string[]) =>
      copyPaths(paths, true),
    ),
    reveal: withTreeFocus((path: string) => revealItem(path)),
    rename: startRename,
    delete: withTreeFocus(deletePaths),
  };

  /* ─── Keyboard ──────────────────────────────────────────────── */

  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keys pressed on a row's own buttons belong to them.
    if (event.target !== event.currentTarget) return;

    const mod = event.ctrlKey || event.metaKey;
    const current = focusedNode;

    const moveFocus = (index: number, extend = event.shiftKey) => {
      if (rows.length === 0) return;
      const target =
        rows[Math.min(Math.max(index, 0), rows.length - 1)].node.path;
      if (extend) {
        const anchor = selection.anchor ?? current?.path ?? target;
        select(pathsBetween(order, anchor, target), target, anchor);
      } else {
        select([target], target);
      }
      scrollToPath(target);
    };
    const pageSize = () =>
      Math.max(
        1,
        Math.floor((treeRef.current?.clientHeight ?? 0) / TREE_ROW_HEIGHT) - 1,
      );

    const handled = ((): boolean => {
      if (mod && !event.altKey) {
        switch (event.key.toLowerCase()) {
          case "a":
            select(order, current?.path ?? null, selection.anchor);
            return true;
          case "c":
            cutOrCopy("copy", orderedSelection());
            return true;
          case "x":
            cutOrCopy("cut", orderedSelection());
            return true;
          case "v":
            void pasteInto(folderOf(current));
            return true;
          case " ":
            if (current) {
              select(
                selected.has(current.path)
                  ? selection.paths.filter((path) => path !== current.path)
                  : [...selection.paths, current.path],
                current.path,
              );
            }
            return true;
        }
        return false;
      }

      // Shift+Alt shortcuts are matched by physical key: with Alt held,
      // `key` is often some other character.
      if (event.altKey) {
        if (!event.shiftKey || mod) return false;
        if (event.code === "KeyC") {
          void copyPaths(orderedSelection(), false);
          return true;
        }
        if (event.code === "KeyR") {
          void revealItem(current?.path ?? "");
          return true;
        }
        return false;
      }

      switch (event.key) {
        case "ArrowDown":
          moveFocus(focusRow + 1);
          return true;
        case "ArrowUp":
          moveFocus(focusRow - 1);
          return true;
        case "Home":
          moveFocus(0);
          return true;
        case "End":
          moveFocus(rows.length - 1);
          return true;
        case "PageDown":
          moveFocus(focusRow + pageSize());
          return true;
        case "PageUp":
          moveFocus(focusRow - pageSize());
          return true;
        case "ArrowRight": {
          if (current?.type !== "folder") return true;
          const open = isFiltering || expandedFolders.has(current.path);
          if (!open) {
            if (current.hasChildren ?? Boolean(current.children)) {
              setFolderExpanded(current.path, true);
            }
          } else if ((rows[focusRow + 1]?.depth ?? -1) > rows[focusRow].depth) {
            moveFocus(focusRow + 1, false);
          }
          return true;
        }
        case "ArrowLeft": {
          if (!current) return true;
          if (
            current.type === "folder" &&
            !isFiltering &&
            expandedFolders.has(current.path)
          ) {
            setFolderExpanded(current.path, false);
          } else {
            const parent = order.indexOf(getParentPath(current.path));
            if (parent !== -1) moveFocus(parent, false);
          }
          return true;
        }
        case "Enter":
        case " ":
          if (current) openNode(current);
          return true;
        case "F2":
          if (current) startRename(current.path);
          return true;
        case "Delete":
          void deletePaths(orderedSelection());
          return true;
        case "Escape":
          if (clipboard) setClipboard(null);
          select([], current?.path ?? null, null);
          return true;
        case "ContextMenu":
          openMenuFromKeyboard();
          return true;
        case "F10":
          if (!event.shiftKey) return false;
          openMenuFromKeyboard();
          return true;
      }

      // Typing a name jumps to the next entry that starts with it.
      if (event.key.length === 1 && rows.length > 0) {
        const fresh =
          event.timeStamp - typeAhead.current.at > TYPE_AHEAD_RESET_MS;
        const text =
          (fresh ? "" : typeAhead.current.text) + event.key.toLowerCase();
        typeAhead.current = { text, at: event.timeStamp };
        // One letter moves on to the next match; a longer prefix may stay put.
        const start = text.length === 1 ? focusRow + 1 : Math.max(focusRow, 0);
        for (let step = 0; step < rows.length; step += 1) {
          const index = (start + step) % rows.length;
          if (rows[index].node.name.toLowerCase().startsWith(text)) {
            moveFocus(index, false);
            break;
          }
        }
        return true;
      }
      return false;
    })();

    if (handled) event.preventDefault();
  };

  /* ─── Drag and drop ─────────────────────────────────────────── */

  const cancelDragExpand = () => {
    if (dragExpand.current) window.clearTimeout(dragExpand.current.timer);
    dragExpand.current = null;
  };

  const endDrag = () => {
    dragPaths.current = [];
    cancelDragExpand();
    setDropTarget(null);
  };

  const onRowDragStart = (event: DragEvent, node: WorkspaceFile) => {
    const paths = selected.has(node.path) ? orderedSelection() : [node.path];
    if (!selected.has(node.path)) select([node.path], node.path);
    dragPaths.current = topLevelPaths(paths);
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragPaths.current));
    event.dataTransfer.setData("text/plain", dragPaths.current.join("\n"));
    if (dragPaths.current.length > 1) {
      showDragCount(event, dragPaths.current.length);
    }
  };

  /** Whether the dragged items can go into `folder`. */
  const acceptsDrop = (folder: string, copy: boolean) => {
    const paths = dragPaths.current;
    if (paths.length === 0) return false;
    // Never into itself or its own contents.
    if (paths.some((path) => isWithin(folder, path))) return false;
    // A move needs somewhere new to go; a copy into the same folder duplicates.
    return copy || paths.some((path) => getParentPath(path) !== folder);
  };

  const onDragOverTarget = (event: DragEvent, node: WorkspaceFile | null) => {
    // Files dragged in from outside the app carry no path to work with.
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.stopPropagation();
    const folder = folderOf(node);
    const copy = event.ctrlKey;

    if (!acceptsDrop(folder, copy)) {
      event.dataTransfer.dropEffect = "none";
      if (dropTarget !== null) setDropTarget(null);
      cancelDragExpand();
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = copy ? "copy" : "move";
    if (dropTarget !== folder) setDropTarget(folder);

    // Hovering a closed folder opens it, so a drop can go deeper.
    if (node?.type === "folder" && !expandedFolders.has(node.path)) {
      if (dragExpand.current?.path !== node.path) {
        cancelDragExpand();
        dragExpand.current = {
          path: node.path,
          timer: window.setTimeout(() => {
            dragExpand.current = null;
            setFolderExpanded(node.path, true);
          }, DRAG_EXPAND_DELAY_MS),
        };
      }
    } else {
      cancelDragExpand();
    }
  };

  const onDropTarget = (event: DragEvent, node: WorkspaceFile | null) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    const folder = folderOf(node);
    const copy = event.ctrlKey;
    const paths = dragPaths.current;
    const accepted = acceptsDrop(folder, copy);
    endDrag();
    if (!accepted) return;

    treeRef.current?.focus();
    if (copy) void copyItems(paths, folder);
    else void moveInto(paths, folder);
  };

  /* ─── Render ────────────────────────────────────────────────── */

  if (!loaded) {
    return (
      <section className="workspace-explorer">
        <div className="workspace-explorer__empty">Loading workspace…</div>
      </section>
    );
  }

  // New items from the header go where the keyboard focus is.
  const headerTarget = selection.paths.length > 0 ? folderOf(focusedNode) : "";
  const activeIndex = focusedNode ? itemIndex.get(focusedNode.path) : undefined;
  const hasOrg = Boolean(organization);

  return (
    <section className="workspace-explorer">
      {files.length > 0 && (
        <div className="workspace-explorer__search">
          <Search size={13} className="workspace-explorer__search-icon" />
          <input
            className="workspace-explorer__search-input"
            type="text"
            value={query}
            placeholder="Search files…"
            aria-label="Filter files by name"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") setQuery("");
              // Down arrow continues into the results.
              if (event.key === "ArrowDown" && rows.length > 0) {
                event.preventDefault();
                treeRef.current?.focus();
              }
            }}
          />
          {isFiltering && (
            <button
              type="button"
              className="workspace-explorer__search-clear"
              title="Clear"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Project section header with hover-revealed tools */}
      <div
        className="workspace-explorer__section"
        title={workspaceName || files[0]?.name}
      >
        <span className="workspace-explorer__section-name">
          {(workspaceName || files[0]?.name || "PROJECT").toUpperCase()}
        </span>
        <div className="workspace-explorer__section-actions">
          <button
            type="button"
            className="workspace-explorer__section-tool"
            title="New File…"
            aria-label="New file"
            onClick={() => startCreate(headerTarget, "file")}
          >
            <FilePlus2 size={14} />
          </button>
          <button
            type="button"
            className="workspace-explorer__section-tool"
            title="New Folder…"
            aria-label="New folder"
            onClick={() => startCreate(headerTarget, "folder")}
          >
            <FolderPlus size={14} />
          </button>
          <button
            type="button"
            className="workspace-explorer__section-tool"
            title="New Salesforce source — class, trigger, LWC, Aura, Visualforce"
            aria-label="New Salesforce source"
            onClick={() => setNewSource(true)}
          >
            <Sparkles size={14} />
          </button>
          <span className="workspace-explorer__section-sep" aria-hidden />
          <button
            type="button"
            className="workspace-explorer__section-tool"
            title="Refresh Explorer"
            aria-label="Refresh explorer"
            onClick={() => void refreshFiles()}
          >
            <RotateCw size={13} />
          </button>
          <button
            type="button"
            className="workspace-explorer__section-tool"
            title="Collapse Folders in Explorer"
            aria-label="Collapse folders"
            onClick={collapseFolders}
          >
            <ChevronsDownUp size={13} />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="workspace-explorer__empty">
          {isFiltering ? (
            <p>No file names match “{query.trim()}”.</p>
          ) : (
            <>
              {/* The workspace is open — it just has nothing in it yet. */}
              <p>This folder is empty.</p>
              <p className="workspace-explorer__empty-hint">
                Retrieve metadata from your org, or add files yourself.
              </p>
              <div className="workspace-explorer__empty-actions">
                <button
                  type="button"
                  className="fw-btn fw-btn--primary"
                  onClick={openRetrieve}
                >
                  Retrieve Metadata
                </button>
                <button
                  type="button"
                  className="fw-btn"
                  onClick={() => startCreate("", "file")}
                >
                  New File
                </button>
                <button
                  type="button"
                  className="fw-btn"
                  onClick={() => void openFolder()}
                >
                  Open Folder…
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div
          ref={treeRef}
          className={cls(
            "workspace-explorer__tree",
            dropTarget === "" && "is-drop-target",
          )}
          role="tree"
          aria-label="Files"
          aria-multiselectable
          aria-activedescendant={
            activeIndex === undefined ? undefined : rowId(activeIndex)
          }
          tabIndex={0}
          onKeyDown={onTreeKeyDown}
          onContextMenu={(event) => {
            event.preventDefault();
            openMenu(event.clientX, event.clientY, null);
          }}
          onDragOver={(event) => onDragOverTarget(event, null)}
          onDrop={(event) => onDropTarget(event, null)}
          onDragLeave={(event) => {
            const next = event.relatedTarget as Node | null;
            if (!next || !event.currentTarget.contains(next)) {
              setDropTarget(null);
              cancelDragExpand();
            }
          }}
        >
          <div
            className="workspace-explorer__rows"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              const style = {
                transform: `translateY(${virtualRow.start}px)`,
                height: TREE_ROW_HEIGHT,
              };

              if (item.kind === "create") {
                return (
                  <div
                    key={CREATE_ROW_KEY}
                    className="workspace-explorer__row is-editing"
                    style={style}
                  >
                    <div
                      className="fw-tree__inline-row"
                      onContextMenu={(event) => event.stopPropagation()}
                    >
                      {Array.from({ length: item.depth }).map((_, index) => (
                        <span
                          key={index}
                          className="fw-tree__guide"
                          aria-hidden
                        />
                      ))}
                      <span className="fw-tree__chevron" />
                      <span className="fw-tree__icon">
                        {item.type === "file" ? (
                          <FileText size={15} className="fw-tree__file-icon" />
                        ) : (
                          <Folder size={15} className="fw-tree__folder" />
                        )}
                      </span>
                      <InlineInput
                        label={
                          item.type === "file"
                            ? "New file name"
                            : "New folder name"
                        }
                        placeholder={
                          item.type === "file"
                            ? "AccountService.cls"
                            : "folder-name"
                        }
                        validate={(value) =>
                          entryNameProblem(value, {
                            siblings: childrenOf(item.parentPath),
                            newFile: item.type === "file",
                          })
                        }
                        onCommit={(value, how) => void commitCreate(value, how)}
                        onCancel={cancelInline}
                      />
                    </div>
                  </div>
                );
              }

              const { node, depth } = item;
              if (renamingPath === node.path) {
                return (
                  <div
                    key={node.path}
                    className="workspace-explorer__row is-editing"
                    style={style}
                  >
                    <div
                      className="fw-tree__inline-row"
                      onContextMenu={(event) => event.stopPropagation()}
                    >
                      {Array.from({ length: depth }).map((_, index) => (
                        <span
                          key={index}
                          className="fw-tree__guide"
                          aria-hidden
                        />
                      ))}
                      <span className="fw-tree__chevron" />
                      <span className="fw-tree__icon">
                        {node.type === "file" ? (
                          <TreeFileIcon name={node.name} />
                        ) : (
                          <Folder size={15} className="fw-tree__folder" />
                        )}
                      </span>
                      <InlineInput
                        label={`Rename ${node.name}`}
                        defaultValue={node.name}
                        selectStem={node.type === "file"}
                        validate={(value) =>
                          entryNameProblem(value, {
                            siblings: childrenOf(getParentPath(node.path)),
                            current: node.path,
                          })
                        }
                        onCommit={(value, how) =>
                          void commitRename(node, value, how)
                        }
                        onCancel={cancelInline}
                      />
                    </div>
                  </div>
                );
              }

              const isFile = node.type === "file";
              const canDeploy =
                hasOrg && isDeployablePath(node.path, packageDirectories);

              return (
                <div
                  key={node.path}
                  className="workspace-explorer__row"
                  style={style}
                >
                  <TreeRow
                    item={item}
                    id={rowId(virtualRow.index)}
                    isExpanded={isFiltering || expandedFolders.has(node.path)}
                    isLoading={loadingFolders.has(node.path)}
                    isSelected={selected.has(node.path)}
                    isFocused={focusedNode?.path === node.path}
                    isActive={selectedFile === node.path}
                    isDirty={isFile && (dirtyMap[node.path] ?? false)}
                    isOpenTab={isFile && openFiles.includes(node.path)}
                    isCut={cut.has(node.path)}
                    isDropTarget={
                      dropTarget !== null &&
                      dropTarget !== "" &&
                      isWithin(node.path, dropTarget)
                    }
                    deploy={
                      canDeploy
                        ? {
                            title: `Deploy to ${organization?.alias}`,
                            disabled: deploying,
                          }
                        : undefined
                    }
                    onClick={onRowClick}
                    onContextMenu={onRowContextMenu}
                    onDeploy={(path) => void deployPathsAction([path])}
                    onStartCreate={startCreate}
                    onDragStart={onRowDragStart}
                    onDragOver={onDragOverTarget}
                    onDrop={onDropTarget}
                    onDragEnd={endDrag}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {menu && (
        <FileContextMenu
          x={menu.x}
          y={menu.y}
          paths={menu.paths}
          target={
            menu.target
              ? { path: menu.target.path, type: menu.target.type }
              : null
          }
          hasOrg={hasOrg}
          deployable={deployable(menu.paths)}
          canPaste={Boolean(clipboard?.paths.length)}
          onClose={() => setMenu(null)}
          actions={menuActions}
        />
      )}

      {newSource && <NewSourceDialog onClose={() => setNewSource(false)} />}
    </section>
  );
}
