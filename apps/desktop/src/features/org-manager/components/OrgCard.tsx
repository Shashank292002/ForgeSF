import { useState } from "react";

import type { Organization } from "../types";

import {
  listOrgs,
  logoutOrg,
  openOrg,
  setDefaultOrg,
} from "../../../services/tauri";

import { useOrganizationStore } from "../../../store/orgStore";
import { Button, Badge } from "../../../components/ui";
import {
  Check,
  Cloud,
  ExternalLink,
  Info,
  KeyRound,
  LogOut,
  MapPin,
  Star,
} from "lucide-react";

import { isProtectedOrg, protectionPrompt } from "../lib/orgProtection";
import { confirm } from "../../../components/ui/Confirm/confirm";
import { toast } from "../../../components/ui/Toast/toast";
import { requestReauthentication } from "../store/reauthStore";
import OrgDetailsDialog from "./OrgDetailsDialog";
import { errorMessage } from "../../../lib/errors";

import styles from "./OrgCard.module.css";

interface Props {
  org: Organization;
}

export default function OrgCard({ org }: Props) {
  const removeOrganization = useOrganizationStore((s) => s.removeOrganization);
  const setOrganizations = useOrganizationStore((s) => s.setOrganizations);
  const setSelectedOrganization = useOrganizationStore(
    (s) => s.setSelectedOrganization,
  );
  const selectedOrganization = useOrganizationStore(
    (s) => s.selectedOrganization,
  );

  // Failures used to go to console.error only, so a failed logout or
  // set-default looked like the button did nothing.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"default" | "logout" | "open" | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const isSelected = selectedOrganization?.id === org.id;
  const isProtected = isProtectedOrg(org);
  const isConnected = org.status === "Connected";

  async function run(action: typeof busy, work: () => Promise<void>) {
    setBusy(action);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const handleOpenOrg = () => run("open", () => openOrg(org.username));

  const handleSetDefault = () =>
    run("default", async () => {
      await setDefaultOrg(org.username);
      setSelectedOrganization(org);
      // Re-read so the Default badge moves to this org instead of staying on
      // the previous one.
      setOrganizations(await listOrgs({ skipConnectionStatus: true }));
      toast.success(`${org.alias} is now the Salesforce CLI's default org.`);
    });

  const handleLogout = async () => {
    // Production gets the full identity of what is being disconnected.
    const prompt = protectionPrompt(org, "Log out", "Log out") ?? {
      title: `Log out of ${org.alias}?`,
      message:
        "The Salesforce CLI forgets this org's login. You can connect it again later.",
      details: [org.username],
      confirmLabel: "Log out",
      tone: "danger" as const,
    };
    if (!(await confirm(prompt))) return;

    await run("logout", async () => {
      await logoutOrg(org.username);
      removeOrganization(org.id);
      // The card disappears, so the outcome is reported where it stays visible.
      toast.success(`Logged out of ${org.alias}.`);
    });
  };

  return (
    <div className={`${styles.card} ${isSelected ? styles.selected : ""}`}>
      <div className={styles.cardTop}>
        <div className={styles.avatar}>
          <Cloud size={20} />
        </div>

        <div className={styles.titleWrap}>
          <div className={styles.titleRow}>
            <h3 className={styles.title}>{org.alias || org.username}</h3>
            {org.isDefault && (
              <Badge tone="purple" dot>
                Default
              </Badge>
            )}
          </div>
          <span className={styles.username}>{org.username}</span>
        </div>

        {isProtected && (
          <Badge tone="warning" dot>
            Protected
          </Badge>
        )}

        <Badge tone={isConnected ? "success" : "warning"} dot>
          {org.status}
        </Badge>
      </div>

      <ul className={styles.info}>
        <li>
          <span className={styles.label}>Org ID</span>
          <code>{org.id}</code>
        </li>
        <li>
          <span className={styles.label}>Type</span>
          <Badge tone="info">{org.orgType}</Badge>
        </li>
        <li>
          <span className={styles.label}>Instance</span>
          <span className={styles.instance}>
            <MapPin size={12} />
            {org.instanceUrl}
          </span>
        </li>
      </ul>

      {!isConnected && (
        <div className={styles.expired} role="status">
          <span>
            {org.status === "Expired"
              ? "The session has expired."
              : "ForgeSF can't reach this org."}{" "}
            Log in again to keep using it.
          </span>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<KeyRound size={14} />}
            onClick={() => requestReauthentication(org)}
          >
            Re-authenticate
          </Button>
        </div>
      )}

      {isSelected && (
        <div className={styles.activeBanner}>Active Organization</div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <Button
          variant={isSelected ? "primary" : "secondary"}
          size="sm"
          leftIcon={<Check size={14} />}
          onClick={() => setSelectedOrganization(org)}
        >
          {isSelected ? "Selected" : "Select"}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          leftIcon={<ExternalLink size={14} />}
          onClick={() => void handleOpenOrg()}
          loading={busy === "open"}
        >
          Open Org
        </Button>

        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Info size={14} />}
          onClick={() => setShowDetails(true)}
        >
          Details
        </Button>

        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Star size={14} />}
          onClick={() => void handleSetDefault()}
          loading={busy === "default"}
          disabled={org.isDefault}
        >
          {org.isDefault ? "Default" : "Set Default"}
        </Button>

        <Button
          variant="danger"
          size="sm"
          leftIcon={<LogOut size={14} />}
          onClick={() => void handleLogout()}
          loading={busy === "logout"}
        >
          Logout
        </Button>
      </div>

      {showDetails && (
        <OrgDetailsDialog org={org} onClose={() => setShowDetails(false)} />
      )}
    </div>
  );
}
