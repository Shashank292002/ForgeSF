import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listMetadataComponents,
  listMetadataTypes,
} from "../../../services/tauri";
import type { MetadataType } from "../types";

/**
 * An org's metadata listings, cached and shared.
 *
 * Every one of these starts the Salesforce CLI — one to three seconds — and
 * the answers barely change while the app is open. They used to be fetched
 * again on each visit, and separately by the Retrieve wizard and the
 * Deployments page, so picking a deploy scope re-ran a listing the wizard had
 * just done.
 */
const FRESH_FOR_MS = 10 * 60 * 1000;

const TYPES = "metadata-types";
const COMPONENTS = "metadata-components";

const typesKey = (username: string | undefined) => [TYPES, username] as const;
const componentsKey = (username: string | undefined, kind: string | null) =>
  [COMPONENTS, username, kind] as const;

/** The metadata types an org has. */
export function useMetadataTypes(username: string | undefined) {
  return useQuery({
    queryKey: typesKey(username),
    queryFn: () => listMetadataTypes(username as string),
    enabled: Boolean(username),
    staleTime: FRESH_FOR_MS,
  });
}

/**
 * The components of the type being looked at, plus every list already held
 * for the other chosen types — the picker counts "3 of 12 components" from
 * those, and only the active type is listed from the org.
 */
export function useComponentsOfTypes(
  username: string | undefined,
  kinds: string[],
  active: string | null,
) {
  const results = useQueries({
    queries: kinds.map((kind) => ({
      queryKey: componentsKey(username, kind),
      queryFn: () => listMetadataComponents(kind, username as string),
      enabled: Boolean(username) && kind === active,
      staleTime: FRESH_FOR_MS,
    })),
  });

  const byKind: Record<string, string[]> = {};
  kinds.forEach((kind, index) => {
    const members = results[index]?.data;
    if (members) byKind[kind] = members;
  });

  const current = active ? results[kinds.indexOf(active)] : undefined;
  return {
    byKind,
    loading: current?.isFetching ?? false,
    error: current?.error ?? null,
    /** Lists the active type again — what a failed listing's Retry needs. */
    refetch: () => {
      void current?.refetch();
    },
  };
}

/**
 * Lists a type's components for code outside the render flow — the check a
 * retrieve runs before it starts — reusing the cache while it is fresh.
 */
export function useComponentLister() {
  const client = useQueryClient();
  return (username: string, kind: string): Promise<string[]> =>
    client.fetchQuery({
      queryKey: componentsKey(username, kind),
      queryFn: () => listMetadataComponents(kind, username),
      staleTime: FRESH_FOR_MS,
    });
}

export type { MetadataType };
