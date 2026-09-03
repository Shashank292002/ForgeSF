import { ChevronDown, Terminal } from "lucide-react";

import WorkspaceTerminal from "./WorkspaceTerminal";

import "./WorkspacePanel.css";

interface WorkspacePanelProps {
  open: boolean;
  onToggle: () => void;
}

export default function WorkspacePanel({
  open,
  onToggle,
}: WorkspacePanelProps) {
  return (
    <div className={`workspace-panel ${open ? "is-open" : "is-closed"}`}>
      <div className="workspace-panel__bar" onClick={onToggle}>
        <div className="workspace-panel__label">
          <Terminal size={13} />
          <span>Terminal</span>
        </div>
        <button
          type="button"
          className="workspace-panel__toggle"
          title={open ? "Hide Panel (Ctrl+`)" : "Show Panel (Ctrl+`)"}
        >
          <ChevronDown size={14} className={open ? "is-open" : ""} />
        </button>
      </div>
      {open && (
        <div className="workspace-panel__body">
          <WorkspaceTerminal />
        </div>
      )}
    </div>
  );
}
