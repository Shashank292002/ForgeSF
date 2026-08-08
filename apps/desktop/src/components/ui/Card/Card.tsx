import type { ReactNode } from "react";

import styles from "./Card.module.css";

interface CardProps {
  title?: string;
  children: ReactNode;
}

export default function Card({ title, children }: CardProps) {
  return (
    <div className={styles.card}>
      {title && <h3 className={styles.title}>{title}</h3>}

      <div className={styles.content}>{children}</div>
    </div>
  );
}