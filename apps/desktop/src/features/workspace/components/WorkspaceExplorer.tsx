import { createElement, useEffect, useMemo, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useWorkspaceStore } from "../store/workspaceStore";
import { useOrganizationStore } from "../../../store/orgStore";
import type { WorkspaceFile } from "../types";
import { iconForFile } from "../lib/fileIcons";
import {
  findNode,
  flattenVisible,
  getAncestors,
  getParentPath,
} from "../lib/workspaceUtils";
import FileContextMenu from "./FileContextMenu";

import "./WorkspaceExplorer.css";

interface PendingCreate {
  parentPath: string;
  kind: "file" | "folder";
}

/** Row height in px — must match `.fw-tree-row` in WorkspaceExplorer.css. */
const TREE_ROW_HEIGHT = 23;

/* ─── Inline text input shared by rename + create ────────────── */

function InlineInput({
  defaultValue = "",
  placeholder,
  onCommit,
  onCancel,
}: {
  defaultValue?: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  // Escape unmounts this input, which makes React fire `blur` on the way out.
  // Without this flag that blur committed the very edit Escape just cancelled.
  const cancelled = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  return (
    <input
      ref={inputRef}
      className="fw-tree__inline-input"
      value={value}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          cancelled.current = false;
          onCommit(value);
        }
        if (event.key === "Escape") {
          cancelled.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (cancelled.current) return;
        onCommit(value);
      }}
    />
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
  node: WorkspaceFile;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  isActive: boolean;
  isDirty: boolean;
  isOpenTab: boolean;
  isRenaming: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onStartRename: (path: string) => void;
  onCommitRename: (path: string, value: string) => void;
  onCancelRename: () => void;
  onStartCreate: (parentPath: string, kind: "file" | "folder") => void;
  /** Inline deploy — omitted when no org is connected. */
  onDeploy?: (path: string) => void;
  deployDisabled: boolean;
  deployTitle: string;
  onOpenContext: (
    event: React.MouseEvent,
    path: string,
    type: WorkspaceFile["type"],
  ) => void;
}

