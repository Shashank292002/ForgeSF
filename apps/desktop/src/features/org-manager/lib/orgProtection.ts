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

/** Wording for a destructive action against `org`, or null when it is safe. */
export function protectionPrompt(
  org: Organization | null | undefined,
  action: string,
): string | null {
  if (!isProtectedOrg(org) || !org) return null;
  return (
    `${action} on a PRODUCTION org?\n\n` +
    `  ${org.alias}\n  ${org.username}\n  ${org.instanceUrl}\n\n` +
    "This affects a live production environment."
  );
}
