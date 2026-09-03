import { Search, Menu, User } from "lucide-react";

import { useOrganizationStore } from "../../store/orgStore";

import styles from "./AppHeader.module.css";

interface AppHeaderProps {
  onToggleSidebar: () => void;
}

export default function AppHeader({ onToggleSidebar }: AppHeaderProps) {
  const organization = useOrganizationStore((s) => s.selectedOrganization);

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <button
          className={styles.menuBtn}
          onClick={onToggleSidebar}
          aria-label="Toggle navigation"
        >
          <Menu size={20} />
        </button>

        <div className={styles.brand}>
          <span className={styles.logo}>⚡</span>
          <div className={styles.brandText}>
            <span className={styles.title}>ForgeSF</span>
            <span className={styles.tagline}>Salesforce Toolkit</span>
          </div>
        </div>
      </div>

      <div className={styles.search}>
        <Search size={17} />
        <input
          className={styles.searchInput}
          disabled
          title="Global search is not implemented yet"
          placeholder="Search (coming soon)"
        />
      </div>

      <div className={styles.actions}>
        <div className={styles.orgPill}>
          <span className={styles.orgAvatar}>
            <User size={15} />
          </span>
          <div className={styles.orgInfo}>
            <span className={styles.orgName}>
              {organization ? organization.alias : "No Org Selected"}
            </span>
            <span className={styles.orgType}>
              {organization ? organization.orgType : "Connect to begin"}
            </span>
          </div>
          <span
            className={`${styles.onlineDot} ${
              organization ? styles.online : styles.offline
            }`}
          />
        </div>
      </div>
    </header>
  );
}
