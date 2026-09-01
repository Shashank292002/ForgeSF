import type { ReactNode } from "react";

import styles from "./Badge.module.css";
import { cls } from "../../../lib/cls";

export type BadgeTone =
  "default" | "success" | "warning" | "error" | "info" | "purple";

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}

export default function Badge({
  children,
  tone = "default",
  dot = false,
  className,
}: BadgeProps) {
  return (
    <span className={cls(styles.badge, styles[tone], className)}>
      {dot && <span className={styles.dot} aria-hidden />}
      {children}
    </span>
  );
}