function TreeRow({
  node,
  depth,
  isExpanded,
  isLoading,
  isActive,
  isDirty,
  isOpenTab,
  isRenaming,
  onToggle,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onStartCreate,
  onDeploy,
  deployDisabled,
  deployTitle,
  onOpenContext,
}: TreeRowProps) {
  const isFile = node.type === "file";
  // A folder can be expandable before its children are loaded, so trust the
  // backend's `hasChildren` rather than the presence of a children array.
  const expandable = !isFile && (node.hasChildren ?? Boolean(node.children));

  if (isRenaming) {
    return (
      <div className="fw-tree__inline-row">
        {Array.from({ length: depth }).map((_, index) => (
          <span key={index} className="fw-tree__guide" aria-hidden />
        ))}
        <span className="fw-tree__chevron" />
        <InlineInput
          defaultValue={node.name}
          onCommit={(value) => onCommitRename(node.path, value)}
          onCancel={onCancelRename}
        />
      </div>
    );
  }

  return (
    <div
      className={[
        "fw-tree-row",
        isFile ? "is-file" : "is-folder",
        isActive ? "is-selected" : "",
        isOpenTab && !isActive ? "is-open" : "",
        isDirty ? "is-dirty" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-path={node.path}
      role="treeitem"
      aria-selected={isActive}
      aria-level={depth + 1}
      aria-expanded={isFile ? undefined : expandable ? isExpanded : undefined}
      tabIndex={0}
      onClick={() => (isFile ? onSelect(node.path) : onToggle(node.path))}
      onContextMenu={(event) => onOpenContext(event, node.path, node.type)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (isFile) onSelect(node.path);
          else onToggle(node.path);
        }
        if (event.key === "F2") {
          event.preventDefault();
          onStartRename(node.path);
        }
      }}
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

      <span className="fw-tree__row-actions">
        {onDeploy && (
          <button
            type="button"
            className="fw-tree__row-btn"
            title={deployTitle}
            disabled={deployDisabled}
            onMouseDown={(event) => event.stopPropagation()}
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
            onMouseDown={(event) => event.stopPropagation()}
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
            onMouseDown={(event) => event.stopPropagation()}
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

/* ─── WorkspaceExplorer component ─────────────────────────────── */

export default function WorkspaceExplorer() {
  const files = useWorkspaceStore((state) => state.files);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const loaded = useWorkspaceStore((state) => state.loaded);
  const refreshFiles = useWorkspaceStore((state) => state.refreshFiles);
  const createItem = useWorkspaceStore((state) => state.createItem);
  const renameItem = useWorkspaceStore((state) => state.renameItem);
  const deleteItem = useWorkspaceStore((state) => state.deleteItem);
  const openFolder = useWorkspaceStore((state) => state.openFolder);
  const workspaceName = useWorkspaceStore((state) => state.workspaceName);
  const revealRequest = useWorkspaceStore((state) => state.revealRequest);
  const loadFolder = useWorkspaceStore((state) => state.loadFolder);
  const loadFullTree = useWorkspaceStore((state) => state.loadFullTree);
  const loadingFolders = useWorkspaceStore((state) => state.loadingFolders);
  const deployPathsAction = useWorkspaceStore((state) => state.deployPathsAction);
  const retrievePathsAction = useWorkspaceStore(
    (state) => state.retrievePathsAction,
  );
  const openDiff = useWorkspaceStore((state) => state.openDiff);
  const deploying = useWorkspaceStore((state) => state.deploying);
  const organization = useOrganizationStore(
    (state) => state.selectedOrganization,
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
    null,
  );
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    type: string;
  } | null>(null);

  // Subscribed, not read via getState(): an imperative snapshot does not
  // re-render this component, so the unsaved-changes dots only refreshed when
  // some *other* subscribed value happened to change.
  const dirtyMap = useWorkspaceStore((state) => state.dirty);
  const dirty = (path: string) => dirtyMap[path] ?? false;
  const isPathOpen = (path: string) => openFiles.includes(path);

  const expandPaths = (paths: string[]) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const path of paths) next.add(path);
      return next;
    });

  /* Effective expansion = user-expanded set + ancestors of the active
     file and latest reveal request, so the opened file stays visible
     ("Reveal in Explorer" behaviour) without cascading state updates. */
  const effectiveExpanded = useMemo(() => {
    const next = new Set(expanded);
    if (selectedFile) {
      for (const ancestor of getAncestors(selectedFile)) next.add(ancestor);
    }
    if (revealRequest) {
      for (const ancestor of getAncestors(revealRequest.path)) {
        next.add(ancestor);
      }
    }
    return next;
  }, [expanded, selectedFile, revealRequest]);

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
        isFiltering ? true : effectiveExpanded.has(path),
      ),
    [filteredFiles, effectiveExpanded, isFiltering],
  );

  // Fetch contents for anything expanded but not yet read — covers expanding a
  // folder, revealing a file inside one, and re-expansion after a refresh.
  useEffect(() => {
    for (const { node } of rows) {
      if (
        node.type === "folder" &&
        node.children === undefined &&
        (node.hasChildren ?? false) &&
        effectiveExpanded.has(node.path)
      ) {
        void loadFolder(node.path);
      }
    }
  }, [rows, effectiveExpanded, loadFolder]);

  /** Where the inline create input sits, and how deep it is indented. */
  const createRow = useMemo(() => {
    if (!pendingCreate || !pendingCreate.parentPath) return null;
    const index = rows.findIndex(
      (row) => row.node.path === pendingCreate.parentPath,
    );
    if (index === -1) return null;
    return {
      offset: (index + 1) * TREE_ROW_HEIGHT,
      depth: rows[index].depth + 1,
    };
  }, [pendingCreate, rows]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TREE_ROW_HEIGHT,
    overscan: 20,
  });

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    void loadFolder(path);
  };

  const startCreate = (parentPath: string, kind: "file" | "folder") => {
    setRenamingPath(null);
    expandPaths([...getAncestors(parentPath), parentPath]);
    setPendingCreate({ parentPath, kind });
  };

  const commitCreate = (parentPath: string, name: string) => {
    if (name.trim()) {
      void createItem(
        parentPath,
        name.trim(),
        pendingCreate?.kind === "folder",
      );
    }
    setPendingCreate(null);
  };

  const handleOpenContext = (
    event: React.MouseEvent,
    path: string,
    type: string,
  ) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, path, type });
  };

  /* Context-menu actions reuse the exact same store operations as the
     tree UI — only the presentation differs (inline instead of prompts). */
  const menuRename = (path: string) => {
    setPendingCreate(null);
    expandPaths(getAncestors(path));
    setRenamingPath(path);
  };
  const menuDelete = (path: string) => {
    if (window.confirm(`Delete "${path}"? This cannot be undone.`)) {
      void deleteItem(path);
    }
  };

  /* Toolbar create targets the folder of the current selection. */
  const toolbarCreateTarget = (() => {
    if (!selectedFile) return "";
    const node = findNode(files, selectedFile);
    if (!node) return "";
    return node.type === "folder" ? node.path : getParentPath(node.path);
  })();

  if (!loaded || !files.length) {
    return (
      <section className="workspace-explorer">
        <div className="workspace-explorer__empty">
          {loaded ? (
            <>
              <p>No workspace open.</p>
              <button
                type="button"
                className="fw-btn fw-btn--primary"
                onClick={() => void openFolder()}
              >
                Open Folder
              </button>
            </>
          ) : (
            "Loading workspace…"
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-explorer">
      {/* File filter box */}
      <div className="workspace-explorer__search">
        <Search size={13} className="workspace-explorer__search-icon" />
        <input
          className="workspace-explorer__search-input"
          type="text"
          value={query}
          placeholder="Search files…"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") setQuery("");
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
            onClick={() => startCreate(toolbarCreateTarget, "file")}
          >
            <FilePlus2 size={14} />
          </button>
          <button
            type="button"
            className="workspace-explorer__section-tool"
            title="New Folder…"
            aria-label="New folder"
            onClick={() => startCreate(toolbarCreateTarget, "folder")}
          >
            <FolderPlus size={14} />
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
            onClick={() => setExpanded(new Set())}
          >
            <ChevronsDownUp size={13} />
          </button>
        </div>
      </div>

      <div
        className="workspace-explorer__tree"
        role="tree"
        aria-label="Files"
        ref={scrollRef}
      >
        <div
          className="workspace-explorer__rows"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const { node, depth } = rows[row.index];

            return (
              <div
                key={node.path}
                className="workspace-explorer__row"
                style={{
                  transform: `translateY(${row.start}px)`,
                  height: TREE_ROW_HEIGHT,
                }}
              >
                <TreeRow
                  node={node}
                  depth={depth}
                  isExpanded={isFiltering || effectiveExpanded.has(node.path)}
                  isLoading={loadingFolders.has(node.path)}
                  isActive={selectedFile === node.path}
                  isDirty={node.type === "file" && dirty(node.path)}
                  isOpenTab={node.type === "file" && isPathOpen(node.path)}
                  isRenaming={renamingPath === node.path}
                  onToggle={toggleExpand}
                  onSelect={(path) => void selectFile(path)}
                  onStartRename={(path) => {
                    setPendingCreate(null);
                    setRenamingPath(path);
                  }}
                  onCommitRename={(path, value) => {
                    if (value.trim()) void renameItem(path, value.trim());
                    setRenamingPath(null);
                  }}
                  onCancelRename={() => setRenamingPath(null)}
                  onStartCreate={startCreate}
                  onDeploy={
                    organization
                      ? (target) => void deployPathsAction([target])
                      : undefined
                  }
                  deployDisabled={deploying}
                  deployTitle={
                    organization
                      ? `Deploy to ${organization.alias}`
                      : "Connect an org to deploy"
                  }
                  onOpenContext={handleOpenContext}
                />
              </div>
            );
          })}

          {/* Inline creation, positioned just under its parent row rather
              than nested inside it: virtual rows have a fixed height. */}
          {createRow && (
            <div
              className="fw-tree__inline-row workspace-explorer__row"
              style={{
                transform: `translateY(${createRow.offset}px)`,
                height: TREE_ROW_HEIGHT,
              }}
            >
              {Array.from({ length: createRow.depth }).map((_, index) => (
                <span key={index} className="fw-tree__guide" aria-hidden />
              ))}
              <span className="fw-tree__chevron" />
              <span className="fw-tree__icon">
                {pendingCreate?.kind === "file" ? (
                  <FileText size={15} className="fw-tree__file-icon" />
                ) : (
                  <Folder size={15} className="fw-tree__folder" />
                )}
              </span>
              <InlineInput
                placeholder={
                  pendingCreate?.kind === "file"
                    ? "file-name.cls"
                    : "folder-name"
                }
                onCommit={(value) =>
                  commitCreate(pendingCreate?.parentPath ?? "", value)
                }
                onCancel={() => setPendingCreate(null)}
              />
            </div>
          )}
        </div>

        {/* Root-level inline creation */}
        {pendingCreate && !pendingCreate.parentPath && (
          <div className="fw-tree__inline-row">
            <span className="fw-tree__chevron" />
            <span className="fw-tree__icon">
              {pendingCreate.kind === "file" ? (
                <FileText size={15} className="fw-tree__file-icon" />
              ) : (
                <Folder size={15} className="fw-tree__folder" />
              )}
            </span>
            <InlineInput
              placeholder={
                pendingCreate.kind === "file" ? "file-name.cls" : "folder-name"
              }
              onCommit={(value) => {
                if (value.trim()) {
                  void createItem(
                    "",
                    value.trim(),
                    pendingCreate.kind === "folder",
                  );
                }
                setPendingCreate(null);
              }}
              onCancel={() => setPendingCreate(null)}
            />
          </div>
        )}
      </div>

      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          path={contextMenu.path}
          type={contextMenu.type === "folder" ? "folder" : "file"}
          hasOrg={Boolean(organization)}
          onClose={() => setContextMenu(null)}
          onDeploy={(target) => void deployPathsAction([target])}
          onRetrieve={(target) => void retrievePathsAction([target])}
          onDiff={(target) => void openDiff(target)}
          onNewFile={(target) => startCreate(target, "file")}
          onNewFolder={(target) => startCreate(target, "folder")}
          onRename={menuRename}
          onDelete={menuDelete}
        />
      )}
    </section>
  );
}
