import { useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { getBaseName } from "../lib/workspaceUtils";
import { iconForFile } from "../lib/fileIcons";

import "./WorkspaceTabs.css";

interface TabMenu {
  x: number;
  y: number;
  path: string;
}

export default function WorkspaceTabs() {
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const closeFile = useWorkspaceStore((state) => state.closeFile);
  const dirty = useWorkspaceStore((state) => state.dirty);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<TabMenu | null>(null);

  // Keep the active tab visible when many files are open.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedFile]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  /** Closes a tab, protecting unsaved changes from accidental loss. */
  const requestClose = (file: string) => {
    if (dirty[file]) {
      const name = getBaseName(file);
      const confirmed = window.confirm(
        `"${name}" has unsaved changes.\n\nClose without saving?`,
      );
      if (!confirmed) return;
    }
    closeFile(file);
  };

  const closeOthers = (path: string) => {
    for (const file of openFiles) {
      if (file === path) continue;
      if (dirty[file]) {
        const name = getBaseName(file);
        if (
          !window.confirm(`"${name}" has unsaved changes.\n\nClose without saving?`)
        ) {
          continue;
        }
      }
      closeFile(file);
    }
  };

  const closeAll = () => {
    for (const file of [...openFiles]) {
      if (dirty[file]) {
        const name = getBaseName(file);
        if (
          !window.confirm(`"${name}" has unsaved changes.\n\nClose without saving?`)
        ) {
          continue;
        }
      }
      closeFile(file);
    }
  };

  if (openFiles.length === 0) return null;

  return (
    <div className="fw-tabs-wrap">
      <div className="fw-tabs" role="tablist">
        {openFiles.map((file) => {
          const isActive = file === selectedFile;
          const isDirty = Boolean(dirty[file]);
          const Icon = iconForFile(file, "file");
          return (
            <div
              key={file}
              ref={isActive ? activeTabRef : undefined}
              role="tab"
              aria-selected={isActive}
              className={`fw-tab ${isActive ? "is-active" : ""}`}
              onClick={() => void selectFile(file)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, path: file });
              }}
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  requestClose(file);
                }
              }}
              title={file}
            >
              <Icon size={14} className="fw-tab__icon" />
              <span className="fw-tab__label">{getBaseName(file)}</span>
              <button
                type="button"
                className="fw-tab__close"
                title={isDirty ? "Close without saving" : "Close"}
                onClick={(event) => {
                  event.stopPropagation();
                  requestClose(file);
                }}
              >
                {isDirty ? (
                  <span className="fw-tab__dirty-dot" />
                ) : (
                  <span className="fw-tab__close-x">×</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {menu && (
        <div className="fw-tabs-menu" style={{ left: menu.x, top: menu.y }}>
          <button type="button" onClick={() => { requestClose(menu.path); setMenu(null); }}>
            Close
          </button>
          <button type="button" onClick={() => { closeOthers(menu.path); setMenu(null); }}>
            Close Others
          </button>
          <button type="button" onClick={() => { closeAll(); setMenu(null); }}>
            Close All
          </button>
        </div>
      )}
    </div>
  );
}