import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cls } from "../../../lib/cls";
import {
  dismissToast,
  useToastStore,
  type Toast,
  type ToastTone,
} from "./toast";

import styles from "./Toaster.module.css";

const ICONS: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

function ToastItem({ toast }: { toast: Toast }) {
  const Icon = ICONS[toast.tone];
  // Pointer over a toast holds it open, so a long error can be read.
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (toast.durationMs === null || paused) return;
    const timer = setTimeout(() => dismissToast(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, paused]);

  return (
    <div
      className={cls(styles.toast, styles[toast.tone])}
      // Errors interrupt a screen reader; everything else waits its turn.
      role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon size={16} className={styles.icon} aria-hidden />
      <div className={styles.text}>
        {toast.title && <p className={styles.title}>{toast.title}</p>}
        <p className={styles.message}>{toast.message}</p>
      </div>
      <button
        type="button"
        className={styles.close}
        aria-label="Dismiss notification"
        title="Dismiss"
        onClick={() => dismissToast(toast.id)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Stacks notifications in the bottom-right corner. Mount once, at the root. */
export default function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  if (toasts.length === 0) return null;

  return createPortal(
    <section className={styles.stack} aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </section>,
    document.body,
  );
}
