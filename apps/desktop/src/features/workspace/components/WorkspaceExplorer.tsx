import { createElement, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronsDownUp,
  FileText,
  Folder,
  FolderPlus,
  RotateCw,
} from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import type { WorkspaceFile, WorkspaceFileType } from "../types";
import { iconForFile } from "../lib/fileIcons";
import FileContextMenu from "./FileContextMenu";

import "./WorkspaceExplorer.css";

interface PendingCreate {
  parentPath: string;
  kind: "file" | "folder";
}

interface RenameState {
  path: string;
  value: string;
}

/* ─── Inline rename input ────────────────────────────────────── */

function RenameInput({
  defaultValue,
  onCommit,
  onCancel,
}: {
  defaultValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

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
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") onCommit(value);
        if (event.key === "Escape") onCancel();
      }}
      onBlur={() => onCommit(value)}
    />
  );
}

/* ─── Recursive tree row ─────────────────────────────────────── */

interface TreeNodeProps {
  node: WorkspaceFile;
  level: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  selected: string | null;
  dirty: (path: string) => boolean;
  renaming: RenameState | null;
  onStartRename: (path: string) => void;
  onCommitRename: (path: string, value: string) => void;
  onCancelRename: () => void;
  onCreateIn: (parentPath: string, kind: "file" | "folder") => void;
  onOpenContext: (
    event: React.MouseEvent,
    path: string,
    type: WorkspaceFileType,
  ) => void;
}

function TreeNode({
  node,
  level,
  expanded,
  onToggle,
  onSelect,
  selected,
  dirty,
  renaming,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onCreateIn,
  onOpenContext,
}: TreeNodeProps) {
  const isFile = node.type === "file";
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isCollapsed = !expanded.has(node.path);
  const indent = 8 + level * 12;
  const isRenaming = renaming?.path === node.path;

  return (
    <div className="fw-tree-node">
      <div
        className={`fw-tree-row ${isFile ? "is-file" : "is-folder"} ${
          selected === node.path ? "is-selected" : ""
        }`}
        style={{ paddingLeft: `${indent}px` }}
        data-path={node.path}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (isFile) onSelect(node.path);
          else if (hasChildren) onToggle(node.path);
        }}
        onContextMenu={(event) => onOpenContext(event, node.path, node.type)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (isFile) onSelect(node.path);
            else if (hasChildren) onToggle(node.path);
          }
          if (event.key === "F2") onStartRename(node.path);
        }}
      >
        <span className="fw-tree__chevron">
          {isFile || !hasChildren ? null : (
            <ChevronRight
              size={14}
              className={`fw-tree__chevron-icon ${isCollapsed ? "" : "is-open"}`}
            />
          )}
        </span>

        <span className="fw-tree__icon">
          {isFile ? (
            <TreeFileIcon name={node.name} />
          ) : (
            <Folder
              size={15}
              className={
                isCollapsed
                  ? "fw-tree__folder"
                  : "fw-tree__folder fw-tree__folder--open"
              }
            />
          )}
        </span>

        {!isRenaming && <span className="fw-tree__name">{node.name}</span>}

        {!isFile && (
          <span className="fw-tree__row-actions">
            <button
              type="button"
              className="fw-tree__row-btn"
              title="New File"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onCreateIn(node.path, "file");
              }}
            >
              <FileText size={13} />
            </button>
            <button
              type="button"
              className="fw-tree__row-btn"
              title="New Folder"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onCreateIn(node.path, "folder");
              }}
            >
              <FolderPlus size={13} />
            </button>
          </span>
        )}

        {dirty(node.path) && (
          <span className="fw-tree__dirty" title="Unsaved changes" />
        )}
      </div>

      {isRenaming && (
        <div
          className="fw-tree__rename"
          data-path={node.path}
          style={{ paddingLeft: `${indent + 30}px` }}
        >
          <RenameInput
            defaultValue={node.name}
            onCommit={(value) => onCommitRename(node.path, value)}
            onCancel={onCancelRename}
          />
        </div>
      )}

      {!isFile && hasChildren && !isCollapsed && (
        <div className="fw-tree__children">
          {node.children!.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selected={selected}
              dirty={dirty}
              renaming={renaming}
              onStartRename={onStartRename}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onCreateIn={onCreateIn}
              onOpenContext={onOpenContext}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TreeFileIcon({ name }: { name: string }) {
  const icon = iconForFile(name, "file");
  return createElement(icon, { size: 15 });
}

/* ─── WorkspaceExplorer component ─────────────────────────────── */

export default function WorkspaceExplorer() {
  const files = useWorkspaceStore((state) => state.files);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const loaded = useWorkspaceStore((state) => state.loaded);
  const refreshFiles = useWorkspaceStore((state) => state.refreshFiles);
  const createItem = useWorkspaceStore((state) => state.createItem);
  const renameItem = useWorkspaceStore((state) => state.renameItem);
  const openFolder = useWorkspaceStore((state) => state.openFolder);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    type: string;
  } | null>(null);

  const dirty = (path: string) =>
    useWorkspaceStore.getState().dirty[path] ?? false;

  const toggleExpand = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const handleOpenContext = (
    event: React.MouseEvent,
    path: string,
    type: string,
  ) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, path, type });
  };

  const commitCreate = () => {
    if (!pendingCreate) return;
    const base = prompt(`${pendingCreate.kind === "file" ? "File" : "Folder"} name`);
    if (base && base.trim()) {
      void createItem(pendingCreate.parentPath, base.trim(), pendingCreate.kind === "folder");
    }
    setPendingCreate(null);
  };

  if (!loaded || !files.length) {
    return (
      <section className="workspace-explorer">
        <div className="workspace-explorer__header">
          <span>EXPLORER</span>
          {loaded && (
            <button type="button" className="workspace-explorer__action" onClick={() => void openFolder()}>
              Open Folder
            </button>
          )}
        </div>
        <div className="workspace-explorer__empty">
          {loaded ? "No workspace open." : "Loading workspace…"}
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-explorer">
      <div className="workspace-explorer__header">
        <span>EXPLORER</span>
        <div className="workspace-explorer__tools">
          <button
            type="button"
            className="workspace-explorer__tool"
            title="Collapse All"
            onClick={() => setExpanded(new Set())}
          >
            <ChevronsDownUp size={14} />
          </button>
          <button
            type="button"
            className="workspace-explorer__tool"
            title="Refresh"
            onClick={() => void refreshFiles()}
          >
            <RotateCw size={14} />
          </button>
        </div>
      </div>

      <div className="workspace-explorer__tree">
        {files.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            level={0}
            expanded={expanded}
            onToggle={toggleExpand}
            onSelect={(path) => void selectFile(path)}
            selected={selectedFile}
            dirty={dirty}
            renaming={renameState}
            onStartRename={(path) => setRenameState({ path, value: "" })}
            onCommitRename={(path, value) => {
              if (value.trim()) void renameItem(path, value.trim());
              setRenameState(null);
            }}
            onCancelRename={() => setRenameState(null)}
            onCreateIn={(parentPath, kind) => setPendingCreate({ parentPath, kind })}
            onOpenContext={handleOpenContext}
          />
        ))}
      </div>

      {pendingCreate && (
        <div className="workspace-explorer__create-bar" onKeyDown={(e) => e.stopPropagation()}>
          <input
            className="forge-ws__inline-input"
            autoFocus
            placeholder={pendingCreate.kind === "file" ? "New file name…" : "New folder name…"}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitCreate();
              if (e.key === "Escape") setPendingCreate(null);
            }}
          />
        </div>
      )}

      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          path={contextMenu.path}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}