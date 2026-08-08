import { NavLink } from "react-router-dom";
import { navigation } from "../navigation/navigation";
import styles from "./AppSidebar.module.css";

export default function AppSidebar() {
  return (
    <aside className={styles.sidebar}>

      <nav>
        <ul className={styles.navList}>
          {navigation.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  isActive
                    ? `${styles.navLink} ${styles.active}`
                    : styles.navLink
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}