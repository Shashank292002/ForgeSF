import { useEffect } from "react";
import { Users } from "lucide-react";

import OrgList from "./components/OrgList";
import AddOrgButton from "./components/AddOrgButton";

import {
  getOrganizations,
  getSelectedOrganizationId,
} from "../../services/storage";

import { useOrganizationStore } from "../../store/orgStore";

import styles from "./OrgManagerPage.module.css";

export default function OrgManagerPage() {
  const organizations = useOrganizationStore((s) => s.organizations);
  const setOrganizations = useOrganizationStore((s) => s.setOrganizations);
  const setSelectedOrganization = useOrganizationStore((s) => s.setSelectedOrganization);

  useEffect(() => {
    async function loadOrganizations() {
      const orgs = await getOrganizations();
      const selectedOrganizationId = await getSelectedOrganizationId();

      setOrganizations(orgs);

      const selectedOrganization =
        orgs.find((org) => org.id === selectedOrganizationId) ?? orgs[0] ?? null;

      setSelectedOrganization(selectedOrganization);
    }

    loadOrganizations();
  }, [setOrganizations, setSelectedOrganization]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <div className={styles.titleBlock}>
            <span className={styles.headingIcon}>
              <Users size={22} />
            </span>
            <div>
              <h1 className={styles.title}>Organizations</h1>
              <p className={styles.subtitle}>
                Connect, manage, and switch between your Salesforce organizations.
              </p>
            </div>
          </div>
        </div>

        <AddOrgButton />
      </header>

      <div className={styles.summary}>
        <span>
          <b>{organizations.length}</b> connected org{organizations.length === 1 ? "" : "s"}
        </span>
        <span className={styles.divider}>·</span>
        <span>Org credentials are stored locally via the Salesforce CLI.</span>
      </div>

      <OrgList />
    </div>
  );
}
