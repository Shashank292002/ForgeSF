import { Cloud, GitBranch, Loader2, Check } from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import { useOrganizationStore } from "../../../store/orgStore";
import { languageForPath } from "../lib/editorLanguage";

import "./WorkspaceStatusBar.css";

export default function WorkspaceStatusBar() {
  const workspaceName = useWorkspaceStore((state) => state.workspaceName);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const cursor = useWorkspaceStore((state) => state.cursorPosition);
  const saveStatus = useWorkspaceStore((state) => state.saveStatus);
  const dirty = useWorkspaceStore((state) => state.dirty);
  const deploying = useWorkspaceStore((state) => state.deploying);
  const organization = useOrganizationStore(
    (state) => state.selectedOrganization,
  );

  const dirtyCount = Object.keys(dirty).length;

  return (
    <footer className="workspace-statusbar">
      <div className="workspace-statusbar__left">
        <span className="workspace-statusbar__item" title={workspaceName}>
          <GitBranch size={12} />
          {workspaceName || "workspace"}
        </span>
        <span className="workspace-statusbar__item" title="Active organization">
          <Cloud size={12} />
          {organization ? organization.alias : "No org"}
        </span>
      </div>

      <div className="workspace-statusbar__right">
        {deploying && (
          <span className="workspace-statusbar__item">
            <Loader2 size={12} className="spinning" /> Deploying…
          </span>
        )}
        {saveStatus === "saving" && (
          <span className="workspace-statusbar__item">
            <Loader2 size={12} className="spinning" /> Saving…
          </span>
        )}
        {saveStatus === "saved" && (
          <span className="workspace-statusbar__item">
            <Check size={12} /> Saved
          </span>
        )}
        {saveStatus === "error" && (
          <span className="workspace-statusbar__item is-error">Save failed</span>
        )}
        <span className="workspace-statusbar__item">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span className="workspace-statusbar__item">
          {selectedFile
            ? languageForPath(selectedFile).toUpperCase()
            : "PLAINTEXT"}
        </span>
        <span className="workspace-statusbar__item">
          {dirtyCount > 0 ? `${dirtyCount} unsaved` : "Clean"}
        </span>
      </div>
    </footer>
  );
}