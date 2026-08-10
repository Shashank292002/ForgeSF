import { useState } from "react";
import { ChevronRight } from "lucide-react";

import "./WorkspaceExplorer.css";

import { useWorkspaceStore } from "../store/workspaceStore";
import type { WorkspaceFile } from "../types";
import { IconFolder, IconFolderOpen, iconForFile } from "../lib/fileIcons";

interface TreeNodeProps {
  node: WorkspaceFile;
  selectedFile: string | null;
  onSelect: (file: string) => void;
  level: number;
  collapsedSet: Set<string>;
  onToggle: (path: string) => void;
}

/**
 * Recursive tree node with VS Code-style expand/collapse.
 * A Set of collapsed paths is kept in the parent component state so the
 * tree remembers which folders the user has opened/closed.
 */
function TreeNode({
  node,
  selectedFile,
  onSelect,
  level,
  collapsedSet,
  onToggle,
}: TreeNodeProps) {
  const isFile = node.type === "file";
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isCollapsed = collapsedSet.has(node.path);
  const indent = level * 14;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isFile) {
      onSelect(node.path);
    } else if (hasChildren) {
      onToggle(node.path);
    }
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isFile && hasChildren) {
      onToggle(node.path);
    }
  };

  return (
    <>
      <div
        className={`ws-tree-row ${
          isFile ? "ws-tree-file" : "ws-tree-folder"
        } ${selectedFile === node.path ? "active" : ""}`}
        style={{ paddingLeft: `${indent + 8}px` }}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick(e as unknown as React.MouseEvent);
          }
        }}
      >
        {!isFile && hasChildren && (
          <button
            type="button"
            className="ws-tree-chevron-btn"
            onClick={handleToggle}
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            <ChevronRight
              size={14}
              className={`ws-tree-chevron ${
                isCollapsed ? "" : "ws-tree-chevron--expanded"
              }`}
            />
          </button>
        )}

        {!isFile && !hasChildren && <span className="ws-tree-indent" />}

        <span className="ws-tree-icon">
          {isFile ? (
            (() => {
              const Icon = iconForFile(node.name, "file");
              return <Icon size={14} />;
            })()
          ) : isCollapsed ? (
            <IconFolder size={14} />
          ) : (
            <IconFolderOpen size={14} />
          )}
        </span>

        <span className="ws-tree-name">{node.name}</span>

        {isFile && node.path === selectedFile && (
          <span
            className="ws-tree-dirty"
            title="Unsaved changes"
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              marginLeft: "auto",
              borderRadius: "50%",
              background: "var(--fw-warning)",
            }}
          />
        )}
      </div>

      {!isFile && hasChildren && !isCollapsed && (
        <>
          {node.children!.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedFile={selectedFile}
              onSelect={onSelect}
              level={level + 1}
              collapsedSet={collapsedSet}
              onToggle={onToggle}
            />
          ))}
        </>
      )}
    </>
  );
}

export default function WorkspaceExplorer() {
  const files = useWorkspaceStore((state) => state.files);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const loaded = useWorkspaceStore((s) => s.loaded);
  const refreshFiles = useWorkspaceStore((s) => s.refreshFiles);

  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(() => new Set());

  const toggleCollapse = (path: string) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (!loaded || files.length === 0) {
    return (
      <section className="workspace-explorer">
        <div className="workspace-explorer__header">
          <span>Explorer</span>
        </div>
        <div className="workspace-explorer__empty">
          {loaded ? "Workspace is empty." : "Loading workspace files…"}
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-explorer">
      <div className="workspace-explorer__header">
        <span>Explorer</span>
        <button
          type="button"
          className="workspace-explorer__refresh"
          title="Refresh"
          onClick={() => void refreshFiles()}
        >
          Refresh
        </button>
      </div>

      <div className="workspace-explorer__tree">
        {files.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            selectedFile={selectedFile}
            onSelect={selectFile}
            level={0}
            collapsedSet={collapsedSet}
            onToggle={toggleCollapse}
          />
        ))}
      </div>
    </section>
  );
}
