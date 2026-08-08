import { Card } from "../../../components/ui";

import styles from "./StatCard.module.css";

interface StatCardProps {
  title: string;
  value: string | number;
}

export default function StatCard({
  title,
  value,
}: StatCardProps) {
  return (
    <Card>
      <div className={styles.container}>
        <span className={styles.title}>{title}</span>

        <span className={styles.value}>{value}</span>
      </div>
    </Card>
  );
}