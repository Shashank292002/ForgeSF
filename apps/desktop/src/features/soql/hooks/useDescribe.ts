import { useQuery, useQueryClient } from "@tanstack/react-query";

import { describeSObject, listSObjects } from "../services/describeService";
import type { SObjectDescribe } from "@/types/generated";

/**
 * The org's shape, cached.
 *
 * A describe is a large payload and a slow call — the CLI start-up plus a
 * round trip — and an org's fields do not change while you are typing a
 * query. Both are cached for the session so autocomplete is instant after the
 * first use of an object.
 */
const FRESH_FOR_MS = 30 * 60 * 1000;

export const sobjectsKey = (username: string | undefined) =>
  ["sobjects", username] as const;

export const describeKey = (
  username: string | undefined,
  sobject: string | null,
  tooling: boolean,
) => ["describe", username, sobject, tooling] as const;

/** One object's fields, for the completion list. */
export function useDescribe(
  username: string | undefined,
  sobject: string | null,
  tooling = false,
) {
  return useQuery({
    queryKey: describeKey(username, sobject, tooling),
    queryFn: () =>
      describeSObject(username as string, sobject as string, tooling),
    enabled: Boolean(username) && Boolean(sobject),
    staleTime: FRESH_FOR_MS,
  });
}

/**
 * Describes an object from outside the render flow — what a completion
 * provider needs, since Monaco asks for suggestions rather than re-rendering.
 * Reuses whatever is cached.
 */
export function useDescriber() {
  const client = useQueryClient();
  return (
    username: string,
    sobject: string,
    tooling = false,
  ): Promise<SObjectDescribe> =>
    client.fetchQuery({
      queryKey: describeKey(username, sobject, tooling),
      queryFn: () => describeSObject(username, sobject, tooling),
      staleTime: FRESH_FOR_MS,
    });
}

/** The object list, for the same reason. */
export function useSObjectLister() {
  const client = useQueryClient();
  return (username: string): Promise<string[]> =>
    client.fetchQuery({
      queryKey: sobjectsKey(username),
      queryFn: () => listSObjects(username),
      staleTime: FRESH_FOR_MS,
    });
}
