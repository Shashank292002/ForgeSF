import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { getBaseName } from "../lib/workspaceUtils";
import { iconForFile } from "../lib/fileIcons";
import { Menu, MenuItem } from "../../../components/ui";

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
  // Asks once about unsaved changes: save them, drop them, or close nothing.
  // It used to be OK/Cancel per file, where OK meant "discard".
  const closeTabs = useWorkspaceStore((state) => state.closeFiles);
  const dirty = useWorkspaceStore((state) => state.dirty);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const [menu, setMenu] = useState<TabMenu | null>(null);

  // Keep the active tab visible when many files are open.
  useEffect(() => {
    if (!selectedFile) return;
    tabRefs.current.get(selectedFile)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedFile]);

  if (openFiles.length === 0) return null;

  const focusTab = (path: string | null) => {
    if (path) tabRefs.current.get(path)?.focus();
  };

  const closeAndRefocus = async (files: string[]) => {
    await closeTabs(files);
    // Focus follows to the tab that is active now, instead of falling to the
    // page when the focused tab went away.
    focusTab(useWorkspaceStore.getState().selectedFile);
  };

  /** Tabs are one stop for Tab; arrows move between them, as in a tab strip. */
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>, file: string) => {
    const index = openFiles.indexOf(file);
    const moveTo = (next: number) => {
      const target = openFiles[(next + openFiles.length) % openFiles.length];
      void selectFile(target);
      focusTab(target);
    };

    switch (event.key) {
      case "ArrowRight":
        moveTo(index + 1);
        break;
      case "ArrowLeft":
        moveTo(index - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(openFiles.length - 1);
        break;
      case "Enter":
      case " ":
        void selectFile(file);
        break;
      case "Delete":
        void closeAndRefocus([file]);
        break;
      case "ContextMenu":
      case "F10": {
        if (event.key === "F10" && !event.shiftKey) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setMenu({ x: rect.left + 12, y: rect.bottom, path: file });
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="fw-tabs-wrap">
      <div className="fw-tabs" role="tablist" aria-label="Open files">
        {openFiles.map((file) => {
          const isActive = file === selectedFile;
          const isDirty = Boolean(dirty[file]);
          const name = getBaseName(file);
          const Icon = iconForFile(file, "file");
          return (
            <div
              key={file}
              ref={(element) => {
                if (element) tabRefs.current.set(file, element);
                else tabRefs.current.delete(file);
              }}
              role="tab"
              aria-selected={isActive}
              // Unsaved changes show as a dot; say so in words too.
              aria-label={isDirty ? `${name}, unsaved changes` : name}
              tabIndex={isActive ? 0 : -1}
              className={`fw-tab ${isActive ? "is-active" : ""}`}
              onClick={() => void selectFile(file)}
              onKeyDown={(event) => onTabKeyDown(event, file)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, path: file });
              }}
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  void closeTabs([file]);
                }
              }}
              title={file}
            >
              <Icon size={14} className="fw-tab__icon" aria-hidden />
              <span className="fw-tab__label">{name}</span>
              <button
                type="button"
                className="fw-tab__close"
                title={isDirty ? "Close (unsaved changes)" : "Close"}
                aria-label={`Close ${name}`}
                // Delete closes the focused tab; one Tab stop per tab strip.
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTabs([file]);
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
        <Menu
          className="fw-tabs-menu"
          label="Tab actions"
          at={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
        >
          <MenuItem onSelect={() => void closeAndRefocus([menu.path])}>
            Close
          </MenuItem>
          <MenuItem
            onSelect={() =>
              void closeAndRefocus(
                openFiles.filter((file) => file !== menu.path),
              )
            }
            disabled={openFiles.length < 2}
          >
            Close Others
          </MenuItem>
          <MenuItem onSelect={() => void closeAndRefocus([...openFiles])}>
            Close All
          </MenuItem>
        </Menu>
      )}
    </div>
  );
}
