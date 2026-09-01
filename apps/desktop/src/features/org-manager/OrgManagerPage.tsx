import { useState } from "react";
import { RefreshCw, Users } from "lucide-react";

import OrgList from "./components/OrgList";
import AddOrgButton from "./components/AddOrgButton";

import { listOrgs } from "../../services/tauri";
import { useOrganizationStore } from "../../store/orgStore";

import styles from "./OrgManagerPage.module.css";

export default function OrgManagerPage() {
  const organizations = useOrganizationStore((s) => s.organizations);
  const setOrganizations = useOrganizationStore((s) => s.setOrganizations);
  const orgLoadError = useOrganizationStore((s) => s.orgLoadError);

  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No load-on-mount here: AppInitializer already reconciles against the CLI
  // at startup. Repeating it meant a duplicate CLI call and a redundant disk
  // write every time this page was opened. Refreshing is now explicit.
  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const live = await listOrgs();
      setOrganizations(live);
      useOrganizationStore.setState({ orgLoadError: null });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not reach the Salesforce CLI.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  const notice = error ?? orgLoadError;

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
                Connect, manage, and switch between your Salesforce
                organizations.
              </p>
            </div>
          </div>
        </div>

        <AddOrgButton />
      </header>

      {notice && (
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          <span className={styles.noticeHint}>
            Showing the last known list — it may be out of date.
          </span>
        </div>
      )}

      <div className={styles.summary}>
        <span>
          <b>{organizations.length}</b> connected org
          {organizations.length === 1 ? "" : "s"}
        </span>
        <span className={styles.divider}>·</span>
        <span>Org credentials are stored locally via the Salesforce CLI.</span>
        <span className={styles.divider}>·</span>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          <RefreshCw
            size={13}
            className={refreshing ? styles.spinning : undefined}
          />
          {refreshing ? "Refreshing…" : "Refresh from CLI"}
        </button>
      </div>

      <OrgList />
    </div>
  );
}
