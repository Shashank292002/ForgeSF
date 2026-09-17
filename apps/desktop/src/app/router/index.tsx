import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from "react-router-dom";

import MainLayout from "../../components/layout/MainLayout";

import DashboardPage from "../../features/dashboard/DashboardPage";
import OrgManagerPage from "../../features/org-manager/OrgManagerPage";
import MetadataPage from "../../features/metadata/MetadataPage";
import SOQLPage from "../../features/soql/SOQLPage";
import LogsPage from "../../features/logs/LogsPage";
import DependenciesPage from "../../features/dependencies/DependenciesPage";
import DeploymentsPage from "../../features/deployments/DeploymentsPage";
import PluginsPage from "../../features/plugins/PluginsPage";
import SettingsPage from "../../features/settings/SettingsPage";
import WorkspacePage from "../../features/workspace/WorkspacePage";

const router = createBrowserRouter([
  {
    path: "/",

    element: <MainLayout />,

    children: [
      {
        index: true,
        element: <DashboardPage />,
      },

      {
        path: "organizations",
        element: <OrgManagerPage />,
      },

      {
        path: "metadata",
        element: <MetadataPage />,
      },
      {
        path: "workspace",
        element: <WorkspacePage />,
      },

      {
        // The standalone Apex page duplicated Developer Tools' Apex tab with
        // weaker error handling and no production guard. Old links land on
        // the tab instead.
        path: "apex",
        element: <Navigate to="/devtools?tab=apex" replace />,
      },

      {
        path: "devtools",
        element: <SOQLPage />,
      },

      {
        path: "logs",
        element: <LogsPage />,
      },

      {
        path: "dependencies",
        element: <DependenciesPage />,
      },

      {
        path: "deployments",
        element: <DeploymentsPage />,
      },

      {
        path: "plugins",
        element: <PluginsPage />,
      },

      {
        path: "settings",
        element: <SettingsPage />,
      },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
