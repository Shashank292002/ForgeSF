import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import {
  getOrganizations,
  getSelectedOrganizationId,
  saveOrganizations,
} from "../services/storage";
import { listOrgs } from "../services/tauri";

import { useOrganizationStore } from "../store/orgStore";
import { onPersistFailure } from "../services/persistQueue";
import { useWorkspaceStore } from "../features/workspace/store/workspaceStore";
import {
  clearDiffSessions,
  workspaceForOrg,
} from "../features/workspace/services/workspaceService";

interface Props {
  children: ReactNode;
}

export default function AppInitializer({ children }: Props) {
  // StrictMode mounts effects twice in development; the CLI round-trip below
  // is not worth doing twice.
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    async function initialize() {
      // The locally cached list is only a fast first paint. The Salesforce CLI
      // is the source of truth: it knows about orgs authenticated outside the
      // app, and it knows which ones have expired — neither of which the cache
      // could ever learn on its own.
      let organizations = await getOrganizations().catch(() => []);
      const selectedOrganizationId = await getSelectedOrganizationId().catch(
        () => null,
      );

      try {
        const live = await listOrgs();
        organizations = live;
        await saveOrganizations(live);
      } catch (error) {
        // Keep the cached list so the app is still usable when the CLI is
        // missing or slow, but say so rather than silently showing stale orgs.
        useOrganizationStore.setState({
          orgLoadError:
            error instanceof Error
              ? error.message
              : "Could not reach the Salesforce CLI.",
        });
      }

      const selectedOrganization =
        organizations.find((org) => org.id === selectedOrganizationId) ??
        organizations.find((org) => org.isDefault) ??
        organizations[0] ??
        null;

      useOrganizationStore.setState({
        organizations,
        selectedOrganization,
        selectedOrganizationId: selectedOrganization?.id ?? null,
        orgsLoaded: true,
      });

      // The org owns the workspace, so resolve (and create on first use) the
      // folder for whichever org we just restored before the editor mounts.
      // Done here rather than via the org subscribe because setState above is
      // the initial load, not a user-driven switch.
      const workspaceStore = useWorkspaceStore.getState();
      if (selectedOrganization) {
        try {
          await workspaceForOrg(
            selectedOrganization.id,
            selectedOrganization.alias,
          );
        } catch {
          // Falls back to whatever get_workspace resolves to; the workspace
          // page surfaces any real failure.
        }
      }
      await workspaceStore.loadWorkspaces();
    }

    // Diff Check scratch directories are disposable; clear anything a previous
    // run left behind.
    void clearDiffSessions().catch(() => {});

    // A failed write used to be swallowed: the UI reported success and the
    // data was gone on next launch.
    onPersistFailure((message) =>
      useOrganizationStore.setState({ orgLoadError: message }),
    );

    void initialize();
  }, []);

  return <>{children}</>;
}
