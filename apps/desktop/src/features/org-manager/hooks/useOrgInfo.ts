import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getOrgDetails, getOrgLimits } from "../../../services/tauri";

/**
 * What an org says about itself.
 *
 * Both calls start the Salesforce CLI, so they are cached and shared: the
 * Settings page and the org details panel ask for the same thing.
 */

/** Identity and instance barely change while the app is open. */
const DETAILS_FRESH_FOR_MS = 10 * 60 * 1000;

/** Limits move as you use the org, so they go stale quickly. */
const LIMITS_FRESH_FOR_MS = 60 * 1000;

const DETAILS = "org-details";
const LIMITS = "org-limits";

export const orgDetailsKey = (username: string | undefined) =>
  [DETAILS, username] as const;

export const orgLimitsKey = (username: string | undefined) =>
  [LIMITS, username] as const;

export function useOrgDetails(username: string | undefined) {
  return useQuery({
    queryKey: orgDetailsKey(username),
    queryFn: () => getOrgDetails(username as string),
    enabled: Boolean(username),
    staleTime: DETAILS_FRESH_FOR_MS,
  });
}

export function useOrgLimits(username: string | undefined) {
  return useQuery({
    queryKey: orgLimitsKey(username),
    queryFn: () => getOrgLimits(username as string),
    enabled: Boolean(username),
    staleTime: LIMITS_FRESH_FOR_MS,
  });
}

/**
 * Drops what is cached for an org, so the next read asks the org again.
 * Used by the panel's Refresh, and after re-authenticating.
 */
export function useRefreshOrgInfo() {
  const client = useQueryClient();
  return (username: string) => {
    void client.invalidateQueries({ queryKey: orgDetailsKey(username) });
    void client.invalidateQueries({ queryKey: orgLimitsKey(username) });
  };
}
