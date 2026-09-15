import { useRef, useState } from "react";

import {
  cancelSfCommand,
  connectSalesforce,
  newRunId,
  type ConnectOptions,
} from "../../../services/tauri";
import { useOrganizationStore } from "../../../store/orgStore";
import type { Organization } from "../types";

interface ConnectOrgState {
  /** Resolves to the connected org, or null if it failed or was cancelled. */
  connect: (options?: ConnectOptions) => Promise<Organization | null>;
  /** Abandons an in-progress browser login. */
  cancel: () => void;
  loading: boolean;
  error: string | null;
  dismissError: () => void;
}

/**
 * Shared "connect an org" behaviour.
 *
 * Both entry points previously inlined this and swallowed failures into
 * `console.error`, so a cancelled or failed login just stopped the spinner
 * with no explanation on screen. A login waiting on the browser could also not
 * be abandoned: closing the tab left the button spinning until restart.
 */
export function useConnectOrg(): ConnectOrgState {
  const addOrganization = useOrganizationStore((s) => s.addOrganization);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef<string | null>(null);
  const cancelled = useRef(false);

  async function connect(options: ConnectOptions = {}) {
    if (loading) return null;
    const id = newRunId();
    runId.current = id;
    cancelled.current = false;
    setLoading(true);
    setError(null);
    try {
      const organization = await connectSalesforce(options, id);
      const connected = {
        ...organization,
        connectedAt: new Date().toISOString(),
      };
      addOrganization(connected);
      return connected;
    } catch (caught) {
      // A cancel the user asked for is not an error worth showing.
      if (!cancelled.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : typeof caught === "string"
              ? caught
              : "Could not connect to Salesforce.",
        );
      }
      return null;
    } finally {
      runId.current = null;
      setLoading(false);
    }
  }

  function cancel() {
    if (!runId.current) return;
    cancelled.current = true;
    void cancelSfCommand(runId.current);
  }

  return {
    connect,
    cancel,
    loading,
    error,
    dismissError: () => setError(null),
  };
}
