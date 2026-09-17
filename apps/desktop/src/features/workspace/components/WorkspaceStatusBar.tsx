import { Cloud, Loader2, Check } from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import { useOrganizationStore } from "../../../store/orgStore";
import { languageForPath, languageLabel } from "../lib/editorLanguage";

import "./WorkspaceStatusBar.css";

export default function WorkspaceStatusBar() {
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const cursor = useWorkspaceStore((state) => state.cursorPosition);
  const editorInfo = useWorkspaceStore((state) => state.editorInfo);
  const saveStatus = useWorkspaceStore((state) => state.saveStatus);
  // A count, not the map: the map is replaced whenever a file turns dirty or
  // clean, but the count is all this shows.
  const dirtyCount = useWorkspaceStore(
    (state) => Object.keys(state.dirty).length,
  );
  const deploying = useWorkspaceStore((state) => state.deploying);
  const organization = useOrganizationStore(
    (state) => state.selectedOrganization,
  );

  return (
    <footer className="workspace-statusbar">
      <div className="workspace-statusbar__left">
        <WorkspaceSwitcher />
        <span className="workspace-statusbar__item" title="Active organization">
          <Cloud size={12} aria-hidden />
          {organization ? organization.alias : "No org"}
        </span>
      </div>

      <div className="workspace-statusbar__right">
        <span role="status" className="workspace-statusbar__live">
          {deploying && (
            <span className="workspace-statusbar__item">
              <Loader2 size={12} className="spinning" aria-hidden /> Deploying…
            </span>
          )}
          {saveStatus === "saving" && (
            <span className="workspace-statusbar__item">
              <Loader2 size={12} className="spinning" aria-hidden /> Saving…
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="workspace-statusbar__item">
              <Check size={12} aria-hidden /> Saved
            </span>
          )}
          {saveStatus === "error" && (
            <span className="workspace-statusbar__item is-error">
              Save failed
            </span>
          )}
        </span>

        {/* What the editor detected in the file on screen — they used to be
            a fixed "Spaces: 4" and "UTF-8", shown even with no file open. */}
        {selectedFile && editorInfo && (
          <>
            <span className="workspace-statusbar__item" title="Cursor position">
              Ln {cursor.line}, Col {cursor.column}
            </span>
            <span className="workspace-statusbar__item" title="Indentation">
              {editorInfo.insertSpaces
                ? `Spaces: ${editorInfo.tabSize}`
                : `Tab Size: ${editorInfo.tabSize}`}
            </span>
            {/* Only UTF-8 text opens in the editor. */}
            <span className="workspace-statusbar__item" title="Encoding">
              UTF-8
            </span>
            <span className="workspace-statusbar__item" title="Line endings">
              {editorInfo.eol}
            </span>
            <span className="workspace-statusbar__item" title="Language">
              {languageLabel(languageForPath(selectedFile))}
            </span>
          </>
        )}
        <span className="workspace-statusbar__item">
          {dirtyCount > 0 ? `${dirtyCount} unsaved` : "All saved"}
        </span>
      </div>
    </footer>
  );
}
