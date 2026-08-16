import { useWorkspaceStore } from "../store/workspaceStore";
import { getBaseName } from "../lib/workspaceUtils";
import { iconForFile } from "../lib/fileIcons";

import "./WorkspaceTabs.css";

export default function WorkspaceTabs() {
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const closeFile = useWorkspaceStore((state) => state.closeFile);
  const dirty = useWorkspaceStore((state) => state.dirty);

  if (openFiles.length === 0) return null;

  return (
    <div className="fw-tabs" role="tablist">
      {openFiles.map((file) => {
        const isActive = file === selectedFile;
        const isDirty = Boolean(dirty[file]);
        const Icon = iconForFile(file, "file");
        return (
          <div
            key={file}
            role="tab"
            aria-selected={isActive}
            className={`fw-tab ${isActive ? "is-active" : ""}`}
            onClick={() => void selectFile(file)}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                closeFile(file);
              }
            }}
            title={file}
          >
            <Icon size={14} className="fw-tab__icon" />
            <span className="fw-tab__label">{getBaseName(file)}</span>
            <button
              type="button"
              className="fw-tab__close"
              title="Close"
              onClick={(event) => {
                event.stopPropagation();
                closeFile(file);
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
  );
}