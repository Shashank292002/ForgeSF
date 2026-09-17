import {
  Cloud,
  Database,
  Loader2,
  RotateCw,
  Rocket,
  Save,
  Search,
} from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import { useOrganizationStore } from "../../../store/orgStore";

import "./WorkspaceToolbar.css";

export default function WorkspaceToolbar() {
  const workspaceName = useWorkspaceStore((state) => state.workspaceName);
  const dirty = useWorkspaceStore((state) => state.dirty);
  const deploying = useWorkspaceStore((state) => state.deploying);
  const refreshFiles = useWorkspaceStore((state) => state.refreshFiles);
  const saveAll = useWorkspaceStore((state) => state.saveAll);
  const runDeploy = useWorkspaceStore((state) => state.runDeploy);
  const openRetrieve = useWorkspaceStore((state) => state.openRetrieve);
  const openQuickInput = useWorkspaceStore((state) => state.openQuickInput);

  const organization = useOrganizationStore(
    (state) => state.selectedOrganization,
  );
  const dirtyCount = Object.keys(dirty).length;

  return (
    <div className="workspace-toolbar">
      <div className="workspace-toolbar__context">
        <span className="workspace-toolbar__name" title={workspaceName}>
          {workspaceName || "Workspace"}
        </span>
        <span className="workspace-toolbar__separator">/</span>
        <span className="workspace-toolbar__tag">ForgeSF</span>
      </div>

      {/* Where Quick Open and the command palette can be found without
          knowing their shortcuts. */}
      <button
        type="button"
        className="workspace-toolbar__goto"
        title="Go to File (Ctrl+P) — type > for commands (Ctrl+Shift+P)"
        onClick={() => openQuickInput("")}
      >
        <Search size={13} />
        <span className="workspace-toolbar__goto-label">Go to file…</span>
        <kbd className="workspace-toolbar__goto-keys">Ctrl+P</kbd>
      </button>

      <div className="workspace-toolbar__actions">
        {dirtyCount > 0 && (
          <button
            type="button"
            className="workspace-toolbar__btn"
            title="Save All"
            aria-label="Save all files"
            onClick={() => void saveAll()}
          >
            <Save size={14} />
          </button>
        )}
        <button
          type="button"
          className="workspace-toolbar__btn"
          title="Refresh"
          aria-label="Refresh the workspace files"
          onClick={() => void refreshFiles()}
        >
          <RotateCw size={14} />
        </button>

        <span
          className="workspace-toolbar__org"
          title={
            organization
              ? `Active organization: ${organization.alias}`
              : "No organization"
          }
        >
          <Cloud size={13} />
          <span className="workspace-toolbar__org-name">
            {organization ? organization.alias : "No org"}
          </span>
        </span>

        <span className="workspace-toolbar__divider" />

        <button
          type="button"
          className="workspace-toolbar__btn--retrieve"
          title="Retrieve Metadata from org"
          onClick={openRetrieve}
        >
          <Database size={14} />
          Retrieve
        </button>

        <button
          type="button"
          className="workspace-toolbar__cta"
          onClick={() => void runDeploy(organization?.username ?? "", false)}
          disabled={!organization || deploying}
        >
          {deploying ? (
            <Loader2 size={13} className="spinning" />
          ) : (
            <Rocket size={13} />
          )}
          Deploy
        </button>
      </div>
    </div>
  );
}
