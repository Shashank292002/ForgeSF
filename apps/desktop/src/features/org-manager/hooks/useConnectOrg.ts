import { useState } from "react";

import { connectSalesforce } from "../../../services/tauri";
import { useOrganizationStore } from "../../../store/orgStore";

interface ConnectOrgState {
  connect: () => Promise<void>;
  loading: boolean;
  error: string | null;
  dismissError: () => void;
}

/**
 * Shared "Add Organization" behaviour.
 *
 * Both entry points previously inlined this and swallowed failures into
 * `console.error`, so a cancelled or failed login just stopped the spinner
 * with no explanation on screen.
 */
export function useConnectOrg(): ConnectOrgState {
  const addOrganization = useOrganizationStore((s) => s.addOrganization);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const organization = await connectSalesforce();
      addOrganization({
        ...organization,
        connectedAt: new Date().toISOString(),
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not connect to Salesforce.",
      );
    } finally {
      setLoading(false);
    }
  }

  return { connect, loading, error, dismissError: () => setError(null) };
}
