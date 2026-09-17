import { create } from "zustand";

import type { Organization } from "../types";

/**
 * The org whose login dialog is open, from wherever it was asked for: an org
 * card, or a notice about a command that failed because the session expired.
 */
interface ReauthState {
  org: Organization | null;
}

export const useReauthStore = create<ReauthState>(() => ({ org: null }));

/** Opens the login dialog for `org`. */
export function requestReauthentication(org: Organization) {
  useReauthStore.setState({ org });
}

export function closeReauthentication() {
  useReauthStore.setState({ org: null });
}
