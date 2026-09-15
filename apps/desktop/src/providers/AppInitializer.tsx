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
import {
  useWorkspaceStore,
  waitForWorkspaceSync,
} from "../features/workspace/store/workspaceStore";
import { clearDiffSessions } from "../features/workspace/services/workspaceService";
import { cliInfo } from "../features/deployments/services/deployService";
import { useDeployJobsStore } from "../features/deployments/store/deployJobsStore";
import { toast } from "../components/ui/Toast/toast";
import type { Organization } from "../features/org-manager/types";

interface Props {
  children: ReactNode;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Applies an org list, keeping the selection on the same org by id.
 *
 * `keepStatusFrom` carries statuses over from a previous list: a list read
 * with `--skip-connection-status` reports every org as connected, which would
 * otherwise hide an expired session the cache already knew about.
 */
function applyOrganizations(
  organizations: Organization[],
  preferredId: string | null,
  keepStatusFrom?: Organization[],
) {
  const merged = keepStatusFrom
    ? organizations.map((org) => {
        const known = keepStatusFrom.find((item) => item.id === org.id);
        return known ? { ...org, status: known.status } : org;
      })
    : organizations;

  const selectedOrganization =
    merged.find((org) => org.id === preferredId) ??
    merged.find((org) => org.isDefault) ??
    merged[0] ??
    null;

  useOrganizationStore.setState({
    organizations: merged,
    selectedOrganization,
    selectedOrganizationId: selectedOrganization?.id ?? null,
  });
  return merged;
}

export default function AppInitializer({ children }: Props) {
  // StrictMode mounts effects twice in development; the CLI round-trip below
  // is not worth doing twice.
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    async function initialize() {
      const cached = await getOrganizations().catch(() => []);
      const selectedId = await getSelectedOrganizationId().catch(() => null);

      // 1. Paint the cached list immediately. Startup used to wait for
      //    `sf org list` — which pings every org — before showing anything,
      //    so pages behind OrgGuard said "No Organization Connected" for
      //    several seconds on every launch.
      if (cached.length > 0) {
        applyOrganizations(cached, selectedId);
        useOrganizationStore.setState({ orgsLoaded: true });
      }

      // 2. The CLI is the source of truth for *which* orgs exist; the fast
      //    listing answers that without contacting each org.
      let current = cached;
      try {
        const fast = await listOrgs({ skipConnectionStatus: true });
        current = applyOrganizations(
          fast,
          useOrganizationStore.getState().selectedOrganizationId ?? selectedId,
          cached,
        );
        await saveOrganizations(current).catch(() => {});
      } catch (error) {
        // Keep the cached list so the app is still usable when the CLI is
        // missing or slow, but say so rather than silently showing stale orgs.
        useOrganizationStore.setState({
          orgLoadError: errorMessage(
            error,
            "Could not reach the Salesforce CLI.",
          ),
        });
      } finally {
        useOrganizationStore.setState({ orgsLoaded: true });
      }

      // With nothing selected no org switch runs, so load the registry here.
      if (!useOrganizationStore.getState().selectedOrganization) {
        await useWorkspaceStore.getState().loadWorkspaces();
      }
      // Selecting the restored org above queued its workspace; opening it is
      // the org listener's job alone, so it is not repeated here.
      await waitForWorkspaceSync();

      // 3. Connection statuses (expired sessions) take a network round-trip
      //    per org, so they arrive last and without blocking anything.
      if (current.length > 0) {
        try {
          const full = await listOrgs();
          applyOrganizations(
            full,
            useOrganizationStore.getState().selectedOrganizationId,
          );
          await saveOrganizations(full);
          useOrganizationStore.setState({ orgLoadError: null });
        } catch {
          // The fast list is already showing; a failed status refresh only
          // means statuses may be stale, which the cache already implied.
        }
      }
    }

    // Diff Check scratch directories are disposable; clear anything a previous
    // run left behind.
    void clearDiffSessions().catch(() => {});

    // Deploys keep running in the org while ForgeSF is closed; follow any
    // that had not finished, so their results and pending changes catch up.
    void (async () => {
      try {
        await useDeployJobsStore.getState().loadHistory();
        useDeployJobsStore.getState().resumeRunning();
      } catch {
        // History is a convenience; the Deployments page reads it again.
      }
    })();

    // An old `sf` fails in confusing ways (unknown flags, no `--async`), so
    // it is named up front.
    void cliInfo()
      .then((info) => {
        useOrganizationStore.setState({
          cliWarning: info.supported ? null : info.message,
        });
      })
      .catch(() => {});

    // A failed write used to be swallowed: the UI reported success and the
    // data was gone on next launch. It then borrowed the org list's "could not
    // reach the CLI" banner, which only the Organizations page shows.
    onPersistFailure((message) =>
      toast.error(message, { title: "A setting was not saved" }),
    );

    void initialize();
  }, []);

  return <>{children}</>;
}
