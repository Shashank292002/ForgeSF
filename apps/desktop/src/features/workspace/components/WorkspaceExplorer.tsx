import { createElement, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronsDownUp,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  RotateCw,
  Search,
  X,
} from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import type { WorkspaceFile } from "../types";
import { iconForFile } from "../lib/fileIcons";
import { findNode, getAncestors, getParentPath } from "../lib/workspaceUtils";
import FileContextMenu from "./FileContextMenu";

import "./WorkspaceExplorer.css";

interface PendingCreate {
  parentPath: string;
  kind: "file" | "folder";
}

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

/* ─── Recursive tree row ─────────────────────────────────────── */

interface TreeNodeProps {
  node: WorkspaceFile;
  level: number;
  expanded: Set<string>;
  forceExpand: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  selected: string | null;
  dirty: (path: string) => boolean;
  isOpen: (path: string) => boolean;
  renamingPath: string | null;
  onStartRename: (path: string) => void;
  onCommitRename: (path: string, value: string) => void;
  onCancelRename: () => void;
  creating: PendingCreate | null;
  onStartCreate: (parentPath: string, kind: "file" | "folder") => void;
  onCommitCreate: (parentPath: string, name: string) => void;
  onCancelCreate: () => void;
  onOpenContext: (
    event: React.MouseEvent,
    path: string,
    type: WorkspaceFile["type"],
  ) => void;
}

function TreeNode({
  node,
  level,
  expanded,
  forceExpand,
  onToggle,
  onSelect,
  selected,
  dirty,
  isOpen,
  renamingPath,
  onStartRename,
  onCommitRename,
  onCancelRename,
  creating,
  onStartCreate,
  onCommitCreate,
  onCancelCreate,
  onOpenContext,
}: TreeNodeProps) {
  const isFile = node.type === "file";
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isCollapsed = !forceExpand && !expanded.has(node.path);
  const isActive = selected === node.path;
  const isDirty = isFile && dirty(node.path);
  const isOpenTab = isFile && isOpen(node.path);
  const isRenaming = renamingPath === node.path;

  return (
    <div className="fw-tree-node" role="none">
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
        aria-expanded={
          isFile ? undefined : hasChildren ? !isCollapsed : undefined
        }
        tabIndex={0}
        onClick={() => {
          if (isFile || forceExpand) onSelect(node.path);
          else if (hasChildren) onToggle(node.path);
        }}
        onDoubleClick={() => {
          if (!isFile && hasChildren) onToggle(node.path);
        }}
        onContextMenu={(event) => onOpenContext(event, node.path, node.type)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (isFile) onSelect(node.path);
            else if (hasChildren) onToggle(node.path);
          }
          if (event.key === "F2") {
            event.preventDefault();
            onStartRename(node.path);
          }
        }}
      >
        {Array.from({ length: level }).map((_, index) => (
          <span key={index} className="fw-tree__guide" aria-hidden />
        ))}

        <span
          className="fw-tree__chevron"
          onClick={(event) => {
            if (!isFile && hasChildren) {
              event.stopPropagation();
              onToggle(node.path);
            }
          }}
        >
          {!isFile && hasChildren ? (
            <ChevronRight
              size={14}
              className={`fw-tree__chevron-icon ${isCollapsed ? "" : "is-open"}`}
            />
          ) : null}
        </span>

        <span className="fw-tree__icon">
          {isFile ? (
            <TreeFileIcon name={node.name} muted={isDirty} />
          ) : isCollapsed ? (
            <Folder size={15} className="fw-tree__folder" />
          ) : (
            <FolderOpen
              size={15}
              className="fw-tree__folder fw-tree__folder--open"
            />
          )}
        </span>

        {!isRenaming && <span className="fw-tree__name">{node.name}</span>}

        {!isFile && !isRenaming && (
          <span className="fw-tree__row-actions">
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
          </span>
        )}

        {isDirty && !isRenaming && (
          <span className="fw-tree__dirty" title="Unsaved changes" />
        )}
        {isOpenTab && !isActive && !isDirty && !isRenaming && (
          <span className="fw-tree__tab-dot" title="Open in editor" />
        )}
      </div>

      {isRenaming && (
        <div className="fw-tree__inline-row">
          {Array.from({ length: level }).map((_, index) => (
            <span key={index} className="fw-tree__guide" aria-hidden />
          ))}
          <span className="fw-tree__chevron" />
          <InlineInput
            defaultValue={node.name}
            onCommit={(value) => onCommitRename(node.path, value)}
            onCancel={onCancelRename}
          />
        </div>
      )}

      {/* VS Code-style inline creation inside the target folder */}
      {!isFile &&
        creating &&
        creating.parentPath === node.path &&
        !isCollapsed && (
          <div className="fw-tree__inline-row">
            {Array.from({ length: level + 1 }).map((_, index) => (
              <span key={index} className="fw-tree__guide" aria-hidden />
            ))}
            <span className="fw-tree__chevron" />
            <span className="fw-tree__icon">
              {creating.kind === "file" ? (
                <FileText size={15} className="fw-tree__file-icon" />
              ) : (
                <Folder size={15} className="fw-tree__folder" />
              )}
            </span>
            <InlineInput
              placeholder={
                creating.kind === "file" ? "file-name.cls" : "folder-name"
              }
              onCommit={(value) => onCommitCreate(node.path, value)}
              onCancel={onCancelCreate}
            />
          </div>
        )}

      {!isFile && hasChildren && !isCollapsed && (
        <div className="fw-tree__children" role="group">
          {node.children!.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              level={level + 1}
              expanded={expanded}
              forceExpand={forceExpand}
              onToggle={onToggle}
              onSelect={onSelect}
              selected={selected}
              dirty={dirty}
              isOpen={isOpen}
              renamingPath={renamingPath}
              onStartRename={onStartRename}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              creating={creating}
              onStartCreate={onStartCreate}
              onCommitCreate={onCommitCreate}
              onCancelCreate={onCancelCreate}
              onOpenContext={onOpenContext}
            />
          ))}
        </div>
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

  const toggleExpand = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

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

      <div className="workspace-explorer__tree" role="tree" aria-label="Files">
        {filteredFiles.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            level={0}
            expanded={effectiveExpanded}
            forceExpand={isFiltering}
            onToggle={toggleExpand}
            onSelect={(path) => void selectFile(path)}
            selected={selectedFile}
            dirty={dirty}
            isOpen={isPathOpen}
            renamingPath={renamingPath}
            onStartRename={(path) => {
              setPendingCreate(null);
              setRenamingPath(path);
            }}
            onCommitRename={(path, value) => {
              if (value.trim()) void renameItem(path, value.trim());
              setRenamingPath(null);
            }}
            onCancelRename={() => setRenamingPath(null)}
            creating={pendingCreate}
            onStartCreate={startCreate}
            onCommitCreate={commitCreate}
            onCancelCreate={() => setPendingCreate(null)}
            onOpenContext={handleOpenContext}
          />
        ))}

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
          onClose={() => setContextMenu(null)}
          onNewFile={(target) => startCreate(target, "file")}
          onNewFolder={(target) => startCreate(target, "folder")}
          onRename={menuRename}
          onDelete={menuDelete}
        />
      )}
    </section>
  );
}
