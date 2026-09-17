import { useLocation } from "react-router-dom";
import ForgeMark from "../brand/ForgeMark";
import { NavLink } from "react-router-dom";
import { ChevronLeft, X, Cloud } from "lucide-react";

import { navigationGroups } from "../navigation/navigation";
import { useOrganizationStore } from "../../store/orgStore";

import styles from "./AppSidebar.module.css";

interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  open: boolean;
  onClose: () => void;
}

export default function AppSidebar({
  collapsed,
  onToggleCollapse,
  open,
  onClose,
}: AppSidebarProps) {
  const location = useLocation();
  const organization = useOrganizationStore((s) => s.selectedOrganization);

  return (
    <>
      {open && <div className={styles.backdrop} onClick={onClose} />}

      <aside
        className={[
          styles.sidebar,
          collapsed ? styles.collapsed : "",
          open ? styles.open : "",
        ].join(" ")}
      >
        <div className={styles.topRow}>
          <div className={styles.brand}>
            <span className={styles.logo}>
              <ForgeMark size={20} />
            </span>
            <span className={styles.brandName}>
              Forge<span className={styles.brandAccent}>SF</span>
            </span>
          </div>

          <div className={styles.topActions}>
            <button
              className={styles.iconBtn}
              onClick={onToggleCollapse}
              aria-label="Toggle sidebar"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className={`${styles.iconBtn} ${styles.closeBtn}`}
              onClick={onClose}
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <nav className={styles.nav}>
          {navigationGroups.map((group) => (
            <div className={styles.group} key={group.label}>
              <span className={styles.groupLabel}>{group.label}</span>

              <ul className={styles.navList}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    location.pathname === item.path ||
                    (item.path !== "/" &&
                      location.pathname.startsWith(item.path));

                  return (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        onClick={onClose}
                        className={
                          isActive
                            ? `${styles.navLink} ${styles.active}`
                            : styles.navLink
                        }
                      >
                        <span className={styles.icon}>
                          <Icon size={18} />
                        </span>
                        <span className={styles.label}>{item.label}</span>
                        {isActive && <span className={styles.activeDot} />}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className={styles.footer}>
          <div className={styles.orgBox}>
            <span className={styles.orgIcon}>
              <Cloud size={16} />
            </span>
            <div className={styles.orgMeta}>
              <span className={styles.orgLabel}>
                {organization ? "Active Org" : "No Org"}
              </span>
              <span className={styles.orgName}>
                {organization?.alias ?? "Connect an org"}
              </span>
            </div>
            <span
              className={`${styles.statusDot} ${
                organization ? styles.statusConnected : styles.statusIdle
              }`}
            />
          </div>
        </div>
      </aside>
    </>
  );
}
