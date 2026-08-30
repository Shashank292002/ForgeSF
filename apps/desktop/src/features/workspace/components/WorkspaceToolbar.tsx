import { Cloud, Database, Loader2, RotateCw, Rocket, Save } from "lucide-react";

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

      <div className="workspace-toolbar__actions">
        {dirtyCount > 0 && (
          <button
            type="button"
            className="workspace-toolbar__btn"
            title="Save All"
            onClick={() => void saveAll()}
          >
            <Save size={14} />
          </button>
        )}
        <button
          type="button"
          className="workspace-toolbar__btn"
          title="Refresh"
          onClick={() => void refreshFiles()}
        >
          <RotateCw size={14} />
        </button>

        <span className="workspace-toolbar__org" title="Active organization">
          <Cloud size={13} />
          {organization ? organization.alias : "No org"}
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
          {deploying ? <Loader2 size={13} className="spinning" /> : <Rocket size={13} />}
          Deploy
        </button>
      </div>
    </div>
  );
}