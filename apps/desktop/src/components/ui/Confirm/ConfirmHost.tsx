import Button from "../Button/Button";
import Dialog from "../Dialog/Dialog";
import { answer, useAskStore, type PendingAsk } from "./confirm";

import styles from "./ConfirmHost.module.css";

function AskDialog({ entry }: { entry: PendingAsk }) {
  const { options } = entry;
  const dismiss = () => answer(entry.id, null);
  const focus = options.focus ?? options.actions.at(-1)?.value;
  const paragraphs = (options.message ?? "")
    .split(/\n\s*\n/)
    .map((text) => text.trim())
    .filter(Boolean);

  return (
    <Dialog
      title={options.title}
      onClose={dismiss}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            data-autofocus={focus === "cancel" ? "" : undefined}
            onClick={dismiss}
          >
            {options.cancelLabel ?? "Cancel"}
          </Button>
          {options.actions.map((action) => (
            <Button
              key={action.value}
              variant={action.variant ?? "primary"}
              size="sm"
              data-autofocus={focus === action.value ? "" : undefined}
              onClick={() => answer(entry.id, action.value)}
            >
              {action.label}
            </Button>
          ))}
        </>
      }
    >
      {paragraphs.map((text, index) => (
        <p key={index} className={styles.message}>
          {text}
        </p>
      ))}
      {options.details && options.details.length > 0 && (
        <ul className={styles.details}>
          {options.details.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/**
 * Renders the question at the front of the `ask` queue. Mount once, at the
 * root; questions asked while one is open wait their turn.
 */
export default function ConfirmHost() {
  const current = useAskStore((state) => state.queue[0]);
  // Keyed by id, so each question gets a fresh dialog and focus trap.
  return current ? <AskDialog key={current.id} entry={current} /> : null;
}
