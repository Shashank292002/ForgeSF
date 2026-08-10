import { useState } from "react";

import "./WorkspacePage.css";

import ActivityBar, { type ActivityId } from "./components/ActivityBar";
import SideBar from "./components/SideBar";
import WorkspaceExplorer from "./components/WorkspaceExplorer";
import WorkspaceSearch from "./components/WorkspaceSearch";
import SourceControl from "./components/SourceControl";
import WorkspaceEditor from "./components/WorkspaceEditor";
import WorkspacePanel from "./components/WorkspacePanel";
import WorkspaceStatusBar from "./components/WorkspaceStatusBar";
import MetadataPanel from "../metadata/components/MetadataPanel";
import { useWorkspaceInit } from "./hooks/useWorkspaceInit";

type SidebarId = ActivityId | "metadata";

export default function WorkspacePage() {
  const [view, setView] = useState<SidebarId>("explorer");
  const [panelOpen, setPanelOpen] = useState(true);

  const loaded = useWorkspaceInit();

  const sidebarTitle =
    view === "explorer"
      ? "Explorer"
      : view === "search"
        ? "Search"
        : view === "scm"
          ? "Source Control"
          : view === "metadata"
            ? "Metadata"
            : "Settings";

  return (
    <div className="forge-ws">
      {!loaded && (
        <div className="forge-ws__loading">
          <span className="forge-ws__loading-dot" />
          <span className="forge-ws__loading-dot" />
          <span className="forge-ws__loading-dot" />
          <span>Loading workspace…</span>
        </div>
      )}

      <ActivityBar active={view} onSelect={(v) => setView(v as SidebarId)} />

      <div className="forge-ws__main">
        <SideBar
          title={sidebarTitle}
          visible={true}
          onToggle={() => setView("explorer")}
        >
          {view === "explorer" && <WorkspaceExplorer />}
          {view === "search" && <WorkspaceSearch />}
          {view === "scm" && <SourceControl />}
          {view === "metadata" && <MetadataPanel />}
          {view === "settings" && (
            <div className="forge-ws__placeholder">
              Settings view coming soon.
            </div>
          )}
        </SideBar>

        <div className="forge-ws__center">
          <WorkspaceEditor />
          <WorkspacePanel
            open={panelOpen}
            onToggle={() => setPanelOpen((o) => !o)}
          />
        </div>
      </div>

      <WorkspaceStatusBar />
    </div>
  );
}
