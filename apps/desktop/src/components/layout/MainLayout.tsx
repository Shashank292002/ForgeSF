import { Outlet } from "react-router-dom";
import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";
import styles from "./MainLayout.module.css";

export default function MainLayout() {
  return (
    <div className={styles.container}>
      <AppHeader />

      <div className={styles.content}>
        <AppSidebar />

        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}