import styles from "./Badge.module.css";

interface BadgeProps {
  children: React.ReactNode;
}

export default function Badge({ children }: BadgeProps) {
  return <span className={styles.badge}>{children}</span>;
}