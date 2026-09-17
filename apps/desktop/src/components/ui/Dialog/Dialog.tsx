import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { useDialog } from "../../../hooks/useDialog";

import styles from "./Dialog.module.css";

interface DialogProps {
  title: string;
  description?: ReactNode;
  /** Called for the close button, Escape, and a click on the backdrop. */
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * A modal dialog: a scrim, a focus-trapped panel, and a close affordance.
 *
 * Confirmations go through `confirm`/`ask` (see `Confirm/confirm.ts`), which
 * render on this.
 */
export default function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
}: DialogProps) {
  const dialogRef = useDialog(onClose);

  // Rendered into <body>: cards that open dialogs use `transform` and
  // `backdrop-filter`, which would otherwise make the card the containing
  // block for this `position: fixed` overlay and trap it inside the card.
  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>{title}</h2>
            {description && <p className={styles.description}>{description}</p>}
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className={styles.body}>{children}</div>

        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
