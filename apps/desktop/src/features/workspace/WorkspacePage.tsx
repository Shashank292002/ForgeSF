import "./WorkspacePage.css";

import WorkspaceToolbar from "./components/WorkspaceToolbar";
import WorkspaceExplorer from "./components/WorkspaceExplorer";
import WorkspaceEditor from "./components/WorkspaceEditor";
import WorkspaceTerminal from "./components/WorkspaceTerminal";

export default function WorkspacePage() {
    return (
        <div className="workspace-page">
            <WorkspaceToolbar />

            <div className="workspace-body">
                <WorkspaceExplorer />

                <div className="workspace-main-pane">
                    <WorkspaceEditor />
                    <WorkspaceTerminal />
                </div>
            </div>
        </div>
    );
}