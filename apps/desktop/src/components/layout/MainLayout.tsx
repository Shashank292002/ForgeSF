import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";
import ErrorBoundary from "../ErrorBoundary/ErrorBoundary";
import { useOrganizationStore } from "../../store/orgStore";
import styles from "./MainLayout.module.css";

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  // Remembered separately: the Workspace starts with the app sidebar folded to
  // icons, because its own activity bar and explorer already take the left
  // edge — at the 1024px minimum window the full sidebar left the editor about
  // half the width. Expanding it there does not change other pages.
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const cliWarning = useOrganizationStore((s) => s.cliWarning);
  const [cliWarningDismissed, setCliWarningDismissed] = useState(false);
  const location = useLocation();

  // The Workspace page renders its own VS Code-style chrome (activity bar,
  // status bar, panel).  When inside the workspace we hide the application
  // header so the editor can go full-bleed, matching the VS Code aesthetic.
  const isWorkspace = location.pathname.startsWith("/workspace");

  return (
    <div
      className={`${styles.container} ${isWorkspace ? styles.workspace : ""}`}
    >
      {!isWorkspace && (
        <AppHeader onToggleSidebar={() => setSidebarOpen((s) => !s)} />
      )}

      <div className={styles.content}>
        <AppSidebar
          collapsed={isWorkspace ? workspaceCollapsed : collapsed}
          onToggleCollapse={() =>
            isWorkspace
              ? setWorkspaceCollapsed((c) => !c)
              : setCollapsed((c) => !c)
          }
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <main
          className={`${styles.main} ${isWorkspace ? styles.workspaceMain : ""}`}
        >
          {cliWarning && !cliWarningDismissed && !isWorkspace && (
            <div className={styles.cliWarning} role="alert">
              <AlertTriangle size={16} />
              <span>{cliWarning}</span>
              <button
                type="button"
                className={styles.cliWarningClose}
                aria-label="Dismiss"
                onClick={() => setCliWarningDismissed(true)}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
