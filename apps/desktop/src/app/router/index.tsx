import { createBrowserRouter, RouterProvider } from "react-router-dom";

import MainLayout from "../../components/layout/MainLayout";

import DashboardPage from "../../features/dashboard/DashboardPage";
import OrgManagerPage from "../../features/org-manager/OrgManagerPage";
import MetadataPage from "../../features/metadata/MetadataPage";
import ApexPage from "../../features/apex/ApexPage";
import SOQLPage from "../../features/soql/SOQLPage";
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
        path: "apex",
        element: <ApexPage />,
      },

      {
        path: "soql",
        element: <SOQLPage />,
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

  return (
    <RouterProvider router={router}/>
  );

}