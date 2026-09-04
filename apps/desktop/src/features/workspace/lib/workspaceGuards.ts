import type { Workspace } from "../types";

/** Why a retrieve is being questioned before it runs. */
export interface MixingWarning {
  workspaceName: string;
  /** Org that populated the tree, as an id — resolved to a label by the caller. */
  previousOrgId: string;
}

/**
 * Decides whether retrieving into `workspace` from `orgId` would mix two orgs'
 * metadata in one tree.
 *
 * Only warns when the workspace has actually been populated before and by a
 * *different* org — a first retrieve, or a repeat from the same org, is silent.
 */
export function mixingWarningFor(
  workspace: Workspace | undefined,
  orgId: string | undefined,
): MixingWarning | null {
  if (!workspace || !orgId) return null;

  const previousOrgId = workspace.lastRetrievedOrgId;
  if (!previousOrgId || previousOrgId === orgId) return null;

  return { workspaceName: workspace.name, previousOrgId };
}
