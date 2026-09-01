import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import {
  getOrganizations,
  getSelectedOrganizationId,
  saveOrganizations,
} from "../services/storage";
import { listOrgs } from "../services/tauri";

import { useOrganizationStore } from "../store/orgStore";

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
    }

    void initialize();
  }, []);

  return <>{children}</>;
}
