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
      {/* The whole bar toggles, so it is the button — it used to be a plain
          div with an onClick, with a chevron button inside that had no
          handler of its own and only worked because the click bubbled to it.
          Neither was reachable from the keyboard. */}
      <button
        type="button"
        className="workspace-panel__bar"
        aria-expanded={open}
        aria-label={open ? "Hide the panel" : "Show the panel"}
        title={open ? "Hide Panel (Ctrl+`)" : "Show Panel (Ctrl+`)"}
        onClick={onToggle}
      >
        <span className="workspace-panel__label">
          <Terminal size={13} />
          <span>Terminal</span>
        </span>
        <span className="workspace-panel__toggle" aria-hidden="true">
          <ChevronDown size={14} className={open ? "is-open" : ""} />
        </span>
      </button>
      {open && (
        <div className="workspace-panel__body">
          <WorkspaceTerminal />
        </div>
      )}
    </div>
  );
}
