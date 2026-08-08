import "./WorkspaceToolbar.css";
import { useOrganizationStore } from "../../../store/orgStore";
import { useWorkspaceStore } from "../store/workspaceStore";

export default function WorkspaceToolbar() {
    const selectedOrg = useOrganizationStore((state) => state.selectedOrganization);
    const selectedFile = useWorkspaceStore((state) => state.selectedFile);
    const saveFile = useWorkspaceStore((state) => state.saveFile);

    const handleSave = () => {
        if (selectedFile) {
            saveFile(selectedFile);
        }
    };

    return (
        <header className="workspace-toolbar">
            <div className="workspace-info">
                <div>
                    <p className="workspace-label">Salesforce DX</p>
                    <strong>Workspace</strong>
                </div>

                <div className="workspace-meta">
                    <span className="workspace-pill">{selectedOrg ? selectedOrg.alias : "No Org Connected"}</span>
                    <span className="workspace-pill muted">Ready for deployment</span>
                </div>
            </div>

            <div className="workspace-actions">
                <button type="button">Open Org</button>
                <button type="button">Pull Metadata</button>
                <button type="button">Deploy</button>
                <button type="button" disabled={!selectedFile} onClick={handleSave}>
                    Save
                </button>
            </div>
        </header>
    );
}