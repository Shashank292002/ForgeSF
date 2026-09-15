import type { ConfirmOptions } from "@/components/ui/Confirm/confirm";
import { isProtectedOrg } from "@/features/org-manager/lib/orgProtection";
import type { Organization } from "@/features/org-manager/types";
import type { Workspace } from "../types";

/**
 * The confirmation for deploying a workspace to an org it does not belong to,
 * or null when the two match (or the workspace belongs to no org).
 *
 * Each org owns its own folder. Sending one org's folder to another is a
 * legitimate promotion (sandbox → production), but it is also exactly what a
 * stale org selection looks like, so it is always named before it runs.
 */
export function workspaceOrgMismatchPrompt(
  workspace: Workspace | null | undefined,
  target: Organization | null | undefined,
  organizations: Organization[],
): ConfirmOptions | null {
  if (!workspace || !target || !workspace.orgId) return null;
  if (workspace.orgId === target.id) return null;

  const owner =
    organizations.find((org) => org.id === workspace.orgId)?.alias ??
    "a different org";

  return {
    title: `Deploy ${owner}'s files to ${target.alias}?`,
    message:
      `The open workspace "${workspace.name}" belongs to ${owner}, ` +
      `but the deploy targets ${target.alias} (${target.username}).`,
    confirmLabel: `Deploy to ${target.alias}`,
    tone: "danger",
  };
}

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
