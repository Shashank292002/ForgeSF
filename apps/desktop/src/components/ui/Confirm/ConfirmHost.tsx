import { useId, useState } from "react";

import Button from "../Button/Button";
import Dialog from "../Dialog/Dialog";
import { answer, useAskStore, type PendingAsk } from "./confirm";

import styles from "./ConfirmHost.module.css";

function AskDialog({ entry }: { entry: PendingAsk }) {
  const { options } = entry;
  const inputId = useId();
  const choiceId = useId();
  const [text, setText] = useState(options.input?.initialValue ?? "");
  const [choice, setChoice] = useState(options.choices?.[0]?.value ?? "");
  const dismiss = () => answer(entry.id, null);
  // A text dialog answers with what was typed; a drop-down with what was
  // selected. The action value only decides *that* it was confirmed, and an
  // empty field cannot confirm at all.
  const empty = options.input !== undefined && text.trim() === "";
  const chose = (value: string) =>
    answer(entry.id, options.input ? text : options.choices ? choice : value);
  const focus =
    options.input !== undefined
      ? undefined
      : (options.focus ?? options.actions.at(-1)?.value);
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
              disabled={empty}
              data-autofocus={focus === action.value ? "" : undefined}
              onClick={() => chose(action.value)}
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
      {options.choices && options.choices.length > 0 && (
        <div className={styles.field}>
          {options.choicesLabel && (
            <label htmlFor={choiceId}>{options.choicesLabel}</label>
          )}
          <select
            id={choiceId}
            value={choice}
            data-autofocus=""
            onChange={(event) => setChoice(event.target.value)}
          >
            {options.choices.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {options.input && (
        <div className={styles.field}>
          {options.input.label && (
            <label htmlFor={inputId}>{options.input.label}</label>
          )}
          <input
            id={inputId}
            type="text"
            value={text}
            placeholder={options.input.placeholder}
            // Focused and selected on open, so typing replaces the old value
            // — the same as renaming in the explorer.
            data-autofocus=""
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || empty) return;
              event.preventDefault();
              chose(options.actions.at(-1)?.value ?? "");
            }}
          />
        </div>
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
