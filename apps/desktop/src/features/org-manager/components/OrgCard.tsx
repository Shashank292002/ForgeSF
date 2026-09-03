import type { Organization } from "../types";

import { openOrg, setDefaultOrg, logoutOrg } from "../../../services/tauri";

import { useOrganizationStore } from "../../../store/orgStore";
import { Button, Badge } from "../../../components/ui";
import { Cloud, ExternalLink, Star, LogOut, Check, MapPin } from "lucide-react";

import styles from "./OrgCard.module.css";

interface Props {
  org: Organization;
}

export default function OrgCard({ org }: Props) {
  const removeOrganization = useOrganizationStore((s) => s.removeOrganization);
  const setSelectedOrganization = useOrganizationStore(
    (s) => s.setSelectedOrganization,
  );
  const selectedOrganization = useOrganizationStore(
    (s) => s.selectedOrganization,
  );

  const isSelected = selectedOrganization?.id === org.id;
  const isConnected = org.status === "Connected";

  async function handleOpenOrg() {
    try {
      await openOrg(org.username);
    } catch (error) {
      console.error("Failed to open org:", error);
    }
  }

  async function handleSelect() {
    setSelectedOrganization(org);
  }

  async function handleSetDefault() {
    try {
      await setDefaultOrg(org.username);
      setSelectedOrganization(org);
    } catch (error) {
      console.error(error);
    }
  }

  async function handleRemove() {
    const confirmRemove = window.confirm(`Logout ${org.username}?`);
    if (!confirmRemove) return;

    try {
      await logoutOrg(org.username);
      await removeOrganization(org.id);
    } catch (error) {
      console.error("Failed to logout org:", error);
    }
  }

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

      {isSelected && (
        <div className={styles.activeBanner}>Active Organization</div>
      )}

      <div className={styles.actions}>
        <Button
          variant={isSelected ? "primary" : "secondary"}
          size="sm"
          leftIcon={<Check size={14} />}
          onClick={handleSelect}
        >
          {isSelected ? "Selected" : "Select"}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          leftIcon={<ExternalLink size={14} />}
          onClick={handleOpenOrg}
        >
          Open Org
        </Button>

        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Star size={14} />}
          onClick={handleSetDefault}
        >
          Set Default
        </Button>

        <Button
          variant="danger"
          size="sm"
          leftIcon={<LogOut size={14} />}
          onClick={handleRemove}
        >
          Logout
        </Button>
      </div>
    </div>
  );
}
