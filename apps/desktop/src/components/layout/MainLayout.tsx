import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";
import styles from "./MainLayout.module.css";

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // The Workspace page renders its own VS Code-style chrome (activity bar,
  // status bar, panel).  When inside the workspace we hide the application
  // header so the editor can go full-bleed, matching the VS Code aesthetic.
  const isWorkspace = location.pathname.startsWith("/workspace");

  return (
    <div className={`${styles.container} ${isWorkspace ? styles.workspace : ""}`}>
      {!isWorkspace && <AppHeader onToggleSidebar={() => setSidebarOpen((s) => !s)} />}

      <div className={styles.content}>
        <AppSidebar
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <main
          className={`${styles.main} ${isWorkspace ? styles.workspaceMain : ""}`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
