import type { ReactNode } from "react";

import styles from "./Card.module.css";
import { cls } from "../../../lib/cls";

interface CardProps {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  interactive?: boolean;
  accent?: "primary" | "accent" | "warm" | "none";
  className?: string;
  children: ReactNode;
}

export default function Card({
  title,
  subtitle,
  icon,
  action,
  interactive = false,
  accent = "none",
  className,
  children,
}: CardProps) {
  const heading =
    title || icon ? (
      <div className={styles.head}>
        <div className={styles.headLeft}>
          {icon && <span className={styles.icon}>{icon}</span>}
          <div>
            {title && <h3 className={styles.title}>{title}</h3>}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
        </div>
        {action && <div className={styles.action}>{action}</div>}
      </div>
    ) : null;

  return (
    <div
      className={cls(
        styles.card,
        interactive && styles.interactive,
        accent !== "none" && styles[`accent-${accent}`],
        className,
      )}
    >
      {heading}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
