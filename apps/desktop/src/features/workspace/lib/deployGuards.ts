import { isProtectedOrg } from "@/features/org-manager/lib/orgProtection";
import type { Organization } from "@/features/org-manager/types";

/**
 * Whether deploying to `org` should ask first.
 *
 * Sandbox, Scratch and Developer orgs are the inner loop — a confirmation on
 * every single-file deploy would be noise. Production is the one that warrants
 * a pause. This only became trustworthy once org types were derived from
 * `sf org list` rather than hardcoded to "Production" for everything.
 */
export function needsDeployConfirmation(
  org: Organization | null | undefined,
): boolean {
  // Delegates to the single protection rule so deploy, logout and any future
  // destructive action agree on what counts as protected.
  return isProtectedOrg(org);
}

/**
 * The unsaved buffers a retrieve into `target` would overwrite.
 *
 * A retrieve rewrites files on disk; edits sitting only in the editor are
 * silently superseded. Scoped to the selection so retrieving one class does
 * not warn about an unrelated open file.
 */
export function buffersAffectedBy(
  target: string,
  dirty: Record<string, boolean>,
): string[] {
  const prefix = `${target}/`;
  return Object.entries(dirty)
    .filter(([, isDirty]) => isDirty)
    .map(([path]) => path)
    .filter((path) => path === target || path.startsWith(prefix))
    .sort();
}
