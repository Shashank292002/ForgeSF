import { toast } from "../../../components/ui/Toast/toast";
import { errorKind, errorMessage } from "../../../lib/errors";
import { requestReauthentication } from "../store/reauthStore";
import type { Organization } from "../types";

/**
 * When an org command failed because the org needs logging in again, says
 * so with a button that opens the login for it. Returns whether it did;
 * other failures are left to the caller to show as before.
 *
 * An expired session used to surface as the CLI's raw error, wherever the
 * command was run from, with nothing to do about it on that screen.
 */
export function offerReauthentication(
  error: unknown,
  org: Organization | null | undefined,
): boolean {
  if (!org || errorKind(error) !== "authRequired") return false;

  toast.error(errorMessage(error), {
    title: `${org.alias} needs you to log in again`,
    // It stays until acted on or closed: the fix is one click away.
    durationMs: null,
    action: {
      label: "Re-authenticate",
      onClick: () => requestReauthentication(org),
    },
  });
  return true;
}
