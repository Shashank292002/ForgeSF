import type { ConfirmOptions } from "../../../components/ui/Confirm/confirm";
import type { Organization } from "../types";

/**
 * Whether an org should be treated as protected.
 *
 * Production orgs are protected by default: the audit found any connected org
 * could be deployed to or logged out of from any screen with no distinction
 * between a scratch org and a live production environment. This is the single
 * predicate every destructive action consults, so the rule lives in one place
 * rather than being re-derived per call site.
 */
export function isProtectedOrg(org: Organization | null | undefined): boolean {
  if (!org) return false;
  return org.orgType === "Production";
}

/**
 * The confirmation for a destructive action against `org`, or null when it
 * is safe to run without asking.
 *
 * @param action What is about to happen, as a phrase: "Log out".
 * @param confirmLabel The confirm button; defaults to `action`.
 */
export function protectionPrompt(
  org: Organization | null | undefined,
  action: string,
  confirmLabel?: string,
): ConfirmOptions | null {
  if (!isProtectedOrg(org) || !org) return null;
  return {
    title: `${action} on a production org?`,
    message: "This affects a live production environment.",
    details: [org.alias, org.username, org.instanceUrl],
    confirmLabel: confirmLabel ?? action,
    tone: "danger",
  };
}
