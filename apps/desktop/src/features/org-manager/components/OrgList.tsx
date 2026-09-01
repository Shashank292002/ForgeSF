import OrgCard from "./OrgCard";
import EmptyState from "./EmptyState";
import { useOrganizationStore } from "../../../store/orgStore";

import styles from "./OrgList.module.css";

export default function OrgList() {
  const organizations = useOrganizationStore((s) => s.organizations);

  if (organizations.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className={styles.grid}>
      {organizations.map((org) => (
        <OrgCard key={org.id} org={org} />
      ))}
    </div>
  );
}
