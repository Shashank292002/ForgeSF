import { useEffect, useRef } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { AlertTriangle, Hammer } from "lucide-react";

import "./WorkspacePage.css";

import ActivityBar from "./components/ActivityBar";
import SideBar from "./components/SideBar";
import WorkspaceExplorer from "./components/WorkspaceExplorer";
import WorkspaceSearch from "./components/WorkspaceSearch";
import SourceControl from "./components/SourceControl";
import WorkspaceEditor from "./components/WorkspaceEditor";
import WorkspacePanel from "./components/WorkspacePanel";
import WorkspaceStatusBar from "./components/WorkspaceStatusBar";
import WorkspaceToolbar from "./components/WorkspaceToolbar";
import MetadataLauncher from "../metadata/components/retrieve/MetadataLauncher";
import MetadataRetriever from "../metadata/components/retrieve/MetadataRetriever";
import { useWorkspaceInit } from "./hooks/useWorkspaceInit";
import { useWorkspaceShortcuts } from "./hooks/useWorkspaceShortcuts";
import { useWorkspaceStore } from "./store/workspaceStore";

const SIDEBAR_TITLES: Record<string, string> = {
  explorer: "Explorer",
  search: "Search",
  scm: "Source Control",
  metadata: "Metadata",
  settings: "Settings",
};

export default function WorkspacePage() {
  const activeView = useWorkspaceStore((state) => state.activeView);
  const sidebarVisible = useWorkspaceStore((state) => state.sidebarVisible);
  const setSidebarVisible = useWorkspaceStore(
    (state) => state.setSidebarVisible,
  );
  const panelOpen = useWorkspaceStore((state) => state.panelOpen);
  const setPanelOpen = useWorkspaceStore((state) => state.setPanelOpen);
  const openFolder = useWorkspaceStore((state) => state.openFolder);
  const initWorkspace = useWorkspaceStore((state) => state.initWorkspace);
  const retrieveOpen = useWorkspaceStore((state) => state.retrieveOpen);
  const closeRetrieve = useWorkspaceStore((state) => state.closeRetrieve);

  const { loaded, error, booting } = useWorkspaceInit();
  useWorkspaceShortcuts();

  const bottomPanelRef = useRef<ImperativePanelHandle>(null);

  // Keep the bottom panel's collapse state in sync with the store.
  useEffect(() => {
    const handle = bottomPanelRef.current;
    if (!handle) return;
    if (panelOpen) {
      handle.expand();
    } else {
      handle.collapse();
    }
  }, [panelOpen]);

  const sectionTitle = SIDEBAR_TITLES[activeView] ?? "Explorer";

  return (
    <div className="forge-ws">
      {booting && !loaded && (
        <div className="forge-ws__boot">
          <div className="forge-ws__boot-content">
            <span className="forge-ws__boot-mark">
              <Hammer size={22} />
            </span>
            <span className="forge-ws__boot-spinner" />
            <span className="forge-ws__boot-hint">Preparing workspace…</span>
          </div>
        </div>
      )}

      {error && !loaded && (
        <div className="forge-ws__error">
          <div className="forge-ws__error-card">
            <span className="forge-ws__error-icon">
              <AlertTriangle size={26} />
            </span>
            <h2>Unable to load workspace</h2>
            <p>{error}</p>
            <div className="forge-ws__error-actions">
              <button
                className="fw-btn fw-btn--primary"
                onClick={() => void openFolder()}
              >
                Open Folder
              </button>
              <button className="fw-btn" onClick={() => void initWorkspace()}>
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="forge-ws__main">
        <ActivityBar />

        <PanelGroup
          className="forge-ws__panels"
          direction="horizontal"
          autoSaveId="forge-ws-horizontal"
        >
          {sidebarVisible && (
            <>
              <Panel
                id="forge-ws-sidebar"
                order={1}
                defaultSize={26}
                minSize={16}
                maxSize={45}
              >
                <SideBar
                  title={sectionTitle}
                  onCollapse={() => setSidebarVisible(false)}
                >
                  {activeView === "explorer" && <WorkspaceExplorer />}
                  {activeView === "search" && <WorkspaceSearch />}
                  {activeView === "scm" && <SourceControl />}
                  {activeView === "metadata" && <MetadataLauncher />}
                  {activeView === "settings" && (
                    <div className="forge-ws__placeholder">
                      Workspace settings are coming soon.
                    </div>
                  )}
                </SideBar>
              </Panel>

              <PanelResizeHandle className="fw-resize-vertical" />
            </>
          )}

          <Panel id="forge-ws-center" order={2} minSize={30}>
            <PanelGroup
              className="forge-ws__center"
              direction="vertical"
              autoSaveId="forge-ws-vertical"
            >
              <Panel
                id="forge-ws-editor"
                order={1}
                defaultSize={74}
                minSize={25}
              >
                <WorkspaceToolbar />
                <WorkspaceEditor />
              </Panel>

              <PanelResizeHandle className="fw-resize-horizontal" />

              <Panel
                id="forge-ws-panel"
                ref={bottomPanelRef}
                order={2}
                defaultSize={26}
                minSize={8}
                collapsible
                collapsedSize={0}
              >
                <WorkspacePanel
                  open={panelOpen}
                  onToggle={() => setPanelOpen(!panelOpen)}
                />
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      <WorkspaceStatusBar />

      {retrieveOpen && (
        <div
          className="mr-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRetrieve();
          }}
        >
          <MetadataRetriever mode="overlay" onClose={closeRetrieve} />
        </div>
      )}
    </div>
  );
}
